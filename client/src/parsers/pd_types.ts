// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
/**
 * USB Power Delivery — static type definitions for parsed Data Objects.
 * Covers USB PD Rev 3.2.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared base
// ─────────────────────────────────────────────────────────────────────────────

/** Fields present in every decoded DO */
interface DoBase {
  /** 1-based PDO index (index+1 of the array position) */
  readonly index: number;
  /** Raw hex word e.g. "0x2601912C" */
  readonly raw: string;
  readonly label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDO (Power Data Object) — §6.4.1
// ─────────────────────────────────────────────────────────────────────────────

export interface PdoFixed extends DoBase {
  readonly pdoType: 'Fixed';
  readonly isSink: boolean;
  readonly vMv: number;
  readonly iMa: number;
  readonly dualRolePower: boolean;
  readonly unconstrainedPower: boolean;
  readonly usbCommsCapable: boolean;
  readonly dualRoleData: boolean;
  // Source-only flags
  readonly usbSuspend?: boolean;
  readonly unchunkedExtMsg?: boolean;
  readonly eprModeCapable?: boolean;
  // Sink-only flags
  readonly higherCapability?: boolean;
  readonly fastRoleSwap?: number;
  readonly fastRoleSwapLabel?: string;
}

export interface PdoBattery extends DoBase {
  readonly pdoType: 'Battery';
  readonly isSink: boolean;
  readonly vMaxMv: number;
  readonly vMinMv: number;
  /** mWh — Maximum (Source) or Operational (Sink) power in 250 mW units × 250 */
  readonly wMax: number;
}

export interface PdoVariable extends DoBase {
  readonly pdoType: 'Variable';
  readonly isSink: boolean;
  readonly vMaxMv: number;
  readonly vMinMv: number;
  /** mA — Maximum (Source) or Operational (Sink) current */
  readonly iMa: number;
}

export interface PdoApdoPps extends DoBase {
  readonly pdoType: 'APDO_PPS';
  readonly isSink: boolean;
  readonly vMaxMv: number;
  readonly vMinMv: number;
  /** mA — maximum current in 50 mA units */
  readonly iMa: number;
}

export interface PdoApdoAvsEpr extends DoBase {
  readonly pdoType: 'APDO_AVS';
  readonly isSink: boolean;
  readonly vMaxMv: number;
  readonly vMinMv: number;
  /** W — Peak Demand Power */
  readonly pdpW: number;
  readonly peakCurrent: number | null;
  readonly peakCurrentLabel: string | null;
}

export interface PdoApdoAvsSpr extends DoBase {
  readonly pdoType: 'APDO_SPR_AVS';
  readonly isSink: false;
  readonly vMaxMv: number;
  readonly vMinMv: number;
  /** mA in 9–15 V range */
  readonly iMa_9_15: number;
  /** mA in 15–20 V range (0 when max voltage is 15 V) */
  readonly iMa_15_20: number;
  readonly peakCurrent: number;
  readonly peakCurrentLabel: string;
}

export interface PdoApdoUnknown extends DoBase {
  readonly pdoType: 'APDO_Unknown';
}

export type Pdo =
  | PdoFixed
  | PdoBattery
  | PdoVariable
  | PdoApdoPps
  | PdoApdoAvsEpr
  | PdoApdoAvsSpr
  | PdoApdoUnknown;

export type PdoType = Pdo['pdoType'];

// ─────────────────────────────────────────────────────────────────────────────
// RDO (Request Data Object) — §6.4.2
// ─────────────────────────────────────────────────────────────────────────────

interface RdoBase {
  readonly raw: string;
  readonly label: string;
  /** 1-based object position referencing source PDO */
  readonly objPos: number;
  readonly capMismatch: boolean;
  readonly usbComms: boolean;
  readonly noUsbSuspend: boolean;
  readonly unchunkedExt: boolean;
  readonly eprMode: boolean;
}

export interface RdoFixed extends RdoBase {
  readonly rdoType: 'Fixed';
  readonly giveBack: boolean;
  /** mA */
  readonly opCurrent_mA: number;
  /** mA — max (GiveBack=0) or min (GiveBack=1) */
  readonly maxCurrent_mA: number;
}

export interface RdoBattery extends RdoBase {
  readonly rdoType: 'Battery';
  readonly giveBack: boolean;
  /** mW */
  readonly opPower_mW: number;
  /** mW — max (GiveBack=0) or min (GiveBack=1) */
  readonly limPower_mW: number;
}

export interface RdoPps extends RdoBase {
  readonly rdoType: 'PPS';
  /** mV in 20 mV steps */
  readonly opVoltage_mV: number;
  /** mA in 50 mA steps */
  readonly opCurrent_mA: number;
}

export interface RdoAvs extends RdoBase {
  readonly rdoType: 'AVS';
  /** mV in 25 mV steps */
  readonly opVoltage_mV: number;
  /** mA in 50 mA steps */
  readonly opCurrent_mA: number;
}

export type Rdo = RdoFixed | RdoBattery | RdoPps | RdoAvs;
export type RdoType = Rdo['rdoType'];

// ─────────────────────────────────────────────────────────────────────────────
// Message Header — §6.2.1.1
// ─────────────────────────────────────────────────────────────────────────────

export type SpecRevision = '1.0' | '2.0' | '3.0' | '3.1';
export type PortPowerRole = 'Source' | 'Sink';
export type PortDataRole  = 'DFP' | 'UFP';

export interface MessageHeader {
  readonly extended: boolean;
  readonly numDataObjects: number;
  readonly msgId: number;
  /** null for SOP' / SOP'' */
  readonly portPowerRole: PortPowerRole | null;
  /** null for SOP' / SOP'' */
  readonly portDataRole: PortDataRole | null;
  /** null for SOP — true=Cable Plug, false=DFP/UFP Port */
  readonly cablePlug: boolean | null;
  readonly specRevision: SpecRevision | string;
  readonly msgType: number;
  readonly typeName: string;
  readonly isControl: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended Message Header — §6.2.1.2
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtendedMessageHeader {
  readonly chunked: boolean;
  readonly chunkNumber: number;
  readonly requestChunk: boolean;
  readonly dataSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CPD record envelope (STM32CubeMonitor-UCPD .cpd format)
// ─────────────────────────────────────────────────────────────────────────────

export type CpdDirName = 'SRC→SNK' | 'SNK→SRC' | 'DEBUG' | 'EVENT';
export type SopQualName = 'SOP' | "SOP'" | "SOP''";
export type RecordType = 'PD_MSG' | 'ASCII_LOG' | 'EVENT';

export interface CpdEnvelope {
  readonly dirName: CpdDirName;
  readonly sopQualName: SopQualName | null;
  readonly ts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree-display child rows (used by decodeDataObjects)
// ─────────────────────────────────────────────────────────────────────────────

/** Key-value field row (rendered as label + value pair) */
export interface TreeFieldRow {
  readonly label: string;
  readonly value: string;
  readonly raw?: string;
  readonly color?: string;
}

/** Section header row (collapsible in 2-level VDM tree) */
export interface TreeSectionRow {
  readonly label: string;
  readonly raw: string;
  readonly section: true;
}

/** Generic VDO label row (no `value` field, no `section` flag) */
export interface TreeVdoRow {
  readonly label: string;
  readonly raw: string;
}

/** EPR_Mode action row */
export interface TreeEprModeRow {
  readonly label: string;
  readonly raw: string;
  readonly action: string;
}

export type TreeRow =
  | TreeFieldRow
  | TreeSectionRow
  | TreeVdoRow
  | TreeEprModeRow
  | (Pdo & { eprMirror?: boolean })
  | Rdo;

// ─────────────────────────────────────────────────────────────────────────────
// Parsed payload rows (from decodeSourceCapsExtended, decodeSinkCapsExtended, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedPayloadRow {
  readonly label: string;
  readonly value: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Information Data Object (SIDO) — §6.4.11 / Table 6.52
// ─────────────────────────────────────────────────────────────────────────────

export interface SidoResult {
  readonly raw: string;
  readonly portType: 'Guaranteed' | 'Managed';
  readonly portTypeRaw: 0 | 1;
  readonly maxPdpW: number;
  readonly presentPdpW: number;
  readonly reportedPdpW: number;
  readonly label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level parsed message
// ─────────────────────────────────────────────────────────────────────────────

/** Full USB-PD message frame (PD_MSG record, or raw-frame parse result) */
export interface PdMessage {
  readonly id?: number;
  readonly ts: number;
  readonly source: string;
  readonly raw: string;
  readonly header: MessageHeader;
  readonly extendedHeader: ExtendedMessageHeader | null;
  /** Raw uint32 data object words */
  readonly dataObjects: readonly number[];
  /** Decoded extended message payload rows (SCDB, SKEDB, Status, etc.) */
  readonly parsedPayload: readonly ParsedPayloadRow[] | null;
  /** One-line summary for the Raw column */
  readonly pdoSummary?: string;
  /** CPD binary record envelope */
  readonly cpd?: CpdEnvelope & {
    readonly fixedField: number;
    readonly cat: number;
    readonly dir: number;
    readonly sopQual: number;
    readonly payloadLen: number;
    readonly sentinelHex: string;
    readonly recordOffset: number;
  };
  readonly recordType?: RecordType;
  readonly eprCapable?: boolean;
}

/**
 * A record returned by parseCpdFile — may be a PD_MSG frame, an ASCII log
 * line, or an event marker.  Use `recordType` to discriminate.
 */
export type PdFrame =
  | (PdMessage & { readonly recordType: 'PD_MSG' })
  | {
      readonly ts: number;
      readonly source: string;
      readonly raw: string;
      readonly recordType: 'ASCII_LOG';
      readonly asciiLog: string;
      readonly vbusMv?: number;
      readonly ccPin?: number;
      readonly cpd: PdMessage['cpd'];
    }
  | {
      readonly ts: number;
      readonly source: string;
      readonly raw: string;
      readonly recordType: 'EVENT';
      readonly eventName: string;
      readonly cpd: PdMessage['cpd'];
    };

export interface ParsedCpdFile {
  readonly frames: PdFrame[];
  readonly errors: string[];
}
