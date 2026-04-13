/**
 * USB Power Delivery message parser — Rev 3.2 compliant
 *
 * Entrypoints:
 *   parseCpdFile(arrayBuffer)     — Parse a STM32CubeMonitor-UCPD .cpd binary file
 *   parseRawFrame(hexStr, source) — Parse a single USB-PD frame from a hex string
 *
 * ============================================================
 * .cpd Binary Record Structure (per record, 20 + N bytes total)
 * ============================================================
 *
 *  Offset  Size  Field
 *  ------  ----  ---------------------------------------------------
 *   00-03    4   Sync:       FD FD FD FD  (always)
 *   04-05    2   FixedField: 32 00        (always; format/version ID)
 *   06       1   Cat:        payloadLen + 9  (redundant length encoding)
 *                            cat = 0x0B → len=2  (ctrl, NDO=0)
 *                            cat = 0x0F → len=6  (data, NDO=1)
 *                            cat = 0x13 → len=10 (data, NDO=2)
 *                            cat = 0x17 → len=14 (data, NDO=3 or Extended)
 *                            cat = 0x1B → len=18 (data, NDO=4)
 *                            cat = 0x1F → len=22 (data, NDO=5 or VDM)
 *                            cat = 0x23 → len=26 (data, NDO=6)
 *                            cat = 0x27 → len=30 (data, NDO=7 or Src_Cap_Ext)
 *                            cat = 0x09 → len=0  (Event marker, no PD payload)
 *                            cat = 0x16-0x18 → ASCII debug string
 *   07       1   Dir:        0x07 = Source→Sink  (TX direction)
 *                            0x08 = Sink→Source  (RX direction)
 *                            0x06 = ASCII debug/status string (not a PD frame)
 *                            0x03 = Event marker (SOP'/SOP'' detection event)
 *   08-0B    4   Timestamp:  LE uint32, firmware free-running timer ticks
 *   0C       1   Pad0:       always 0x00
 *   0D       1   SopQual:    0x00 = SOP  / 0x01 = SOP'  / 0x02 = SOP''
 *                            (non-zero only when Dir=0x03, Cat=0x09)
 *   0E       1   Pad1:       always 0x00
 *   0F       1   PayloadLen: number of bytes in payload (= Cat - 9)
 *   10..    N    Payload:    USB-PD message bytes  OR  ASCII string
 *   10+N..  4    Sentinel:   A5 A5 A5 A5 (observed always; accept any value)
 *                            Possible future encoding (unconfirmed):
 *                              25 25 25 25 → SOP  ordered-set
 *                              65 25 25 25 → SOP' ordered-set
 *                              25 65 65 65 → SOP'' ordered-set
 * ============================================================
 */

// ---------- Constants ----------

export const SOP_TYPES = {
  0b10001: 'SOP',
  0b10010: "SOP'",
  0b10011: "SOP''",
  0b10100: 'SOP_DBG1',
  0b10101: 'SOP_DBG2',
};

/** Dir byte → human-readable direction label */
export const CPD_DIR = {
  0x07: 'SRC→SNK',  // Source to Sink
  0x08: 'SNK→SRC',  // Sink to Source
  0x06: 'DEBUG',    // ASCII debug/status string
  0x03: 'EVENT',    // Event marker (SOP' / SOP'' detection)
};

/** SOP qualifier byte (offset 0x0D) */
export const CPD_SOP_QUAL = {
  0x00: 'SOP',
  0x01: "SOP'",
  0x02: "SOP''",
};

/**
 * EVENT type names derived from sopQual byte.
 * SOP' (0x01) = DETACHED, SOP'' (0x02) = ATTACHED
 * (observed from STM32CubeMonitor-UCPD original display)
 */
export const CPD_EVENT_NAME = {
  0x01: 'DETACHED',   // SOP' cable plug marker lost
  0x02: 'ATTACHED',  // SOP'' cable plug marker detected
};

/** Record type (derived from dir) */
export const CPD_RECORD_TYPE = {
  0x07: 'PD_MSG',
  0x08: 'PD_MSG',
  0x06: 'ASCII_LOG',
  0x03: 'EVENT',
};

export const MSG_TYPE_CTRL = {
  0x00: 'Reserved',
  0x01: 'GoodCRC',
  0x02: 'GotoMin',
  0x03: 'Accept',
  0x04: 'Reject',
  0x05: 'Ping',
  0x06: 'PS_RDY',
  0x07: 'Get_Source_Cap',
  0x08: 'Get_Sink_Cap',
  0x09: 'DR_Swap',
  0x0a: 'PR_Swap',
  0x0b: 'VCONN_Swap',
  0x0c: 'Wait',
  0x0d: 'Soft_Reset',
  0x0e: 'Data_Reset',
  0x0f: 'Data_Reset_Complete',
  0x10: 'Not_Supported',
  0x11: 'Get_Source_Cap_Extended',
  0x12: 'Get_Status',
  0x13: 'FR_Swap',
  0x14: 'Get_PPS_Status',
  0x15: 'Get_Country_Codes',
  0x16: 'Get_Sink_Cap_Extended',
  0x17: 'Get_Source_Info',
  0x18: 'Get_Revision',
};

export const MSG_TYPE_DATA = {
  0x01: 'Source_Capabilities',
  0x02: 'Request',
  0x03: 'BIST',
  0x04: 'Sink_Capabilities',
  0x05: 'Battery_Status',
  0x06: 'Alert',
  0x07: 'Get_Country_Info',
  0x08: 'Enter_USB',
  0x09: 'EPR_Request',
  0x0a: 'EPR_Mode',
  0x0b: 'Source_Info',
  0x0c: 'Revision',
  0x0f: 'Vendor_Defined',
};

/** Table 6-5 (USB PD Rev 3.2): Extended Message type codes (Extended bit = 1) */
export const MSG_TYPE_EXT = {
  0x01: 'Source_Capabilities_Extended',
  0x02: 'Status',
  0x03: 'Get_Battery_Cap',
  0x04: 'Get_Battery_Status',
  0x05: 'Battery_Capabilities',
  0x06: 'Get_Manufacturer_Info',
  0x07: 'Manufacturer_Info',
  0x08: 'Security_Request',
  0x09: 'Security_Response',
  0x0a: 'Firmware_Update_Request',
  0x0b: 'Firmware_Update_Response',
  0x0c: 'PPS_Status',
  0x0d: 'Country_Info',
  0x0e: 'Country_Codes',
  0x0f: 'Sink_Capabilities_Extended',
  0x10: 'Extended_Control',
  0x11: 'EPR_Source_Capabilities',
  0x12: 'EPR_Sink_Capabilities',
};

// ---------- Header parser ----------

/**
 * Parse a USB-PD 16-bit Message Header.
 * @param {number} word  16-bit little-endian message header value
 * @returns {object}
 */
/**
 * @param {number} word     16-bit message header word (little-endian already resolved)
 * @param {number} sopQual  0=SOP (default), 1=SOP', 2=SOP'' — governs bit-8 and bit-5 semantics (Table 6.1)
 */
export function parseMessageHeader(word, sopQual = 0) {
  const numDataObjects = (word >> 12) & 0x7;
  const msgId          = (word >> 9) & 0x7;
  const bit8           = (word >> 8) & 0x1;
  const specRevision   = (word >> 6) & 0x3;  // 0=1.0, 1=2.0, 2=3.0, 3=3.1
  const bit5           = (word >> 5) & 0x1;
  const msgType        = word & 0x1f;
  const extended       = (word >> 15) & 0x1;

  // Table 6.1: bit 8 and bit 5 meaning differs for SOP vs SOP'/SOP''
  const isSop = sopQual === 0;
  // SOP only  : bit 8 = Port Power Role (0=Sink, 1=Source)
  // SOP'/SOP'': bit 8 = Cable Plug      (0=DFP/UFP port, 1=Cable Plug)
  const portPowerRole = isSop ? (bit8 ? 'Source' : 'Sink') : null;
  const cablePlug     = isSop ? null : !!bit8;
  // SOP only  : bit 5 = Port Data Role  (0=UFP, 1=DFP)
  // SOP'/SOP'': bit 5 = Reserved
  const portDataRole  = isSop ? (bit5 ? 'DFP' : 'UFP') : null;

  const isControl = numDataObjects === 0 && !extended;
  const typeName = isControl
    ? (MSG_TYPE_CTRL[msgType] ?? `Ctrl_0x${msgType.toString(16)}`)
    : extended
      ? (MSG_TYPE_EXT[msgType]  ?? `Ext_0x${msgType.toString(16)}`)
      : (MSG_TYPE_DATA[msgType] ?? `Data_0x${msgType.toString(16)}`);

  return {
    extended: !!extended,
    numDataObjects,
    msgId,
    portPowerRole,
    portDataRole,
    cablePlug,
    specRevision: ['1.0', '2.0', '3.0', '3.1'][specRevision] ?? `Rev${specRevision}`,
    msgType,
    typeName,
    isControl,
  };
}

