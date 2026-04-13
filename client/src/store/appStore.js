import { create } from 'zustand';
import { decodePDO, decodeRDO } from '../parsers/pd_parser';

/**
 * Global application state managed by Zustand.
 */

// ── Topology initial shapes ──────────────────────────────────────
const INIT_SOURCE  = { connected: false, pdRevision: null, eprActive: false, capabilities: [], contract: null, status: null };
const INIT_EMARKER = { sop1Detected: false, sop2Detected: false, cableCurrentMa: null, maxVbusV: null, isActive: null, eprCapable: null };
const INIT_SINK    = { connected: false, pdRevision: null, eprActive: false, capabilities: [], lastRequest: null, status: null };

export const INITIAL_TOPOLOGY = {
  source:  { ...INIT_SOURCE },
  eMarker: { ...INIT_EMARKER },
  sink:    { ...INIT_SINK },
  cable:   { attached: false },
  vbusMv:  null,
  ccPin:   null,
};

/**
 * Pure state-machine function: apply one decoded frame to topology and return new topology.
 * Called both for live WebSocket frames and during file-import replay.
 */
function applyFrameToTopo(topo, frame) {
  const { recordType, header, cpd, eventName, dataObjects, parsedPayload, vbusMv, ccPin } = frame;

  // ── EVENT records ──
  if (recordType === 'EVENT') {
    if (eventName === 'DETACHED') {
      // Cable disconnected → full reset
      return { ...INITIAL_TOPOLOGY };
    }
    if (eventName === 'ATTACHED') {
      // Cable (re)connected
      return { ...topo, cable: { attached: true } };
    }
    return topo;
  }

  // ── ASCII_LOG: extract VBUS / CC pin ──
  if (recordType === 'ASCII_LOG') {
    if (vbusMv === undefined && ccPin === undefined) return topo;
    const next = { ...topo };
    if (vbusMv !== undefined) next.vbusMv = vbusMv;
    if (ccPin   !== undefined) next.ccPin  = ccPin;
    return next;
  }

  // ── PD messages ──
  if (recordType !== 'PD_MSG' || !header) return topo;

  const typeName = header.typeName;
  const sopQual  = cpd?.sopQualName ?? 'SOP';
  const isSOP    = sopQual === 'SOP';
  const isSOP1   = sopQual === "SOP'";
  const isSOP2   = sopQual === "SOP''";
  const isSrcDir = cpd?.dirName === 'SRC\u2192SNK';
  const isSnkDir = cpd?.dirName === 'SNK\u2192SRC';

  // Hard Reset → reset PD state; keep cable-attach / VBUS readings
  if (typeName === 'Hard_Reset') {
    return { ...INITIAL_TOPOLOGY, cable: topo.cable, vbusMv: topo.vbusMv, ccPin: topo.ccPin };
  }

  // Soft Reset → reset negotiation; keep discovered capabilities & cable
  if (typeName === 'Soft_Reset') {
    return {
      ...topo,
      source: { ...topo.source, contract: null },
      sink:   { ...topo.sink,   lastRequest: null },
    };
  }

  const next = { ...topo };

  if (isSOP) {
    if (typeName === 'Source_Capabilities' && isSrcDir) {
      const caps = (dataObjects ?? []).map((dw, i) => decodePDO(dw, i + 1));
      // Source advertising caps → both sides are present on the bus
      next.source = { ...next.source, connected: true, pdRevision: header.specRevision, capabilities: caps };
      next.sink   = { ...next.sink,   connected: true };

    } else if (typeName === 'Sink_Capabilities') {
      const caps = (dataObjects ?? []).map((dw, i) => decodePDO(dw, i + 1));
      next.sink   = { ...next.sink,   connected: true, pdRevision: header.specRevision, capabilities: caps };
      next.source = { ...next.source, connected: true };

    } else if ((typeName === 'Request' || typeName === 'EPR_Request') && isSnkDir) {
      if (dataObjects?.length) {
        // Determine the correct PDO type from the source capabilities before decoding RDO
        const rawRdo  = dataObjects[0];
        const objPos  = (rawRdo >>> 28) & 0xF;
        const srcPdo  = next.source.capabilities[objPos - 1];
        const srcType = srcPdo?.pdoType ?? (typeName === 'EPR_Request' ? 'APDO_AVS' : 'Fixed');
        const rdo = decodeRDO(rawRdo, srcType);
        // Sink sending a request → both sides present
        next.sink   = { ...next.sink,   connected: true, lastRequest: rdo };
        next.source = { ...next.source, connected: true };
      }

    } else if (typeName === 'PS_RDY' && isSrcDir) {
      // Contract established: cross-reference RDO with the source capabilities
      const rdo = next.sink?.lastRequest;
      if (rdo && next.source.capabilities.length) {
        const pdo = next.source.capabilities[rdo.objPos - 1] ?? null;
        const isAdjustable = rdo.rdoType === 'PPS' || rdo.rdoType === 'AVS';
        next.source = {
          ...next.source,
          contract: {
            pdo,
            objPos:        rdo.objPos,
            opVoltage_mV:  isAdjustable ? rdo.opVoltage_mV : null,
            opCurrent_mA:  rdo.opCurrent_mA,
            maxCurrent_mA: isAdjustable ? rdo.opCurrent_mA : rdo.maxCurrent_mA,
            capMismatch:   rdo.capMismatch,
            rdoType:       rdo.rdoType,
          },
        };
      }

    } else if (typeName === 'EPR_Mode') {
      next.source = { ...next.source, eprActive: true };
      next.sink   = { ...next.sink,   eprActive: true };

    } else if (typeName === 'Status') {
      // Extended Status message — store decoded payload for topology display
      if (isSrcDir) next.source = { ...next.source, status: parsedPayload };
      else if (isSnkDir) next.sink = { ...next.sink, status: parsedPayload };
    }
  }

  // eMarker detection via SOP' / SOP'' traffic
  if (isSOP1) next.eMarker = { ...next.eMarker, sop1Detected: true };
  if (isSOP2) next.eMarker = { ...next.eMarker, sop2Detected: true };

  // SOP' Discover Identity ACK → decode cable plug VDO for current rating, type, etc.
  if (isSOP1 && typeName === 'Vendor_Defined' && dataObjects?.length >= 5) {
    const vdmHdr     = dataObjects[0];
    const structured = (vdmHdr >>> 15) & 0x1;
    const cmd        = vdmHdr & 0x1F;
    const cmdType    = (vdmHdr >>> 6) & 0x3;
    if (structured && cmd === 0x01 && cmdType === 1) {
      // Cable Plug VDO is the 5th DO (index 4)
      const cableVdo      = dataObjects[4];
      const curRating     = (cableVdo >>> 5) & 0x3;
      const cableCurrentMa = curRating === 1 ? 3000 : curRating === 2 ? 5000 : null;
      const maxVbusV      = [20, 30, 40, 50][(cableVdo >>> 8) & 0x3] ?? 20;
      const isActive      = ((cableVdo >>> 10) & 0x3) >= 2;
      const eprCapable    = !!(cableVdo & (1 << 15));
      next.eMarker = { ...next.eMarker, sop1Detected: true, cableCurrentMa, maxVbusV, isActive, eprCapable };
    }
  }

  return next;
}

