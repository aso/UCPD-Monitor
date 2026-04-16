// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO

import type {
  Pdo, Rdo, MessageHeader, ExtendedMessageHeader,
  PdMessage, PdFrame, ParsedCpdFile, ParsedPayloadRow, TreeRow, SidoResult,
} from './pd_types.js';

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
export const CPD_DIR: Record<number, string> = {
  0x07: 'SRC→SNK',  // Source to Sink
  0x08: 'SNK→SRC',  // Sink to Source
  0x06: 'DEBUG',    // ASCII debug/status string
  0x03: 'EVENT',    // Event marker (SOP' / SOP'' detection)
};

/** SOP qualifier byte (offset 0x0D) */
export const CPD_SOP_QUAL: Record<number, string> = {
  0x00: 'SOP',
  0x01: "SOP'",
  0x02: "SOP''",
};

/**
 * EVENT type names derived from sopQual byte.
 * SOP' (0x01) = DETACHED, SOP'' (0x02) = ATTACHED
 * (observed from STM32CubeMonitor-UCPD original display)
 */
export const CPD_EVENT_NAME: Record<number, string> = {
  0x01: 'DETACHED',   // SOP' cable plug marker lost
  0x02: 'ATTACHED',  // SOP'' cable plug marker detected
};

/** Record type (derived from dir) */
export const CPD_RECORD_TYPE: Record<number, string> = {
  0x07: 'PD_MSG',
  0x08: 'PD_MSG',
  0x06: 'ASCII_LOG',
  0x03: 'EVENT',
};

