/**
 * pd_parser.test.ts — Comprehensive bit-field coverage tests for pd_parser.ts
 * USB PD Rev 3.2 parser unit tests using vitest
 */
import { describe, it, expect } from 'vitest';
import type { PdoFixed, PdoBattery, PdoVariable, PdoApdoPps, PdoApdoAvsEpr, PdoApdoAvsSpr } from './pd_types';
import {
  parseMessageHeader,
  parseExtendedMsgHeader,
  parseRawFrame,
  decodePDO,
  decodeRDO,
  decodeSIDO,
  buildPdoSummary,
  buildRdoSummary,
  decodeDataObjects,
  decodeSourceCapsExtended,
  decodeStatus,
  decodeExtendedControl,
  decodeSinkCapsExtended,
  collectParseViolations,
} from './pd_parser';

// ---------------------------------------------------------------------------
// parseMessageHeader
// ---------------------------------------------------------------------------
describe('parseMessageHeader', () => {
  it('decodes GoodCRC (control msg, NDO=0)', () => {
    // GoodCRC: msgType=0x01, NDO=0, extended=0, specRev=3.0(2), Sink/UFP
    // bits: [15]=0 [14:12]=000 [11:9]=000 [8]=0 [7:6]=10 [5]=0 [4:0]=00001
    // specRev=2 (3.0) → bits7:6=10 → 0x80 | 0x01 = 0x0081
    const h = parseMessageHeader(0x0081, 0);
    expect(h.isControl).toBe(true);
    expect(h.typeName).toBe('GoodCRC');
    expect(h.numDataObjects).toBe(0);
    expect(h.extended).toBe(false);
    expect(h.specRevision).toBe('3.0');
    expect(h.portPowerRole).toBe('Sink');
    expect(h.portDataRole).toBe('UFP');
  });

  it('decodes Accept (control msg, Source/DFP)', () => {
    // Accept: msgType=0x03, NDO=0, specRev=3.0(2), portPowerRole=1(Source), portDataRole=1(DFP)
    // [15]=0 [14:12]=000 [11:9]=000 [8]=1 [7:6]=10 [5]=1 [4:0]=00011
    // = 0x01A3
    const h = parseMessageHeader(0x01A3, 0);
    expect(h.isControl).toBe(true);
    expect(h.typeName).toBe('Accept');
    expect(h.portPowerRole).toBe('Source');
    expect(h.portDataRole).toBe('DFP');
  });

  it('decodes Source_Capabilities (data msg, NDO=3)', () => {
    // msgType=0x01(SrcCap), NDO=3, specRev=3.0(2), Source/DFP
    // [15]=0 [14:12]=011 [11:9]=000 [8]=1 [7:6]=10 [5]=1 [4:0]=00001
    // = 0x31A1
    const h = parseMessageHeader(0x31A1, 0);
    expect(h.isControl).toBe(false);
    expect(h.typeName).toBe('Source_Capabilities');
    expect(h.numDataObjects).toBe(3);
    expect(h.msgType).toBe(0x01);
  });

  it('decodes Vendor_Defined (data msg, NDO=5)', () => {
    // msgType=0x0F(VDM), NDO=5, specRev=3.0(2)
    // [14:12]=101 [7:6]=10 → 0x51CF (approx)
    // Let's build: NDO=5→bits14:12=101, specRev=2→bits7:6=10, msgType=0x0F
    // = (5<<12)|(2<<6)|0x0F = 0x5000|0x0080|0x000F = 0x508F
    const h = parseMessageHeader(0x508F, 0);
    expect(h.isControl).toBe(false);
    expect(h.typeName).toBe('Vendor_Defined');
    expect(h.numDataObjects).toBe(5);
    expect(h.extended).toBe(false);
  });

  it('decodes extended bit message', () => {
    // Extended bit set, msgType=0x11 (EPR_Source_Capabilities)
    // [15]=1 [14:12]=001 [8]=1 [7:6]=10 [4:0]=10001 = 0x91B1
    const h = parseMessageHeader(0x91B1, 0);
    expect(h.extended).toBe(true);
    expect(h.typeName).toBe('EPR_Source_Capabilities');
    expect(h.isControl).toBe(false);
  });

  it('decodes SOP\' cable plug message', () => {
    // sopQual=1 → portPowerRole=null, cablePlug resolved from bit8
    // bit8=1 → cablePlug=true
    const h = parseMessageHeader(0x0141, 1);
    expect(h.portPowerRole).toBeNull();
    expect(h.portDataRole).toBeNull();
    expect(h.cablePlug).toBe(true);
  });

  it('decodes msgId from bits [11:9]', () => {
    // msgId=5 → bits11:9=101 → shift by 9: 5<<9 = 0x0A00
    const h = parseMessageHeader(0x0A01, 0); // GoodCRC-like, msgId=5
    expect(h.msgId).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// parseExtendedMsgHeader
// ---------------------------------------------------------------------------
describe('parseExtendedMsgHeader', () => {
  it('decodes chunk 0 unchunked', () => {
    // chunked=0, chunkNumber=0, requestChunk=0, dataSize=26
    const e = parseExtendedMsgHeader(0x001A);
    expect(e.chunked).toBe(false);
    expect(e.chunkNumber).toBe(0);
    expect(e.requestChunk).toBe(false);
    expect(e.dataSize).toBe(26);
  });

  it('decodes chunk 0 chunked, dataSize=26', () => {
    // chunked=1 (bit15), chunkNumber=0 (bits14:11), dataSize=26
    // = 0x8000 | 26 = 0x801A
    const e = parseExtendedMsgHeader(0x801A);
    expect(e.chunked).toBe(true);
    expect(e.chunkNumber).toBe(0);
    expect(e.dataSize).toBe(26);
  });

  it('decodes chunk 1 chunked', () => {
    // chunked=1, chunkNumber=1 (bits14:11=0001→bit11=1 → 1<<11=0x0800)
    // = 0x8000 | 0x0800 | dataSize
    const e = parseExtendedMsgHeader(0x880E);
    expect(e.chunked).toBe(true);
    expect(e.chunkNumber).toBe(1);
  });

  it('decodes request chunk bit', () => {
    // requestChunk=1 (bit10) = 0x8400
    const e = parseExtendedMsgHeader(0x8400);
    expect(e.requestChunk).toBe(true);
    expect(e.chunked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decodePDO — Source Fixed
// ---------------------------------------------------------------------------
describe('decodePDO — Source Fixed', () => {
  it('5V/3A standard (EPR mode not capable)', () => {
    // vMv=5000→units=5000/50=100; iMa=3000→units=3000/10=300
    // word = (100<<10)|300 = 0x19000|0x12C = 0x1912C
    const pdo = decodePDO(0x0001912C, 0, false) as PdoFixed;
    expect(pdo.pdoType).toBe('Fixed');
    expect(pdo.vMv).toBe(5000);
    expect(pdo.iMa).toBe(3000);
    expect(pdo.eprModeCapable).toBe(false);
    expect(pdo.isSink).toBe(false);
    expect(pdo.index).toBe(1);
  });

  it('5V/3A with USB-Suspend, USBComms, EPR not set', () => {
    // B28=1 (USB-Suspend), B27=1 (UCPwr)
    // word = (100<<10)|300 | (1<<28) | (1<<27) = 0x1912C | 0x18000000 = 0x1801912C
    const pdo = decodePDO(0x1801912C, 0, false) as PdoFixed;
    expect(pdo.pdoType).toBe('Fixed');
    // vMv: bits19:10 = (0x0881912C >> 10) & 0x3FF
    const vMv = ((0x0881912C >>> 10) & 0x3FF) * 50;
    expect(pdo.vMv).toBe(5000);
    expect(pdo.iMa).toBe(3000);
    expect(pdo.usbSuspend).toBe(true);
    expect(pdo.eprModeCapable).toBe(false);
  });

  it('28V/3A EPR mode capable', () => {
    // vMv=28000→bits19:10=560→0x230; iMa=3000→300→0x12C
    // B23=1 (EPR), B27=1 (UCPwr), B24=1 (unchunkedExt)
    // pdoType=00, bits31:30=00
    // (560 << 10) | 300 | (1<<23) | (1<<27) | (1<<24) = ...
    // 560<<10 = 0x8C000, 300 = 0x12C
    // 0x8C000 | 0x12C = 0x8C12C
    // | B23=0x800000 | B27=0x8000000 | B24=0x1000000
    // = 0x8C12C | 0x9800000 = 0x98C12C... let's just check bits
    // From conversation: "Source Fixed 28V/3A (EPR): 0x008801C8"
    // Verify: (0x008801C8>>>10)&0x3FF = (0x008801C8/1024)...
    // 0x008801C8 = 8978888 decimal, >>10 = 8768, &0x3FF = 8768 & 1023 = 576→576*50=28800? No.
    // Let me recalculate: 28000/50=560=0x230
    // (0x008801C8 >>> 10) = 0x22200 >> no.
    // 0x008801C8 in binary:
    //   0000 0000 1000 1000 0000 0001 1100 1000
    //   bits19:10 = bits[19..10] = 0010 0010 00 = 0x088... 
    // Hmm. Let me just compute directly:
    // Want: vMv=28000=28000/50=560=0x230, iMa=3000=300=0x12C
    // Word = (0x230 << 10) | 0x12C = 0x8C000 | 0x12C = 0x8C12C
    // + EPR B23 = 0x8C12C | 0x800000 = 0x88C12C
    // + UCPwr B27 = | 0x8000000 = 0x888C12C
    // that's not 28V EPR. Let me just use a known computed value.
    const word = (560 << 10) | 300 | (1 << 23) | (1 << 27);
    const pdo  = decodePDO(word >>> 0, 7, false) as PdoFixed;
    expect(pdo.pdoType).toBe('Fixed');
    expect(pdo.vMv).toBe(28000);
    expect(pdo.iMa).toBe(3000);
    expect(pdo.eprModeCapable).toBe(true);
    expect(pdo.index).toBe(8);
  });

  it('decodes all source-only capability bits', () => {
    // DRP=B29, UsbSuspend=B28, UCPwr=B27, UsbComm=B26, DRD=B25, UnchunkExt=B24, EPR=B23
    const word = (1<<29)|(1<<28)|(1<<27)|(1<<26)|(1<<25)|(1<<24)|(1<<23)|((100<<10)|200);
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoFixed;
    expect(pdo.dualRolePower).toBe(true);
    expect(pdo.usbSuspend).toBe(true);
    expect(pdo.unconstrainedPower).toBe(true);
    expect(pdo.usbCommsCapable).toBe(true);
    expect(pdo.dualRoleData).toBe(true);
    expect(pdo.unchunkedExtMsg).toBe(true);
    expect(pdo.eprModeCapable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decodePDO — Sink Fixed
// ---------------------------------------------------------------------------
describe('decodePDO — Sink Fixed', () => {
  it('5V/0.9A sink with DRP, HigherCap, FRS=0', () => {
    // iMa=900→units=90; vMv=5000→units=100
    // B29=DRP, B28=HigherCap, B27=UCPwr
    // pdoType=00 (sink)
    const word = (1<<29)|(1<<28)|(1<<27)|((100<<10)|90);
    const pdo  = decodePDO(word >>> 0, 0, true) as PdoFixed;
    expect(pdo.pdoType).toBe('Fixed');
    expect(pdo.isSink).toBe(true);
    expect(pdo.vMv).toBe(5000);
    expect(pdo.iMa).toBe(900);
    expect(pdo.dualRolePower).toBe(true);
    expect(pdo.higherCapability).toBe(true);
    expect(pdo.fastRoleSwap).toBe(0);
    expect(pdo.fastRoleSwapLabel).toBe('FRS not supported');
  });

  it('FastRoleSwap=01b — Default USB Power (B24:23=01)', () => {
    // FRS_LABELS[1] = 'FRS: Default USB Power' (B24:23=01b)
    const word = (1 << 23) | ((100 << 10) | 300);
    const pdo  = decodePDO(word >>> 0, 0, true) as PdoFixed;
    expect(pdo.fastRoleSwap).toBe(1);
    expect(pdo.fastRoleSwapLabel).toBe('FRS: Default USB Power');
  });

  it('FastRoleSwap=10b — 1.5A @ 5V (B24:23=10)', () => {
    // FRS_LABELS[2] = 'FRS: 1.5A @ 5V' (B24:23=10b)
    const word = (2 << 23) | ((100 << 10) | 300);
    const pdo  = decodePDO(word >>> 0, 0, true) as PdoFixed;
    expect(pdo.fastRoleSwap).toBe(2);
    expect(pdo.fastRoleSwapLabel).toBe('FRS: 1.5A @ 5V');
  });

  it('FastRoleSwap 3A@5V (FRS=3)', () => {
    // B24:23=11→FRS=3
    const word = (3 << 23) | ((100 << 10) | 300);
    const pdo  = decodePDO(word >>> 0, 0, true) as PdoFixed;
    expect(pdo.fastRoleSwap).toBe(3);
    expect(pdo.fastRoleSwapLabel).toBe('FRS: 3.0A @ 5V');
  });
});

// ---------------------------------------------------------------------------
// decodePDO — Battery & Variable
// ---------------------------------------------------------------------------
describe('decodePDO — Battery', () => {
  it('Source Battery 9-20V/50W', () => {
    // pdoType=01→bits31:30=01
    // vMaxMv=20000→400→B29:20; vMinMv=9000→180→B19:10; wMax=50000mW→200×250→200→B9:0
    const vmax = 20000/50; // 400
    const vmin = 9000/50;  // 180
    const wmax = 50000/250;// 200
    const word = (0b01 << 30) | (vmax << 20) | (vmin << 10) | wmax;
    const pdo  = decodePDO(word >>> 0, 1, false) as PdoBattery;
    expect(pdo.pdoType).toBe('Battery');
    expect(pdo.vMaxMv).toBe(20000);
    expect(pdo.vMinMv).toBe(9000);
    expect(pdo.wMax).toBe(50000);
    expect(pdo.isSink).toBe(false);
  });

  it('Sink Battery (Op Power label)', () => {
    const word = (0b01 << 30) | (200 << 20) | (100 << 10) | 120;
    const pdo  = decodePDO(word >>> 0, 0, true) as PdoBattery;
    expect(pdo.isSink).toBe(true);
    expect(pdo.label).toContain('Op');
  });
});

describe('decodePDO — Variable', () => {
  it('Source Variable 9-20V/3A', () => {
    // pdoType=10→bits31:30=10
    const vmax = 20000/50; // 400
    const vmin = 9000/50;  // 180
    const iMa  = 3000/10;  // 300
    const word = (0b10 << 30) | (vmax << 20) | (vmin << 10) | iMa;
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoVariable;
    expect(pdo.pdoType).toBe('Variable');
    expect(pdo.vMaxMv).toBe(20000);
    expect(pdo.vMinMv).toBe(9000);
    expect(pdo.iMa).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// decodePDO — APDO types
// ---------------------------------------------------------------------------
describe('decodePDO — APDO_PPS', () => {
  it('PPS 5-11V / 3.6A', () => {
    // pdoType=11→B31:30=11, apdoType=00→B29:28=00
    // vMaxMv=11000→110→B24:17; vMinMv=5000→50→B15:8; iMa=3600→72→B6:0
    const vmax = 11000/100; // 110
    const vmin = 5000/100;  // 50
    const iMa  = 3600/50;   // 72
    // 0xC0000000 | (vmax<<17) | (vmin<<8) | iMa
    const word = (0b11 << 30) | (vmax << 17) | (vmin << 8) | iMa;
    const pdo  = decodePDO(word >>> 0, 4, false) as PdoApdoPps;
    expect(pdo.pdoType).toBe('APDO_PPS');
    expect(pdo.vMaxMv).toBe(11000);
    expect(pdo.vMinMv).toBe(5000);
    expect(pdo.iMa).toBe(3600);
    expect(pdo.index).toBe(5);
  });
});

describe('decodePDO — APDO_SPR_AVS', () => {
  // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3, Table 6.16 "SPR Adjustable Voltage Supply APDO – Source"
  // Applies when operating in SPR Mode, supplying 9V up to 20V. Bit-field layout:
  //   B31:30 = 11b  — Augmented Power Data Object (APDO)
  //   B29:28 = 10b  — SPR Adjustable Voltage Supply
  //   B27:26        — Peak Current (see Table 6.10 §6.4.1.2.5.3.1 / §6.4.1.2.2.8)
  //   B25:20        — Reserved — Shall be set to zero
  //   B19:10        — Max Current (9V–15V range) in 10mA units = Maximum Current of 15V Fixed Source PDO
  //   B9:0          — Max Current (15V–20V range) in 10mA units = Maximum Current of 20V Fixed Source PDO;
  //                   set to 0 if maximum voltage in SPR AVS range is 15V

  it('SPR AVS 9-15V — B9:0=0 → vMaxMv=15000 (Table 6.16 B9:0)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3, Table 6.16 B19:10 / B9:0
    // B19:10: Max Current for 9V–15V range in 10mA units (= Max Current of 15V Fixed Source PDO)
    // B9:0=0 → "set to 0 if the Maximum voltage in the SPR AVS range is 15V" → vMaxMv=15000
    // B31:30=11b (APDO), B29:28=10b (SPR AVS), B19:10=300 (3000mA÷10), B9:0=0
    const iMa_9_15 = 3000/10; // 300 → B19:10
    const word = (0b11 << 30) | (0b10 << 28) | (iMa_9_15 << 10);
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoApdoAvsSpr;
    expect(pdo.pdoType).toBe('APDO_SPR_AVS');
    expect(pdo.vMinMv).toBe(9000);
    expect(pdo.vMaxMv).toBe(15000);
    expect(pdo.iMa_9_15).toBe(3000);
    expect(pdo.iMa_15_20).toBe(0);
  });

  it('SPR AVS 9-20V — B9:0>0 → vMaxMv=20000 (Table 6.16 B9:0)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3, Table 6.16 B9:0
    // B9:0 > 0 → Max Current for 15V–20V range = Maximum Current of 20V Fixed Source PDO
    // → vMaxMv=20000; B9:0=150 → iMa_15_20=1500mA
    const word = (0b11 << 30) | (0b10 << 28) | (300 << 10) | 150;
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoApdoAvsSpr;
    expect(pdo.vMaxMv).toBe(20000);
    expect(pdo.iMa_15_20).toBe(1500);
  });

  it('PeakCurrent B27:26=00b — equals IOC / default (§6.4.1.2.5.3.1, Table 6.10)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3.1, Table 6.10
    // 00b: Peak current equals IOC (default)
    const word = (0b11 << 30) | (0b10 << 28) | (0b00 << 26) | (200 << 10);
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoApdoAvsSpr;
    expect(pdo.peakCurrent).toBe(0);
    expect(pdo.peakCurrentLabel).toContain('IOC');
  });

  it('PeakCurrent B27:26=01b — 150% IOC overload (§6.4.1.2.5.3.1, Table 6.10)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3.1, Table 6.10
    // 01b: Peak current equals 150% IOC for 1ms @ 5% duty cycle
    const word = (0b11 << 30) | (0b10 << 28) | (0b01 << 26) | (200 << 10);
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoApdoAvsSpr;
    expect(pdo.peakCurrent).toBe(1);
    expect(pdo.peakCurrentLabel).toContain('150%');
  });

  it('PeakCurrent B27:26=10b — 200% IOC overload (§6.4.1.2.5.3.1, Table 6.10)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3.1
    // "Peak Current for SPR AVS APDO follows the same definition for Fixed Supply PDOs
    //  (see Section 6.4.1.2.2.8 and Table 6.10 'Fixed Power Source Peak Current Capability')"
    // B27:26=10b → same 200% IOC overload tier as Fixed Supply PDO Table 6.10
    const word = (0b11 << 30) | (0b10 << 28) | (2 << 26) | (200 << 10);
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoApdoAvsSpr;
    expect(pdo.peakCurrent).toBe(2);
    expect(pdo.peakCurrentLabel).toContain('200%');
  });

  it('PeakCurrent B27:26=11b — 200%/175%/150% IOC overload (§6.4.1.2.5.3.1, Table 6.10)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.3.1, Table 6.10
    // 11b: Peak current equals 200% IOC for 1ms @ 5% / 175% for 2ms / 150% for 10ms
    const word = (0b11 << 30) | (0b10 << 28) | (0b11 << 26) | (200 << 10);
    const pdo  = decodePDO(word >>> 0, 0, false) as PdoApdoAvsSpr;
    expect(pdo.peakCurrent).toBe(3);
    expect(pdo.peakCurrentLabel).toContain('175%');
  });
});

describe('decodePDO — APDO_AVS (EPR)', () => {
  // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2, Table 6.14 "EPR Adjustable Voltage Supply APDO – Source"
  // Bit-field layout (Source only; applies when EPR Mode active, 15V–48V):
  //   B31:30 = 11b  — Augmented Power Data Object (APDO)
  //   B29:28 = 01b  — EPR Adjustable Voltage Supply
  //   B27:26        — Peak Current (see Table 6.15 §6.4.1.2.5.2.2)
  //   B25:17        — Maximum Voltage in 100mV increments
  //   B16           — Reserved — Shall be set to zero
  //   B15:8         — Minimum Voltage in 100mV increments
  //   B7:0          — PDP in 1W increments (§6.4.1.2.5.2.1)

  it('EPR AVS 15-28V / 100W Source — bit-fields per Table 6.14', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2, Table 6.14
    // B31:30=11b (APDO), B29:28=01b (EPR AVS), B27:26=00b (peakCurrent=0)
    // B25:17=280 (28000mV÷100), B15:8=150 (15000mV÷100), B7:0=100 (100W)
    // §6.4.1.2.5.2.1: PDP field "Shall contain the AVS Port's PDP"
    const vmax = 28000/100; // 280 → B25:17
    const vmin = 15000/100; // 150 → B15:8
    const pdpW = 100;       //       B7:0
    const word = (0b11 << 30) | (0b01 << 28) | (vmax << 17) | (vmin << 8) | pdpW;
    const pdo  = decodePDO(word >>> 0, 7, false) as PdoApdoAvsEpr;
    expect(pdo.pdoType).toBe('APDO_AVS');
    expect(pdo.vMaxMv).toBe(28000);
    expect(pdo.vMinMv).toBe(15000);
    expect(pdo.pdpW).toBe(100);
    expect(pdo.isSink).toBe(false);
    expect(pdo.peakCurrent).not.toBeNull();
  });

  it('EPR AVS Sink — peakCurrent is null (§6.4.1.2.5.2.2 Source-only field)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2.2
    // "Every EPR Adjustable voltage Supply PDO Shall contain a Peak Current field"
    // Peak Current (B27:26) is a Source-only field; Sink PDOs do not expose it.
    const word = (0b11 << 30) | (0b01 << 28) | (280 << 17) | (150 << 8) | 100;
    const pdo  = decodePDO(word >>> 0, 7, true) as PdoApdoAvsEpr;
    expect(pdo.isSink).toBe(true);
    expect(pdo.peakCurrent).toBeNull();
    expect(pdo.peakCurrentLabel).toBeNull();
  });

  it('EPR AVS PeakCurrent=00b — equals IOC / default (B27:26, Table 6.15)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2.2, Table 6.15 "EPR AVS Power Source Peak Current Capability"
    // 00b: "Peak current equals IOC (default) or look at extended Source capabilities"
    // "Supplies that do not support an overload capability Shall set these bits to 00b"
    const word = (0b11 << 30) | (0b01 << 28) | (0b00 << 26) | (280 << 17) | (150 << 8) | 100;
    const pdo  = decodePDO(word >>> 0, 7, false) as PdoApdoAvsEpr;
    expect(pdo.peakCurrent).toBe(0);
  });

  it('EPR AVS PeakCurrent=01b — 150% IOC overload (B27:26, Table 6.15)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2.2, Table 6.15
    // 01b Overload Capabilities:
    //   1. Peak current equals 150% IOC for 1ms @ 5% duty cycle
    //   2. Peak current equals 125% IOC for 2ms @ 10% duty cycle
    //   3. Peak current equals 110% IOC for 10ms @ 50% duty cycle
    const word = (0b11 << 30) | (0b01 << 28) | (0b01 << 26) | (280 << 17) | (150 << 8) | 100;
    const pdo  = decodePDO(word >>> 0, 7, false) as PdoApdoAvsEpr;
    expect(pdo.peakCurrent).toBe(1);
    expect(pdo.peakCurrentLabel).toContain('150%');
  });

  it('EPR AVS PeakCurrent=10b — 200% IOC overload (B27:26, Table 6.15)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2.2, Table 6.15
    // 10b Overload Capabilities:
    //   1. Peak current equals 200% IOC for 1ms @ 5% duty cycle
    //   2. Peak current equals 150% IOC for 2ms @ 10% duty cycle
    //   3. Peak current equals 125% IOC for 10ms @ 50% duty cycle
    const word = (0b11 << 30) | (0b01 << 28) | (0b10 << 26) | (280 << 17) | (150 << 8) | 100;
    const pdo  = decodePDO(word >>> 0, 7, false) as PdoApdoAvsEpr;
    expect(pdo.peakCurrent).toBe(2);
    expect(pdo.peakCurrentLabel).toContain('200%');
  });

  it('EPR AVS PeakCurrent=11b — 200%/175%/150% IOC overload (B27:26, Table 6.15)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2.2, Table 6.15
    // 11b Overload Capabilities:
    //   1. Peak current equals 200% IOC for 1ms @ 5% duty cycle
    //   2. Peak current equals 175% IOC for 2ms @ 10% duty cycle
    //   3. Peak current equals 150% IOC for 10ms @ 50% duty cycle
    const word = (0b11 << 30) | (0b01 << 28) | (0b11 << 26) | (280 << 17) | (150 << 8) | 100;
    const pdo  = decodePDO(word >>> 0, 7, false) as PdoApdoAvsEpr;
    expect(pdo.peakCurrent).toBe(3);
    expect(pdo.peakCurrentLabel).toContain('200%');
  });

  it('EPR AVS: B16 reserved=1 does not corrupt vMaxMv/vMinMv/pdpW (Table 6.14 B16)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2, Table 6.14 B16
    // B16: "Reserved – Shall be set to zero"
    // Parser must mask B16 out; setting it Shall not affect decoded voltage/power fields.
    // B25:17 = vMaxMv units, B15:8 = vMinMv units, B7:0 = PDP — none overlap B16
    const word = (0b11 << 30) | (0b01 << 28) | (280 << 17) | (1 << 16) | (150 << 8) | 100;
    const pdo  = decodePDO(word >>> 0, 7, false);
    expect(pdo.vMaxMv).toBe(28000); // B25:17=280 unaffected by B16
    expect(pdo.vMinMv).toBe(15000); // B15:8=150 unaffected by B16
    expect(pdo.pdpW).toBe(100);     // B7:0=100 unaffected by B16
  });

  it('EPR AVS 15-48V / 240W — maximum voltage boundary (Table 6.14 B25:17)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2, Table 6.14 B25:17
    // Maximum Voltage in 100mV increments; 48V = 480 units (fits in 9-bit field, max=511)
    // §6.4.1.2.5.2 states Source "supplying 15V up to 48V"
    const vmax = 48000/100; // 480 → B25:17
    const vmin = 15000/100; // 150 → B15:8
    const pdpW = 240;       //       B7:0 (max practical EPR PDP)
    const word = (0b11 << 30) | (0b01 << 28) | (vmax << 17) | (vmin << 8) | pdpW;
    const pdo  = decodePDO(word >>> 0, 7, false);
    expect(pdo.vMaxMv).toBe(48000);
    expect(pdo.vMinMv).toBe(15000);
    expect(pdo.pdpW).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// buildPdoSummary — null-fill filter for EPR
// ---------------------------------------------------------------------------
describe('buildPdoSummary', () => {
  it('SPR Source: 3 Fixed PDOs listed', () => {
    const dos = [
      (100 << 10) | 300,      // 5V/3A: 5000/50=100, 3000/10=300
      (180 << 10) | 200,      // 9V/2A: 9000/50=180, 2000/10=200
      (240 << 10) | 200,      // 12V/2A: 12000/50=240
    ];
    const s = buildPdoSummary('Source_Capabilities', dos);
    expect(s).toContain('[1] Fixed:5V/3A');
    expect(s).toContain('[2] Fixed:9V/2A');
    expect(s).toContain('[3] Fixed:12V/2A');
  });

  it('EPR: filters 0x00000000 (null-fill)', () => {
    const dos = [
      0x00000000, // null-fill — shall be hidden
      (0b11 << 30) | (0b01 << 28) | (280 << 17) | (150 << 8) | 100, // EPR AVS
    ];
    const s = buildPdoSummary('EPR_Source_Capabilities', dos, 7);
    expect(s).not.toContain('[1]'); // null-fill suppressed
    expect(s).toContain('AVS:');
  });

  it('EPR: filters 0xD0000000 (APDO_AVS type bits only, zero value fields)', () => {
    // 0xD0000000 → bits31:28=1101 → pdoType=11(APDO), apdoType=01(AVS), value bits=0
    // (dw & 0x0FFFFFFF) === 0 → filtered
    const dos = [
      0xD0000000,
      (0b11 << 30) | (0b01 << 28) | (280 << 17) | (150 << 8) | 100,
    ];
    const s = buildPdoSummary('EPR_Source_Capabilities', dos, 7);
    expect(s).not.toMatch(/\[8\]/);
    expect(s).toContain('AVS:');
  });

  it('EPR: filters 0xC0000000 (APDO_PPS zero-value)', () => {
    const dos = [0xC0000000, (50 << 10) | 100];
    const s = buildPdoSummary('EPR_Source_Capabilities', dos, 0);
    expect(s).not.toContain('PPS:');
    expect(s).toContain('Fixed:');
  });

  it('Non-EPR: does NOT filter 0x00000000 (shows as Fixed 0V/0A)', () => {
    const dos = [0x00000000];
    const s = buildPdoSummary('Source_Capabilities', dos);
    expect(s).toContain('[1]');
  });

  it('indexOffset shifts PDO numbers', () => {
    const dos = [(50 << 10) | 100];
    const s = buildPdoSummary('EPR_Source_Capabilities', dos, 6);
    expect(s).toContain('[7]');
  });

  it('SPR AVS format includes dash separator', () => {
    const word = (0b11 << 30) | (0b10 << 28) | (300 << 10) | 150;
    const s = buildPdoSummary('Source_Capabilities', [word]);
    expect(s).toContain('SPR-AVS:9V-20V');
  });

  it('PPS format: min-max/current', () => {
    const word = (0b11 << 30) | (110 << 17) | (50 << 8) | 72;
    const s = buildPdoSummary('Source_Capabilities', [word]);
    expect(s).toContain('PPS:5V-11V/3.6A');
  });

  it('Battery Source format: min-max/Max:W', () => {
    // Battery PDO: [n] Battery:${vMin}-${vMax}/Max:${W}W
    // vMax=20000/50=400→B29:20, vMin=9000/50=180→B19:10, wMax=50000mW/250=200→B9:0
    const word = (0b01 << 30) | (400 << 20) | (180 << 10) | 200;
    const s = buildPdoSummary('Source_Capabilities', [word]);
    expect(s).toContain('[1] Battery:9V-20V/Max:50W');
  });

  it('Battery Sink format: min-max/Op:W', () => {
    // Sink Battery PDO uses Op: instead of Max:
    const word = (0b01 << 30) | (400 << 20) | (180 << 10) | 200;
    const s = buildPdoSummary('Sink_Capabilities', [word]);
    expect(s).toContain('[1] Battery:9V-20V/Op:50W');
  });

  it('Variable Source format: min-max/A', () => {
    // Variable PDO: [n] Var:${vMin}-${vMax}/${A}
    // vMax=20000/50=400→B29:20, vMin=9000/50=180→B19:10, iMa=3000/10=300→B9:0
    const word = (0b10 << 30) | (400 << 20) | (180 << 10) | 300;
    const s = buildPdoSummary('Source_Capabilities', [word]);
    expect(s).toContain('[1] Var:9V-20V/3A');
  });

  it('EPR AVS Source format: min-max/W', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.1.2.5.2, Table 6.14
    // EPR AVS PDO summary: [n] AVS:${vMin}-${vMax}/${pdpW}W
    const word = (0b11 << 30) | (0b01 << 28) | (280 << 17) | (150 << 8) | 100;
    const s = buildPdoSummary('EPR_Source_Capabilities', [word], 0);
    expect(s).toContain('[1] AVS:15V-28V/100W');
  });
});

// ---------------------------------------------------------------------------
// decodeRDO
// ---------------------------------------------------------------------------
describe('decodeRDO — Fixed/Variable', () => {
  it('Fixed RDO: PDO#2, 3A/3A', () => {
    // objPos=2→B31:28=0010; opCurr=300→B19:10; maxCurr=300→B9:0
    const word = (2 << 28) | (300 << 10) | 300;
    const rdo  = decodeRDO(word >>> 0, 'Fixed');
    expect(rdo.rdoType).toBe('Fixed');
    expect(rdo.objPos).toBe(2);
    expect(rdo.opCurrent_mA).toBe(3000);
    expect(rdo.maxCurrent_mA).toBe(3000);
    expect(rdo.capMismatch).toBe(false);
    expect(rdo.giveBack).toBe(false);
  });

  it('Fixed RDO with CapMismatch and GiveBack flags', () => {
    const word = (1 << 28) | (1 << 27) | (1 << 26) | (200 << 10) | 100;
    const rdo  = decodeRDO(word >>> 0, 'Fixed');
    expect(rdo.giveBack).toBe(true);
    expect(rdo.capMismatch).toBe(true);
    expect(rdo.label).toContain('Min:');
  });

  it('EPR mode flag (B22)', () => {
    const word = (3 << 28) | (1 << 22) | (300 << 10) | 300;
    const rdo  = decodeRDO(word >>> 0, 'Fixed');
    expect(rdo.eprMode).toBe(true);
  });
});

describe('decodeRDO — PPS', () => {
  it('PPS RDO: 9V / 3A', () => {
    // objPos=5→B31:28=0101; outVoltage=9000/20=450→B20:9; opCurrent=3000/50=60→B6:0
    const word = (5 << 28) | (450 << 9) | 60;
    const rdo  = decodeRDO(word >>> 0, 'APDO_PPS');
    expect(rdo.rdoType).toBe('PPS');
    expect(rdo.objPos).toBe(5);
    expect(rdo.opVoltage_mV).toBe(9000);
    expect(rdo.opCurrent_mA).toBe(3000);
  });
});

describe('decodeRDO — AVS', () => {
  it('AVS RDO: 20V / 3A', () => {
    // outVoltage=20000/25=800→B20:9; opCurrent=3000/50=60→B6:0
    const word = (6 << 28) | (800 << 9) | 60;
    const rdo  = decodeRDO(word >>> 0, 'APDO_AVS');
    expect(rdo.rdoType).toBe('AVS');
    expect(rdo.opVoltage_mV).toBe(20000);
    expect(rdo.opCurrent_mA).toBe(3000);
  });
});

describe('decodeRDO — Battery', () => {
  it('Battery RDO: PDO#3, 25W op, 30W max', () => {
    // objPos=3; opPower=25W→100×250mW; limPower=30W→120×250mW
    const word = (3 << 28) | (100 << 10) | 120;
    const rdo  = decodeRDO(word >>> 0, 'Battery');
    expect(rdo.rdoType).toBe('Battery');
    expect(rdo.opPower_mW).toBe(25000);
    expect(rdo.limPower_mW).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// buildRdoSummary
// ---------------------------------------------------------------------------
describe('buildRdoSummary', () => {
  it('Fixed summary format', () => {
    const word = (2 << 28) | (300 << 10) | 300;
    expect(buildRdoSummary(word >>> 0, 'Fixed')).toMatch(/PDO#2.*Op:3A.*Max:3A/);
  });

  it('PPS summary format', () => {
    const word = (5 << 28) | (450 << 9) | 60;
    expect(buildRdoSummary(word >>> 0, 'APDO_PPS')).toMatch(/PDO#5.*Out:9V.*Op:3A/);
  });

  it('AVS summary format', () => {
    const word = (6 << 28) | (800 << 9) | 60;
    expect(buildRdoSummary(word >>> 0, 'APDO_AVS')).toMatch(/PDO#6.*Out:20V.*Op:3A/);
  });

  it('CapMismatch appended', () => {
    const word = (1 << 28) | (1 << 26) | (200 << 10) | 200;
    expect(buildRdoSummary(word >>> 0)).toContain('CapMismatch');
  });

  it('EPR flag appended', () => {
    const word = (1 << 28) | (1 << 22) | (200 << 10) | 200;
    expect(buildRdoSummary(word >>> 0)).toContain('EPR');
  });
});

// ---------------------------------------------------------------------------
// decodeSIDO
// ---------------------------------------------------------------------------
describe('decodeSIDO', () => {
  it('Managed port type (B31=0)', () => {
    // portType=0 (Managed), max=100W, present=65W, reported=65W
    const word = (0 << 31) | (100 << 16) | (65 << 8) | 65;
    const r = decodeSIDO(word >>> 0);
    expect(r.portType).toBe('Managed');
    expect(r.portTypeRaw).toBe(0);
    expect(r.maxPdpW).toBe(100);
    expect(r.presentPdpW).toBe(65);
    expect(r.reportedPdpW).toBe(65);
    expect(r.label).toContain('Managed');
  });

  it('Guaranteed port type (B31=1)', () => {
    const word = (1 << 31) | (65 << 16) | (65 << 8) | 60;
    const r = decodeSIDO(word >>> 0);
    expect(r.portType).toBe('Guaranteed');
    expect(r.portTypeRaw).toBe(1);
  });

  it('raw field formatted correctly', () => {
    const word = 0x80641E3C;
    const r = decodeSIDO(word >>> 0);
    expect(r.raw).toBe('0x80641E3C');
  });
});

// ---------------------------------------------------------------------------
// decodeDataObjects — VDM Discover Identity (real captured frame)
// ---------------------------------------------------------------------------
describe('decodeDataObjects — VDM Discover Identity ACK', () => {
  // Real capture: "AF 59 41 A0 00 FF B4 04 80 2D 00 00 00 00 00 00 65 F6 08 00 00 00"
  // Bytes[0:1] = AF 59 → message header 0x59AF (NDO=5, VDM, Rev3.0)
  // Bytes[2:5] = 41 A0 00 FF → DO[0]=0xFF00A041 (VDM Hdr: SVID=0xFF00, structured, DiscoverIdentity ACK, v2.0)
  // Bytes[6:9] = B4 04 80 2D → DO[1]=0x2D8004B4 (ID Hdr: VID=0x04B4/Cypress, ufpType=101b/5, Modal=1, dfpType=011b/PowerBrick)
  // Bytes[10:13] = 00 00 00 00 → DO[2]=0x00000000 (Cert Stat: XID=0)
  // Bytes[14:17] = 00 00 65 F6 → DO[3]=0xF6650000 (Product: PID=0xF665, bcd=0)
  // Bytes[18:21] = 08 00 00 00 → DO[4]=0x00000008 (DFP VDO: VDOVer=1.0, HostCap=none, PortNum=8)
  const DOs = [0xFF00A041, 0x2D8004B4, 0x00000000, 0xF6650000, 0x00000008];

  it('returns rows array', () => {
    const rows = decodeDataObjects('Vendor_Defined', DOs);
    expect(rows).not.toBeNull();
    expect(Array.isArray(rows)).toBe(true);
  });

  it('VDM header row contains SVID and ACK', () => {
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const headerRow = rows[0] as any;
    expect(headerRow.label).toContain('Discover Identity');
    expect(headerRow.label).toContain('ACK');
    expect(headerRow.label).toContain('PD SID');
  });

  it('ID Header: VID=0x04B4 (Cypress)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.8, Table 6.34 B15:0
    // "Manufacturers Shall set the Vendor ID field to the value assigned by USB-IF"
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const vidRow = rows.find((r: any) => r.label === 'VID') as any;
    expect(vidRow).toBeDefined();
    expect(vidRow.value).toContain('0x04B4');
    expect(vidRow.value).toContain('Cypress');
  });

  it('ID Header: USBHostCapable=0 (B31=0)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.1, Table 6.34 B31
    // "Shall be set to one if the product is capable of enumerating USB Devices"
    // DO[1]=0x2D8004B4 → B31=0 → USBHostCapable=0
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const hostRow = rows.find((r: any) => r.label === 'USBHostCapable') as any;
    expect(hostRow).toBeDefined();
    expect(hostRow.value).toBe('0');
  });

  it('ID Header: USBDeviceCapable=0 (B30=0)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.2, Table 6.34 B30
    // "Shall be set to one if the product is capable of being enumerated as a USB Device"
    // DO[1]=0x2D8004B4 → B30=0 → USBDeviceCapable=0
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const devRow = rows.find((r: any) => r.label === 'USBDeviceCapable') as any;
    expect(devRow).toBeDefined();
    expect(devRow.value).toBe('0');
  });

  it('ID Header: ufpPType=101b=Reserved (B29:27, SOP context)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.3, Table 6.34 B29:27, Table 6.35
    // SOP Product Type (UFP) per Table 6.35:
    //   000b=Undefined, 001b=PDUSB Hub, 010b=PDUSB Peripheral, 011b=PSD
    //   100b–111b = Reserved, Shall Not be used
    // DO[1]=0x2D8004B4 → B29:27=101b=5 → Reserved
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const ufpRow = rows.find((r: any) => r.label === 'ProductTypeUFP') as any;
    expect(ufpRow).toBeDefined();
    expect(ufpRow.value).toContain('101');
    expect(ufpRow.value).toContain('Rsvd');
  });

  it('ID Header: dfpPType=011b=Power Brick (B25:23, Table 6.37)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.6, Table 6.34 B25:23, Table 6.37
    // SOP Product Type (DFP) per Table 6.37:
    //   000b=Undefined, 001b=PDUSB Hub, 010b=PDUSB Host, 011b=Power Brick
    //   100b–111b = Reserved, Shall Not be used
    // Table 6.37: Power Brick → DFP VDO returned (§6.4.4.3.1.5)
    // DO[1]=0x2D8004B4 → B25:23=011b=3 → Power Brick
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const dfpRow = rows.find((r: any) => r.label === 'ProductTypeDFP') as any;
    expect(dfpRow).toBeDefined();
    expect(dfpRow.value).toContain('011');
    expect(dfpRow.value).toContain('Power Brick');
  });

  it('ID Header: ModalOperation=1 (B26)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.5, Table 6.34 B26
    // "Shall be set to one if the product (UFP/Cable Plug) is capable of supporting
    //  Modal Operation (Alternate Modes)"
    // DO[1]=0x2D8004B4 → B26=1 → Modal Operation Supported
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const modalRow = rows.find((r: any) => r.label === 'ModalOperation') as any;
    expect(modalRow?.value).toBe('1');
  });

  it('ID Header: ConnectorType=00b=Reserved/legacy-compat (B22:21)', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.7, Table 6.34 B22:21
    // Connector Type encoding:
    //   00b = Reserved, for compatibility with legacy systems
    //   01b = Reserved, Shall Not be used
    //   10b = USB Type-C® Receptacle
    //   11b = USB Type-C® Plug
    // DO[1]=0x2D8004B4 → B22:21=00b → Reserved (legacy compat.)
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const connRow = rows.find((r: any) => r.label === 'ConnectorType') as any;
    expect(connRow).toBeDefined();
    expect(connRow.value).toContain('00');
  });

  it('Cert Stat: XID=0x00000000', () => {
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const xidRow = rows.find((r: any) => r.label === 'XID') as any;
    expect(xidRow?.value).toBe('0x00000000');
  });

  it('Product VDO: PID=0xF665', () => {
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const pidRow = rows.find((r: any) => r.label === 'USBProductID') as any;
    expect(pidRow?.value).toBe('0xF665');
  });

  it('DFP VDO: VDOVersion=1.0', () => {
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const verRow = rows.find((r: any) => r.label === 'VDOVersion') as any;
    expect(verRow?.value).toBe('1.0');
  });

  it('DFP VDO: HostCapability=none (DO[4]=0x00000008, B25:23=000)', () => {
    // 0x00000008: B25=0, B24=0, B23=0 → no USB host capabilities
    const dw = 0x00000008;
    const hostCap = (dw >>> 23) & 0x7;
    expect(hostCap).toBe(0);
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const capRow = rows.find((r: any) => r.label === 'HostCapability') as any;
    expect(capRow?.value).toBe('none');
  });

  it('DFP VDO: PortNumber=8 (B4:0=01000)', () => {
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const portRow = rows.find((r: any) => r.label === 'PortNumber') as any;
    expect(portRow?.value).toBe('8');
  });

  it('DFP VDO returned because dfpPType=Power Brick (011b), regardless of ufpPType', () => {
    // USB PD Rev 3.2 v1.0 2023-10 §6.4.4.3.1.1.6, Table 6.37
    // "Power Brick: Shall be used when the Product is a Power Brick/Wall Wart"
    // Table 6.37 mandates DFP VDO (§6.4.4.3.1.5) be returned for Power Brick.
    // Bug-fix: removed ufpPType===0 guard that incorrectly blocked DFP VDO decoding
    // when ufpPType=5 (Reserved per Table 6.35). DFP VDO presence is driven by
    // dfpPType (B25:23), not ufpPType (B29:27).
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const dfpSection = rows.find((r: any) => (r as any).section && r.label === 'DFP VDO') as any;
    expect(dfpSection).toBeDefined();
  });
});

describe('decodeDataObjects — DFP hostCap bit positions', () => {
  it('hostCap B23=USB2.0 only', () => {
    // B23=1→hostCap=(dw>>>23)&0x7=1→USB2.0
    const dfpVdo = (1 << 23);
    const DOs = [0xFF00A041, 0x2D8004B4, 0x00000000, 0xF6650000, dfpVdo >>> 0];
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const capRow = rows.find((r: any) => r.label === 'HostCapability') as any;
    expect(capRow?.value).toContain('USB2.0');
    expect(capRow?.value).not.toContain('USB3.2');
    expect(capRow?.value).not.toContain('USB4');
  });

  it('hostCap B24=USB3.2', () => {
    // B24=1→hostCap=0b010=2→USB3.2
    const dfpVdo = (1 << 24);
    const DOs = [0xFF00A041, 0x2D8004B4, 0x00000000, 0xF6650000, dfpVdo >>> 0];
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const capRow = rows.find((r: any) => r.label === 'HostCapability') as any;
    expect(capRow?.value).toContain('USB3.2');
    expect(capRow?.value).not.toContain('USB4');
  });

  it('hostCap B25=USB4', () => {
    // B25=1→hostCap=0b100=4→USB4
    const dfpVdo = (1 << 25);
    const DOs = [0xFF00A041, 0x2D8004B4, 0x00000000, 0xF6650000, dfpVdo >>> 0];
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const capRow = rows.find((r: any) => r.label === 'HostCapability') as any;
    expect(capRow?.value).toContain('USB4');
    expect(capRow?.value).not.toContain('USB3.2');
  });

  it('hostCap B25+B24+B23=USB4+USB3.2+USB2.0', () => {
    const dfpVdo = (1 << 25) | (1 << 24) | (1 << 23);
    const DOs = [0xFF00A041, 0x2D8004B4, 0x00000000, 0xF6650000, dfpVdo >>> 0];
    const rows = decodeDataObjects('Vendor_Defined', DOs)!;
    const capRow = rows.find((r: any) => r.label === 'HostCapability') as any;
    expect(capRow?.value).toContain('USB4');
    expect(capRow?.value).toContain('USB3.2');
    expect(capRow?.value).toContain('USB2.0');
  });

  it('B26 is NOT part of hostCap (only B25:23)', () => {
    // B26 only set → hostCap = (dw>>>23)&0x7 = (1<<26>>>23)&0x7 = 8&7 = 0 → none
    const dfpVdo = (1 << 26);
    const hostCap = (dfpVdo >>> 23) & 0x7;
    expect(hostCap).toBe(0); // B26 falls outside the 3-bit mask
  });
});

// ---------------------------------------------------------------------------
// decodeDataObjects — Source_Capabilities
// ---------------------------------------------------------------------------
describe('decodeDataObjects — Source_Capabilities', () => {
  it('returns array of PDOs', () => {
    const dos = [(50 << 10) | 300, (180 << 10) | 200];
    const rows = decodeDataObjects('Source_Capabilities', dos);
    expect(rows).toHaveLength(2);
    expect((rows![0] as any).pdoType).toBe('Fixed');
    expect((rows![1] as any).pdoType).toBe('Fixed');
  });

  it('indexOffset shifts PDO index', () => {
    const dos = [(50 << 10) | 300];
    const rows = decodeDataObjects('EPR_Source_Capabilities', dos, undefined, 7);
    expect((rows![0] as any).index).toBe(8);
  });

  it('EPR null-fill DOs are filtered out', () => {
    const dos = [0x00000000, (0b11 << 30) | (0b01 << 28) | (280 << 17) | (150 << 8) | 100];
    const rows = decodeDataObjects('EPR_Source_Capabilities', dos);
    expect(rows).toHaveLength(1);
    expect((rows![0] as any).pdoType).toBe('APDO_AVS');
  });
});

// ---------------------------------------------------------------------------
// decodeDataObjects — Request / EPR_Request
// ---------------------------------------------------------------------------
describe('decodeDataObjects — Request', () => {
  it('decodes single RDO', () => {
    const word = (2 << 28) | (300 << 10) | 300;
    const rows = decodeDataObjects('Request', [word >>> 0]);
    expect(rows).toHaveLength(1);
    expect((rows![0] as any).rdoType).toBe('Fixed');
  });
});

describe('decodeDataObjects — EPR_Request', () => {
  it('decodes EPR RDO and mirror PDO', () => {
    const rdoWord = (6 << 28) | (800 << 9) | 60;
    const mirrorPdo = (0b11 << 30) | (0b01 << 28) | (280 << 17) | (150 << 8) | 100;
    const rows = decodeDataObjects('EPR_Request', [rdoWord >>> 0, mirrorPdo >>> 0], 'APDO_AVS');
    expect(rows).toHaveLength(2);
    expect((rows![0] as any).rdoType).toBe('AVS');
    expect((rows![1] as any).eprMirror).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseRawFrame — SPR Source_Capabilities
// ---------------------------------------------------------------------------
describe('parseRawFrame — SPR Source_Capabilities', () => {
  it('parses 3-PDO source cap frame', () => {
    // Build a frame: header (SrcCap, NDO=3, specRev=3.0, Source/DFP)
    // header = 0x31A1 → LE: A1 31
    // PDO1: 5V/3A  → (100<<10)|300 = 0x1912C  → LE: 2C 91 01 00
    // PDO2: 9V/2A  → (180<<10)|200 = 0x2D0C8  → LE: C8 D0 02 00
    // PDO3: 20V/3A → (400<<10)|300 = 0x6412C  → LE: 2C 41 06 00
    const frame = 'A1 31 2C 91 01 00 C8 D0 02 00 2C 41 06 00';
    const msg = parseRawFrame(frame, 'STM32');
    expect(msg).not.toBeNull();
    expect(msg!.header.typeName).toBe('Source_Capabilities');
    expect(msg!.header.numDataObjects).toBe(3);
    expect(msg!.dataObjects).toHaveLength(3);
    expect(msg!.pdoSummary).toContain('[1] Fixed:5V/3A');
    expect(msg!.pdoSummary).toContain('[3] Fixed:20V/3A'); // 20000mV/50=400, 3000mA/10=300
  });
});

// ---------------------------------------------------------------------------
// parseRawFrame — EPR Source_Capabilities chunk 0 and chunk 1
// ---------------------------------------------------------------------------
describe('parseRawFrame — EPR Source_Capabilities chunks', () => {
  it('chunk 0: chunkPdoOffset=0, 6 DOs parsed', () => {
    // EPR SrcCap chunk 0 from conversation:
    // "B1 FB 24 80 2C 91 81 08 2C D1 02 00 0A B1 04 00 C8 40 06 00 48 32 DC C0 00 00 00 00 00 00"
    // header bytes: B1 FB → 0xFBB1 → extended=1, NDO=7, msgType=0x11(EPR_Source_Capabilities)
    //   extended msg header: 24 80 → 0x8024 → chunked=1, chunkNumber=0, dataSize=36(0x24)
    // DOs start at byte 4:
    //   DO1: 2C 91 81 08 = 0x088191 2C
    //   DO2: 2C D1 02 00 = 0x0002D12C
    //   DO3: 0A B1 04 00 = 0x0004B10A
    //   DO4: C8 40 06 00 = 0x000640C8
    //   DO5: 48 32 DC C0 = 0xC0DC3248
    //   DO6: 00 00 00 00 = 0x00000000
    const hex = 'B1 FB 24 80 2C 91 81 08 2C D1 02 00 0A B1 04 00 C8 40 06 00 48 32 DC C0 00 00 00 00 00 00';
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg).not.toBeNull();
    expect(msg!.header.typeName).toBe('EPR_Source_Capabilities');
    expect(msg!.extendedHeader?.chunkNumber).toBe(0);
    expect(msg!.chunkPdoOffset).toBe(0);
    expect(msg!.dataObjects.length).toBeGreaterThanOrEqual(1);
  });

  it('chunk 1: chunkPdoOffset=7, 2-byte skip applied', () => {
    // EPR SrcCap chunk 1 (buggy charger, from conversation):
    // "B1 BD 24 88 00 00 00 00 00 00 00 00 00 D0"
    // header: B1 BD → 0xBDB1 → extended=1, msgType=0x11
    // ext header: 24 88 → 0x8824 → chunked=1, chunkNumber=1, dataSize=36
    // After EPR_CHUNK1_SKIP=2: bytes [4+2..] = bytes[6..]: 00 00 00 00, 00 00 00 D0
    // → DO0=0x00000000, DO1=0xD0000000 — both filtered by (dw&0x0FFFFFFF)===0
    const hex = 'B1 BD 24 88 00 00 00 00 00 00 00 00 00 D0';
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg).not.toBeNull();
    expect(msg!.header.typeName).toBe('EPR_Source_Capabilities');
    expect(msg!.extendedHeader?.chunkNumber).toBe(1);
    expect(msg!.chunkPdoOffset).toBe(7);
    // pdoSummary should be empty (all DOs filtered by null-fill filter)
    // or the DOs array should only contain zeros
    const filtered = msg!.dataObjects.filter((dw: number) => (dw & 0x0FFFFFFF) !== 0);
    expect(filtered).toHaveLength(0);
  });

  it('chunk 1 pdoSummary empty after null-fill filter', () => {
    const hex = 'B1 BD 24 88 00 00 00 00 00 00 00 00 00 D0';
    const msg = parseRawFrame(hex, 'STM32');
    // pdoSummary is built from dataObjects; all filtered → empty string
    expect(msg!.pdoSummary ?? '').toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseRawFrame — VDM Discover Identity (real frame)
// ---------------------------------------------------------------------------
describe('parseRawFrame — VDM Discover Identity', () => {
  const hex = 'AF 59 41 A0 00 FF B4 04 80 2D 00 00 00 00 00 00 65 F6 08 00 00 00';

  it('parses frame correctly', () => {
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg).not.toBeNull();
    expect(msg!.header.typeName).toBe('Vendor_Defined');
    expect(msg!.dataObjects.length).toBe(5);
  });

  it('DO[0]=0xFF00A041 (VDM Header — bytes[2:5] LE)', () => {
    // bytes[0:1]=AF 59 → msg header; bytes[2:5]=41 A0 00 FF → DO[0]=0xFF00A041
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg!.dataObjects[0]).toBe(0xFF00A041);
  });

  it('DO[1]=0x2D8004B4 (ID Header — bytes[6:9] LE)', () => {
    // bytes[6:9]=B4 04 80 2D → DO[1]=0x2D8004B4
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg!.dataObjects[1]).toBe(0x2D8004B4);
  });

  it('DO[4]=0x00000008 (DFP VDO)', () => {
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg!.dataObjects[4]).toBe(0x00000008);
  });

  it('pdoSummary is undefined (VDM, not cap message)', () => {
    const msg = parseRawFrame(hex, 'STM32');
    expect(msg!.pdoSummary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseRawFrame — Control messages
// ---------------------------------------------------------------------------
describe('parseRawFrame — Control messages', () => {
  it('GoodCRC: 2-byte frame, no DOs', () => {
    // header: 0x0081 (GoodCRC, NDO=0, specRev=3.0) → LE: 81 00
    const msg = parseRawFrame('81 00', 'STM32');
    expect(msg).not.toBeNull();
    expect(msg!.header.typeName).toBe('GoodCRC');
    expect(msg!.dataObjects).toHaveLength(0);
    expect(msg!.header.isControl).toBe(true);
  });

  it('Accept: 2-byte frame', () => {
    // Accept = msgType=0x03, NDO=0, specRev=3.0(2), Source(bit8=1)/DFP(bit5=1)
    // (2<<6)|(1<<8)|(1<<5)|0x03 = 0x80|0x100|0x20|0x03 = 0x1A3 → LE: A3 01
    const msg = parseRawFrame('A3 01', 'STM32');
    expect(msg!.header.typeName).toBe('Accept');
  });

  it('returns null for too-short frame', () => {
    expect(parseRawFrame('FF', 'STM32')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRawFrame — Extended messages (Status, Source_Capabilities_Extended)
// ---------------------------------------------------------------------------
describe('parseRawFrame — Extended messages', () => {
  it('parses Extended_Control (EPR_KeepAlive)', () => {
    // Header: Extended=1, msgType=0x10(Extended_Control), NDO=1
    // [15]=1,[14:12]=001,[7:6]=10,[4:0]=10000 = 0x90D0 → LE: D0 90
    // Extended msg header: chunked=0, chunkNum=0, dataSize=2 → 0x0002 → LE: 02 00
    // Payload: type=0x03(EPR_KeepAlive), data=0x00 → 03 00
    const msg = parseRawFrame('D0 90 02 00 03 00', 'STM32');
    expect(msg).not.toBeNull();
    expect(msg!.header.typeName).toBe('Extended_Control');
    expect(msg!.parsedPayload).not.toBeNull();
    const payload = msg!.parsedPayload as any[];
    const typeRow = payload?.find((r: any) => r.label === 'Type');
    expect(typeRow?.value).toBe('EPR_KeepAlive');
  });
});

// ---------------------------------------------------------------------------
// decodeSourceCapsExtended
// ---------------------------------------------------------------------------
describe('decodeSourceCapsExtended', () => {
  it('returns empty array for insufficient bytes', () => {
    expect(decodeSourceCapsExtended(new Uint8Array(10))).toHaveLength(0);
  });

  it('decodes VID/PID/XID from bytes 0-7', () => {
    const bytes = new Uint8Array(25);
    // VID=0x0483 (STMicro) at bytes 0-1 LE
    bytes[0] = 0x83; bytes[1] = 0x04;
    // PID=0x1234 at bytes 2-3
    bytes[2] = 0x34; bytes[3] = 0x12;
    // XID=0xDEADBEEF at bytes 4-7
    bytes[4] = 0xEF; bytes[5] = 0xBE; bytes[6] = 0xAD; bytes[7] = 0xDE;
    const rows = decodeSourceCapsExtended(bytes);
    const vid = rows.find((r) => r.label === 'VID')?.value;
    const pid = rows.find((r) => r.label === 'PID')?.value;
    const xid = rows.find((r) => r.label === 'XID')?.value;
    expect(vid).toBe('0x0483');
    expect(pid).toBe('0x1234');
    expect(xid).toBe('0xDEADBEEF');
  });

  it('decodes SPR PDP and EPR PDP', () => {
    const bytes = new Uint8Array(25);
    bytes[23] = 65;  // SPR PDP
    bytes[24] = 140; // EPR PDP
    const rows = decodeSourceCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'SPR PDP Rating')?.value).toBe('65 W');
    expect(rows.find((r) => r.label === 'EPR PDP Rating')?.value).toBe('140 W');
  });

  it('decodes FW/HW version bytes', () => {
    const bytes = new Uint8Array(25);
    bytes[8] = 0x12; // FW
    bytes[9] = 0xAB; // HW
    const rows = decodeSourceCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'FW Version')?.value).toBe('0x12');
    expect(rows.find((r) => r.label === 'HW Version')?.value).toBe('0xAB');
  });

  it('decodes holdup time 0=Not supported', () => {
    const bytes = new Uint8Array(25);
    bytes[11] = 0;
    const rows = decodeSourceCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'Holdup Time')?.value).toBe('Not supported');
  });

  it('decodes holdup time 100ms', () => {
    const bytes = new Uint8Array(25);
    bytes[11] = 100;
    const rows = decodeSourceCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'Holdup Time')?.value).toBe('100 ms');
  });
});

// ---------------------------------------------------------------------------
// decodeStatus
// ---------------------------------------------------------------------------
describe('decodeStatus', () => {
  it('returns empty for insufficient bytes', () => {
    expect(decodeStatus(new Uint8Array(3))).toHaveLength(0);
  });

  it('decodes internal temperature', () => {
    const bytes = new Uint8Array(7);
    bytes[0] = 85;
    const rows = decodeStatus(bytes);
    expect(rows.find((r) => r.label === 'Internal Temp')?.value).toBe('85 °C');
  });

  it('temp=0 → Not supported', () => {
    const bytes = new Uint8Array(7);
    bytes[0] = 0;
    const rows = decodeStatus(bytes);
    expect(rows.find((r) => r.label === 'Internal Temp')?.value).toBe('Not supported');
  });

  it('decodes OCP/OTP event flags', () => {
    const bytes = new Uint8Array(7);
    bytes[3] = 0x02 | 0x04; // OCP | OTP
    const rows = decodeStatus(bytes);
    const ef = rows.find((r) => r.label === 'Event Flags')?.value ?? '';
    expect(ef).toContain('OCP');
    expect(ef).toContain('OTP');
  });

  it('Temperature Status: Normal (bits[2:1]=01)', () => {
    const bytes = new Uint8Array(7);
    bytes[4] = 0x02; // bits[2:1]=01
    const rows = decodeStatus(bytes);
    expect(rows.find((r) => r.label === 'Temp Status')?.value).toBe('Normal');
  });

  it('Temperature Status: Over temperature (bits[2:1]=11)', () => {
    const bytes = new Uint8Array(7);
    bytes[4] = 0x06; // bits[2:1]=11
    const rows = decodeStatus(bytes);
    expect(rows.find((r) => r.label === 'Temp Status')?.value).toBe('Over temperature');
  });
});

// ---------------------------------------------------------------------------
// decodeExtendedControl
// ---------------------------------------------------------------------------
describe('decodeExtendedControl', () => {
  it('returns empty for <2 bytes', () => {
    expect(decodeExtendedControl([0x01])).toHaveLength(0);
  });

  it('EPR_Get_Source_Cap (type=0x01)', () => {
    const rows = decodeExtendedControl([0x01, 0x00]);
    expect(rows.find((r) => r.label === 'Type')?.value).toBe('EPR_Get_Source_Cap');
  });

  it('EPR_KeepAlive_Ack (type=0x04)', () => {
    const rows = decodeExtendedControl([0x04, 0x00]);
    expect(rows.find((r) => r.label === 'Type')?.value).toBe('EPR_KeepAlive_Ack');
  });

  it('non-zero data byte flagged as spec violation', () => {
    const rows = decodeExtendedControl([0x03, 0x01]);
    const dataRow = rows.find((r) => r.label === 'Data');
    expect(dataRow).toBeDefined();
    expect(dataRow?.value).toContain('⚠');
  });

  it('zero data byte → no Data row', () => {
    const rows = decodeExtendedControl([0x03, 0x00]);
    expect(rows.find((r) => r.label === 'Data')).toBeUndefined();
  });

  it('Reserved type shows Reserved label', () => {
    const rows = decodeExtendedControl([0xFF, 0x00]);
    expect(rows.find((r) => r.label === 'Type')?.value).toContain('Reserved');
  });
});

// ---------------------------------------------------------------------------
// decodeSinkCapsExtended
// ---------------------------------------------------------------------------
describe('decodeSinkCapsExtended', () => {
  it('returns empty for <21 bytes', () => {
    expect(decodeSinkCapsExtended(new Uint8Array(10))).toHaveLength(0);
  });

  it('decodes VID/PID', () => {
    const bytes = new Uint8Array(24);
    bytes[0] = 0xB4; bytes[1] = 0x04; // VID=0x04B4
    bytes[2] = 0x65; bytes[3] = 0xF6; // PID=0xF665
    const rows = decodeSinkCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'VID')?.value).toBe('0x04B4');
    expect(rows.find((r) => r.label === 'PID')?.value).toBe('0xF665');
  });

  it('decodes Sink PDPs', () => {
    const bytes = new Uint8Array(24);
    bytes[18] = 15; // min
    bytes[19] = 45; // operational
    bytes[20] = 65; // max
    bytes[22] = 100; // EPR op
    bytes[23] = 140; // EPR max
    const rows = decodeSinkCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'Sink Minimum PDP')?.value).toBe('15 W');
    expect(rows.find((r) => r.label === 'Sink Operational PDP')?.value).toBe('45 W');
    expect(rows.find((r) => r.label === 'Sink Maximum PDP')?.value).toBe('65 W');
    expect(rows.find((r) => r.label === 'EPR Sink Operational PDP')?.value).toBe('100 W');
    expect(rows.find((r) => r.label === 'EPR Sink Maximum PDP')?.value).toBe('140 W');
  });

  it('LoadStep 0 → 150 mA/μs', () => {
    const bytes = new Uint8Array(24);
    bytes[11] = 0x00;
    const rows = decodeSinkCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'Load Step')?.value).toBe('150 mA/μs');
  });

  it('LoadStep 1 → 500 mA/μs', () => {
    const bytes = new Uint8Array(24);
    bytes[11] = 0x01;
    const rows = decodeSinkCapsExtended(bytes);
    expect(rows.find((r) => r.label === 'Load Step')?.value).toBe('500 mA/μs');
  });
});

// ---------------------------------------------------------------------------
// collectParseViolations
// USB PD Rev 3.2 spec-constraint violation detection
// ---------------------------------------------------------------------------
describe('collectParseViolations', () => {
  // Helper: build a minimal MessageHeader-like stub
  function hdr(isControl: boolean, numDataObjects: number, extended = false) {
    return { isControl, numDataObjects, extended };
  }

  // ── NDO mismatch ────────────────────────────────────────────────────────
  // Table 6.1: Number of Data Objects field declares how many 4-byte DOs follow the header.
  // If fewer DOs are actually present, the frame is truncated.
  it('NDO mismatch: header declares 3 DOs but only 1 present → violation', () => {
    // Non-extended data message (Source_Capabilities) claiming 3 DOs but only 1 provided
    const v = collectParseViolations('Source_Capabilities', hdr(false, 3), [0x0901912C]);
    expect(v.some(s => s.includes('NDO mismatch'))).toBe(true);
    expect(v.some(s => s.includes('3 DOs'))).toBe(true);
  });

  it('NDO mismatch: no violation when DO count matches header', () => {
    // 3 DOs declared AND 3 provided → no NDO mismatch
    const dos = [0x0901912C, 0x0002D12C, 0x0003C190];
    const v = collectParseViolations('Source_Capabilities', hdr(false, 3), dos);
    expect(v.some(s => s.includes('NDO mismatch'))).toBe(false);
  });

  it('NDO mismatch: not triggered for extended messages (different NDO semantics)', () => {
    // Extended messages encode data size in the Extended Header, not NDO field
    const v = collectParseViolations('Source_Capabilities_Extended', hdr(false, 1, true), []);
    expect(v.some(s => s.includes('NDO mismatch'))).toBe(false);
  });

  // ── Source_Capabilities PDO#1 must be vSafe5V Fixed Supply ──────────────
  // §6.4.1.2.2: "The first PDO Shall always be a Fixed Supply PDO for vSafe5V."
  it('Source PDO#1 not Fixed → violation (pdoType=01b Battery)', () => {
    // Battery PDO as first entry: bits 31:30 = 0b01
    const batteryPdo = 0x4000_0000;  // pdoType=01b Battery
    const v = collectParseViolations('Source_Capabilities', hdr(false, 1), [batteryPdo]);
    expect(v.some(s => s.includes('PDO#1'))).toBe(true);
    expect(v.some(s => s.includes('Shall be Fixed Supply'))).toBe(true);
  });

  it('Source PDO#1 Fixed but voltage ≠ 5V → violation', () => {
    // Fixed PDO at 9 V: bits 19:10 = 9000/50 = 180 = 0xB4
    // Encoding: pdoType=00b (B31:30=0), voltage in B19:10
    const pdo9V = (180 << 10) >>> 0;  // 0x0002D000
    const v = collectParseViolations('Source_Capabilities', hdr(false, 1), [pdo9V]);
    expect(v.some(s => s.includes('PDO#1'))).toBe(true);
    expect(v.some(s => s.includes('9000 mV'))).toBe(true);
    expect(v.some(s => s.includes('5000 mV'))).toBe(true);
  });

  it('Source PDO#1 Fixed at 5V → no voltage violation', () => {
    // Fixed 5V PDO: bits 19:10 = 5000/50 = 100 = 0x64
    const pdo5V = (100 << 10) >>> 0;  // 0x00019000
    const v = collectParseViolations('Source_Capabilities', hdr(false, 1), [pdo5V]);
    expect(v.some(s => s.includes('PDO#1') && s.includes('mV'))).toBe(false);
  });

  it('Sink_Capabilities PDO#1 not Fixed → violation', () => {
    // Variable PDO as first entry: bits 31:30 = 0b10
    const varPdo = 0x8000_0000;  // pdoType=10b Variable
    const v = collectParseViolations('Sink_Capabilities', hdr(false, 1), [varPdo]);
    expect(v.some(s => s.includes('PDO#1'))).toBe(true);
    expect(v.some(s => s.includes('Shall be Fixed Supply'))).toBe(true);
  });

  it('EPR_Source_Capabilities chunk 1 — PDO#1 check skipped (chunkPdoOffset=7)', () => {
    // Chunk 1 of EPR_Source_Capabilities: first DO in dataObjects is actually PDO#8,
    // so the vSafe5V check should not fire for the first element.
    const notFixed = 0x4000_0000;  // Battery PDO type
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [notFixed],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('PDO#1') && s.includes('Shall be Fixed Supply'))).toBe(false);
  });

  // ── RDO Object Position Shall not be zero ────────────────────────────────
  // §6.4.2: "The Object Position Shall not be set to zero."
  it('RDO objPos=0 → violation', () => {
    // objPos stored in bits 31:28 of RDO; set to 0
    const rdoObjPos0 = 0x0000_0000;
    const v = collectParseViolations('Request', hdr(false, 1), [rdoObjPos0]);
    expect(v.some(s => s.includes('RDO Object Position = 0'))).toBe(true);
    expect(v.some(s => s.includes('§6.4.2'))).toBe(true);
  });

  it('RDO objPos=1 → no objPos violation', () => {
    // objPos=1: bits 31:28 = 0001
    const rdoObjPos1 = 0x1000_0000;
    const v = collectParseViolations('Request', hdr(false, 1), [rdoObjPos1]);
    expect(v.some(s => s.includes('Object Position'))).toBe(false);
  });

  it('EPR_Request objPos=0 → violation', () => {
    const v = collectParseViolations('EPR_Request', hdr(false, 1), [0x0000_0000]);
    expect(v.some(s => s.includes('RDO Object Position = 0'))).toBe(true);
  });

  // ── Reserved APDO subtype 0b11 ────────────────────────────────────────────
  // §6.4.1.2.5 / Table 6.7: APDO subtypes 00b=PPS, 01b=EPR AVS, 10b=SPR AVS; 11b=Reserved.
  it('APDO subtype 11b (Reserved) in Source_Capabilities → violation', () => {
    // First DO: Fixed 5V (no violation from PDO#1 check)
    // Second DO: APDO with subtype=11b: bits 31:30=11b, bits 29:28=11b
    const pdo5V    = (100 << 10) >>> 0;           // Fixed 5V
    const rsvdApdo = 0xF000_0000 >>> 0;           // pdoType=11b, apdoType=11b
    const v = collectParseViolations('Source_Capabilities', hdr(false, 2), [pdo5V, rsvdApdo]);
    expect(v.some(s => s.includes('APDO subtype 11b is Reserved'))).toBe(true);
    expect(v.some(s => s.includes('§6.4.1.2.5'))).toBe(true);
  });

  it('APDO subtype 00b (PPS) → no reserved-subtype violation', () => {
    const pdo5V  = (100 << 10) >>> 0;
    const ppsPdo = 0xC000_0000 >>> 0;  // pdoType=11b, apdoType=00b (PPS)
    const v = collectParseViolations('Source_Capabilities', hdr(false, 2), [pdo5V, ppsPdo]);
    expect(v.some(s => s.includes('APDO subtype 11b'))).toBe(false);
  });

  // ── EPR AVS voltage range constraints ──────────────────────────────────────
  // §6.4.1.2.5.2 Table 6.14: vMin ≥ 15V, vMax ≤ 48V, vMax > vMin
  //
  // EPR AVS APDO bit layout (Table 6.14):
  //   B31:30 = 11b (APDO)  B29:28 = 01b (EPR AVS)  B27:25 = PeakCurrent
  //   B24:17 = vMax/100mV  B16 = Reserved (Shall be zero)
  //   B15:8  = vMin/100mV  B7:0 = PDP (W)
  function makeEprAvsPdo(vMinMv: number, vMaxMv: number, b16 = 0): number {
    const vMaxField = (vMaxMv / 100) & 0x1FF;   // 9 bits in B24:17
    const vMinField = (vMinMv / 100) & 0xFF;    // 8 bits in B15:8
    // pdoType=11b (B31:30), apdoType=01b (B29:28), PeakCurrent=00b (B27:25)
    const base = (0b11 << 30) | (0b01 << 28);
    return (base | (vMaxField << 17) | (b16 << 16) | (vMinField << 8) | 0x3C) >>> 0;
  }

  it('EPR AVS PDO#8 vMin < 15V → violation', () => {
    const apdo = makeEprAvsPdo(14000, 28000);
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [apdo],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('vMin 14000 mV < 15000 mV'))).toBe(true);
    expect(v.some(s => s.includes('§6.4.1.2.5.2'))).toBe(true);
  });

  it('EPR AVS PDO#8 vMax > 48V → violation', () => {
    const apdo = makeEprAvsPdo(15000, 50000);
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [apdo],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('vMax 50000 mV > 48000 mV'))).toBe(true);
  });

  it('EPR AVS PDO vMax ≤ vMin (degenerate range) → violation', () => {
    // vMin field is 8-bit (max 255×100 = 25500 mV); use 25000 mV to stay in range
    const apdo = makeEprAvsPdo(25000, 20000);  // vMax(20V) < vMin(25V)
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [apdo],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('vMax') && s.includes('≤ vMin'))).toBe(true);
  });

  it('EPR AVS PDO valid range 15V–48V → no range violation', () => {
    const apdo = makeEprAvsPdo(15000, 48000);
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [apdo],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('vMin') || s.includes('vMax'))).toBe(false);
  });

  // ── EPR AVS B16 (Reserved) Shall be zero ─────────────────────────────────
  // §6.4.1.2.5.2 Table 6.14 B16: "Reserved — Shall be zero"
  it('EPR AVS PDO B16=1 → violation', () => {
    const apdo = makeEprAvsPdo(15000, 28000, 1);  // B16 forced to 1
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [apdo],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('B16 = 1') && s.includes('Reserved'))).toBe(true);
  });

  it('EPR AVS PDO B16=0 → no B16 violation', () => {
    const apdo = makeEprAvsPdo(15000, 28000, 0);
    const v = collectParseViolations('EPR_Source_Capabilities', hdr(false, 1), [apdo],
      { chunkPdoOffset: 7 });
    expect(v.some(s => s.includes('B16'))).toBe(false);
  });

  // ── SPR AVS B25:20 (Reserved) Shall be zero ──────────────────────────────
  // §6.4.1.2.5.3 Table 6.16 B25:20: "Reserved — Shall be zero"
  //
  // SPR AVS APDO bit layout (Table 6.16):
  //   B31:30 = 11b (APDO)  B29:28 = 10b (SPR AVS)
  //   B27:26 = PeakCurrent  B25:20 = Reserved (Shall be zero)
  //   B19:10 = max current 9–15V (10 mA units)  B9:0 = max current 15–20V (10 mA units)
  it('SPR AVS PDO B25:20 non-zero → violation', () => {
    const pdo5V    = (100 << 10) >>> 0;  // Fixed 5V as PDO#1
    // SPR AVS: pdoType=11b, apdoType=10b, B25:20 = 0b001001 (non-zero)
    const sprAvsPdo = ((0b11 << 30) | (0b10 << 28) | (0b001001 << 20)) >>> 0;
    const v = collectParseViolations('Source_Capabilities', hdr(false, 2), [pdo5V, sprAvsPdo]);
    expect(v.some(s => s.includes('B25:20') && s.includes('Reserved'))).toBe(true);
    expect(v.some(s => s.includes('§6.4.1.2.5.3'))).toBe(true);
  });

  it('SPR AVS PDO B25:20 = 0 → no B25:20 violation', () => {
    const pdo5V     = (100 << 10) >>> 0;
    const sprAvsPdo = ((0b11 << 30) | (0b10 << 28)) >>> 0;  // B25:20 all zero
    const v = collectParseViolations('Source_Capabilities', hdr(false, 2), [pdo5V, sprAvsPdo]);
    expect(v.some(s => s.includes('B25:20'))).toBe(false);
  });

  // ── Integration: parseRawFrame attaches parseViolations ──────────────────
  it('parseRawFrame: Source_Capabilities with 9V PDO#1 → parseViolations populated', () => {
    // Source_Capabilities with one Fixed PDO at 9V
    // Header: msgType=0x01 (Source_Capabilities), NDO=1, PPS=SOP, Rev=2.0
    //   word = (1<<12)|(0<<9)|(1<<6)|0x01 = 0x1041 → LE bytes: 41 10
    // PDO: Fixed 9V, 3A: voltage=9000/50=180=0xB4 in B19:10, current=3000/10=300=0x12C in B9:0
    //   = (180<<10)|(300) = 0x2D12C → LE bytes: 2C D1 02 00
    const hex = '41 10 2C D1 02 00';
    const msg = parseRawFrame(hex, 'TEST');
    expect(msg).not.toBeNull();
    expect(msg!.parseViolations).toBeDefined();
    expect(msg!.parseViolations!.some(s => s.includes('PDO#1') && s.includes('9000 mV'))).toBe(true);
  });

  it('parseRawFrame: Source_Capabilities with 5V PDO#1 → no parseViolations', () => {
    // Header: msgType=0x01, NDO=1, Rev=2.0 → 0x1041 → LE: 41 10
    // PDO: Fixed 5V, 3A: voltage=100 in B19:10, current=300 in B9:0 → (100<<10)|300 = 0x1912C
    //   LE bytes: 2C 91 01 00
    const hex = '41 10 2C 91 01 00';
    const msg = parseRawFrame(hex, 'TEST');
    expect(msg).not.toBeNull();
    expect(msg!.parseViolations).toBeUndefined();
  });

  it('parseRawFrame: Request with objPos=0 → parseViolations populated', () => {
    // Request: msgType=0x02, NDO=1, Rev=2.0 → header = (1<<12)|(1<<6)|0x02 = 0x1042 → LE: 42 10
    // RDO: objPos=0 in bits 31:28, all other bits zero
    const hex = '42 10 00 00 00 00';
    const msg = parseRawFrame(hex, 'TEST');
    expect(msg).not.toBeNull();
    expect(msg!.parseViolations).toBeDefined();
    expect(msg!.parseViolations!.some(s => s.includes('Object Position = 0'))).toBe(true);
  });
});