/**
 * Parse 16-bit Extended Message Header per Table 6.3 (USB PD Rev 3.2).
 * Layout:  bit 15 = Chunked | bits 14..11 = Chunk Number | bit 10 = Request Chunk
 *          bit  9 = Reserved | bits 8..0 = Data Size
 *
 * @param {number} word  16-bit Extended Message Header (little-endian already resolved)
 * @returns {{ chunked: boolean, chunkNumber: number, requestChunk: boolean, dataSize: number }}
 */
export function parseExtendedMsgHeader(word) {
  return {
    chunked:      !!((word >> 15) & 0x1),   // bit 15
    chunkNumber:   (word >> 11) & 0xf,       // bits 14..11
    requestChunk: !!((word >> 10) & 0x1),    // bit 10
    // bit 9: Reserved (ignored)
    dataSize:      word & 0x1ff,             // bits 8..0
  };
}

// ---------- Frame parser ----------

/**
 * Parse a raw hex frame string into a PdMessage.
 *
 * Expected format (STM32G071B-DISCO protocol, extensible):
 *   Each byte as 2-hex-char, space-separated.
 *   e.g. "12 34 56 78"
 *
 * @param {string} hexStr   Raw hex bytes as space-separated string
 * @param {string} source   'STM32' | 'KM003C'
 * @returns {object|null}   Decoded PdMessage or null on error
 */
export function parseRawFrame(hexStr, source) {
  try {
    const bytes = hexStr
      .trim()
      .split(/\s+/)
      .map((h) => parseInt(h, 16));

    if (bytes.length < 2) return null;

    // First two bytes: 16-bit message header (little-endian)
    const headerWord = bytes[0] | (bytes[1] << 8);
    const header = parseMessageHeader(headerWord);

    // When Extended bit is set, bytes 2-3 carry the Extended Message Header (Table 6.3).
    // Actual data objects follow from byte 4.
    let doOffset = 2;
    let extendedHeader = null;
    if (header.extended && bytes.length >= 4) {
      extendedHeader = parseExtendedMsgHeader(bytes[2] | (bytes[3] << 8));
      doOffset = 4;
    }

    // Remaining bytes: Data Objects (4 bytes each)
    const dataObjects = [];
    for (let i = doOffset; i + 3 < bytes.length; i += 4) {
      const dw =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      dataObjects.push(dw >>> 0); // keep as unsigned
    }

    return {
      ts: Date.now(),
      source,
      raw: hexStr,
      header,
      extendedHeader,
      dataObjects,
      parsedPayload: (header.typeName === 'Source_Capabilities_Extended' && bytes.length >= doOffset + 25)
        ? decodeSourceCapsExtended(bytes.slice(doOffset, doOffset + 25))
        : (header.typeName === 'Status' && bytes.length >= doOffset + 7)
          ? decodeStatus(bytes.slice(doOffset, doOffset + 7))
          : (header.typeName === 'Extended_Control' && bytes.length >= doOffset + 2)
            ? decodeExtendedControl(bytes.slice(doOffset))
            : (header.typeName === 'Sink_Capabilities_Extended' && bytes.length >= doOffset + 21)
              ? decodeSinkCapsExtended(bytes.slice(doOffset))
              : null,
      pdoSummary: (header.typeName === 'Source_Info' && dataObjects.length)
        ? decodeSIDO(dataObjects[0]).label
        : undefined,
    };
  } catch (e) {
    console.warn('[pd_parser] Parse error:', e.message, hexStr);
    return null;
  }
}

// ---------- PDO / RDO Decoder ----------

/** Format a mV value: drop decimals when it's a round 100 mV or 1 V multiple */
function fmtV(mv) {
  if (mv % 1000 === 0) return `${mv / 1000}V`;
  if (mv % 100  === 0) return `${(mv / 1000).toFixed(1)}V`;
  return `${(mv / 1000).toFixed(2)}V`;
}

/** Format a mA value: drop decimals when clean */
function fmtA(ma) {
  if (ma % 1000 === 0) return `${ma / 1000}A`;
  if (ma % 100  === 0) return `${(ma / 1000).toFixed(1)}A`;
  return `${(ma / 1000).toFixed(2)}A`;
}

/**
 * Build a compact one-line PDO summary string suitable for the log Raw column.
 * e.g. "[1] Fixed:5V/3A │ [2] Fixed:9V/3A │ [5] PPS:5-11V/5A"
 *
 * @param {string}   typeName    'Source_Capabilities' | 'Sink_Capabilities'
 * @param {number[]} dataObjects Array of raw uint32 PDO words
 * @returns {string}
 */
export function buildPdoSummary(typeName, dataObjects) {
  if (!dataObjects?.length) return '';
  return dataObjects.map((dw, i) => {
    const pdo = decodePDO(dw, i);
    const n   = pdo.index;
    switch (pdo.pdoType) {
      case 'Fixed':
        return `[${n}] Fixed:${fmtV(pdo.vMv)}/${fmtA(pdo.iMa)}`;
      case 'Battery':
        return `[${n}] Battery:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${(pdo.wMax/1000).toFixed(0)}W`;
      case 'Variable':
        return `[${n}] Var:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${fmtA(pdo.iMa)}`;
      case 'APDO_PPS':
        return `[${n}] PPS:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${fmtA(pdo.iMa)}`;
      case 'APDO_AVS':
        return `[${n}] AVS:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${pdo.pdpW}W`;
      default:
        return `[${n}] ?:${pdo.raw}`;
    }
  }).join('  ');
}

/**
 * Build a compact one-line RDO summary string for the log parsed column.
 * e.g. "PDO#2  Op:3A  Max:3A  [CapMismatch]"
 *
 * @param {number} dw       Unsigned 32-bit RDO word
 * @param {string} pdoType  Optional source PDO type ('APDO_PPS' | 'APDO_AVS' | others)
 * @returns {string}
 */
export function buildRdoSummary(dw, pdoType = 'Fixed') {
  const rdo = decodeRDO(dw, pdoType);
  let parts;
  if (pdoType === 'APDO_PPS' || pdoType === 'APDO_AVS') {
    parts = [`PDO#${rdo.objPos}`, `Out:${fmtV(rdo.opVoltage_mV)}`, `Op:${fmtA(rdo.opCurrent_mA)}`];
  } else {
    parts = [`PDO#${rdo.objPos}`, `Op:${fmtA(rdo.opCurrent_mA)}`, `Max:${fmtA(rdo.maxCurrent_mA)}`];
  }
  if (rdo.capMismatch) parts.push('CapMismatch');
  if (rdo.eprMode)     parts.push('EPR');
  if (rdo.giveBack)    parts.push('GiveBack');
  return parts.join('  ');
}

/**
 * Decode a single 32-bit Power Data Object (PDO) from Source or Sink Capabilities.
 * USB PD Rev 3.2, §6.4.1
 *
 * @param {number} dw    Unsigned 32-bit PDO value
 * @param {number} index 0-based PDO index (for display)
 * @returns {object}     Decoded PDO with type-specific fields
 */