export const useAppStore = create((set, get) => ({
  // --- Connection ---
  wsStatus: 'disconnected',
  setWsStatus: (s) => set({ wsStatus: s }),

  // --- Serial port status (mirrored from server) ---
  serialStatus: { connected: false, port: null, baudRate: null, error: null },
  setSerialStatus: (s) => set({ serialStatus: s }),

  // --- Available serial ports (hotplug list from server) ---
  serialPorts: [],
  setSerialPorts: (ports) => set({ serialPorts: ports }),

  // --- Hex dump mode: log every raw CPD_RECORD hex to console ---
  hexDump: false,
  setHexDump: (v) => set({ hexDump: v }),

  // --- Messages (time-series decoded frames) ---
  messages: [],
  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages, { id: state.messages.length, ...msg }],
    })),
  setMessages: (msgs) =>
    set({ messages: msgs.map((m, i) => ({ id: i, ...m })) }),
  clearMessages: () => set({ messages: [] }),

  // --- Import status ---
  importStatus: { loading: false, filename: '', done: 0, total: 0, warnings: 0 },
  setImportStatus: (patch) =>
    set((state) => ({ importStatus: { ...state.importStatus, ...patch } })),

  // --- Topology state ---
  topology: { ...INITIAL_TOPOLOGY },

  /** Apply a single decoded frame (incremental update — live WebSocket). */
  applyFrame: (frame) =>
    set((state) => ({ topology: applyFrameToTopo(state.topology, frame) })),

  /** Replay all frames from scratch to rebuild topology (called after file import). */
  replayFrames: (frames) => {
    let topo = { ...INITIAL_TOPOLOGY };
    for (const f of frames) topo = applyFrameToTopo(topo, f);
    set({ topology: topo });
  },

  /** Manual full reset from UI button. */
  resetTopology: () => set({ topology: { ...INITIAL_TOPOLOGY } }),

  // --- Console log ---
  consoleLogs: [],
  appendLog: (line) =>
    set((state) => ({
      consoleLogs: [...state.consoleLogs.slice(-4999), `${new Date().toISOString()} ${line}`],
    })),
  clearLogs: () => set({ consoleLogs: [] }),
}));

