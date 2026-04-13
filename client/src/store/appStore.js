import { create } from 'zustand';
import { decodePDO, decodeRDO } from '../parsers/pd_parser';

/**
 * Global application state managed by Zustand.
 */

// ── Topology initial shapes ──────────────────────────────────────
const INIT_SOURCE  = { connected: false, pdRevision: null, eprActive: false, capabilities: [], contract: null };
const INIT_EMARKER = { sop1Detected: false, sop2Detected: false, vdoInfo: null };
const INIT_SINK    = { connected: false, pdRevision: null, eprActive: false, capabilities: [], lastRequest: null };

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
  const { recordType, header, cpd, eventName, dataObjects, vbusMv, ccPin } = frame;

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
      next.source = { ...next.source, connected: true, pdRevision: header.specRevision, capabilities: caps };

    } else if (typeName === 'Sink_Capabilities') {
      const caps = (dataObjects ?? []).map((dw, i) => decodePDO(dw, i + 1));
      next.sink = { ...next.sink, connected: true, pdRevision: header.specRevision, capabilities: caps };

    } else if ((typeName === 'Request' || typeName === 'EPR_Request') && isSnkDir) {
      const rdo = dataObjects?.length ? decodeRDO(dataObjects[0]) : null;
      next.sink = { ...next.sink, lastRequest: rdo };

    } else if (typeName === 'PS_RDY' && isSrcDir) {
      // Contract established: cross-reference RDO with the source capabilities
      const rdo = next.sink?.lastRequest;
      if (rdo && next.source.capabilities.length) {
        const pdo = next.source.capabilities[rdo.objPos - 1] ?? null;
        next.source = {
          ...next.source,
          contract: {
            pdo,
            objPos:        rdo.objPos,
            opCurrent_mA:  rdo.opCurrent_mA,
            maxCurrent_mA: rdo.maxCurrent_mA,
            capMismatch:   rdo.capMismatch,
          },
        };
      }

    } else if (typeName === 'EPR_Mode') {
      next.source = { ...next.source, eprActive: true };
      next.sink   = { ...next.sink,   eprActive: true };
    }
  }

  // eMarker detection via SOP' / SOP'' traffic
  if (isSOP1) next.eMarker = { ...next.eMarker, sop1Detected: true };
  if (isSOP2) next.eMarker = { ...next.eMarker, sop2Detected: true };

  return next;
}

export const useAppStore = create((set, get) => ({
  // --- Connection ---
  wsStatus: 'disconnected',
  setWsStatus: (s) => set({ wsStatus: s }),

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