export function decodePDO(dw, index) {
  const pdoType = (dw >>> 30) & 0x3;

  const base = { index: index + 1, raw: `0x${dw.toString(16).toUpperCase().padStart(8, '0')}` };

  if (pdoType === 0b00) {
    // Fixed Supply
    const vMv  = ((dw >>> 10) & 0x3FF) * 50;
    const iMa  = (dw & 0x3FF) * 10;
    return {
      ...base,
      pdoType: 'Fixed',
      vMv, iMa,
      // Capability flags (Source side; bits may differ for Sink)
      dualRolePower:       !!(dw & (1 << 29)),
      usbSuspend:          !!(dw & (1 << 28)),
      unconstrainedPower:  !!(dw & (1 << 27)),
      usbCommsCapable:     !!(dw & (1 << 26)),
      dualRoleData:        !!(dw & (1 << 25)),
      unchunkedExtMsg:     !!(dw & (1 << 24)),
      eprModeCapable:      !!(dw & (1 << 23)),
      label: `Fixed ${fmtV(vMv)} / ${fmtA(iMa)}`,
    };
  }

  if (pdoType === 0b01) {
    // Battery
    const vMaxMv = ((dw >>> 20) & 0x3FF) * 50;
    const vMinMv = ((dw >>> 10) & 0x3FF) * 50;
    const wMax   = (dw & 0x3FF) * 250;
    return {
      ...base,
      pdoType: 'Battery',
      vMaxMv, vMinMv, wMax,
      label: `Battery ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${(wMax/1000).toFixed(0)}W`,
    };
  }

  if (pdoType === 0b10) {
    // Variable Supply (non-battery)
    const vMaxMv = ((dw >>> 20) & 0x3FF) * 50;
    const vMinMv = ((dw >>> 10) & 0x3FF) * 50;
    const iMa   = (dw & 0x3FF) * 10;
    return {
      ...base,
      pdoType: 'Variable',
      vMaxMv, vMinMv, iMa,
      label: `Variable ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${fmtA(iMa)}`,
    };
  }

  // pdoType === 0b11 → Augmented PDO (APDO)
  const apdoType = (dw >>> 28) & 0x3;

  if (apdoType === 0b00) {
    // PPS (Programmable Power Supply)
    const vMaxMv = ((dw >>> 17) & 0xFF) * 100;
    const vMinMv = ((dw >>> 8)  & 0xFF) * 100;
    const iMa   = (dw & 0x7F) * 50;
    const ppsType = (dw >>> 28) & 0x3;  // always 0 here
    return {
      ...base,
      pdoType: 'APDO_PPS',
      vMaxMv, vMinMv, iMa,
      label: `PPS ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${fmtA(iMa)}`,
    };
  }

  if (apdoType === 0b01) {
    // EPR AVS (Adjustable Voltage Supply) — Rev 3.2 Table 6.14
    // B27..26 = Peak Current, B25..17 = Vmax/100mV, B16 = Rsvd, B15..8 = Vmin/100mV, B7..0 = PDP/W
    const peakCurrent = (dw >>> 26) & 0x3;  // Table 6.15
    const vMaxMv = ((dw >>> 17) & 0x1FF) * 100;
    const vMinMv = ((dw >>> 8)  & 0xFF)  * 100;
    const pdpW   = (dw & 0xFF);
    // Table 6.15 human-readable labels
    const PEAK_CURRENT_LABEL = [
      'Peak = IOC (default)',
      'Peak 150%/1ms, 125%/2ms, 110%/10ms',
      'Peak 200%/1ms, 150%/2ms, 125%/10ms',
      'Peak 200%/1ms, 175%/2ms, 150%/10ms',
    ];
    return {
      ...base,
      pdoType: 'APDO_AVS',
      vMaxMv, vMinMv, pdpW,
      peakCurrent,
      peakCurrentLabel: PEAK_CURRENT_LABEL[peakCurrent],
      label: `AVS ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${pdpW}W`,
    };
  }

  return { ...base, pdoType: 'APDO_Unknown', label: `APDO unknown subtype 0x${apdoType.toString(16)}` };
}

/**
 * Decode a Source Information Data Object (SIDO). USB PD Rev 3.2, §6.4.11 / Table 6.52.
 *
 * Bit layout:
 *   B31       — Port Type          (0 = Managed Capability, 1 = Guaranteed Capability)
 *   B30…24    — Reserved
 *   B23…16    — Port Maximum PDP   (watts, static)
 *   B15…8     — Port Present PDP   (watts; static for Guaranteed, dynamic for Managed)
 *   B7…0      — Port Reported PDP  (watts; largest PDO voltage×current in Source_Caps)
 *
 * @param {number} dw  Unsigned 32-bit SIDO word
 * @returns {object}
 */
export function decodeSIDO(dw) {
  const portTypeRaw    = (dw >>> 31) & 0x1;
  const portType       = portTypeRaw ? 'Guaranteed' : 'Managed';
  const maxPdpW        = (dw >>> 16) & 0xFF;
  const presentPdpW    = (dw >>> 8)  & 0xFF;
  const reportedPdpW   =  dw         & 0xFF;

  return {
    raw:          `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
    portType,
    portTypeRaw,
    maxPdpW,
    presentPdpW,
    reportedPdpW,
    label: `${portType}  Max:${maxPdpW}W  Present:${presentPdpW}W  Reported:${reportedPdpW}W`,
  };
}

/**
 * Decode a Request Data Object (RDO). USB PD Rev 3.2, §6.4.2
 *
 * pdoType controls the bit-field interpretation:
 *   'APDO_PPS' — Table 6.22: B19..9 = OutVoltage×20mV, B6..0 = OpCurrent×50mA
 *   'APDO_AVS' — Table 6.35: B19..9 = OutVoltage×25mV, B6..0 = OpCurrent×50mA
 *   others     — Table 6.19: B19..10 = OpCurrent×10mA, B9..0 = MaxCurrent×10mA
 *
 * @param {number} dw       Unsigned 32-bit RDO value
 * @param {string} pdoType  Source PDO type the request targets (default 'Fixed')
 * @returns {object}
 */
export function decodeRDO(dw, pdoType = 'Fixed') {
  const raw          = `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const objPos       = (dw >>> 28) & 0xF;
  const capMismatch  = !!(dw & (1 << 26));
  const usbComms     = !!(dw & (1 << 25));
  const noUsbSuspend = !!(dw & (1 << 24));
  const unchunkedExt = !!(dw & (1 << 23));

  if (pdoType === 'APDO_PPS') {
    // Table 6.22 — PPS RDO
    const opVoltage_mV  = ((dw >>> 9) & 0x7FF) * 20;
    const opCurrent_mA  = (dw & 0x7F) * 50;
    return {
      raw, objPos, capMismatch, usbComms, noUsbSuspend, unchunkedExt,
      rdoType: 'PPS',
      opVoltage_mV,
      opCurrent_mA,
      label: `RDO(PPS) → PDO#${objPos}  Out:${fmtV(opVoltage_mV)}  Op:${fmtA(opCurrent_mA)}`,
    };
  }

  if (pdoType === 'APDO_AVS') {
    // Table 6.35 — EPR AVS RDO
    const opVoltage_mV  = ((dw >>> 9) & 0x7FF) * 25;
    const opCurrent_mA  = (dw & 0x7F) * 50;
    return {
      raw, objPos, capMismatch, usbComms, noUsbSuspend, unchunkedExt,
      rdoType: 'AVS',
      opVoltage_mV,
      opCurrent_mA,
      label: `RDO(AVS) → PDO#${objPos}  Out:${fmtV(opVoltage_mV)}  Op:${fmtA(opCurrent_mA)}`,
    };
  }

  // Fixed / Variable / Battery RDO — Table 6.19
  const giveBack      = !!(dw & (1 << 27));
  const eprMode       = !!(dw & (1 << 22));
  const opCurrent_mA  = ((dw >>> 10) & 0x3FF) * 10;
  const maxCurrent_mA = (dw & 0x3FF) * 10;
  return {
    raw, objPos, giveBack, capMismatch, usbComms, noUsbSuspend, unchunkedExt, eprMode,
    rdoType: 'Fixed',
    opCurrent_mA,
    maxCurrent_mA,
    label: `RDO → PDO#${objPos}  Op:${fmtA(opCurrent_mA)}  Max:${fmtA(maxCurrent_mA)}`,
  };
}

// ==================== VDM / Structured VDM Decoders ====================

/** USB PD Rev 3.2 Table 6.30 – Structured VDM command names */
const VDM_CMD_NAMES = {
  0x01: 'Discover Identity',
  0x02: 'Discover SVIDs',
  0x03: 'Discover Modes',
  0x04: 'Enter Mode',
  0x05: 'Exit Mode',
  0x06: 'Attention',
};

/** Command Type field (bits[7:6] of VDM header lower word) */
const VDM_CMD_TYPE = ['REQ', 'ACK', 'NAK', 'BUSY'];

/** Well-known SVIDs */
const VDM_SVID_NAMES = {
  0xFF00: 'SOP',       // used during identity discovery (no Alt Mode)
  0xFF01: 'DP',        // VESA DisplayPort Alt Mode
  0x8087: 'TBT3',     // Intel Thunderbolt 3
  0x04B4: 'Cypress',
  0x18D1: 'Google',
  0x2109: 'VIA Labs',
  0x04CC: 'OPPO/OnePlus',
};

function fmtSvid(svid) {
  const name = VDM_SVID_NAMES[svid];
  return name
    ? `${name} (0x${svid.toString(16).toUpperCase().padStart(4, '0')})`
    : `0x${svid.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Decode Discover Identity ACK VDOs (USB PD Rev 3.2 §6.4.4.3).
 * vdos = dataObjects[1..] (excluding the VDM header DO).
 *
 * DO order:  ID Header VDO, Cert Stat VDO, Product VDO, [Product Type VDO(s)]
 */
function decodeDiscoverIdentityVDOs(vdos) {
  const out = [];
  const hex32 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

  // ---- VDO[1] ID Header VDO (Table 6.41) ----
  if (vdos.length >= 1) {
    const dw   = vdos[0];
    const vid  = dw & 0xFFFF;
    const connType = (dw >>> 24) & 0x3; // bits[25:24]
    const connNames = ['Rsvd', 'USB-A', 'USB-B', 'USB-C'];
    const flags = [
      (dw >>> 31) & 1 ? 'USB Host' : null,
      (dw >>> 30) & 1 ? 'USB Device' : null,
      (dw >>> 29) & 1 ? 'Modal Op' : null,
      (dw >>> 28) & 1 ? 'USB4' : null,
    ].filter(Boolean).join(', ') || 'none';
    out.push({
      label: `ID Header VDO — VID=0x${vid.toString(16).toUpperCase().padStart(4,'0')} Conn=${connNames[connType]} Flags=[${flags}]`,
      raw: hex32(dw),
    });
  }

  // ---- VDO[2] Cert Stat VDO (Table 6.42): XID in bits[19:0] ----
  if (vdos.length >= 2) {
    const dw  = vdos[1];
    const xid = dw & 0x000FFFFF;
    out.push({
      label: `Cert Stat VDO — XID=0x${xid.toString(16).toUpperCase()}`,
      raw: hex32(dw),
    });
  }

  // ---- VDO[3] Product VDO (Table 6.43) ----
  if (vdos.length >= 3) {
    const dw  = vdos[2];
    const pid = (dw >>> 16) & 0xFFFF;
    const bcd = dw & 0xFFFF;
    out.push({
      label: `Product VDO — PID=0x${pid.toString(16).toUpperCase().padStart(4,'0')} bcdDevice=0x${bcd.toString(16).toUpperCase().padStart(4,'0')}`,
      raw: hex32(dw),
    });
  }

  // ---- VDO[4+] Product Type VDOs (Cable Plug or UFP/DFP) — raw for now ----
  for (let i = 3; i < vdos.length; i++) {
    out.push({
      label: `Product Type VDO[${i - 2}] — 0x${(vdos[i] >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
      raw: hex32(vdos[i]),
    });
  }

  return out;
}