export const MSG_TYPE_CTRL: Record<number, string> = {
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

export const MSG_TYPE_DATA: Record<number, string> = {
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
export const MSG_TYPE_EXT: Record<number, string> = {
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
export function parseMessageHeader(word: number, sopQual = 0): MessageHeader {
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
export function parseExtendedMsgHeader(word: number): ExtendedMessageHeader {
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
export function parseRawFrame(hexStr: string, source: string): PdMessage | null {
  try {
    const bytes = hexStr
      .trim()
      .split(/\s+/)
      .map((h) => parseInt(h, 16));

    if (bytes.length < 2) return null;

    // First two bytes: 16-bit message header (little-endian)
    const headerWord = bytes[0]! | (bytes[1]! << 8);
    const header = parseMessageHeader(headerWord);

    // When Extended bit is set, bytes 2-3 carry the Extended Message Header (Table 6.3).
    // Actual data objects follow from byte 4.
    let doOffset = 2;
    let extendedHeader = null;
    if (header.extended && bytes.length >= 4) {
      extendedHeader = parseExtendedMsgHeader(bytes[2]! | (bytes[3]! << 8));
      doOffset = 4;
    }

    // Remaining bytes: Data Objects (4 bytes each)
    const dataObjects = [];
    for (let i = doOffset; i + 3 < bytes.length; i += 4) {
      const dw =
        bytes[i]! |
        (bytes[i + 1]! << 8) |
        (bytes[i + 2]! << 16) |
        (bytes[i + 3]! << 24);
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
        ? decodeSIDO(dataObjects[0]!).label
        : (header.typeName === 'BIST' && dataObjects.length)
          ? (() => {
              const BIST_TYPE: Record<number, string> = { 0: 'Carrier Mode 2', 5: 'Test Data', 8: 'Shared Mode Entry', 9: 'Shared Mode Exit' };
              return `BIST: ${BIST_TYPE[(dataObjects[0]! >>> 28) & 0xF] ?? 'Reserved'}`;
            })()
          : (header.typeName === 'Alert' && dataObjects.length)
            ? (() => {
                const dw = dataObjects[0]!;
                const flags = [];
                if (dw & (1 << 26)) flags.push('SrcInChange');
                if (dw & (1 << 25)) flags.push('BatChange');
                if (dw & (1 << 24)) flags.push('OCP');
                if (dw & (1 << 23)) flags.push('OTP');
                if (dw & (1 << 22)) flags.push('OpCondChange');
                if (dw & (1 << 31)) flags.push('Extended');
                return `Alert: ${flags.join(' | ') || '(none)'}`;
              })()
            : (header.typeName === 'Battery_Status' && dataObjects.length)
              ? (() => {
                  const dw = dataObjects[0]!
                  const bpc = (dw >>> 16) & 0xFFFF;
                  const st = (dw & 1) ? 'InvalidRef'
                    : (dw & 4) ? 'FullyDischarged'
                    : (dw & 8) ? 'FullyCharged'
                    : (dw & 2) ? 'Charging' : 'Idle';
                  return `BatStatus: ${st}  Cap:${bpc === 0xFFFF ? 'Unknown' : `${bpc * 10}mWh`}`;
                })()
              : (header.typeName === 'Revision' && dataObjects.length)
                ? (() => {
                    const dw = dataObjects[0]!
                    return `Rev ${(dw>>>28)&0xF}.${(dw>>>24)&0xF}  Ver ${(dw>>>12)&0xF}.${(dw>>>8)&0xF}`;
                  })()
                : undefined,
    };
  } catch (e) {
    console.warn('[pd_parser] Parse error:', (e as Error).message, hexStr);
    return null;
  }
}

// ---------- PDO / RDO Decoder ----------

/** Format a mV value: drop decimals when it's a round 100 mV or 1 V multiple */
function fmtV(mv: number): string {
  if (mv % 1000 === 0) return `${mv / 1000}V`;
  if (mv % 100  === 0) return `${(mv / 1000).toFixed(1)}V`;
  return `${(mv / 1000).toFixed(2)}V`;
}

/** Format a mA value: drop decimals when clean */
function fmtA(ma: number): string {
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
export function buildPdoSummary(typeName: string, dataObjects: number[]): string {
  if (!dataObjects?.length) return '';
  const isSink = typeName === 'Sink_Capabilities' || typeName === 'EPR_Sink_Capabilities';
  return dataObjects.map((dw, i) => {
    const pdo = decodePDO(dw, i, isSink);
    const n   = pdo.index;
    switch (pdo.pdoType) {
      case 'Fixed':
        return `[${n}] Fixed:${fmtV(pdo.vMv)}/${fmtA(pdo.iMa)}`;
      case 'Battery':
        return `[${n}] Battery:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${pdo.isSink ? 'Op' : 'Max'}:${(pdo.wMax/1000).toFixed(0)}W`;
      case 'Variable':
        return `[${n}] Var:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${fmtA(pdo.iMa)}`;
      case 'APDO_PPS':
        return `[${n}] PPS:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${fmtA(pdo.iMa)}`;
      case 'APDO_AVS':
        return `[${n}] AVS:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${pdo.pdpW}W`;
      case 'APDO_SPR_AVS': {
        const sfx = pdo.iMa_15_20 > 0
          ? `${fmtA(pdo.iMa_9_15)}│${fmtA(pdo.iMa_15_20)}`
          : fmtA(pdo.iMa_9_15);
        return `[${n}] SPR-AVS:${fmtV(pdo.vMinMv)}-${fmtV(pdo.vMaxMv)}/${sfx}`;
      }
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
export function buildRdoSummary(dw: number, pdoType = 'Fixed'): string {
  const rdo = decodeRDO(dw, pdoType);
  let parts: string[];
  if (rdo.rdoType === 'PPS' || rdo.rdoType === 'AVS') {
    parts = [`PDO#${rdo.objPos}`, `Out:${fmtV(rdo.opVoltage_mV)}`, `Op:${fmtA(rdo.opCurrent_mA)}`];
  } else if (rdo.rdoType === 'Battery') {
    parts = [`PDO#${rdo.objPos}`, `Op:${(rdo.opPower_mW/1000).toFixed(2)}W`, `${rdo.giveBack ? 'Min' : 'Max'}:${(rdo.limPower_mW/1000).toFixed(2)}W`];
  } else {
    // Fixed (covers Fixed / Variable / APDO_SPR_AVS all use Fixed RDO format)
    parts = [`PDO#${rdo.objPos}`, `Op:${fmtA(rdo.opCurrent_mA)}`, `${rdo.giveBack ? 'Min' : 'Max'}:${fmtA(rdo.maxCurrent_mA)}`];
  }
  if (rdo.capMismatch) parts.push('CapMismatch');
  if (rdo.eprMode)     parts.push('EPR');
  if (rdo.rdoType === 'Fixed' || rdo.rdoType === 'Battery') {
    if (rdo.giveBack) parts.push('GiveBack');
  }
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
/**
 * Decode a single PDO data object word.
 * USB PD Rev 3.2, §6.4.1
 *
 * @param {number}  dw     Unsigned 32-bit PDO value
 * @param {number}  index  0-based PDO index (for display)
 * @param {boolean} [isSink=false]  True when decoding Sink_Capabilities / EPR_Sink_Capabilities
 * @returns {object}  Decoded PDO with type-specific fields
 */
export function decodePDO(dw: number, index: number, isSink = false): Pdo {
  const pdoType = (dw >>> 30) & 0x3;

  const base = { index: index + 1, raw: `0x${dw.toString(16).toUpperCase().padStart(8, '0')}` };

  if (pdoType === 0b00) {
    // Fixed Supply
    const vMv  = ((dw >>> 10) & 0x3FF) * 50;
    const iMa  = (dw & 0x3FF) * 10;
    if (isSink) {
      // Table 6.17 — Sink Fixed Supply PDO
      // B29=DRP, B28=HigherCapability, B27=UCPwr, B26=USB-Comm, B25=DRD
      // B24..23=Fast Role Swap USB Type-C Current (2-bit), B22..20=Reserved
      const FRS_LABELS = [
        'FRS not supported',
        'FRS: Default USB Power',
        'FRS: 1.5A @ 5V',
        'FRS: 3.0A @ 5V',
      ];
      const fastRoleSwap = (dw >>> 23) & 0x3;
      return {
        ...base,
        pdoType: 'Fixed',
        isSink: true,
        vMv, iMa,
        dualRolePower:      !!(dw & (1 << 29)),
        higherCapability:   !!(dw & (1 << 28)),
        unconstrainedPower: !!(dw & (1 << 27)),
        usbCommsCapable:    !!(dw & (1 << 26)),
        dualRoleData:       !!(dw & (1 << 25)),
        fastRoleSwap,
        fastRoleSwapLabel:  FRS_LABELS[fastRoleSwap],
        label: `Fixed ${fmtV(vMv)} / ${fmtA(iMa)}`,
      };
    }
    // Table 6-7 — Source Fixed Supply PDO
    // B29=DRP, B28=USB-Susp, B27=UCPwr, B26=USB-Comm, B25=DRD, B24=UnchukedExt, B23=EPR
    return {
      ...base,
      pdoType: 'Fixed',
      isSink: false,
      vMv, iMa,
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
    // Battery Supply — Table 6.19 (Sink) / Source equivalent
    // Bit layout identical for Source and Sink; semantic differs:
    //   Source  B9..0 = Maximum Allowable Power in 250mW units
    //   Sink    B9..0 = Operational Power in 250mW units
    const vMaxMv = ((dw >>> 20) & 0x3FF) * 50;
    const vMinMv = ((dw >>> 10) & 0x3FF) * 50;
    const wMax   = (dw & 0x3FF) * 250;
    const powerLabel = isSink ? 'Op' : 'Max';
    return {
      ...base,
      pdoType: 'Battery',
      isSink,
      vMaxMv, vMinMv, wMax,
      label: `Battery ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${powerLabel}:${(wMax/1000).toFixed(0)}W`,
    };
  }

  if (pdoType === 0b10) {
    // Variable Supply (non-Battery) — Table 6.18 (Sink) / Source equivalent
    // Bit layout identical for Source and Sink; semantic differs:
    //   Source  B9..0 = Maximum Current in 10mA units
    //   Sink    B9..0 = Operational Current in 10mA units
    const vMaxMv = ((dw >>> 20) & 0x3FF) * 50;
    const vMinMv = ((dw >>> 10) & 0x3FF) * 50;
    const iMa    = (dw & 0x3FF) * 10;
    const currentLabel = isSink ? 'Op' : 'Max';
    return {
      ...base,
      pdoType: 'Variable',
      isSink,
      vMaxMv, vMinMv, iMa,
      label: `Variable ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${currentLabel}:${fmtA(iMa)}`,
    };
  }

  // pdoType === 0b11 → Augmented PDO (APDO)
  const apdoType = (dw >>> 28) & 0x3;

  if (apdoType === 0b00) {
    // SPR PPS (Programmable Power Supply) — Table 6.20 (Sink) / Table 6.9 (Source)
    // Bit layout and field semantics are identical for Source and Sink:
    //   B24..17 = Vmax in 100mV, B15..8 = Vmin in 100mV, B6..0 = Max Current in 50mA
    const vMaxMv = ((dw >>> 17) & 0xFF) * 100;
    const vMinMv = ((dw >>> 8)  & 0xFF) * 100;
    const iMa    = (dw & 0x7F) * 50;
    return {
      ...base,
      pdoType: 'APDO_PPS',
      isSink,
      vMaxMv, vMinMv, iMa,
      label: `PPS ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${fmtA(iMa)}`,
    };
  }

  if (apdoType === 0b10) {
    // SPR AVS (Adjustable Voltage Supply) — Rev 3.2 Table 6.16 — Source only
    // (No SPR AVS APDO is defined for Sink in USB PD Rev 3.2)
    // B27..26 = Peak Current, B25..20 = Reserved
    // B19..10 = Max Current 9V–15V range (10mA units)
    // B9..0   = Max Current 15V–20V range (10mA units); 0 if max voltage is 15V
    const peakCurrent  = (dw >>> 26) & 0x3;
    const iMa_9_15     = ((dw >>> 10) & 0x3FF) * 10;
    const iMa_15_20    = (dw & 0x3FF) * 10;
    const vMinMv       = 9000;
    const vMaxMv       = iMa_15_20 > 0 ? 20000 : 15000;
    const PEAK_CURRENT_LABEL = [
      'Peak = IOC (default)',
      'Peak 150%/1ms, 125%/2ms, 110%/10ms',
      'Peak 200%/1ms, 150%/2ms, 125%/10ms',
      'Peak 200%/1ms, 175%/2ms, 150%/10ms',
    ];
    const labelSuffix = iMa_15_20 > 0
      ? `${fmtA(iMa_9_15)} (9–15V) / ${fmtA(iMa_15_20)} (15–20V)`
      : `${fmtA(iMa_9_15)} (9–15V)`;
    return {
      ...base,
      pdoType: 'APDO_SPR_AVS',
      isSink: false,
      vMinMv, vMaxMv,
      iMa_9_15, iMa_15_20,
      peakCurrent,
      peakCurrentLabel: PEAK_CURRENT_LABEL[peakCurrent]!,
      label: `SPR-AVS ${fmtV(vMinMv)}–${fmtV(vMaxMv)} / ${labelSuffix}`,
    };
  }

  if (apdoType === 0b01) {
    // EPR AVS (Adjustable Voltage Supply) — Table 6.21 (Sink) / Table 6.14 (Source)
    // Common: B25..17 = Vmax/100mV, B16=Rsvd, B15..8 = Vmin/100mV, B7..0 = PDP/W
    // Source only: B27..26 = Peak Current (Table 6.15); Sink: B27..26 = Reserved
    const vMaxMv = ((dw >>> 17) & 0x1FF) * 100;
    const vMinMv = ((dw >>> 8)  & 0xFF)  * 100;
    const pdpW   = (dw & 0xFF);
    const PEAK_CURRENT_LABEL = [
      'Peak = IOC (default)',
      'Peak 150%/1ms, 125%/2ms, 110%/10ms',
      'Peak 200%/1ms, 150%/2ms, 125%/10ms',
      'Peak 200%/1ms, 175%/2ms, 150%/10ms',
    ];
    const peakCurrentRaw  = (dw >>> 26) & 0x3;
    const peakCurrent      = isSink ? null : peakCurrentRaw;
    const peakCurrentLabel = isSink ? null : (PEAK_CURRENT_LABEL[peakCurrentRaw] ?? '');
    return {
      ...base,
      pdoType: 'APDO_AVS',
      isSink,
      vMaxMv, vMinMv, pdpW,
      peakCurrent,
      peakCurrentLabel,
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
export function decodeSIDO(dw: number): SidoResult {
  const portTypeRaw    = ((dw >>> 31) & 0x1) as 0 | 1;
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
export function decodeRDO(dw: number, pdoType = 'Fixed'): Rdo {
  const raw          = `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const objPos       = (dw >>> 28) & 0xF;
  const capMismatch  = !!(dw & (1 << 26));
  const usbComms     = !!(dw & (1 << 25));
  const noUsbSuspend = !!(dw & (1 << 24));
  const unchunkedExt = !!(dw & (1 << 23));
  const eprMode      = !!(dw & (1 << 22));

  if (pdoType === 'APDO_PPS') {
    // Table 6.26 — PPS Request Data Object
    // B27=Rsvd, B26=CapMismatch, B25=UsbComms, B24=NoUsbSuspend, B23=UnchunkedExt, B22=EPRMode
    // B21=Rsvd, B20..9=OutputVoltage/20mV (12 bits), B8..7=Rsvd, B6..0=OpCurrent/50mA
    const opVoltage_mV = ((dw >>> 9) & 0xFFF) * 20;
    const opCurrent_mA = (dw & 0x7F) * 50;
    return {
      raw, objPos, capMismatch, usbComms, noUsbSuspend, unchunkedExt, eprMode,
      rdoType: 'PPS',
      opVoltage_mV,
      opCurrent_mA,
      label: `RDO(PPS) → PDO#${objPos}  Out:${fmtV(opVoltage_mV)}  Op:${fmtA(opCurrent_mA)}`,
    };
  }

  if (pdoType === 'APDO_AVS' || pdoType === 'APDO_SPR_AVS') {
    // Table 6.27 — AVS Request Data Object (EPR AVS and SPR AVS both use this format)
    // B27=Rsvd, B26=CapMismatch, B25=UsbComms, B24=NoUsbSuspend, B23=UnchunkedExt, B22=EPRMode
    // B21=Rsvd, B20..9=OutputVoltage/25mV (12 bits, LSB2 shall be zero → effective 100mV step)
    // B8..7=Rsvd, B6..0=OpCurrent/50mA
    const opVoltage_mV = ((dw >>> 9) & 0xFFF) * 25;
    const opCurrent_mA = (dw & 0x7F) * 50;
    const tag = pdoType === 'APDO_SPR_AVS' ? 'SPR-AVS' : 'AVS';
    return {
      raw, objPos, capMismatch, usbComms, noUsbSuspend, unchunkedExt, eprMode,
      rdoType: 'AVS',
      opVoltage_mV,
      opCurrent_mA,
      label: `RDO(${tag}) → PDO#${objPos}  Out:${fmtV(opVoltage_mV)}  Op:${fmtA(opCurrent_mA)}`,
    };
  }

  if (pdoType === 'Battery') {
    // Table 6.24 / 6.25 — Battery Request Data Object
    // B27=GiveBack, B26=CapMismatch, B25=UsbComms, B24=NoUsbSuspend, B23=UnchunkedExt, B22=EPRMode
    // B19..10=OperatingPower/250mW, B9..0=MaxOperatingPower(GiveBack=0)/MinOperatingPower(GiveBack=1)/250mW
    const giveBack     = !!(dw & (1 << 27));
    const opPower_mW   = ((dw >>> 10) & 0x3FF) * 250;
    const limPower_mW  = (dw & 0x3FF) * 250;
    const limLabel     = giveBack ? 'Min' : 'Max';
    return {
      raw, objPos, giveBack, capMismatch, usbComms, noUsbSuspend, unchunkedExt, eprMode,
      rdoType: 'Battery',
      opPower_mW,
      limPower_mW,
      label: `RDO(Bat) → PDO#${objPos}  Op:${(opPower_mW/1000).toFixed(2)}W  ${limLabel}:${(limPower_mW/1000).toFixed(2)}W`,
    };
  }

  // Fixed / Variable Request Data Object — Table 6.22 / 6.23
  // B27=GiveBack, B26=CapMismatch, B25=UsbComms, B24=NoUsbSuspend, B23=UnchunkedExt, B22=EPRMode
  // B19..10=OperatingCurrent/10mA, B9..0=MaxOperatingCurrent(GiveBack=0)/MinOperatingCurrent(GiveBack=1)/10mA
  const giveBack      = !!(dw & (1 << 27));
  const opCurrent_mA  = ((dw >>> 10) & 0x3FF) * 10;
  const maxCurrent_mA = (dw & 0x3FF) * 10;
  const limLabel      = giveBack ? 'Min' : 'Max';
  return {
    raw, objPos, giveBack, capMismatch, usbComms, noUsbSuspend, unchunkedExt, eprMode,
    rdoType: 'Fixed',
    opCurrent_mA,
    maxCurrent_mA,
    label: `RDO → PDO#${objPos}  Op:${fmtA(opCurrent_mA)}  ${limLabel}:${fmtA(maxCurrent_mA)}`,
  };
}

// ==================== VDM / Structured VDM Decoders ====================

/** USB PD Rev 3.2 Table 6.30 – Structured VDM command names */
const VDM_CMD_NAMES: Record<number, string> = {
  0x01: 'Discover Identity',
  0x02: 'Discover SVIDs',
  0x03: 'Discover Modes',
  0x04: 'Enter Mode',
  0x05: 'Exit Mode',
  0x06: 'Attention',
};

/** Command Type field (bits[7:6] of VDM header lower word) */
const VDM_CMD_TYPE: Record<number, string> = ['REQ', 'ACK', 'NAK', 'BUSY'];

/** Well-known SVIDs */
const VDM_SVID_NAMES: Record<number, string> = {
  0xFF00: 'PD SID',    // USB PD Standard ID (Table 6.32, §6.4.4.2.1)
  0xFF01: 'DP',        // VESA DisplayPort Alt Mode
  0x8087: 'TBT3',     // Intel Thunderbolt 3
  0x04B4: 'Cypress',
  0x18D1: 'Google',
  0x2109: 'VIA Labs',
  0x04CC: 'OPPO/OnePlus',
};

function fmtSvid(svid: number): string {
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
function decodeDiscoverIdentityVDOs(vdos: number[]): object[] {
  // Returns a flat array of section-header + field rows for tree display.
  // Section headers: { label, raw, section: true }
  // Field rows:      { label, value }  (isKeyValue in PdoRow)
  // Warning rows:    { label, raw }    (isVdoRow, warning text starts with ⚠)
  const out: object[] = [];
  const hex32 = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const bin3  = (v: number) => v.toString(2).padStart(3, '0');
  const bin2  = (v: number) => v.toString(2).padStart(2, '0');

  // Common USB Vendor IDs (representative subset)
  const VID_NAMES: Record<number, string> = {
    0x03F0: 'HP', 0x0403: 'FTDI', 0x0451: 'TI', 0x046D: 'Logitech',
    0x04B4: 'Cypress', 0x04CC: 'OPPO', 0x04D8: 'Microchip',
    0x04E8: 'Samsung', 0x0483: 'STMicro', 0x05AC: 'Apple',
    0x06CB: 'Synaptics', 0x0955: 'NVIDIA', 0x0B05: 'ASUS',
    0x0BDA: 'Realtek', 0x17EF: 'Lenovo', 0x18D1: 'Google',
    0x2109: 'VIA Labs', 0x8087: 'Intel',
  };

  const USB_SPD_NAMES = [
    'USB2.0 only', 'USB3.2 Gen1', 'USB3.2/USB4 Gen2',
    'USB4 Gen3', 'USB4 Gen4', 'Rsvd', 'Rsvd', 'Rsvd',
  ];
  const PLUG_TYPE_NAMES = ['Rsvd', 'Rsvd', 'USB-C', 'Captive'];
  const MAX_VBUS_NAMES  = ['20V', '20V(was30V⚠)', '20V(was40V⚠)', '50V'];

  // ---- VDO[1] ID Header VDO (Table 6.34, §6.4.4.3.1.1) ----
  if (vdos.length >= 1) {
    const dw       = vdos[0]!;
    const vid      = dw & 0xFFFF;
    const usbHost  = (dw >>> 31) & 1;   // B31
    const usbDev   = (dw >>> 30) & 1;   // B30
    const ufpType  = (dw >>> 27) & 0x7; // B29:27
    const modalOp  = (dw >>> 26) & 1;   // B26
    const dfpType  = (dw >>> 23) & 0x7; // B25:23
    const connType = (dw >>> 21) & 0x3; // B22:21

    const UFP_TYPE   = ['Undefined', 'PDUSB Hub', 'PDUSB Peripheral', 'PSD', 'Active Cable', 'Rsvd', 'VPD', 'Rsvd'];
    const ufpName    = (ufpType === 3 && !usbHost && !usbDev) ? 'Passive Cable' : UFP_TYPE[ufpType];
    const DFP_TYPE   = ['Undefined', 'PDUSB Hub', 'PDUSB Host', 'Power Brick', 'Rsvd', 'Rsvd', 'Rsvd', 'Rsvd'];
    const CONN_NAMES = ['Rsvd(compat)', 'Rsvd', 'USB-C Recept.', 'USB-C Plug'];
    const vidName    = VID_NAMES[vid];

    out.push({ label: 'ID HEADER', raw: hex32(dw), section: true });
    out.push({ label: 'VID',              value: `0x${vid.toString(16).toUpperCase().padStart(4,'0')}${vidName ? ` (${vidName})` : ''}` });
    out.push({ label: 'USBHostCapable',   value: `${usbHost}` });
    out.push({ label: 'USBDeviceCapable', value: `${usbDev}` });
    out.push({ label: 'ProductTypeUFP',   value: `${bin3(ufpType)}b  ${ufpName}` });
    out.push({ label: 'ModalOperation',   value: `${modalOp}` });
    out.push({ label: 'ProductTypeDFP',   value: `${bin3(dfpType)}b  ${DFP_TYPE[dfpType]}` });
    out.push({ label: 'ConnectorType',    value: `${bin2(connType)}b  ${CONN_NAMES[connType]}` });
  }

  // ---- VDO[2] Cert Stat VDO (Table 6.38): B31:0 = XID ----
  if (vdos.length >= 2) {
    const dw = vdos[1]!;
    out.push({ label: 'CERT STAT', raw: hex32(dw), section: true });
    out.push({ label: 'XID', value: `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}` });
  }

  // ---- VDO[3] Product VDO (Table 6.39: B31:16=PID, B15:0=bcdDevice) ----
  if (vdos.length >= 3) {
    const dw  = vdos[2]!;
    const pid = (dw >>> 16) & 0xFFFF;
    const bcd = dw & 0xFFFF;
    out.push({ label: 'PRODUCT', raw: hex32(dw), section: true });
    out.push({ label: 'USBProductID', value: `0x${pid.toString(16).toUpperCase().padStart(4,'0')}` });
    out.push({ label: 'bcdDevice',    value: `0x${bcd.toString(16).toUpperCase().padStart(4,'0')}` });
  }

  // ---- VDO[4+] Product Type VDOs ----
  const isDrd        = vdos.length >= 6 && vdos[4]! === 0;
  const idHdrDw      = vdos.length >= 1 ? vdos[0]! : 0;
  const ufpPType     = (idHdrDw >>> 27) & 0x7;  // Table 6.35/6.36
  const idHdrUsbHost = (idHdrDw >>> 31) & 1;
  const idHdrUsbDev  = (idHdrDw >>> 30) & 1;

  for (let i = 3; i < vdos.length; i++) {
    const dw = vdos[i]!;

    // DRD Pad Object (all zeros)
    if (isDrd && i === 4) {
      out.push({ label: 'DRD PAD', raw: hex32(dw), section: true });
      continue;
    }

    // UFP VDO (Table 6.40) — PDUSB Hub (1) or PDUSB Peripheral (2)
    const isUfpSlot = (isDrd && i === 3) || (!isDrd && (ufpPType === 1 || ufpPType === 2) && i === 3);
    if (isUfpSlot) {
      const vdoVer   = (dw >>> 29) & 0x7;
      const devCap   = (dw >>> 24) & 0xF;
      const vconnPw  = (dw >>> 8)  & 0x7;
      const vconnRq  = (dw >>> 7)  & 0x1;
      const vbusRq   = (dw >>> 6)  & 0x1;
      const altModes = (dw >>> 3)  & 0x7;
      const usbSpd   = dw          & 0x7;

      const VCONN_PW  = ['1W','1.5W','2W','3W','4W','5W','6W','Rsvd'];
      const devCapStr = [
        devCap & 1 ? 'USB2.0-Dev' : null, devCap & 2 ? 'USB2.0-Billboard' : null,
        devCap & 4 ? 'USB3.2-Dev' : null, devCap & 8 ? 'USB4-Dev' : null,
      ].filter(Boolean).join('+') || 'none';
      const altStr = [
        altModes & 1 ? 'TBT3' : null,
        altModes & 2 ? 'AltMode(reconfig)' : null,
        altModes & 4 ? 'AltMode(no-reconfig)' : null,
      ].filter(Boolean).join('+') || 'none';

      out.push({ label: 'UFP VDO', raw: hex32(dw), section: true });
      out.push({ label: 'VDOVersion',      value: `1.${vdoVer}` });
      out.push({ label: 'DeviceCapability', value: devCapStr });
      out.push({ label: 'AlternateModes',  value: altStr });
      out.push({ label: 'USBHighestSpeed', value: USB_SPD_NAMES[usbSpd] });
      out.push({ label: 'VCONNRequired',   value: `${vconnRq}${vconnRq ? ` (${VCONN_PW[vconnPw]})` : ''}` });
      out.push({ label: 'VBUSRequired',    value: vbusRq ? '1 (No)' : '0 (Yes)' });
      continue;
    }

    // Passive Cable VDO (Table 6.42) — ufpPType=011b, no USB Host/Device capability
    if (i === 3 && ufpPType === 3 && idHdrUsbHost === 0 && idHdrUsbDev === 0) {
      const hwVer    = (dw >>> 28) & 0xF;
      const fwVer    = (dw >>> 24) & 0xF;
      const vdoVer   = (dw >>> 21) & 0x7;
      const plugType = (dw >>> 18) & 0x3;
      const eprCap   = (dw >>> 17) & 0x1;
      const latency  = (dw >>> 13) & 0xF;
      const termType = (dw >>> 11) & 0x3;
      const maxVbus  = (dw >>> 9)  & 0x3;
      const vbusCurr = (dw >>> 5)  & 0x3;
      const usbSpd   = dw          & 0x7;

      const LATENCY   = ['Rsvd','<10ns(~1m)','10-20ns(~2m)','20-30ns(~3m)',
                         '30-40ns(~4m)','40-50ns(~5m)','50-60ns(~6m)','60-70ns(~7m)',
                         '>70ns(>7m)','Rsvd','Rsvd','Rsvd','Rsvd','Rsvd','Rsvd','Rsvd'];
      const TERM_TYPE = ['VCONN-not-req', 'VCONN-req', 'Rsvd', 'Rsvd'];
      const VBUS_CURR = ['Rsvd', '3A', '5A', 'Rsvd'];

      out.push({ label: 'PASSIVE CABLE VDO', raw: hex32(dw), section: true });
      out.push({ label: 'HWVersion',       value: `0x${hwVer.toString(16).toUpperCase()}` });
      out.push({ label: 'FWVersion',       value: `0x${fwVer.toString(16).toUpperCase()}` });
      out.push({ label: 'VDOVersion',      value: `1.${vdoVer}` });
      out.push({ label: 'PlugType',        value: `${bin2(plugType)}b  ${PLUG_TYPE_NAMES[plugType]}` });
      out.push({ label: 'EPRModeCapable',  value: `${eprCap}` });
      out.push({ label: 'CableLatency',    value: LATENCY[latency] });
      out.push({ label: 'CableTermType',   value: TERM_TYPE[termType] });
      out.push({ label: 'MaxVBUSVoltage',  value: MAX_VBUS_NAMES[maxVbus] });
      out.push({ label: 'VBUSCurrent',     value: VBUS_CURR[vbusCurr] });
      out.push({ label: 'USBHighestSpeed', value: USB_SPD_NAMES[usbSpd] });
      continue;
    }

    // Active Cable VDO 1 & 2 (Table 6.43/6.44) — ufpPType=100b (4)
    if (ufpPType === 4 && idHdrUsbHost === 0 && idHdrUsbDev === 0) {
      if (i === 3) {
        const hwVer    = (dw >>> 28) & 0xF;
        const fwVer    = (dw >>> 24) & 0xF;
        const vdoVer   = (dw >>> 21) & 0x7;
        const plugType = (dw >>> 18) & 0x3;
        const eprCap   = (dw >>> 17) & 0x1;
        const latency  = (dw >>> 13) & 0xF;
        const termType = (dw >>> 11) & 0x3;
        const maxVbus  = (dw >>> 9)  & 0x3;
        const sbuSupp  = (dw >>> 8)  & 0x1;
        const sbuType  = (dw >>> 7)  & 0x1;
        const vbusCurr = (dw >>> 5)  & 0x3;
        const vbusThr  = (dw >>> 4)  & 0x1;
        const sop2     = (dw >>> 3)  & 0x1;
        const usbSpd   = dw          & 0x7;

        const LATENCY_ACT   = ['Rsvd','<10ns(~1m)','10-20ns(~2m)','20-30ns(~3m)',
                                '30-40ns(~4m)','40-50ns(~5m)','50-60ns(~6m)','60-70ns(~7m)',
                                '1000ns(~100m)','2000ns(~200m)','3000ns(~300m)',
                                'Rsvd','Rsvd','Rsvd','Rsvd','Rsvd'];
        const TERM_TYPE_ACT = ['Rsvd','Rsvd','1Active+1Passive(VCONN-req)','Both-Active(VCONN-req)'];
        const VBUS_CURR_ACT = ['Default', '3A', '5A', 'Rsvd'];

        out.push({ label: 'ACTIVE CABLE VDO1', raw: hex32(dw), section: true });
        out.push({ label: 'HWVersion',        value: `0x${hwVer.toString(16).toUpperCase()}` });
        out.push({ label: 'FWVersion',        value: `0x${fwVer.toString(16).toUpperCase()}` });
        out.push({ label: 'VDOVersion',       value: `1.${vdoVer}` });
        out.push({ label: 'PlugType',         value: `${bin2(plugType)}b  ${PLUG_TYPE_NAMES[plugType]}` });
        out.push({ label: 'EPRModeCapable',   value: `${eprCap}` });
        out.push({ label: 'CableLatency',     value: LATENCY_ACT[latency] });
        out.push({ label: 'CableTermType',    value: TERM_TYPE_ACT[termType] });
        out.push({ label: 'MaxVBUSVoltage',   value: MAX_VBUS_NAMES[maxVbus] });
        out.push({ label: 'SBUSupported',     value: sbuSupp ? '1 (No)' : '0 (Yes)' });
        out.push({ label: 'SBUType',          value: sbuSupp ? 'N/A' : (sbuType ? '1 (Active)' : '0 (Passive)') });
        out.push({ label: 'VBUSThroughCable', value: `${vbusThr}` });
        if (vbusThr) out.push({ label: 'VBUSCurrent', value: VBUS_CURR_ACT[vbusCurr] });
        out.push({ label: 'SOP2Controller',   value: `${sop2}` });
        out.push({ label: 'USBHighestSpeed',  value: USB_SPD_NAMES[usbSpd] });
        continue;
      }
      if (i === 4) {
        const maxTemp  = (dw >>> 24) & 0xFF;
        const shdnTemp = (dw >>> 16) & 0xFF;
        const u3Pwr    = (dw >>> 12) & 0x7;
        const u3Mode   = (dw >>> 11) & 0x1;
        const physConn = (dw >>> 10) & 0x1;
        const actElem  = (dw >>> 9)  & 0x1;
        const usb4     = (dw >>> 8)  & 0x1;
        const hubHops  = (dw >>> 6)  & 0x3;
        const usb2     = (dw >>> 5)  & 0x1;
        const usb32    = (dw >>> 4)  & 0x1;
        const lanes    = (dw >>> 3)  & 0x1;
        const optIso   = (dw >>> 2)  & 0x1;
        const usb4Asym = (dw >>> 1)  & 0x1;
        const usbGen   = dw          & 0x1;

        const U3CLd_PWR = ['>10mW','5-10mW','1-5mW','0.5-1mW','0.2-0.5mW','50-200µW','<50µW','Rsvd'];

        out.push({ label: 'ACTIVE CABLE VDO2', raw: hex32(dw), section: true });
        out.push({ label: 'MaxOperatingTemp', value: `${maxTemp}°C` });
        out.push({ label: 'ShutdownTemp',     value: `${shdnTemp}°C` });
        out.push({ label: 'U3CLdPower',       value: U3CLd_PWR[u3Pwr] });
        out.push({ label: 'U3toU0TransMode',  value: u3Mode ? 'via U3S' : 'direct' });
        out.push({ label: 'PhysicalConn',     value: physConn ? 'Optical' : 'Copper' });
        out.push({ label: 'ActiveElement',    value: actElem ? 'Retimer' : 'Redriver' });
        out.push({ label: 'USB4Supported',    value: usb4 ? '1 (No)' : '0 (Yes)' });
        out.push({ label: 'USB2HubHops',      value: `${hubHops}` });
        out.push({ label: 'USB2Supported',    value: usb2 ? '1 (No)' : '0 (Yes)' });
        out.push({ label: 'USB32Supported',   value: usb32 ? '1 (No)' : '0 (Yes)' });
        out.push({ label: 'USBLanes',         value: lanes ? '1 (2-lane)' : '0 (1-lane)' });
        out.push({ label: 'OpticallyIsolated',value: `${optIso}` });
        out.push({ label: 'USB4AsymMode',     value: `${usb4Asym}` });
        out.push({ label: 'USBGen',           value: usbGen ? '1 (Gen2+)' : '0 (Gen1)' });
        continue;
      }
    }

    // VPD VDO (Table 6.45) — ufpPType=110b (6)
    if (i === 3 && ufpPType === 6 && idHdrUsbHost === 0 && idHdrUsbDev === 0) {
      const hwVer   = (dw >>> 28) & 0xF;
      const fwVer   = (dw >>> 24) & 0xF;
      const vdoVer  = (dw >>> 21) & 0x7;
      const maxVbus = (dw >>> 15) & 0x3;
      const ctCurr  = (dw >>> 14) & 0x1;
      const vbusImp = (dw >>> 7)  & 0x3F;
      const gndImp  = (dw >>> 1)  & 0x3F;
      const ctSupp  = dw          & 0x1;
      const MAX_VBUS_VPD = ['20V', '20V(was30V⚠)', '20V(was40V⚠)', '20V(was50V⚠)'];

      out.push({ label: 'VPD VDO', raw: hex32(dw), section: true });
      out.push({ label: 'HWVersion',            value: `0x${hwVer.toString(16).toUpperCase()}` });
      out.push({ label: 'FWVersion',            value: `0x${fwVer.toString(16).toUpperCase()}` });
      out.push({ label: 'VDOVersion',           value: `1.${vdoVer}` });
      out.push({ label: 'MaxVBUSVoltage',       value: MAX_VBUS_VPD[maxVbus] });
      out.push({ label: 'ChargeThroughSupport', value: `${ctSupp}` });
      if (ctSupp) {
        out.push({ label: 'ChargeThroughCurrent', value: ctCurr ? '1 (5A)' : '0 (3A)' });
        out.push({ label: 'VBUSImpedance',        value: `${vbusImp * 2}mΩ` });
        out.push({ label: 'GndImpedance',         value: `${gndImp}mΩ` });
      }
      continue;
    }

    // DFP VDO (Table 6.41) — DRD slot i=5, or non-DRD DFP-only product
    const dfpPType  = (idHdrDw >>> 23) & 0x7;
    const isDfpSlot = (isDrd && i === 5) || (!isDrd && i === 3 && dfpPType >= 1 && dfpPType <= 3 && ufpPType === 0);
    if (isDfpSlot) {
      const vdoVer  = (dw >>> 29) & 0x7;
      const hostCap = (dw >>> 24) & 0x7;
      const portNum = dw          & 0x1F;
      const hostCapStr = [
        hostCap & 1 ? 'USB2.0' : null,
        hostCap & 2 ? 'USB3.2' : null,
        hostCap & 4 ? 'USB4'   : null,
      ].filter(Boolean).join('+') || 'none';

      out.push({ label: 'DFP VDO', raw: hex32(dw), section: true });
      out.push({ label: 'VDOVersion',    value: `1.${vdoVer}` });
      out.push({ label: 'HostCapability', value: hostCapStr });
      out.push({ label: 'PortNumber',    value: `${portNum}` });
      continue;
    }

    // Fallback — raw data
    const ptLabel = isDrd
      ? (i === 3 ? 'UFP' : i === 5 ? 'DFP' : `PType[${i - 2}]`)
      : `PType[${i - 2}]`;
    out.push({ label: ptLabel, raw: hex32(dw), section: true });
    out.push({ label: 'Data', value: hex32(dw) });
  }

  return out;
}

/**
 * Decode Discover SVIDs ACK VDOs (USB PD Rev 3.2 §6.4.4.4).
 * Each VDO contains two SVIDs: bits[31:16] and bits[15:0].
 * The last entry has 0x0000 in bytes[15:0] when list ends.
 */
function decodeDiscoverSVIDsVDOs(vdos: number[]): object[] {
  // Table 6.46: each VDO contains SVID n (B31:16) and SVID n+1 (B15:0).
  // Termination: odd count → B15:0=0x0000; even count → extra VDO with both 0x0000.
  // Output uses the same section/field structure as decodeDiscoverIdentityVDOs:
  //   { label, raw, section: true }  — collapsible section header per VDO word
  //   { label, value }               — field rows inside each section
  const out: object[] = [];
  const hex32 = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  const hex16 = (v: number) => `0x${(v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`;
  for (let i = 0; i < vdos.length; i++) {
    const dw = vdos[i]!;
    const s1 = (dw >>> 16) & 0xFFFF;
    const s2 = dw & 0xFFFF;
    const isTerminator = s1 === 0x0000 && s2 === 0x0000;
    const isOddEnd     = !isTerminator && s2 === 0x0000;

    // Section header
    out.push({ label: `SVID VDO[${i + 1}]`, raw: hex32(dw), section: true });

    if (isTerminator) {
      out.push({ label: 'SVID[upper]', value: '0x0000  (end-of-list)' });
      out.push({ label: 'SVID[lower]', value: '0x0000  (end-of-list)' });
    } else if (isOddEnd) {
      out.push({ label: 'SVID[upper]', value: `${hex16(s1)}  ${fmtSvid(s1)}` });
      out.push({ label: 'SVID[lower]', value: '0x0000  (end-of-list)' });
    } else {
      out.push({ label: 'SVID[upper]', value: `${hex16(s1)}  ${fmtSvid(s1)}` });
      out.push({ label: 'SVID[lower]', value: `${hex16(s2)}  ${fmtSvid(s2)}` });
    }
  }
  return out;
}

/**
 * Decode Discover Modes ACK VDOs for DisplayPort Alt Mode (SVID=0xFF01).
 * USB PD Rev 3.2 §B.1 – DP Capabilities VDO.
 * Returns section/field structure compatible with 2-level tree.
 */
function decodeDPModeVDOs(vdos: number[]): object[] {
  const out: object[] = [];
  const hex32 = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  for (let i = 0; i < vdos.length; i++) {
    const dw = vdos[i]!;
    if (i === 0) {
      // DP Capabilities VDO (Table B-1)
      const ufpD     = (dw >>> 0) & 0xF;
      const dfpD     = (dw >>> 8) & 0xF;
      const recep    = (dw >>> 6) & 0x1;
      const usb20    = (dw >>> 7) & 0x1;
      const sig      = (dw >>> 16) & 0xF;
      const sigNames: Record<number, string> = { 0: 'DP Gen1', 1: 'Gen2', 2: 'Reserved', 8: 'Gen3' };
      out.push({ label: `Mode ${i + 1}: DP Capabilities VDO`, raw: hex32(dw), section: true });
      out.push({ label: 'UFP_D PinAssign', value: `0x${ufpD.toString(16).toUpperCase()}` });
      out.push({ label: 'DFP_D PinAssign', value: `0x${dfpD.toString(16).toUpperCase()}` });
      out.push({ label: 'Receptacle',      value: recep ? '1  Receptacle' : '0  Plug' });
      out.push({ label: 'USB2.0 Signal',   value: String(usb20) });
      out.push({ label: 'DP Signaling',    value: `${sig}  ${sigNames[sig] ?? 'Reserved'}` });
    } else {
      out.push({ label: `Mode ${i + 1}`, raw: hex32(dw), section: true });
      out.push({ label: 'Raw', value: hex32(dw) });
    }
  }
  return out;
}

/**
 * Decode Attention / Enter Mode / Exit Mode VDOs for DP (SVID=0xFF01).
 * DP Status VDO (Enter Mode ACK, Attention) – Table B-3.
 */
function decodeDPStatusVDO(dw: number): string {
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
export function decodeDataObjects(typeName: string, dataObjects: number[], srcPdoType?: string): TreeRow[] | null {
  if (!dataObjects || dataObjects.length === 0) return null;

  switch (typeName) {
    case 'Source_Capabilities':
    case 'Sink_Capabilities':
    case 'EPR_Source_Capabilities':
    case 'EPR_Sink_Capabilities': {
      const isSinkCap = typeName === 'Sink_Capabilities' || typeName === 'EPR_Sink_Capabilities';
      return dataObjects.map((dw, i) => decodePDO(dw, i, isSinkCap));
    }

    case 'Request':
      return [decodeRDO(dataObjects[0]!, srcPdoType ?? 'Fixed')];

    case 'EPR_Request': {
      // DO[0]: EPR RDO (AVS type); DO[1]: mirror of the selected source EPR PDO (spec Table 6.38)
      const eprRows: TreeRow[] = [decodeRDO(dataObjects[0]!, srcPdoType ?? 'APDO_AVS')];
      const eprMirrorDw = dataObjects[1];
      if (eprMirrorDw !== undefined) eprRows.push({ ...decodePDO(eprMirrorDw, 1), eprMirror: true });
      return eprRows;
    }

    case 'EPR_Mode': {
      // USB PD Rev 3.2 Table 6.51 — EPRMDO
      // B31..24 = Action (8-bit), B23..16 = Data, B15..0 = Reserved
      const EPR_ACTION: Record<number, string> = {
        0x01: 'Enter',
        0x02: 'Enter Acknowledged',
        0x03: 'Enter Succeeded',
        0x04: 'Enter Failed',
        0x05: 'Exit',
      };
      const EPR_FAIL: Record<number, string> = {
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
      const sido = decodeSIDO(dataObjects[0]!);
      return [
        { label: 'Port Type',     value: sido.portType,                                                          raw: sido.raw },
        { label: 'Max PDP',       value: `${sido.maxPdpW} W`,                                                    raw: '' },
        { label: 'Present PDP',   value: `${sido.presentPdpW} W`,                                               raw: '' },
        { label: 'Reported PDP',  value: `${sido.reportedPdpW} W`,                                              raw: '' },
      ];
    }

    case 'Vendor_Defined': {
      const vdmHdr   = dataObjects[0]!;
      const svid     = (vdmHdr >>> 16) & 0xFFFF;
      const structured = (vdmHdr >>> 15) & 0x1;

      if (!structured) {
        // Unstructured VDM (USB PD Rev 3.2 Table 6.29)
        // B31:16 = VID, B15 = 0 (Unstructured), B14:0 = Vendor-defined data
        const vendorData = vdmHdr & 0x7FFF;
        return [
          {
            label: `VDM Header — SVID:${fmtSvid(svid)} [Unstructured] VendorData:0x${vendorData.toString(16).toUpperCase().padStart(4, '0')}`,
            raw: `0x${(vdmHdr >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          },
          ...dataObjects.slice(1).map((dw, i) => ({
            label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })),
        ];
      }

      // Structured VDM Header (USB PD Rev 3.2 Table 6.30)
      // B15=VDM Type, B14:13=VDM Version Major, B12:11=VDM Version Minor,
      // B10:8=Object Position, B7:6=CmdType, B5=Rsvd, B4:0=Command
      const vdmVerMaj = (vdmHdr >>> 13) & 0x3;  // 01b = Version 2.x
      const vdmVerMin = (vdmHdr >>> 11) & 0x3;  // 00b = 2.0, 01b = 2.1
      const cmdType   = (vdmHdr >>> 6) & 0x3;
      const cmd       = vdmHdr & 0x1F;
      const objPos    = (vdmHdr >>> 8) & 0x7;   // bits[10:8]

      // VDM Version string (Major.Minor)
      const verStr = vdmVerMaj === 0 ? 'v1.0(Deprecated)'
                   : vdmVerMaj === 1 ? `v2.${vdmVerMin}`
                   : `vRsvd(${vdmVerMaj}.${vdmVerMin})`;

      // Command name — 0-15 standard, 16-31 SVID-specific
      const cmdName     = cmd >= 0x10
        ? `SVID_Cmd_0x${cmd.toString(16).toUpperCase()}`
        : (VDM_CMD_NAMES[cmd] ?? `Rsvd_0x${cmd.toString(16)}`);
      const cmdTypeName = VDM_CMD_TYPE[cmdType];

      // Table 6.33: validate allowed responses per command (monitor only — annotate violations)
      // Enter Mode (0x04): ACK, NAK only.  Exit Mode (0x05): ACK, NAK only.
      // Attention (0x06): no response Shall be sent (REQ only).
      let specViolation = '';
      if ((cmd === 0x04 || cmd === 0x05) && cmdType === 3 /* BUSY */) {
        specViolation = ' ⚠BUSY-not-allowed';
      } else if (cmd === 0x06 && cmdType !== 0 /* not REQ */) {
        specViolation = ' ⚠No-response-for-Attention';
      }

      // Object Position — used by Enter Mode (0x04), Exit Mode (0x05), Attention (0x06)
      // §6.4.4.2.4: ObjPos=0x7 (ExitAll) is only defined for Exit Mode.
      // For all other commands it Shall be set to zero when not required.
      let objPosStr = '';
      if (cmd === 0x04 || cmd === 0x05 || cmd === 0x06) {
        if (cmd === 0x05 && objPos === 0x7) {
          objPosStr = ' Obj=ExitAll';        // Exit Mode: 0x7 = exit all active modes
        } else if (objPos > 0) {
          objPosStr = ` Obj#${objPos}`;
        } else {
          objPosStr = ' Obj=Rsvd';           // 0 = reserved / not required
        }
      }

      const headerLabel =
        `VDM Header — SVID:${fmtSvid(svid)} ${cmdName} [${cmdTypeName}] ${verStr}${objPosStr}${specViolation}`;

      const vdos = dataObjects.slice(1);

      // Decode VDOs based on command + cmdType + SVID
      let decodedVdos;
      if (cmd === 0x01 && cmdType === 1) {
        // Discover Identity ACK — standard VDO structure
        decodedVdos = decodeDiscoverIdentityVDOs(vdos);
      } else if (cmd === 0x02 && cmdType === 1) {
        // Discover SVIDs ACK — SVID SHALL be PD SID (0xFF00) (§6.4.4.3.2)
        decodedVdos = [];
        if (svid !== 0xFF00) {
          decodedVdos.push({ label: `⚠ SVID SHALL be PD SID (0xFF00) — §6.4.4.3.2`, raw: '' });
        }
        decodedVdos.push(...decodeDiscoverSVIDsVDOs(vdos));
      } else if (cmd === 0x03 && cmdType === 1 && svid === 0xFF01) {
        // Discover Modes ACK for DisplayPort
        decodedVdos = decodeDPModeVDOs(vdos);
      } else if (cmd === 0x03 && cmdType === 1) {
        // Discover Modes ACK — generic (unknown SVID)
        // §6.4.4.3.3: ACK SHALL contain 1+ Mode VDOs (NDO = 2..7)
        decodedVdos = [];
        if (vdos.length === 0) {
          decodedVdos.push({ label: `⚠ Discover Modes ACK SHALL contain at least one Mode VDO — §6.4.4.3.3`, raw: '' });
        } else {
          const hex32 = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
          vdos.forEach((dw, i) => {
            decodedVdos.push({ label: `Mode ${i + 1}`, raw: hex32(dw), section: true });
            decodedVdos.push({ label: 'Raw', value: hex32(dw) });
          });
        }
      } else if ((cmd === 0x04 || cmd === 0x06) && svid === 0xFF01 && vdos.length >= 1) {
        // Enter Mode ACK / Attention for DP — first VDO is DP Status VDO
        decodedVdos = [
          { label: decodeDPStatusVDO(vdos[0]!), raw: `0x${(vdos[0]! >>> 0).toString(16).toUpperCase().padStart(8,'0')}` },
          ...vdos.slice(1).map((dw, i) => ({
            label: `VDO[${i + 2}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })),
        ];
      } else if (cmd === 0x03) {
        // Discover Modes REQ / NAK / BUSY
        // §6.4.4.3.3: REQ/NAK/BUSY SHALL NOT contain VDOs.
        decodedVdos = [];
        if (vdos.length > 0) {
          decodedVdos.push({ label: `⚠ Discover Modes ${cmdTypeName} SHALL NOT contain VDOs — §6.4.4.3.3`, raw: '' });
          decodedVdos.push(...vdos.map((dw, i) => ({
            label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })));
        }
      } else if (cmd === 0x02) {
        // Discover SVIDs REQ / NAK / BUSY
        // §6.4.4.3.2: SVID SHALL be PD SID (0xFF00); REQ/NAK/BUSY SHALL NOT contain VDOs.
        decodedVdos = [];
        if (svid !== 0xFF00) {
          decodedVdos.push({ label: `⚠ SVID SHALL be PD SID (0xFF00) — §6.4.4.3.2`, raw: '' });
        }
        if (vdos.length > 0) {
          decodedVdos.push({ label: `⚠ Discover SVIDs ${cmdTypeName} SHALL NOT contain VDOs — §6.4.4.3.2`, raw: '' });
          decodedVdos.push(...vdos.map((dw, i) => ({
            label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })));
        }
      } else if (cmd === 0x01) {
        // Discover Identity REQ / NAK / BUSY
        // §6.4.4.3.1: SVID SHALL be PD SID (0xFF00); REQ/NAK/BUSY SHALL NOT contain VDOs.
        decodedVdos = [];
        if (svid !== 0xFF00) {
          decodedVdos.push({ label: `⚠ SVID SHALL be PD SID (0xFF00) \u2014 §6.4.4.3.1`, raw: '' });
        }
        if (vdos.length > 0) {
          decodedVdos.push({ label: `⚠ Discover Identity ${cmdTypeName} SHALL NOT contain VDOs \u2014 §6.4.4.3.1`, raw: '' });
          decodedVdos.push(...vdos.map((dw, i) => ({
            label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
            raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          })));
        }
      } else {
        decodedVdos = vdos.map((dw, i) => ({
          label: `VDO[${i + 1}]: 0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
          raw:   `0x${(dw >>> 0).toString(16).toUpperCase().padStart(8, '0')}`,
        }));
      }

      return [
        { label: headerLabel, raw: `0x${(vdmHdr >>> 0).toString(16).toUpperCase().padStart(8, '0')}` } as TreeRow,
        ...(decodedVdos as TreeRow[]),
      ];
    }

    case 'BIST': {
      // Table 6.9 (USB PD Rev 3.2) – BIST Data Object (BDO)
      // B31..28 = BIST Data Object Type
      const BIST_TYPE: Record<number, string> = {
        0: 'BIST Carrier Mode 2',
        5: 'BIST Test Data',
        8: 'BIST Shared Test Mode Entry',
        9: 'BIST Shared Test Mode Exit',
      };
      const dw0   = dataObjects[0]!;
      const bdoT  = (dw0 >>> 28) & 0xF;
      const label = BIST_TYPE[bdoT] ?? `Reserved(${bdoT})`;
      const raw0  = `0x${dw0.toString(16).toUpperCase().padStart(8, '0')}`;
      // B19..16 = Errored Data Blocks Counter (BIST Test Data mode only)
      const rows = [{ label: 'BIST Mode', value: label, raw: raw0 }];
      if (bdoT === 5) {
        const counter = (dw0 >>> 16) & 0xF;
        rows.push({ label: 'Error Counter', value: String(counter), raw: '' });
      }
      return rows;
    }

    case 'Battery_Status': {
      // Table 6.41 (USB PD Rev 3.2) – Battery Status Data Object (BSDO)
      // B31..16 = Battery Present Capacity (10 mWh, 0xFFFF = Unknown)
      // B3 = Battery Fully Charged
      // B2 = Battery Fully Discharged
      // B1 = Battery is Charging
      // B0 = Invalid Battery Reference
      const dw0 = dataObjects[0]!;
      const bpc = (dw0 >>> 16) & 0xFFFF;
      const fullyCharged    = !!(dw0 & (1 << 3));
      const fullyDischarged = !!(dw0 & (1 << 2));
      const isCharging      = !!(dw0 & (1 << 1));
      const invalidRef      = !!(dw0 & (1 << 0));
      const raw0 = `0x${dw0.toString(16).toUpperCase().padStart(8, '0')}`;
      const bpcStr = bpc === 0xFFFF ? 'Unknown' : `${(bpc * 10).toLocaleString()} mWh`;
      const statusStr = invalidRef      ? 'Invalid Reference'
        : fullyDischarged ? 'Fully Discharged'
        : fullyCharged    ? 'Fully Charged'
        : isCharging      ? 'Charging'
        : 'Idle';
      return [
        { label: 'Present Capacity', value: bpcStr,    raw: raw0 },
        { label: 'Status',           value: statusStr, raw: '' },
      ];
    }

    case 'Alert': {
      // Table 6.44 (USB PD Rev 3.2) – Alert Data Object (ADO)
      // B31 = Extended Alert
      // B26 = Source Input Change
      // B25 = Battery Status Change
      // B24 = Over-Current Protection (OCP)
      // B23 = Over-Temperature Protection (OTP)
      // B22 = Operating Condition Change
      // B19..16 = Fixed Batteries Battery Status Bits (bat4..1)
      // B3..0   = Hot-swappable Batteries Status Bits (bat4..1)
      const dw0      = dataObjects[0]!;
      const extended = !!(dw0 & (1 << 31));
      const srcIn    = !!(dw0 & (1 << 26));
      const batChg   = !!(dw0 & (1 << 25));
      const ocp      = !!(dw0 & (1 << 24));
      const otp      = !!(dw0 & (1 << 23));
      const opChg    = !!(dw0 & (1 << 22));
      const raw0     = `0x${dw0.toString(16).toUpperCase().padStart(8, '0')}`;
      const flags    = [];
      if (srcIn)    flags.push('Source Input Change');
      if (batChg)   flags.push('Battery Status Change');
      if (ocp)      flags.push('OCP');
      if (otp)      flags.push('OTP');
      if (opChg)    flags.push('Operating Condition Change');
      if (extended) flags.push('Extended');
      const fixedBats = (dw0 >>> 16) & 0xF;
      const hotBats   = dw0 & 0xF;
      if (fixedBats) flags.push(`FixedBat[${[0,1,2,3].filter((b) => fixedBats & (1 << b)).map((b) => b + 1).join(',')}]`);
      if (hotBats)   flags.push(`HotBat[${[0,1,2,3].filter((b) => hotBats & (1 << b)).map((b) => b + 1).join(',')}]`);
      const rows = [{ label: 'Alert', value: flags.join('  ') || '(none)', raw: raw0 }];
      // Extended alert: subsequent DOs carry additional alert data
      for (let i = 1; i < dataObjects.length; i++) {
        const w = dataObjects[i]!;
        rows.push({ label: `Alert Data[${i}]`, value: `0x${w.toString(16).toUpperCase().padStart(8, '0')}`, raw: `0x${w.toString(16).toUpperCase().padStart(8, '0')}` });
      }
      return rows;
    }

    case 'Get_Country_Info': {
      // Section 6.4.7 (USB PD Rev 3.2) – Country_Code Data Object
      // B31..16 = Country Code (2 ASCII chars, e.g. 'US', 'JP')
      // B15..0  = Reserved
      return dataObjects.map((dw, i) => {
        const hi  = (dw >>> 24) & 0xFF;
        const lo  = (dw >>> 16) & 0xFF;
        const cc  = hi >= 0x20 && lo >= 0x20
          ? String.fromCharCode(hi) + String.fromCharCode(lo)
          : `0x${((dw >>> 16) & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')}`;
        return {
          label: i === 0 ? 'Country Code' : `Country Code[${i + 1}]`,
          value: cc,
          raw: `0x${dw.toString(16).toUpperCase().padStart(8, '0')}`,
        };
      });
    }

    case 'Enter_USB': {
      // Table 6.48 (USB PD Rev 3.2) – Enter_USB Data Object (EUDO)
      // B29..27 = USB Mode
      // B26     = Ethernet Capable
      // B25     = DRD (Dual Role Data)
      // B24     = Host Capable
      // B23     = MUX Controller Present
      // B22     = Cable Type (0=Passive, 1=Active)
      // B21     = EPR Cable Capable
      // B20     = Modal Operation Supported
      // B16     = HPD Level High
      const USB_MODE: Record<number, string> = { 0: 'USB 2.0', 1: 'USB 3.2', 2: 'USB4 Gen2 (20G)', 3: 'USB4 Gen3 (40G)', 4: 'USB4 Gen4 (80G)' };
      const dw0  = dataObjects[0]!
      const mode = (dw0 >>> 27) & 0x7;
      const raw0 = `0x${dw0.toString(16).toUpperCase().padStart(8, '0')}`;
      const rows = [
        { label: 'USB Mode',   value: USB_MODE[mode] ?? `Mode${mode}`, raw: raw0 },
        { label: 'Cable Type', value: (dw0 & (1 << 22)) ? 'Active' : 'Passive', raw: '' },
      ];
      if  (dw0 & (1 << 26)) rows.push({ label: 'Ethernet',         value: 'Capable', raw: '' });
      if  (dw0 & (1 << 25)) rows.push({ label: 'DRD',              value: 'Yes',     raw: '' });
      if  (dw0 & (1 << 24)) rows.push({ label: 'Host Capable',     value: 'Yes',     raw: '' });
      if  (dw0 & (1 << 23)) rows.push({ label: 'MUX Controller',   value: 'Present', raw: '' });
      if  (dw0 & (1 << 21)) rows.push({ label: 'EPR Cable',        value: 'Capable', raw: '' });
      if  (dw0 & (1 << 20)) rows.push({ label: 'Modal Operation',  value: 'Supported', raw: '' });
      if  (dw0 & (1 << 16)) rows.push({ label: 'HPD',              value: 'High',    raw: '' });
      return rows;
    }

    case 'Revision': {
      // Table 6.53 (USB PD Rev 3.2) – Revision Data Object
      // B31..28 = Major Revision (BCD), B27..24 = Minor Revision (BCD)
      // B15..12 = Major Version (BCD),  B11..8  = Minor Version (BCD)
      const dw0      = dataObjects[0]!
      const revMajor = (dw0 >>> 28) & 0xF;
      const revMinor = (dw0 >>> 24) & 0xF;
      const verMajor = (dw0 >>> 12) & 0xF;
      const verMinor = (dw0 >>>  8) & 0xF;
      const raw0     = `0x${dw0.toString(16).toUpperCase().padStart(8, '0')}`;
      return [
        { label: 'PD Revision', value: `${revMajor}.${revMinor}`, raw: raw0 },
        { label: 'PD Version',  value: `${verMajor}.${verMinor}`, raw: '' },
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
export function decodeSourceCapsExtended(bytes: Uint8Array | number[]): ParsedPayloadRow[] {
  if (!bytes || bytes.length < 25) return [];

  const u8  = (o: number) => bytes[o] ?? 0;
  const u16 = (o: number) => u8(o) | (u8(o + 1) << 8);
  const u32 = (o: number) => (u8(o) | (u8(o+1) << 8) | (u8(o+2) << 16) | (u8(o+3) << 24)) >>> 0;

  const items: ParsedPayloadRow[] = [];
  const item  = (label: string, value: string) => items.push({ label, value });

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
  function decodePeak(offset: number): string {
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
export function decodeStatus(bytes: Uint8Array | number[]): ParsedPayloadRow[] {
  if (!bytes || bytes.length < 7) return [];
  const u8 = (o: number) => bytes[o] ?? 0;
  const items: ParsedPayloadRow[] = [];
  const item  = (label: string, value: string) => items.push({ label, value });

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
  item('Temp Status', TEMP_STATUS[(u8(4) >> 1) & 0x3] ?? 'Unknown');

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
  item('New Power State', NEW_STATE[psc & 0x7] ?? 'Unknown');
  const led = (psc >> 3) & 0x7;
  if (led <= 3) item('LED Indicator', LED_STATE[led] ?? '');

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
export function decodeExtendedControl(bytes: Uint8Array | number[]): ParsedPayloadRow[] {
  if (!bytes || bytes.length < 2) return [];
  const ECDB_TYPE: Record<number, string> = {
    0x01: 'EPR_Get_Source_Cap',
    0x02: 'EPR_Get_Sink_Cap',
    0x03: 'EPR_KeepAlive',
    0x04: 'EPR_KeepAlive_Ack',
  };
  const type = (bytes[0] ?? 0) & 0xFF;
  const data = (bytes[1] ?? 0) & 0xFF;
  const items: ParsedPayloadRow[] = [];
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
export function decodeSinkCapsExtended(bytes: Uint8Array | number[]): ParsedPayloadRow[] {
  if (!bytes || bytes.length < 21) return [];

  const u8  = (o: number) => bytes[o] ?? 0;
  const u16 = (o: number) => u8(o) | (u8(o + 1) << 8);
  const u32 = (o: number) => (u8(o) | (u8(o+1)<<8) | (u8(o+2)<<16) | (u8(o+3)<<24)) >>> 0;

  const items: ParsedPayloadRow[] = [];
  const item  = (label: string, value: string) => items.push({ label, value });

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
  'BIST', 'Battery_Status', 'Alert', 'Get_Country_Info', 'Enter_USB', 'Revision',
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
export function isUndecodedMessage(header: MessageHeader | null | undefined): boolean {
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
export function buildUnknownRecord(frame: Record<string, unknown>, context: string): Record<string, unknown> {
  const cpd = frame.cpd as { dirName?: string; sopQualName?: string } | null | undefined;
  const h   = (frame.header as Partial<MessageHeader> | null | undefined) ?? {};
  return {
    context,
    ts_raw:           String(frame.ts ?? 0),
    source:           frame.source ?? '',
    direction:        cpd?.dirName ?? '',
    sop:              cpd?.sopQualName ?? 'SOP',
    spec_revision:    h.specRevision ?? '',
    msg_id:           h.msgId ?? 0,
    type_name:        h.typeName ?? '',
    is_extended:      !!(h.extended),
    is_control:       !!(h.isControl),
    num_data_objects: h.numDataObjects ?? 0,
    raw_hex:          frame.raw ?? '',
    data_objects:     (frame.dataObjects as number[] | null | undefined ?? []).map(
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
export function parseCpdFile(buffer: ArrayBuffer): ParsedCpdFile {
  const view   = new DataView(buffer);
  const bytes  = new Uint8Array(buffer);
  const total  = bytes.length;
  const frames: PdFrame[] = [];
  const errors: string[]  = [];

  let offset = 0;

  while (offset <= total - CPD_FIXED_HDR) {
    // --- Locate sync marker FD FD FD FD ---
    const syncWord = view.getUint32(offset, false); // big-endian read for comparison
    if (syncWord !== CPD_SYNC) {
      offset++;
      continue;
    }

    // --- Read header fields ---
    // We are inside offset <= total - CPD_FIXED_HDR (=20), so offsets 6..15 are within bounds.
    const fixedField  = view.getUint16(offset + 4, true);   // LE: 0x0032
    const catByte     = bytes[offset + 6]!;                  // payloadLen + 9
    const dirByte     = bytes[offset + 7]!;                  // 0x03/0x06/0x07/0x08
    const timestamp   = view.getUint32(offset + 8, true);   // LE uint32
    const sopQual     = bytes[offset + 13]!;                 // 0x00=SOP, 0x01=SOP', 0x02=SOP''
    const payloadLen  = bytes[offset + 15]!;                 // direct length byte

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
    if (sentinelBytes.some((b) => b !== 0xA5)) {
      errors.push(`offset 0x${offset.toString(16)}: non-standard sentinel [${sentinelHex}]`);
    }

    const payload    = bytes.slice(payloadStart, payloadEnd);
    const recordType = CPD_RECORD_TYPE[dirByte] ?? 'UNKNOWN';

    // Use Record<string, unknown> to allow incremental property addition; cast at push time.
    const frame: Record<string, unknown> = {
      ts:     timestamp,
      source: 'STM32',
      recordType,
      cpd: {
        fixedField,
        cat: catByte,
        dir: dirByte,
        dirName:     CPD_DIR[dirByte]     ?? `0x${dirByte.toString(16)}`,
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
      frame['asciiLog'] = asciiLog;
      frame['raw']      = asciiLog;
      // Parse structured fields: VBUS:<mV>[,:] CC:<pin>
      const vbusM = asciiLog.match(/VBUS:([\d]+)/);
      const ccM   = asciiLog.match(/CC:([\d]+)/);
      if (vbusM) frame['vbusMv'] = parseInt(vbusM[1]!, 10);
      if (ccM)   frame['ccPin']  = parseInt(ccM[1]!,   10);
    } else if (recordType === 'EVENT') {
      // dir=0x03, len=0: SOP'/SOP'' detection event marker
      const eventName   = CPD_EVENT_NAME[sopQual] ?? `EVENT_SOP_0x${sopQual.toString(16)}`;
      frame['eventName'] = eventName;
      frame['raw']       = eventName;
    } else if (recordType === 'PD_MSG' && payload.length >= 2) {
      // dir=0x07/0x08: USB-PD message
      const headerWord = payload[0]! | (payload[1]! << 8);
      const header     = parseMessageHeader(headerWord, sopQual);

      // When Extended bit is set, bytes 2-3 of the payload carry the Extended Message Header
      // (Table 6.3). Actual 4-byte Data Objects follow from byte 4.
      let doOffset = 2;
      let extendedHeader = null;
      if (header.extended && payload.length >= 4) {
        extendedHeader = parseExtendedMsgHeader(payload[2]! | (payload[3]! << 8));
        doOffset = 4;
      }

      const dataObjects: number[] = [];
      for (let i = doOffset; i + 3 < payload.length; i += 4) {
        const dw = (payload[i]! |
                    (payload[i + 1]! << 8) |
                    (payload[i + 2]! << 16) |
                    (payload[i + 3]! << 24)) >>> 0;
        dataObjects.push(dw);
      }

      frame['header']         = header;
      frame['extendedHeader'] = extendedHeader;
      frame['dataObjects']    = dataObjects;
      // Byte-level extended payload decode (before raw is set)
      let parsedPayload: ParsedPayloadRow[] | undefined;
      if (header.typeName === 'Source_Capabilities_Extended' && payload.length >= doOffset + 25) {
        parsedPayload = decodeSourceCapsExtended(payload.slice(doOffset, doOffset + 25));
        frame['parsedPayload'] = parsedPayload;
      } else if (header.typeName === 'Status' && payload.length >= doOffset + 7) {
        parsedPayload = decodeStatus(payload.slice(doOffset, doOffset + 7));
        frame['parsedPayload'] = parsedPayload;
      } else if (header.typeName === 'Extended_Control' && payload.length >= doOffset + 2) {
        parsedPayload = decodeExtendedControl(payload.slice(doOffset));
        frame['parsedPayload'] = parsedPayload;
      } else if (header.typeName === 'Sink_Capabilities_Extended' && payload.length >= doOffset + 21) {
        parsedPayload = decodeSinkCapsExtended(payload.slice(doOffset));
        frame['parsedPayload'] = parsedPayload;
      }
      frame['raw'] = Array.from(payload)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
      // Attach compact inline summary for capability messages
      if (header.typeName === 'Source_Capabilities' || header.typeName === 'Sink_Capabilities'
          || header.typeName === 'EPR_Source_Capabilities' || header.typeName === 'EPR_Sink_Capabilities') {
        if (dataObjects.length > 0) {
          frame['pdoSummary'] = buildPdoSummary(header.typeName, dataObjects);
          // EPR marker: any fixed PDO has eprModeCapable set
          frame['eprCapable'] = dataObjects.some((dw) => {
            const pdoType = (dw >>> 30) & 0x3;
            return pdoType === 0b00 && !!(dw & (1 << 23));
          });
        } else if (extendedHeader) {
          // Chunk request (RequestChunk=1, DataSize=0) or empty chunked frame
          const chunkInfo = extendedHeader.requestChunk
            ? `Chunk#${extendedHeader.chunkNumber} [Req]`
            : `Chunk#${extendedHeader.chunkNumber}`;
          frame['pdoSummary'] = chunkInfo;
        }
      } else if ((header.typeName === 'Request' || header.typeName === 'EPR_Request') && dataObjects.length) {
        frame['pdoSummary'] = buildRdoSummary(dataObjects[0]!);
      } else if (header.typeName === 'EPR_Mode' && dataObjects.length) {
        const EPR_ACTION: Record<number, string> = {
          0x01: 'Enter', 0x02: 'Enter Acknowledged', 0x03: 'Enter Succeeded',
          0x04: 'Enter Failed', 0x05: 'Exit',
        };
        const EPR_FAIL: Record<number, string> = {
          0x00: 'Unknown', 0x01: 'Cable not EPR capable',
          0x02: 'VCONN source failed', 0x03: 'EPR bit not set in RDO',
          0x04: 'Source unable to enter', 0x05: 'EPR bit not set in PDO',
        };
        const dw     = dataObjects[0]!;
        const action = (dw >>> 24) & 0xFF;
        const data   = (dw >>> 16) & 0xFF;
        const label  = EPR_ACTION[action] ?? `Action:0x${action.toString(16).toUpperCase()}`;
        const extra  = action === 0x01 && data ? `  PDP:${data}W`
                     : action === 0x04         ? `  (${EPR_FAIL[data] ?? `0x${data.toString(16)}`})`
                     : '';
        frame['pdoSummary'] = label + extra;
      } else if (header.typeName === 'Source_Info' && dataObjects.length) {
        const dw     = dataObjects[0]!;
        const type   = (dw >>> 31) & 0x1 ? 'Guaranteed' : 'Managed';
        const maxP   = (dw >>> 16) & 0xFF;
        const presP  = (dw >>> 8)  & 0xFF;
        const repP   =  dw         & 0xFF;
        frame['pdoSummary'] = `${type}  Max:${maxP}W  Present:${presP}W  Reported:${repP}W`;
      } else if (header.typeName === 'Vendor_Defined' && dataObjects.length) {
        const vdmHdr     = dataObjects[0]!;
        const svid       = (vdmHdr >>> 16) & 0xFFFF;
        const structured = (vdmHdr >>> 15) & 0x1;
        const svidStr    = fmtSvid(svid);
        if (!structured) {
          const vendorData = vdmHdr & 0x7FFF;
          frame['pdoSummary'] = `${svidStr} [Unstructured] VendorData:0x${vendorData.toString(16).toUpperCase().padStart(4, '0')}`;
        } else {
          const cmd         = vdmHdr & 0x1F;
          const cmdType     = (vdmHdr >>> 6) & 0x3;
          const cmdName     = VDM_CMD_NAMES[cmd] ?? `CMD_0x${cmd.toString(16)}`;
          const cmdTypeName = VDM_CMD_TYPE[cmdType];
          frame['pdoSummary']  = `${svidStr}  ${cmdName} [${cmdTypeName}]`;
        }
      } else if (header.extended && extendedHeader) {
        // Compact inline summary for Extended messages
        if (header.typeName === 'Source_Capabilities_Extended' && parsedPayload?.length) {
          const vid = parsedPayload.find((r) => r.label === 'VID')?.value ?? '?';
          const pid = parsedPayload.find((r) => r.label === 'PID')?.value ?? '?';
          const fw  = parsedPayload.find((r) => r.label === 'FW Version')?.value ?? '?';
          frame['pdoSummary'] = `VID:${vid}  PID:${pid}  FW:${fw}`;
        } else if (header.typeName === 'Status' && parsedPayload?.length) {
          const ef   = parsedPayload.find((r) => r.label === 'Event Flags')?.value ?? '';
          const temp = parsedPayload.find((r) => r.label === 'Temp Status')?.value ?? '';
          frame['pdoSummary'] = [ef, temp].filter(Boolean).join('  │  ');
        } else if (header.typeName === 'Extended_Control' && parsedPayload?.length) {
          frame['pdoSummary'] = parsedPayload[0]?.value ?? '';
        } else if (header.typeName === 'Sink_Capabilities_Extended' && parsedPayload?.length) {
          const vid    = parsedPayload.find((r) => r.label === 'VID')?.value ?? '?';
          const pid    = parsedPayload.find((r) => r.label === 'PID')?.value ?? '?';
          const maxPdp = parsedPayload.find((r) => r.label === 'Sink Maximum PDP')?.value ?? '?';
          frame['pdoSummary'] = `VID:${vid}  PID:${pid}  MaxPDP:${maxPdp}`;
        } else {
          const chunks = extendedHeader.chunked
            ? `Chunk#${extendedHeader.chunkNumber}${extendedHeader.requestChunk ? ' [Req]' : ''}`
            : 'Unchunked';
          frame['pdoSummary'] = `${chunks}  ${extendedHeader.dataSize}B`;
        }
      }
    } else {
      frame['raw'] = Array.from(payload)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    }

    frames.push(frame as unknown as PdFrame);
    offset += CPD_FIXED_HDR + payloadLen;
  }

  return { frames, errors };
}