/**
 * Decode Discover SVIDs ACK VDOs (USB PD Rev 3.2 §6.4.4.4).
 * Each VDO contains two SVIDs: bits[31:16] and bits[15:0].
 * The last entry has 0x0000 in bytes[15:0] when list ends.
 */
function decodeDiscoverSVIDsVDOs(vdos) {
  const out = [];
  for (const dw of vdos) {
    const s1 = (dw >>> 16) & 0xFFFF;
    const s2 = dw & 0xFFFF;
    const pair = [s1, s2].filter((s) => s !== 0).map(fmtSvid).join(', ');
    out.push({
      label: `SVID Pair: ${pair || '(end)'}`,
      raw: `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
    });
  }
  return out;
}

/**
 * Decode Discover Modes ACK VDOs for DisplayPort Alt Mode (SVID=0xFF01).
 * USB PD Rev 3.2 §B.1 – DP Capabilities VDO.
 */
function decodeDPModeVDOs(vdos) {
  const out = [];
  for (let i = 0; i < vdos.length; i++) {
    const dw = vdos[i];
    if (i === 0) {
      // DP Capabilities VDO
      const ufpD     = (dw >>> 0) & 0xF;  // bits[3:0]  UFP_D capable (Pin Assignments)
      const dfpD     = (dw >>> 8) & 0xF;  // bits[11:8] DFP_D capable
      const recep    = (dw >>> 6) & 0x1;  // bit[6]     Receptacle indication
      const usb20    = (dw >>> 7) & 0x1;  // bit[7]     USB 2.0 signaling
      const sig      = (dw >>> 16) & 0xF; // bits[19:16] DP Signaling
      const sigNames = { 0: 'DP', 1: 'Gen2', 2: 'Reserved', 8: 'Gen3' };
      out.push({
        label: `DP Capabilities VDO — UFP_D=0x${ufpD.toString(16).toUpperCase()} DFP_D=0x${dfpD.toString(16).toUpperCase()} Sig=${sigNames[sig] ?? sig}${recep ? ' Receptacle' : ' Plug'}${usb20 ? ' USB2.0' : ''}`,
        raw: `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
      });
    } else {
      out.push({
        label: `Mode VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
        raw: `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
      });
    }
  }
  return out;
}

/**
 * Decode Attention / Enter Mode / Exit Mode VDOs for DP (SVID=0xFF01).
 * DP Status VDO (Enter Mode ACK, Attention) – Table B-3.
 */
function decodeDPStatusVDO(dw) {
  const connected = (dw >>> 0) & 0x3;
  const adaptor   = (dw >>> 2) & 0x1;
  const powerLow  = (dw >>> 3) & 0x1;
  const enabled   = (dw >>> 4) & 0x1;
  const multifunc = (dw >>> 5) & 0x1;
  const usb       = (dw >>> 6) & 0x1;
  const exitDp    = (dw >>> 7) & 0x1;
  const hpd       = (dw >>> 8) & 0x1;
  const connNames = ['Disconnected', 'DFP_D', 'UFP_D', 'Both'];
  const flags = [
    adaptor ? 'Adaptor' : null,
    powerLow ? 'PowerLow' : null,
    enabled ? 'Enabled' : null,
    multifunc ? 'Multifunc' : null,
    usb ? 'USB' : null,
    exitDp ? 'ExitDP' : null,
    hpd ? 'HPD' : null,
  ].filter(Boolean).join(' ');
  return `DP Status VDO — Conn=${connNames[connected]}${flags ? ' ' + flags : ''}`;
}

// =======================================================================

/**
 * Decode all Data Objects in a message based on message type.
 * Returns an array of decoded child objects (for tree-view display).
 *
 * @param {string}   typeName     e.g. 'Source_Capabilities'
 * @param {number[]} dataObjects  Array of unsigned 32-bit DOs
 * @param {string}   [srcPdoType] Optional resolved source PDO type for RDO decoding
 * @returns {object[]|null}       Decoded children, or null if not expandable
 */
export function decodeDataObjects(typeName, dataObjects, srcPdoType) {
  if (!dataObjects || dataObjects.length === 0) return null;

  switch (typeName) {
    case 'Source_Capabilities':
    case 'Sink_Capabilities':
    case 'EPR_Source_Capabilities':
    case 'EPR_Sink_Capabilities':
      return dataObjects.map((dw, i) => decodePDO(dw, i));

    case 'Request':
      return [decodeRDO(dataObjects[0], srcPdoType ?? 'Fixed')];

    case 'EPR_Request':
      // DO[0]: EPR RDO (AVS type); DO[1]: mirror of the selected source EPR PDO (spec Table 6.38)
      return [
        decodeRDO(dataObjects[0], srcPdoType ?? 'APDO_AVS'),
        dataObjects[1] !== undefined
          ? { ...decodePDO(dataObjects[1], 1), eprMirror: true }
          : null,
      ].filter(Boolean);

    case 'EPR_Mode': {
      // USB PD Rev 3.2 Table 6.51 — EPRMDO
      // B31..24 = Action (8-bit), B23..16 = Data, B15..0 = Reserved
      const EPR_ACTION = {
        0x01: 'Enter',
        0x02: 'Enter Acknowledged',
        0x03: 'Enter Succeeded',
        0x04: 'Enter Failed',
        0x05: 'Exit',
      };
      const EPR_FAIL = {
        0x00: 'Unknown cause',
        0x01: 'Cable not EPR capable',
        0x02: 'Source failed to become VCONN source',
        0x03: 'EPR Mode Capable bit not set in RDO',
        0x04: 'Source unable to enter EPR Mode at this time',
        0x05: 'EPR Mode Capable bit not set in PDO',
      };
      return dataObjects.map((dw) => {
        const action = (dw >>> 24) & 0xFF;
        const data   = (dw >>> 16) & 0xFF;
        const actionLabel = EPR_ACTION[action] ?? `Reserved(0x${action.toString(16).toUpperCase()})`;
        const parts = [`Action: ${actionLabel}`];
        if (action === 0x01 && data) parts.push(`Sink PDP: ${data} W`);
        if (action === 0x04)         parts.push(`Reason: ${EPR_FAIL[data] ?? `Reserved(0x${data.toString(16)})` }`);
        return {
          label: parts.join('  │  '),
          raw:   `0x${dw.toString(16).toUpperCase().padStart(8, '0')}`,
          action: actionLabel,
        };
      });
    }

    case 'Source_Info': {
      // Table 6.52 – Source Information Data Object (SIDO) — see decodeSIDO()
      const sido = decodeSIDO(dataObjects[0]);
      return [
        { label: 'Port Type',     value: sido.portType,                                                          raw: sido.raw },
        { label: 'Max PDP',       value: `${sido.maxPdpW} W`,                                                    raw: '' },
        { label: 'Present PDP',   value: `${sido.presentPdpW} W`,                                               raw: '' },
        { label: 'Reported PDP',  value: `${sido.reportedPdpW} W`,                                              raw: '' },
      ];
    }

    case 'Vendor_Defined': {
      const vdmHdr   = dataObjects[0];
      const svid     = (vdmHdr >>> 16) & 0xFFFF;
      const structured = (vdmHdr >>> 15) & 0x1;

      if (!structured) {
        // Unstructured VDM — just show raw DOs
        return [
          {
            label: `VDM Header — SVID:${fmtSvid(svid)} Unstructured`,
            raw: `0x${(vdmHdr >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          },
          ...dataObjects.slice(1).map((dw, i) => ({
            label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })),
        ];
      }

      // Structured VDM Header (USB PD Rev 3.2 Table 6.30)
      // bit[15]=VDM Type, bits[14:13]=VDM Version, bits[7:6]=CmdType, bits[4:0]=Command
      const cmdType  = (vdmHdr >>> 6) & 0x3;
      const cmd      = vdmHdr & 0x1F;
      const objPos   = (vdmHdr >>> 8) & 0x7;   // bits[10:8] Object Position (Enter/Exit/Attention)

      const cmdName      = VDM_CMD_NAMES[cmd] ?? `CMD_0x${cmd.toString(16)}`;
      const cmdTypeName  = VDM_CMD_TYPE[cmdType];
      const objPosStr    = (objPos && (cmd === 0x04 || cmd === 0x05 || cmd === 0x06))
        ? ` Obj#${objPos}` : '';

      const headerLabel =
        `VDM Header — SVID:${fmtSvid(svid)} ${cmdName} [${cmdTypeName}]${objPosStr}`;

      const vdos = dataObjects.slice(1);

      // Decode VDOs based on command + cmdType + SVID
      let decodedVdos;
      if (cmd === 0x01 && cmdType === 1) {
        // Discover Identity ACK — standard VDO structure
        decodedVdos = decodeDiscoverIdentityVDOs(vdos);
      } else if (cmd === 0x02 && cmdType === 1) {
        // Discover SVIDs ACK
        decodedVdos = decodeDiscoverSVIDsVDOs(vdos);
      } else if (cmd === 0x03 && cmdType === 1 && svid === 0xFF01) {
        // Discover Modes ACK for DisplayPort
        decodedVdos = decodeDPModeVDOs(vdos);
      } else if ((cmd === 0x04 || cmd === 0x06) && svid === 0xFF01 && vdos.length >= 1) {
        // Enter Mode ACK / Attention for DP — first VDO is DP Status VDO
        decodedVdos = [
          { label: decodeDPStatusVDO(vdos[0]), raw: `0x${(vdos[0] >>> 0).toString(16).toUpperCase().padStart(8,'0')}` },
          ...vdos.slice(1).map((dw, i) => ({
            label: `VDO[${i + 2}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })),
        ];
      } else {
        // REQ (no VDOs expected) or unknown — show raw
        decodedVdos = vdos.map((dw, i) => ({
          label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
        }));
      }

      return [
        { label: headerLabel, raw: `0x${(vdmHdr >>> 0).toString(16).toUpperCase().padStart(8, '0')}` },
        ...decodedVdos,
      ];
    }

    default:
      // Show raw hex for any other data message
      return dataObjects.map((dw, i) => ({
        label: `DO[${i + 1}]: 0x${dw.toString(16).toUpperCase().padStart(8, '0')}`,
        raw: `0x${dw.toString(16).toUpperCase().padStart(8, '0')}`,
      }));
  }
}

// ---------- Extended Message Payload Decoders ----------

/**
 * Decode a 25-byte Source Capabilities Extended Data Block (SCEDB)
 * per USB PD Rev 3.2 Table 6.55.
 *
 * @param {Uint8Array|number[]} bytes  Raw SCEDB bytes (at least 25)
 * @returns {{ label: string, value: string }[]}  Array of display items
 */
export function decodeSourceCapsExtended(bytes) {
  if (!bytes || bytes.length < 25) return [];

  const u8  = (o) => bytes[o] ?? 0;
  const u16 = (o) => u8(o) | (u8(o + 1) << 8);
  const u32 = (o) => (u8(o) | (u8(o+1) << 8) | (u8(o+2) << 16) | (u8(o+3) << 24)) >>> 0;

  const items = [];
  const item  = (label, value) => items.push({ label, value });

  // Vendor / Product IDs
  item('VID', `0x${u16(0).toString(16).toUpperCase().padStart(4, '0')}`);
  item('PID', `0x${u16(2).toString(16).toUpperCase().padStart(4, '0')}`);
  item('XID', `0x${u32(4).toString(16).toUpperCase().padStart(8, '0')}`);

  // Version bytes
  item('FW Version', `0x${u8(8).toString(16).toUpperCase().padStart(2, '0')}`);
  item('HW Version', `0x${u8(9).toString(16).toUpperCase().padStart(2, '0')}`);

  // Voltage Regulation (byte 10)
  const vr = u8(10);
  const ldStep = vr & 0x3;
  const ldStepStr = ldStep === 0 ? '150 mA/μs' : ldStep === 1 ? '500 mA/μs' : 'Reserved';
  item('Voltage Regulation', `Load step:${ldStepStr}  IoC:${(vr >> 2) & 0x1 ? '90%' : '25%'}`);

  // Holdup Time (byte 11)
  const hup = u8(11);
  item('Holdup Time', hup === 0 ? 'Not supported' : `${hup} ms`);

  // Compliance (byte 12)
  const comp = u8(12);
  const compFlags = [];
  if (comp & 0x1) compFlags.push('LPS');
  if (comp & 0x2) compFlags.push('PS1');
  if (comp & 0x4) compFlags.push('PS2');
  item('Compliance', compFlags.length ? compFlags.join(', ') : 'None');

  // Touch Current (byte 13)
  const tc = u8(13);
  const tcParts = [];
  if (tc & 0x1) tcParts.push('Low touch current');
  if (tc & 0x2) tcParts.push('Ground pin');
  if (tc & 0x4) tcParts.push('Ground=protective earth');
  item('Touch Current', tcParts.length ? tcParts.join(', ') : 'Standard');

  // Peak Current (2 bytes each, 3 entries at offsets 14, 16, 18)
  function decodePeak(offset) {
    const w     = u16(offset);
    if (w === 0) return 'Not specified';
    const pct    = Math.min(w & 0x1f, 25) * 10;    // bits 4..0 × 10%, max 250
    const period = ((w >> 5) & 0x3f) * 20;           // bits 10..5 × 20 ms
    const duty   = ((w >> 11) & 0xf) * 5;            // bits 14..11 × 5%
    const droop  = (w >> 15) & 0x1;
    let s = `${pct}% overload`;
    if (period) s += `  ${period} ms period`;
    if (duty)   s += `  ${duty}% duty`;
    if (droop)  s += '  VBUS droop';
    return s;
  }
  item('Peak Current 1', decodePeak(14));
  item('Peak Current 2', decodePeak(16));
  item('Peak Current 3', decodePeak(18));

  // Touch Temp (byte 20)
  const TOUCH_TEMP = ['IEC 60950-1', 'IEC 62368-1 TS1', 'IEC 62368-1 TS2'];
  item('Touch Temp', TOUCH_TEMP[u8(20)] ?? `Reserved(${u8(20)})`);

  // Source Inputs (byte 21)
  const si = u8(21);
  const siParts = [];
  if (si & 0x1) siParts.push((si & 0x2) ? 'Ext supply unconstrained' : 'Ext supply constrained');
  else          siParts.push('No ext supply');
  if (si & 0x4) siParts.push('Int battery'); else siParts.push('No int battery');
  item('Source Inputs', siParts.join('  │  '));

  // Batteries (byte 22)
  const bat = u8(22);
  item('Batteries', `Fixed:${bat & 0xf}  HotSwap:${(bat >> 4) & 0xf}`);

  // PDP Ratings (bytes 23, 24)
  item('SPR PDP Rating', `${u8(23)} W`);
  item('EPR PDP Rating', `${u8(24)} W`);

  return items;
}

/**
 * Decode a 7-byte SOP Status Data Block (SDB) per USB PD Rev 3.2 Table 6.56.
 *
 * @param {Uint8Array|number[]} bytes  Raw SDB bytes (at least 7)
 * @returns {{ label: string, value: string }[]}
 */
export function decodeStatus(bytes) {
  if (!bytes || bytes.length < 7) return [];
  const u8 = (o) => bytes[o] ?? 0;
  const items = [];
  const item  = (label, value) => items.push({ label, value });

  // Byte 0: Internal Temperature
  const temp = u8(0);
  item('Internal Temp', temp === 0 ? 'Not supported' : temp === 1 ? '<2 °C' : `${temp} °C`);

  // Byte 1: Present Input
  const pi = u8(1);
  const piParts = [];
  if (pi & 0x02) { piParts.push('Ext power'); piParts.push((pi & 0x04) ? 'AC' : 'DC'); }
  else            piParts.push('No ext power');
  if (pi & 0x08)  piParts.push('Int battery');
  if (pi & 0x10)  piParts.push('Int non-battery');
  item('Present Input', piParts.join('  │  '));

  // Byte 2: Present Battery Input (only meaningful when bit 3 of Present Input set)
  const pbi = u8(2);
  if (pi & 0x08) {
    item('Battery Input', `Fixed:b${(pbi & 0xf).toString(2).padStart(4,'0')}  HotSwap:b${((pbi>>4)&0xf).toString(2).padStart(4,'0')}`);
  }

  // Byte 3: Event Flags
  const ef = u8(3);
  const efParts = [];
  if (ef & 0x02) efParts.push('OCP');
  if (ef & 0x04) efParts.push('OTP');
  if (ef & 0x08) efParts.push('OVP');
  if (ef & 0x10) efParts.push('CF mode'); else efParts.push('CV mode');
  item('Event Flags', efParts.join('  │  '));

  // Byte 4: Temperature Status
  const TEMP_STATUS = ['Not Supported', 'Normal', 'Warning', 'Over temperature'];
  item('Temp Status', TEMP_STATUS[(u8(4) >> 1) & 0x3]);

  // Byte 5: Power Status
  const ps = u8(5);
  const psParts = [];
  if (ps & 0x02) psParts.push('Cable current limited');
  if (ps & 0x04) psParts.push('Insuf. power (other ports)');
  if (ps & 0x08) psParts.push('Insuf. ext power');
  if (ps & 0x10) psParts.push('Event flags active');
  if (ps & 0x20) psParts.push('Temperature limited');
  item('Power Status', psParts.length ? psParts.join('  │  ') : 'Normal');

  // Byte 6: Power State Change
  const psc = u8(6);
  const NEW_STATE = ['Not supported','S0','Modern Standby','S3','S4','S5','G3','Reserved'];
  const LED_STATE = ['Off','On','Blinking','Breathing'];
  item('New Power State', NEW_STATE[psc & 0x7]);
  const led = (psc >> 3) & 0x7;
  if (led <= 3) item('LED Indicator', LED_STATE[led]);

  return items;
}

/**
 * Decode an Extended_Control Data Block (ECDB). USB PD Rev 3.2, §6.5.14 / Table 6.67-6.68.
 *
 * Extended Header carries Data Size = 2.  ECDB layout:
 *   Byte 0: Type  (Table 6.68)
 *   Byte 1: Data  — "Shall be set to zero when not used"
 *
 * Type codes (Table 6.68):
 *   0x01  EPR_Get_Source_Cap   — sent by Sink or DRP, SOP only
 *   0x02  EPR_Get_Sink_Cap     — sent by Source or DRP, SOP only
 *   0x03  EPR_KeepAlive        — sent by Sink, SOP only
 *   0x04  EPR_KeepAlive_Ack    — sent by Source, SOP only
 *   others: Reserved
 *
 * @param {Uint8Array|number[]} bytes  Raw bytes starting at doOffset (≥2 expected per spec)
 * @returns {{ label: string, value: string }[]}
 */
export function decodeExtendedControl(bytes) {
  if (!bytes || bytes.length < 2) return [];
  const ECDB_TYPE = {
    0x01: 'EPR_Get_Source_Cap',
    0x02: 'EPR_Get_Sink_Cap',
    0x03: 'EPR_KeepAlive',
    0x04: 'EPR_KeepAlive_Ack',
  };
  const type = bytes[0] & 0xFF;
  const data = bytes[1] & 0xFF;
  const items = [];
  items.push({ label: 'Type', value: ECDB_TYPE[type] ?? `Reserved(0x${type.toString(16).toUpperCase()})` });
  // Data byte: spec says "Shall be set to zero when not used" — flag if violated
  if (data !== 0) {
    items.push({ label: 'Data', value: `0x${data.toString(16).toUpperCase().padStart(2, '0')} ⚠ non-zero (spec violation)` });
  }
  return items;
}

/**
 * Decode a Sink_Capabilities_Extended Data Block (SKEDB). USB PD Rev 3.2, Table 6.62.
 *
 * Byte layout (24 bytes for Rev 3.2):
 *   0..1   VID
 *   2..3   PID
 *   4..7   XID
 *   8      FW Version
 *   9      HW Version
 *   10     SKEDB Version
 *   11     Load Step (bits 1..0: 0=150mA/μs, 1=500mA/μs)
 *   12..13 Sink Load Characteristics (raw)
 *   14     Compliance (bit0=LPS, bit1=PS1, bit2=PS2)
 *   15     Touch Current (bit0=Low touch current)
 *   16..17 Peak Current (same encoding as SCEDB)
 *   18     Sink Minimum PDP  [W]
 *   19     Sink Operational PDP  [W]
 *   20     Sink Maximum PDP  [W]
 *   21     Reserved
 *   22     EPR Sink Operational PDP  [W]  (Rev 3.2)
 *   23     EPR Sink Maximum PDP  [W]  (Rev 3.2)
 *
 * @param {Uint8Array|number[]} bytes  Raw SKEDB bytes (at least 21)
 * @returns {{ label: string, value: string }[]}
 */
export function decodeSinkCapsExtended(bytes) {
  if (!bytes || bytes.length < 21) return [];

  const u8  = (o) => bytes[o] ?? 0;
  const u16 = (o) => u8(o) | (u8(o + 1) << 8);
  const u32 = (o) => (u8(o) | (u8(o+1)<<8) | (u8(o+2)<<16) | (u8(o+3)<<24)) >>> 0;

  const items = [];
  const item  = (label, value) => items.push({ label, value });

  item('VID', `0x${u16(0).toString(16).toUpperCase().padStart(4, '0')}`);
  item('PID', `0x${u16(2).toString(16).toUpperCase().padStart(4, '0')}`);
  item('XID', `0x${u32(4).toString(16).toUpperCase().padStart(8, '0')}`);
  item('FW Version',    `0x${u8(8).toString(16).toUpperCase().padStart(2, '0')}`);
  item('HW Version',    `0x${u8(9).toString(16).toUpperCase().padStart(2, '0')}`);
  item('SKEDB Version', `${u8(10)}`);

  const ldStep = u8(11) & 0x3;
  item('Load Step', ldStep === 0 ? '150 mA/μs' : ldStep === 1 ? '500 mA/μs' : `Reserved(${ldStep})`);

  item('Sink Load Char', `0x${u8(12).toString(16).padStart(2,'0')} 0x${u8(13).toString(16).padStart(2,'0')}`);

  const comp = u8(14);
  const compFlags = [];
  if (comp & 0x1) compFlags.push('LPS');
  if (comp & 0x2) compFlags.push('PS1');
  if (comp & 0x4) compFlags.push('PS2');
  item('Compliance', compFlags.length ? compFlags.join(', ') : 'None');

  item('Touch Current', u8(15) & 0x1 ? 'Low touch current' : 'Standard');

  const pc = u16(16);
  if (pc === 0) {
    item('Peak Current', 'Not specified');
  } else {
    const pct    = Math.min(pc & 0x1f, 25) * 10;
    const period = ((pc >> 5) & 0x3f) * 20;
    const duty   = ((pc >> 11) & 0xf) * 5;
    let s = `${pct}% overload`;
    if (period) s += `  ${period} ms period`;
    if (duty)   s += `  ${duty}% duty`;
    item('Peak Current', s);
  }

  item('Sink Minimum PDP',     `${u8(18)} W`);
  item('Sink Operational PDP', `${u8(19)} W`);
  item('Sink Maximum PDP',     `${u8(20)} W`);

  if (bytes.length >= 24) {
    // byte 21 = Reserved
    item('EPR Sink Operational PDP', `${u8(22)} W`);
    item('EPR Sink Maximum PDP',     `${u8(23)} W`);
  }

  return items;
}

// ---------- Unknown-packet detection & record builder ----------

/**
 * Message types (data / extended) that have dedicated decoders in decodeDataObjects().
 * Anything PD_MSG with data objects that is NOT in this set will be logged as undecoded.
 */
const DECODED_MSG_TYPES = new Set([
  // Data messages
  'Source_Capabilities', 'Sink_Capabilities',
  'EPR_Source_Capabilities', 'EPR_Sink_Capabilities',
  'Request', 'EPR_Request', 'EPR_Mode', 'Source_Info', 'Vendor_Defined',
  // Extended messages
  'Source_Capabilities_Extended', 'Status',
  'Extended_Control', 'Sink_Capabilities_Extended',
]);

/**
 * Return true when a decoded PD frame has no specific field-level decoder
 * (i.e. it would fall into the `default` branch of decodeDataObjects, or its
 * type code is genuinely unknown).
 *
 * Control messages (numDataObjects === 0, extended === false) are excluded because
 * they carry no payload worth inspecting.
 *
 * @param {{ typeName: string, isControl: boolean, extended: boolean, numDataObjects: number }} header
 * @returns {boolean}
 */
export function isUndecodedMessage(header) {
  if (!header) return false;
  // Control messages: named by type code only, no payload
  if (header.isControl) return false;
  // Truly unknown type code (parser falls back to Ctrl_0x / Data_0x / Ext_0x naming)
  if (/0x[0-9a-fA-F]/.test(header.typeName)) return true;
  // Named but lacking a dedicated field decoder
  if (!DECODED_MSG_TYPES.has(header.typeName)) return true;
  return false;
}

/**
 * Build a plain-object record for submission to /api/log-unknown.
 * All numeric values are serialised as strings to survive JSON / YAML round-trips.
 *
 * @param {object} frame    Decoded frame object (from parseCpdFile or parseRawFrame)
 * @param {string} context  Free-text provenance label, e.g. "file:capture.cpd" or "websocket"
 * @returns {object}
 */
export function buildUnknownRecord(frame, context) {
  const h = frame.header ?? {};
  return {
    context,
    ts_raw:           String(frame.ts ?? 0),
    source:           frame.source ?? '',
    direction:        frame.cpd?.dirName ?? '',
    sop:              frame.cpd?.sopQualName ?? 'SOP',
    spec_revision:    h.specRevision ?? '',
    msg_id:           h.msgId ?? 0,
    type_name:        h.typeName ?? '',
    is_extended:      !!(h.extended),
    is_control:       !!(h.isControl),
    num_data_objects: h.numDataObjects ?? 0,
    raw_hex:          frame.raw ?? '',
    data_objects:     (frame.dataObjects ?? []).map(
                        (dw) => `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
                      ),
  };
}

// ---------- .cpd Binary File Parser ----------

const CPD_SYNC        = 0xFDFDFDFD;
const CPD_FIXED_HDR   = 20; // bytes of overhead per record (sync + fields + sentinel)
const CAT_TO_LEN_BIAS = 9;  // payloadLen = cat - CAT_TO_LEN_BIAS

/**
 * Parse a STM32CubeMonitor-UCPD .cpd binary file.
 *
 * @param {ArrayBuffer} buffer  Contents of the .cpd file
 * @returns {{ frames: object[], errors: string[] }}
 */
export function parseCpdFile(buffer) {
  const view   = new DataView(buffer);
  const bytes  = new Uint8Array(buffer);
  const total  = bytes.length;
  const frames = [];
  const errors = [];

  let offset = 0;

  while (offset <= total - CPD_FIXED_HDR) {
    // --- Locate sync marker FD FD FD FD ---
    const syncWord = view.getUint32(offset, false); // big-endian read for comparison
    if (syncWord !== CPD_SYNC) {
      offset++;
      continue;
    }

    // --- Read header fields ---
    const fixedField  = view.getUint16(offset + 4, true);   // LE: 0x0032
    const catByte     = bytes[offset + 6];                   // payloadLen + 9
    const dirByte     = bytes[offset + 7];                   // 0x03/0x06/0x07/0x08
    const timestamp   = view.getUint32(offset + 8, true);   // LE uint32
    const sopQual     = bytes[offset + 13];                  // 0x00=SOP, 0x01=SOP', 0x02=SOP''
    const payloadLen  = bytes[offset + 15];                  // direct length byte

    // Cross-check: cat should equal payloadLen + 9
    const catDerived = catByte - CAT_TO_LEN_BIAS;
    if (catDerived !== payloadLen) {
      errors.push(
        `offset 0x${offset.toString(16)}: cat/len mismatch ` +
        `(cat=0x${catByte.toString(16)} → derived=${catDerived}, payloadLen=${payloadLen})`
      );
    }

    const payloadStart  = offset + 16;
    const payloadEnd    = payloadStart + payloadLen;
    const sentinelStart = payloadEnd;

    if (payloadEnd + 4 > total) {
      errors.push(`offset 0x${offset.toString(16)}: record truncated`);
      break;
    }

    // Read sentinel (accept any 4-byte value; warn if unexpected)
    const sentinelBytes = Array.from(bytes.slice(sentinelStart, sentinelStart + 4));
    const sentinelHex   = sentinelBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    if (sentinelBytes.some((b, i) => b !== 0xA5)) {
      errors.push(`offset 0x${offset.toString(16)}: non-standard sentinel [${sentinelHex}]`);
    }

    const payload = bytes.slice(payloadStart, payloadEnd);
    const recordType = CPD_RECORD_TYPE[dirByte] ?? 'UNKNOWN';

    let frame = {
      ts:     timestamp,
      source: 'STM32',
      recordType,
      cpd: {
        fixedField,
        cat: catByte,
        dir: dirByte,
        dirName:    CPD_DIR[dirByte] ?? `0x${dirByte.toString(16)}`,
        sopQual,
        sopQualName: CPD_SOP_QUAL[sopQual] ?? `0x${sopQual.toString(16)}`,
        payloadLen,
        sentinelHex,
        recordOffset: offset,
      },
    };

    // --- Decode payload by record type ---
    if (recordType === 'ASCII_LOG') {
      // dir=0x06: ASCII debug string (e.g., "VBUS:941: CC:0" or "VBUS:2421, CC:2")
      const asciiLog = new TextDecoder().decode(payload);
      frame.asciiLog = asciiLog;
      frame.raw      = asciiLog;
      // Parse structured fields: VBUS:<mV>[,:] CC:<pin>
      const vbusM = asciiLog.match(/VBUS:([\d]+)/);
      const ccM   = asciiLog.match(/CC:([\d]+)/);
      if (vbusM) frame.vbusMv = parseInt(vbusM[1], 10);
      if (ccM)   frame.ccPin  = parseInt(ccM[1],   10);
    } else if (recordType === 'EVENT') {
      // dir=0x03, len=0: SOP'/SOP'' detection event marker
      const eventName  = CPD_EVENT_NAME[sopQual] ?? `EVENT_SOP_0x${sopQual.toString(16)}`;
      frame.eventName  = eventName;
      frame.raw        = eventName;
    } else if (recordType === 'PD_MSG' && payload.length >= 2) {
      // dir=0x07/0x08: USB-PD message
      const headerWord = (payload[0]) | (payload[1] << 8);
      const header     = parseMessageHeader(headerWord, sopQual);

      // When Extended bit is set, bytes 2-3 of the payload carry the Extended Message Header
      // (Table 6.3). Actual 4-byte Data Objects follow from byte 4.
      let doOffset = 2;
      let extendedHeader = null;
      if (header.extended && payload.length >= 4) {
        extendedHeader = parseExtendedMsgHeader(payload[2] | (payload[3] << 8));
        doOffset = 4;
      }

      const dataObjects = [];
      for (let i = doOffset; i + 3 < payload.length; i += 4) {
        const dw = ((payload[i]) |
                    (payload[i + 1] << 8) |
                    (payload[i + 2] << 16) |
                    (payload[i + 3] << 24)) >>> 0;
        dataObjects.push(dw);
      }

      frame.header         = header;
      frame.extendedHeader = extendedHeader;
      frame.dataObjects    = dataObjects;
      // Byte-level extended payload decode (before raw is set)
      if (header.typeName === 'Source_Capabilities_Extended' && payload.length >= doOffset + 25) {
        frame.parsedPayload = decodeSourceCapsExtended(payload.slice(doOffset, doOffset + 25));
      } else if (header.typeName === 'Status' && payload.length >= doOffset + 7) {
        frame.parsedPayload = decodeStatus(payload.slice(doOffset, doOffset + 7));
      } else if (header.typeName === 'Extended_Control' && payload.length >= doOffset + 2) {
        frame.parsedPayload = decodeExtendedControl(payload.slice(doOffset));
      } else if (header.typeName === 'Sink_Capabilities_Extended' && payload.length >= doOffset + 21) {
        frame.parsedPayload = decodeSinkCapsExtended(payload.slice(doOffset));
      }
      frame.raw         = Array.from(payload)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
      // Attach compact inline summary for capability messages
      if (header.typeName === 'Source_Capabilities' || header.typeName === 'Sink_Capabilities'
          || header.typeName === 'EPR_Source_Capabilities' || header.typeName === 'EPR_Sink_Capabilities') {
        if (dataObjects.length > 0) {
          frame.pdoSummary = buildPdoSummary(header.typeName, dataObjects);
          // EPR marker: any fixed PDO has eprModeCapable set
          frame.eprCapable = dataObjects.some((dw) => {
            const pdoType = (dw >>> 30) & 0x3;
            return pdoType === 0b00 && !!(dw & (1 << 23));
          });
        } else if (extendedHeader) {
          // Chunk request (RequestChunk=1, DataSize=0) or empty chunked frame
          const chunkInfo = extendedHeader.requestChunk
            ? `Chunk#${extendedHeader.chunkNumber} [Req]`
            : `Chunk#${extendedHeader.chunkNumber}`;
          frame.pdoSummary = chunkInfo;
        }
      } else if ((header.typeName === 'Request' || header.typeName === 'EPR_Request') && dataObjects.length) {
        frame.pdoSummary = buildRdoSummary(dataObjects[0]);
      } else if (header.typeName === 'EPR_Mode' && dataObjects.length) {
        const EPR_ACTION = { 0x01: 'Enter', 0x02: 'Enter Acknowledged', 0x03: 'Enter Succeeded',
                             0x04: 'Enter Failed', 0x05: 'Exit' };
        const EPR_FAIL   = { 0x00: 'Unknown', 0x01: 'Cable not EPR capable',
                             0x02: 'VCONN source failed', 0x03: 'EPR bit not set in RDO',
                             0x04: 'Source unable to enter', 0x05: 'EPR bit not set in PDO' };
        const dw     = dataObjects[0];
        const action = (dw >>> 24) & 0xFF;
        const data   = (dw >>> 16) & 0xFF;
        const label  = EPR_ACTION[action] ?? `Action:0x${action.toString(16).toUpperCase()}`;
        const extra  = action === 0x01 && data ? `  PDP:${data}W`
                     : action === 0x04         ? `  (${EPR_FAIL[data] ?? `0x${data.toString(16)}`})`
                     : '';
        frame.pdoSummary = label + extra;
      } else if (header.typeName === 'Source_Info' && dataObjects.length) {
        const dw     = dataObjects[0];
        const type   = (dw >>> 31) & 0x1 ? 'Guaranteed' : 'Managed';
        const maxP   = (dw >>> 16) & 0xFF;
        const presP  = (dw >>> 8)  & 0xFF;
        const repP   =  dw         & 0xFF;
        frame.pdoSummary = `${type}  Max:${maxP}W  Present:${presP}W  Reported:${repP}W`;
      } else if (header.extended && extendedHeader) {
        // Compact inline summary for Extended messages
        if (header.typeName === 'Source_Capabilities_Extended' && frame.parsedPayload?.length) {
          const vid = frame.parsedPayload.find((i) => i.label === 'VID')?.value ?? '?';
          const pid = frame.parsedPayload.find((i) => i.label === 'PID')?.value ?? '?';
          const fw  = frame.parsedPayload.find((i) => i.label === 'FW Version')?.value ?? '?';
          frame.pdoSummary = `VID:${vid}  PID:${pid}  FW:${fw}`;
        } else if (header.typeName === 'Status' && frame.parsedPayload?.length) {
          const ef   = frame.parsedPayload.find((i) => i.label === 'Event Flags')?.value ?? '';
          const temp = frame.parsedPayload.find((i) => i.label === 'Temp Status')?.value ?? '';
          frame.pdoSummary = [ef, temp].filter(Boolean).join('  │  ');
        } else if (header.typeName === 'Extended_Control' && frame.parsedPayload?.length) {
          frame.pdoSummary = frame.parsedPayload[0]?.value ?? '';
        } else if (header.typeName === 'Sink_Capabilities_Extended' && frame.parsedPayload?.length) {
          const vid    = frame.parsedPayload.find((i) => i.label === 'VID')?.value ?? '?';
          const pid    = frame.parsedPayload.find((i) => i.label === 'PID')?.value ?? '?';
          const maxPdp = frame.parsedPayload.find((i) => i.label === 'Sink Maximum PDP')?.value ?? '?';
          frame.pdoSummary = `VID:${vid}  PID:${pid}  MaxPDP:${maxPdp}`;
        } else {
          const chunks = extendedHeader.chunked
            ? `Chunk#${extendedHeader.chunkNumber}${extendedHeader.requestChunk ? ' [Req]' : ''}`
            : 'Unchunked';
          frame.pdoSummary = `${chunks}  ${extendedHeader.dataSize}B`;
        }
      }
    } else {
      frame.raw = Array.from(payload)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    }

    frames.push(frame);
    offset += CPD_FIXED_HDR + payloadLen;
  }

  return { frames, errors };
}


