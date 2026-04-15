// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useState, useMemo, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import styles from './TopologyView.module.css';

// ── USB VID → Manufacturer lookup ────────────────────────────────
// Sources: USB-IF VID list (usbids.github.io), known USB PD vendors
const USB_VID_VENDORS = {
  0x0000: 'Unknown',
  0x0409: 'NEC',
  0x045E: 'Microsoft',
  0x046D: 'Logitech',
  0x0483: 'STMicroelectronics',
  0x04B4: 'Cypress',
  0x04CC: 'Philips',
  0x04D8: 'Microchip',
  0x04E8: 'Samsung',
  0x05AC: 'Apple',
  0x0781: 'SanDisk',
  0x03F0: 'HP',
  0x0489: 'Foxconn',
  0x0B05: 'ASUS',
  0x0BDA: 'Realtek',
  0x0BB4: 'HTC',
  0x0D62: 'Acer',
  0x1199: 'Sierra Wireless',
  0x12D1: 'Huawei',
  0x17EF: 'Lenovo',
  0x18D1: 'Google',
  0x1532: 'Razer',
  0x1B1C: 'Corsair',
  0x1D6B: 'Linux Foundation',
  0x1F3A: 'AllWinner',
  0x2001: 'D-Link',
  0x2109: 'VIA Labs',
  0x2357: 'TP-Link',
  0x22D9: 'OPPO',
  0x2537: 'Phison',
  0x27C6: 'Goodix',
  0x2717: 'Xiaomi',
  0x2E04: 'Huawei',
  0x3434: 'Keychron',
  0x3438: 'ATEN',
  0x348F: 'Luxshare',
  0x413C: 'Dell',
  0x5FC9: 'Parade Tech.',
  0x7104: 'ZOTAC',
  0x8086: 'Intel',
  0x8087: 'Intel',
  0xA2E6: 'Renesas',
  // Shared / sub-licensed VIDs — PID is allocated per-vendor by the VID holder
  0x1209: 'pid.codes',        // pid.codes open PID registry
  0x16C0: 'V-USB Shared',     // Van Ooijen Tech. / V-USB shared VID (free & commercial)
  0x16D0: 'MCS Electronics',  // MCS shared VID program
  0x1D50: 'Openmoko',         // Openmoko open VID/PID registry
  0x1FC9: 'NXP Semiconductors', // NXP sub-licensed PID program
  0x2E8A: 'Raspberry Pi',     // Raspberry Pi USB VID
  0xF055: 'f055.io',          // Unofficially self-assigned (f055.io)
};

function vidToVendor(vidStr) {
  if (!vidStr) return null;
  const n = parseInt(vidStr, 16);
  return Number.isNaN(n) ? null : (USB_VID_VENDORS[n] ?? null);
}
const PDO_COLORS = {
  'Fixed':    '#80deea',
  'Battery':  '#ffcc80',
  'Variable': '#b39ddb',
  'APDO_PPS': '#a5d6a7',
  'APDO_AVS':     '#f48fb1',
  'APDO_SPR_AVS': '#ce93d8',
};

function pdoLabel(pdo) {
  if (!pdo) return '—';
  // Use pdo.label if available (already formatted by parser)
  if (pdo.label) return pdo.label;
  switch (pdo.pdoType) {
    case 'Fixed':    return `${pdo.vMv/1000}V / ${(pdo.iMa/1000).toFixed(2)}A`;
    case 'Battery':  return `${pdo.vMinMv/1000}–${pdo.vMaxMv/1000}V / ${(pdo.wMax/1000).toFixed(0)}W`;
    case 'Variable': return `${pdo.vMinMv/1000}–${pdo.vMaxMv/1000}V / ${(pdo.iMa/1000).toFixed(2)}A`;
    case 'APDO_PPS': return `${pdo.vMinMv/1000}–${pdo.vMaxMv/1000}V / ${(pdo.iMa/1000).toFixed(2)}A`;
    case 'APDO_AVS':     return `${pdo.vMinMv/1000}–${pdo.vMaxMv/1000}V / ${pdo.pdpW}W`;
    case 'APDO_SPR_AVS': {
      const sfx = pdo.iMa_15_20 > 0
        ? `${(pdo.iMa_9_15/1000).toFixed(2)}A (9–15V) / ${(pdo.iMa_15_20/1000).toFixed(2)}A (15–20V)`
        : `${(pdo.iMa_9_15/1000).toFixed(2)}A (9–15V)`;
      return `${pdo.vMinMv/1000}–${pdo.vMaxMv/1000}V / ${sfx}`;
    }
    default:             return pdo.raw ?? '—';
  }
}

function pdoBadge(pdo) {
  if (!pdo) return '';
  return pdo.pdoType === 'APDO_PPS' ? 'PPS'
    : pdo.pdoType === 'APDO_AVS' ? 'AVS'
    : pdo.pdoType === 'APDO_SPR_AVS' ? 'SPR-AVS'
    : pdo.pdoType;
}

// Compact one-line capability range (used in node cap list)
function pdoRangeStr(pdo) {
  if (!pdo) return '—';
  switch (pdo.pdoType) {
    case 'Fixed':
      return `${(pdo.vMv / 1000).toFixed(2)}V  ${(pdo.iMa / 1000).toFixed(2)}A`;
    case 'Battery':
      return `${(pdo.vMinMv / 1000).toFixed(1)}–${(pdo.vMaxMv / 1000).toFixed(1)}V  ${(pdo.wMax / 1000).toFixed(0)}W`;
    case 'Variable':
      return `${(pdo.vMinMv / 1000).toFixed(1)}–${(pdo.vMaxMv / 1000).toFixed(1)}V  ${(pdo.iMa / 1000).toFixed(2)}A`;
    case 'APDO_PPS':
      return `${(pdo.vMinMv / 1000).toFixed(2)}–${(pdo.vMaxMv / 1000).toFixed(2)}V  ${(pdo.iMa / 1000).toFixed(2)}A`;
    case 'APDO_AVS':
      return `${(pdo.vMinMv / 1000).toFixed(2)}–${(pdo.vMaxMv / 1000).toFixed(2)}V  ${pdo.pdpW}W`;
    case 'APDO_SPR_AVS':
      return `${(pdo.vMinMv / 1000).toFixed(2)}–${(pdo.vMaxMv / 1000).toFixed(2)}V`;
    default:
      return pdo.raw ?? '—';
  }
}

// ── Contract voltage helper ──────────────────────────────────

function contractVoltStr(pdo) {
  if (!pdo) return '—';
  if (pdo.pdoType === 'Fixed')    return `${(pdo.vMv / 1000).toFixed(1)} V`;
  if (pdo.vMinMv != null)         return `${(pdo.vMinMv / 1000).toFixed(1)}–${(pdo.vMaxMv / 1000).toFixed(1)} V`;
  return '—';
}

// ── Property tree builders ───────────────────────────────────────

function buildSourceItems(source) {
  if (!source.connected) {
    return [{ key: 'Status', value: 'Not connected', color: '#555' }];
  }
  const items = [];
  items.push({ key: 'PD Rev', value: source.pdRevision ?? '—' });

  // EPR / SPR mode
  if (source.eprActive) {
    items.push({ key: 'Mode', value: 'EPR', color: '#ff9800' });
  } else if (source.contract) {
    items.push({ key: 'Mode', value: 'SPR', color: '#a5d6a7' });
  }

  if (source.capabilities.length) {
    items.push({
      key: 'SRC Caps',
      value: `${source.capabilities.length} PDO${source.capabilities.length !== 1 ? 's' : ''}`,
      autoExpand: false,
      children: source.capabilities.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (source.snkCaps?.length) {
    items.push({
      key: 'SNK Caps',
      value: `${source.snkCaps.length} PDO${source.snkCaps.length !== 1 ? 's' : ''}`,
      autoExpand: false,
      children: source.snkCaps.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (source.contract) {
    const { pdo, objPos, opVoltage_mV, opCurrent_mA, maxCurrent_mA,
            opPower_mW, limPower_mW, giveBack, capMismatch, rdoType } = source.contract;
    const isAdjustable = rdoType === 'PPS' || rdoType === 'AVS';
    const isBattery    = rdoType === 'Battery';
    const voltStr = opVoltage_mV != null
      ? `${(opVoltage_mV / 1000).toFixed(2)} V`   // negotiated output voltage (PPS/AVS)
      : contractVoltStr(pdo);
    const contractSummary = isBattery
      ? `#${objPos} ${pdo?.pdoType ?? ''} · ${voltStr} / ${(opPower_mW / 1000).toFixed(2)} W`
      : `#${objPos} ${pdo?.pdoType ?? ''} · ${voltStr} / ${(opCurrent_mA / 1000).toFixed(2)} A`;
    items.push({
      key: 'Contract',
      value: contractSummary,
      color: source.eprActive ? '#ffb74d' : '#4caf50',
      autoExpand: true,
      children: [
        { key: 'PDO Type',    value: pdo ? pdoBadge(pdo) : '—', color: PDO_COLORS[pdo?.pdoType] },
        { key: 'PDO',         value: pdoLabel(pdo), color: PDO_COLORS[pdo?.pdoType] },
        ...(isAdjustable
          ? [
              { key: 'PDO Range',    value: contractVoltStr(pdo) },
              { key: 'Out Voltage',  value: `${(opVoltage_mV / 1000).toFixed(2)} V`, color: '#a5d6a7' },
            ]
          : [
              { key: 'Voltage',      value: voltStr },
            ]
        ),
        ...(isBattery
          ? [
              { key: 'Op Power',  value: `${(opPower_mW / 1000).toFixed(2)} W` },
              { key: `${giveBack ? 'Min' : 'Max'} Power`, value: `${(limPower_mW / 1000).toFixed(2)} W` },
            ]
          : [
              { key: 'Op Current',  value: `${(opCurrent_mA / 1000).toFixed(2)} A` },
              ...(!isAdjustable && maxCurrent_mA != null
                ? [{ key: 'Max Current', value: `${(maxCurrent_mA / 1000).toFixed(2)} A` }]
                : []),
            ]
        ),
        ...(giveBack ? [{ key: 'GiveBack', value: '', color: '#90caf9' }] : []),
        ...(capMismatch ? [{ key: '⚠ CapMismatch', value: '', color: '#ff9800' }] : []),
      ],
    });
  }

  if (source.status?.length) {
    items.push({
      key: 'Status Msg',
      value: '',
      autoExpand: false,
      children: source.status.map((s) => ({ key: s.label, value: s.value })),
    });
  }

  if (source.scdb?.length) {
    const sprPdp = source.scdb.find((s) => s.label === 'SPR PDP Rating')?.value ?? '';
    const eprPdp = source.scdb.find((s) => s.label === 'EPR PDP Rating')?.value ?? '';
    const summary = [sprPdp && `SPR:${sprPdp}`, eprPdp && `EPR:${eprPdp}`].filter(Boolean).join('  ');
    items.push({
      key: 'SCDB',
      value: summary,
      autoExpand: false,
      children: source.scdb.map((s) => ({ key: s.label, value: s.value })),
    });
  }

  return items;
}

function buildSinkItems(sink) {
  if (!sink.connected) {
    return [{ key: 'Status', value: 'Not connected', color: '#555' }];
  }
  const items = [];
  items.push({ key: 'PD Rev', value: sink.pdRevision ?? '—' });

  // EPR / SPR mode
  if (sink.eprActive) items.push({ key: 'Mode', value: 'EPR', color: '#ff9800' });

  if (sink.capabilities.length) {
    items.push({
      key: 'SNK Caps',
      value: `${sink.capabilities.length} PDO${sink.capabilities.length !== 1 ? 's' : ''}`,
      autoExpand: false,
      children: sink.capabilities.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (sink.srcCaps?.length) {
    items.push({
      key: 'SRC Caps',
      value: `${sink.srcCaps.length} PDO${sink.srcCaps.length !== 1 ? 's' : ''}`,
      autoExpand: false,
      children: sink.srcCaps.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (sink.lastRequest) {
    const { objPos, opVoltage_mV, opCurrent_mA, maxCurrent_mA,
            opPower_mW, limPower_mW, giveBack, capMismatch, rdoType } = sink.lastRequest;
    const isAdj    = rdoType === 'PPS' || rdoType === 'AVS';
    const isBattery = rdoType === 'Battery';
    const rdoSummary = isAdj && opVoltage_mV != null
      ? `PDO#${objPos}  ${(opVoltage_mV / 1000).toFixed(2)} V / ${(opCurrent_mA / 1000).toFixed(2)} A`
      : isBattery
        ? `PDO#${objPos}  ${(opPower_mW / 1000).toFixed(2)} W`
        : `PDO#${objPos}  ${(opCurrent_mA / 1000).toFixed(2)} A`;
    items.push({
      key: 'RDO',
      value: rdoSummary,
      color: '#90caf9',
      autoExpand: true,
      children: [
        { key: 'Object Pos',  value: `#${objPos}` },
        { key: 'RDO Type',    value: rdoType ?? 'Fixed' },
        ...(isAdj && opVoltage_mV != null
          ? [{ key: 'Out Voltage', value: `${(opVoltage_mV / 1000).toFixed(2)} V`, color: '#a5d6a7' }]
          : []),
        ...(isBattery
          ? [
              { key: 'Op Power',  value: `${(opPower_mW / 1000).toFixed(2)} W` },
              { key: `${giveBack ? 'Min' : 'Max'} Power`, value: `${(limPower_mW / 1000).toFixed(2)} W` },
            ]
          : [
              { key: 'Op Current',  value: `${(opCurrent_mA  / 1000).toFixed(2)} A` },
              ...(!isAdj && maxCurrent_mA != null
                ? [{ key: 'Max Current', value: `${(maxCurrent_mA / 1000).toFixed(2)} A` }]
                : []),
            ]
        ),
        ...(giveBack ? [{ key: 'GiveBack', value: '', color: '#90caf9' }] : []),
        ...(capMismatch ? [{ key: '⚠ CapMismatch', value: '', color: '#ff9800' }] : []),
      ],
    });
  }

  if (sink.status?.length) {
    items.push({
      key: 'Status Msg',
      value: '',
      autoExpand: false,
      children: sink.status.map((s) => ({ key: s.label, value: s.value })),
    });
  }

  if (sink.skedb?.length) {
    const maxPdp    = sink.skedb.find((s) => s.label === 'Sink Maximum PDP')?.value ?? '';
    const eprMaxPdp = sink.skedb.find((s) => s.label === 'EPR Sink Maximum PDP')?.value ?? '';
    const summary   = [maxPdp && `MaxPDP:${maxPdp}`, eprMaxPdp && `EPR:${eprMaxPdp}`].filter(Boolean).join('  ');
    items.push({
      key: 'SKEDB',
      value: summary,
      autoExpand: false,
      children: sink.skedb.map((s) => ({ key: s.label, value: s.value })),
    });
  }

  return items;
}

function buildCableItems(eMarker) {
  const anyDetected = eMarker.sop1Detected || eMarker.sop2Detected;
  if (!anyDetected) {
    return [{ key: 'eMarker', value: 'Not detected', color: '#555' }];
  }
  const items = [];
  items.push({ key: 'eMarker', value: 'Detected', color: '#4caf50' });
  const sopStr = [eMarker.sop1Detected && "SOP'", eMarker.sop2Detected && "SOP''"].filter(Boolean).join(', ');
  items.push({ key: 'SOP Traffic', value: sopStr, color: '#4caf50' });
  if (eMarker.isActive != null) {
    items.push({ key: 'Type', value: eMarker.isActive ? 'Active' : 'Passive' });
  }
  if (eMarker.cableCurrentMa != null) {
    items.push({
      key: 'Current Rating',
      value: eMarker.cableCurrentMa >= 5000 ? '5 A' : '3 A',
      color: eMarker.cableCurrentMa >= 5000 ? '#ffb74d' : '#a5d6a7',
    });
  } else {
    items.push({ key: 'Current Rating', value: 'Default (< 3 A)', color: '#888' });
  }
  if (eMarker.maxVbusV != null) {
    items.push({ key: 'Max VBUS', value: `${eMarker.maxVbusV} V` });
  }
  if (eMarker.eprCapable != null) {
    items.push({
      key: 'EPR Capable',
      value: eMarker.eprCapable ? 'Yes' : 'No',
      color: eMarker.eprCapable ? '#ff9800' : '#888',
    });
  }
  return items;
}

// ── PropTree ─────────────────────────────────────────────────────

function PropNode({ item, depth }) {
  const hasChildren = item.children?.length > 0;
  const [open, setOpen] = useState(item.autoExpand ?? false);

  const tooltip = item.value != null && item.value !== ''
    ? `${item.key}: ${item.value}`
    : item.key;

  return (
    <>
      <div
        className={`${styles.propRow} ${hasChildren ? styles.propRowClickable : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={tooltip}
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        <span className={styles.propToggle}>
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </span>
        <span className={styles.propKey}>{item.key}</span>
        {item.value !== undefined && item.value !== '' && (
          <>
            <span className={styles.propSep}>: </span>
            <span className={styles.propValue} style={item.color ? { color: item.color } : undefined}>
              {item.value}
            </span>
          </>
        )}
        {item.value === '' && item.color && (
          <span style={{ color: item.color, fontSize: 10, marginLeft: 4 }}>●</span>
        )}
      </div>
      {open && hasChildren && item.children.map((child, i) => (
        <PropNode key={i} item={child} depth={depth + 1} />
      ))}
    </>
  );
}

function PropPanel({ title, items, width }) {
  return (
    <div className={styles.sidePanel} style={width != null ? { width } : undefined}>
      <div className={styles.panelTitle}>{title}</div>
      {items.map((item, i) => <PropNode key={i} item={item} depth={0} />)}
    </div>
  );
}

// ── Center chain components ──────────────────────────────────────

function nodeState(connected, eprActive, hasContract) {
  if (!connected)  return 'inactive';
  if (eprActive)   return 'epr';
  if (hasContract) return 'contract';
  return 'active';
}

function MeterPanel({ rows }) {
  return (
    <div className={styles.meterPanel}>
      {rows.map((row, i) => (
        <div key={i} className={styles.meterRow}>
          <span className={styles.meterLabel}>{row.label}</span>
          <span className={styles.meterValue} style={row.color ? { color: row.color } : undefined}>
            {row.value}
          </span>
          <span className={styles.meterUnit}>{row.unit}</span>
        </div>
      ))}
    </div>
  );
}

// ── Compact PDO capability list (inside node box) ──────────

// Fixed column order — always shown; null = n/a → dim
// I.min / P.min omitted: always null across all PDO types
const GRID_COLS_SRC = [
  { key: 'vMax', label: 'V.max', unit: 'V' },
  { key: 'vMin', label: 'V.min', unit: 'V' },
  { key: 'iMax', label: 'I.max', unit: 'A' },
  { key: 'pMax', label: 'P.max', unit: 'W' },
];
const GRID_COLS_SNK = [
  { key: 'vMax', label: 'V.max', unit: 'V' },
  { key: 'vMin', label: 'V.min', unit: 'V' },
  { key: 'iMax', label: 'I.op',  unit: 'A' },
  { key: 'pMax', label: 'P.op',  unit: 'W' },
];

// Format a milli-unit value for display. Returns '—' when null.
function fmtCell(valMilli, unit) {
  if (valMilli == null) return '—';
  const n = valMilli / 1000;
  return `${n < 10 ? n.toFixed(2) : n.toFixed(1)}${unit}`;
}

// Extract the 4-column grid values (all in milli-units) from a PDO object.
// I.min / P.min omitted — always null across all PDO types.
function pdoToGrid(pdo) {
  const _ = null;
  switch (pdo.pdoType) {
    case 'Fixed':
      return { vMax: pdo.vMv,    vMin: _,          iMax: pdo.iMa,            pMax: _                                     };
    case 'Battery':
      return { vMax: pdo.vMaxMv, vMin: pdo.vMinMv, iMax: _,                  pMax: pdo.wMax                               };
    case 'Variable':
      return { vMax: pdo.vMaxMv, vMin: pdo.vMinMv, iMax: pdo.iMa,            pMax: _                                     };
    case 'APDO_PPS':
      return { vMax: pdo.vMaxMv, vMin: pdo.vMinMv, iMax: pdo.iMa,            pMax: _                                     };
    case 'APDO_AVS':
      return { vMax: pdo.vMaxMv, vMin: pdo.vMinMv, iMax: _,                  pMax: pdo.pdpW != null ? pdo.pdpW * 1000 : _ };
    case 'APDO_SPR_AVS':
      return { vMax: pdo.vMaxMv, vMin: pdo.vMinMv, iMax: pdo.iMa_9_15 ?? _, pMax: _                                     };
    default:
      return { vMax: pdo.vMv ?? pdo.vMaxMv ?? _, vMin: pdo.vMinMv ?? _, iMax: pdo.iMa ?? _, pMax: _ };
  }
}

function CapList({ caps, selectedObjPos, rdo, isSink = false }) {
  const gridCols = isSink ? GRID_COLS_SNK : GRID_COLS_SRC;
  return (
    <div className={styles.capList}>
      {/* Sticky header */}
      <div className={styles.capHeader}>
        <span /><span />
        {gridCols.map(col => (
          <span key={col.key} className={styles.capHeaderCell}>{col.label}</span>
        ))}
      </div>
      {/* PDO rows */}
      {caps.map((pdo) => {
        const sel = pdo.index === selectedObjPos;
        const grid = pdoToGrid(pdo);
        const color = PDO_COLORS[pdo.pdoType];
        return (
          <div
            key={pdo.index}
            className={`${styles.capRow} ${sel ? styles.capRowSelected : ''}`}
          >
            <span className={styles.capIdx} style={sel ? { color: '#a5d6a7' } : undefined}>
              #{pdo.index}
            </span>
            <span
              className={styles.capBadgeChip}
              style={{ color, borderColor: color, background: color + '22' }}
            >
              {pdoBadge(pdo)}
            </span>
            {gridCols.map(col => {
              const val = grid[col.key];
              return (
                <span key={col.key} className={val != null ? styles.capCellLit : styles.capCellDim}>
                  {fmtCell(val, col.unit)}
                </span>
              );
            })}
          </div>
        );
      })}
      {/* RDO row */}
      {rdo && (() => {
        const { objPos, opVoltage_mV, opCurrent_mA, opPower_mW, rdoType } = rdo;
        const isAdj = rdoType === 'PPS' || rdoType === 'AVS';
        const isBat = rdoType === 'Battery';
        const rdoStr = isAdj && opVoltage_mV != null
          ? `#${objPos}  ${(opVoltage_mV / 1000).toFixed(2)}V  ${(opCurrent_mA / 1000).toFixed(2)}A`
          : isBat
            ? `#${objPos}  ${(opPower_mW / 1000).toFixed(2)}W`
            : `#${objPos}  ${(opCurrent_mA / 1000).toFixed(2)}A`;
        return (
          <div className={styles.rdoRow}>
            <span className={styles.rdoLabel}>RDO</span>
            <span className={styles.rdoValue}>{rdoStr}</span>
          </div>
        );
      })()}
    </div>
  );
}

const PDO_TYPE_DEFS = [
  { key: 'Fixed',        label: 'FIX',   color: '#80deea' },
  { key: 'Battery',      label: 'BAT',   color: '#ffcc80' },
  { key: 'Variable',     label: 'VAR',   color: '#b39ddb' },
  { key: 'APDO_PPS',     label: 'PPS',   color: '#a5d6a7' },
  { key: 'APDO_AVS',     label: 'AVS',   color: '#f48fb1' },
  { key: 'APDO_SPR_AVS', label: 'S-AVS', color: '#ce93d8' },
];

function PdoTypeLamps({ pdoType }) {
  return (
    <div className={styles.pdoLamps}>
      {PDO_TYPE_DEFS.map(({ key, label, color }) => {
        const active = pdoType === key;
        return (
          <span
            key={key}
            className={`${styles.pdoLamp} ${active ? styles.pdoLampActive : ''}`}
            style={active ? { color, borderColor: color, textShadow: `0 0 6px ${color}88` } : undefined}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// EPR-only lamp — dim when SPR mode, lit when EPR mode, invisible when null
function EprLamp({ mode }) {
  if (mode == null) return null;
  const lit = mode === 'epr';
  return (
    <div className={`${styles.eprLamp} ${lit ? styles.eprLampLit : styles.eprLampDim}`}>
      <span className={styles.eprLampDot} />
      EPR
    </div>
  );
}

// ── RDO detail panel (inside sink right column) ──────────────

function RdoPanel({ rdo }) {
  const { objPos, opVoltage_mV, opCurrent_mA, maxCurrent_mA,
          opPower_mW, limPower_mW, giveBack, capMismatch, rdoType } = rdo;
  const isAdj = rdoType === 'PPS' || rdoType === 'AVS';
  const isBat = rdoType === 'Battery';
  return (
    <div className={styles.rdoPanel}>
      <span className={styles.rdoPanelTitle}>RDO</span>
      <div className={styles.rdoPanelRow}>
        <span className={styles.rdoPanelKey}>PDO #</span>
        <span className={styles.rdoPanelVal}>{objPos}</span>
      </div>
      <div className={styles.rdoPanelRow}>
        <span className={styles.rdoPanelKey}>Type</span>
        <span className={styles.rdoPanelVal}>{rdoType ?? 'Fixed'}</span>
      </div>
      {isAdj && opVoltage_mV != null && (
        <div className={styles.rdoPanelRow}>
          <span className={styles.rdoPanelKey}>V.req</span>
          <span className={styles.rdoPanelVal}>{(opVoltage_mV / 1000).toFixed(2)} V</span>
        </div>
      )}
      {isBat ? (
        <>
          <div className={styles.rdoPanelRow}>
            <span className={styles.rdoPanelKey}>P.op</span>
            <span className={styles.rdoPanelVal}>{(opPower_mW / 1000).toFixed(2)} W</span>
          </div>
          <div className={styles.rdoPanelRow}>
            <span className={styles.rdoPanelKey}>{giveBack ? 'P.min' : 'P.max'}</span>
            <span className={styles.rdoPanelVal}>{(limPower_mW / 1000).toFixed(2)} W</span>
          </div>
        </>
      ) : (
        <>
          <div className={styles.rdoPanelRow}>
            <span className={styles.rdoPanelKey}>I.op</span>
            <span className={styles.rdoPanelVal}>{(opCurrent_mA / 1000).toFixed(2)} A</span>
          </div>
          {!isAdj && maxCurrent_mA != null && (
            <div className={styles.rdoPanelRow}>
              <span className={styles.rdoPanelKey}>I.max</span>
              <span className={styles.rdoPanelVal}>{(maxCurrent_mA / 1000).toFixed(2)} A</span>
            </div>
          )}
        </>
      )}
      {giveBack    && <div className={styles.rdoPanelFlag} style={{ color: '#90caf9' }}>GiveBack</div>}
      {capMismatch && <div className={styles.rdoPanelFlag} style={{ color: '#ff9800' }}>⚠ CapMismatch</div>}
    </div>
  );
}

// ── Source spec badge ───────────────────────────────────────────

/** Compact spec badge shown at the top of the SOURCE node box */
function SrcSpecBadge({ source }) {
  const scdb = source.scdb;
  // Cap_Extended: only when Source_Capabilities_Extended was actually received
  const extMsgCap = !!scdb?.length;
  if (!scdb?.length && !source.eprActive && !extMsgCap && !source.vdmSeen) return null;

  const scdbVal  = (label) => scdb?.find((s) => s.label === label)?.value ?? null;
  const vidStr   = scdbVal('VID');
  const vendor   = vidToVendor(vidStr);
  const pid      = scdbVal('PID');
  const eprPdp   = scdbVal('EPR PDP Rating');
  const sprPdp   = scdbVal('SPR PDP Rating');
  const eprCap   = eprPdp && parseInt(eprPdp) > 0;
  const displayPdp = eprCap ? eprPdp : sprPdp;

  return (
    <div className={styles.sinkSpecBadge}>
      <div className={styles.sinkSpecVendor}>
        {vendor
          ? <><span className={styles.sinkSpecVendorName}>{vendor}</span>{pid && <span className={styles.sinkSpecPid}>{pid}</span>}</>
          : vidStr ? <span className={styles.sinkSpecPid}>{vidStr}</span> : <span className={styles.sinkSpecPid}>DFP</span>}
      </div>
      <div className={styles.sinkSpecRow}>
        {(eprCap || source.eprActive) && <span className={styles.sinkSpecEpr}>EPR RDY</span>}
        {extMsgCap && <span className={styles.sinkSpecCap}>Cap_Ext</span>}
        {source.vdmSeen && <span className={styles.sinkSpecCap}>VDM</span>}
        {displayPdp && <span className={styles.sinkSpecPdp}>{displayPdp}</span>}
      </div>
    </div>
  );
}

/** SOURCE node content: spec badge + cap list */
function SourceContent({ source }) {
  return (
    <div>
      <SrcSpecBadge source={source} />
      <CapList caps={source.capabilities} selectedObjPos={source.contract?.objPos ?? null} />
    </div>
  );
}

// ── Sink two-column layout ──────────────────────────────────────
//  Left col : SNK PDO caps
//  Right col : RDO panel + SRC PDO caps (SRC only when advertised)

/** Compact spec badge shown at the top of the SINK node box */
function SinkSpecBadge({ sink }) {
  const skedb = sink.skedb;
  // Cap_Extended support: unchunkedExt bit in lastRequest RDO
  const extMsgCap = sink.lastRequest?.unchunkedExt === true;
  if (!skedb?.length && !sink.eprActive && !extMsgCap && !sink.vdmSeen) return null;

  const skedbVal = (label) => skedb?.find((s) => s.label === label)?.value ?? null;
  const vidStr   = skedbVal('VID');
  const vendor   = vidToVendor(vidStr);
  const pid      = skedbVal('PID');
  const maxPdp   = skedbVal('Sink Maximum PDP');
  const eprMaxPdp = skedbVal('EPR Sink Maximum PDP');
  const eprCap   = eprMaxPdp && parseInt(eprMaxPdp) > 0;
  const displayPdp = eprCap ? eprMaxPdp : maxPdp;

  return (
    <div className={styles.sinkSpecBadge}>
      <div className={styles.sinkSpecVendor}>
        {vendor
          ? <><span className={styles.sinkSpecVendorName}>{vendor}</span>{pid && <span className={styles.sinkSpecPid}>{pid}</span>}</>
          : vidStr ? <span className={styles.sinkSpecPid}>{vidStr}</span> : <span className={styles.sinkSpecPid}>UFP</span>}
      </div>
      <div className={styles.sinkSpecRow}>
        {(eprCap || sink.eprActive) && (
          <span className={styles.sinkSpecEpr}>EPR RDY</span>
        )}
        {extMsgCap && <span className={styles.sinkSpecCap}>Cap_Ext</span>}
        {sink.vdmSeen && <span className={styles.sinkSpecCap}>VDM</span>}
        {displayPdp && (
          <span className={styles.sinkSpecPdp}>{displayPdp}</span>
        )}
      </div>
    </div>
  );
}

function SinkContent({ sink }) {
  const hasSnkCaps = sink.capabilities.length > 0;
  const hasSrcCaps = sink.srcCaps?.length > 0;
  const hasRdo     = !!sink.lastRequest;
  const hasRight   = hasRdo || hasSrcCaps;
  // RDO (+ SRC CAP) is always on the Source-side (left), SNK CAP on the far side (right)
  return (
    <div className={styles.sinkColumns}>
      <SinkSpecBadge sink={sink} />
      {(hasRight || hasSnkCaps) && (
        <div className={styles.sinkColumnsInner}>
          {hasRight && (
            <div className={styles.sinkColRdo}>
              {hasRdo && <RdoPanel rdo={sink.lastRequest} />}
              {hasSrcCaps && (
                <div style={{ marginTop: hasRdo ? 4 : 0 }}>
                  <div className={styles.sinkColLabel}>SRC CAP</div>
                  <CapList caps={sink.srcCaps} selectedObjPos={null} />
                </div>
              )}
            </div>
          )}
          {hasSnkCaps && (
            <div className={styles.sinkColSnk}>
              <CapList caps={sink.capabilities} selectedObjPos={null} isSink={true} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Contract values inside eMarker ────────────────────

function ContractInRow({ label, value, unit, color }) {
  return (
    <div className={styles.contractInRow}>
      <span className={styles.contractInLabel}>{label}</span>
      <span className={styles.contractInValue} style={{ color }}>{value}</span>
      <span className={styles.contractInUnit}>{unit}</span>
    </div>
  );
}

function ContractInMarker({ contract }) {
  const DIM = '#0e2a0e';
  if (!contract) {
    return (
      <div className={styles.contractIn}>
        <ContractInRow label="Contract.V" value="---.---" unit="V" color={DIM} />
        <ContractInRow label="Contract.I" value="---.---"  unit="A" color={DIM} />
      </div>
    );
  }
  const { pdo, objPos, opVoltage_mV, opCurrent_mA, opPower_mW, rdoType } = contract;
  const isAdj     = rdoType === 'PPS' || rdoType === 'AVS';
  const isBattery = rdoType === 'Battery';
  const vMv = isAdj ? opVoltage_mV
    : pdo?.pdoType === 'Fixed' ? pdo.vMv
    : null;
  return (
    <div className={styles.contractIn}>
      <span className={styles.contractInPdo}>PDO #{objPos}</span>
      <ContractInRow
        label="Contract.V"
        value={vMv != null ? (vMv / 1000).toFixed(3) : '---.---'}
        unit="V"
        color="#80deea"
      />
      {isBattery
        ? <ContractInRow
            label="Contract.P"
            value={opPower_mW != null ? (opPower_mW / 1000).toFixed(2) : '---.--'}
            unit="W"
            color="#ffcc80"
          />
        : <ContractInRow
            label="Contract.I"
            value={opCurrent_mA != null ? (opCurrent_mA / 1000).toFixed(3) : '---.---'}
            unit="A"
            color="#a5d6a7"
          />
      }
    </div>
  );
}

function NodeBox({ label, sub, meterRows, capList, mode, state, narrow }) {
  const boxCls = { inactive: styles.nodeInactive, active: styles.nodeActive, contract: styles.nodeContract, epr: styles.nodeEPR }[state] ?? styles.nodeInactive;
  const dotCls = { inactive: styles.dotGray, active: styles.dotGreen, contract: styles.dotBlue, epr: styles.dotOrange }[state] ?? styles.dotGray;
  return (
    <div className={`${styles.node} ${boxCls} ${narrow ? styles.nodeNarrow : ''}`}>
      <EprLamp mode={mode} />
      <div className={styles.nodeHeader}>
        <span className={`${styles.statusDot} ${dotCls}`} />
        <span className={styles.nodeLabel}>{label}</span>
      </div>
      {capList != null
        ? capList
        : meterRows?.length
          ? <MeterPanel rows={meterRows} />
          : sub
            ? <div className={styles.nodeSub}>{sub}</div>
            : null}
    </div>
  );
}

function CableWithEMarker({ state, sop1, sop2, contract }) {
  const trackCls = {
    inactive: styles.cableInactive,
    active:   styles.cableActive,
    contract: styles.cableContract,
    epr:      styles.cableEPR,
  }[state] ?? styles.cableInactive;
  const dotCls = { inactive: styles.dotGray, active: styles.dotGreen, contract: styles.dotBlue, epr: styles.dotOrange }[state] ?? styles.dotGray;
  const anyDetected = sop1 || sop2;
  return (
    <div className={styles.cableChain}>
      <div className={`${styles.cableTrack} ${trackCls}`} />
      <div className={`${styles.eMarker} ${anyDetected ? styles.eMarkerActive : ''}`}>
        <div className={styles.nodeHeader}>
          <span className={`${styles.statusDot} ${dotCls}`} />
          <span className={styles.nodeLabel}>Contract</span>
        </div>
        <div className={styles.eMarkerSops}>
          <span style={{ color: sop1 ? '#33dd33' : '#1a3a1a' }}>SOP’</span>
          <span className={styles.eMarkerSep}>/</span>
          <span style={{ color: sop2 ? '#33dd33' : '#1a3a1a' }}>SOP’’</span>
        </div>
        <ContractInMarker contract={contract} />
      </div>
    </div>
  );
}

function ContractBox({ contract, state }) {
  const boxCls = { inactive: styles.nodeInactive, active: styles.nodeActive, contract: styles.nodeContract, epr: styles.nodeEPR }[state] ?? styles.nodeInactive;
  const dotCls = { inactive: styles.dotGray, active: styles.dotGreen, contract: styles.dotBlue, epr: styles.dotOrange }[state] ?? styles.dotGray;
  return (
    <div className={`${styles.node} ${styles.nodeContract_box} ${boxCls}`}>
      <div className={styles.nodeHeader}>
        <span className={`${styles.statusDot} ${dotCls}`} />
        <span className={styles.nodeLabel}>Contract</span>
      </div>
      <ContractInMarker contract={contract} />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────

export default function TopologyView() {
  const { source, eMarker, sink, cable } = useAppStore((s) => s.topology);
  const messages     = useAppStore((s) => s.messages);
  const replayFrames = useAppStore((s) => s.replayFrames);

  const handleRefresh = useCallback(() => replayFrames(messages), [replayFrames, messages]);

  // ── Resizable panes ──────────────────────────────────────────
  const wrapperRef  = useRef(null);
  const [topoHeight, setTopoHeight] = useState(null);  // null = auto
  const [srcPanelW,  setSrcPanelW]  = useState(200);
  const [snkPanelW,  setSnkPanelW]  = useState(260);

  /** Start a drag-resize. setter receives (startSize + sign * delta). */
  const startDrag = useCallback((e, startSize, setter, axis, sign, min) => {
    e.preventDefault();
    const coord0 = axis === 'x' ? e.clientX : e.clientY;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
    const onMove = (mv) => {
      const delta = (axis === 'x' ? mv.clientX : mv.clientY) - coord0;
      setter(Math.max(min, startSize + sign * delta));
    };
    const onUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const onHeightDragStart = useCallback((e) => {
    const h = wrapperRef.current?.getBoundingClientRect().height ?? 300;
    startDrag(e, h, setTopoHeight, 'y', +1, 140);
  }, [startDrag]);

  const onSrcResize = useCallback((e) => {
    startDrag(e, srcPanelW, setSrcPanelW, 'x', +1, 120);
  }, [startDrag, srcPanelW]);

  const onSnkResize = useCallback((e) => {
    startDrag(e, snkPanelW, setSnkPanelW, 'x', -1, 120);
  }, [startDrag, snkPanelW]);

  const srcState = nodeState(source.connected, source.eprActive, !!source.contract);
  const snkState = nodeState(sink.connected,   sink.eprActive,   !!source.contract);

  const cableState = useMemo(() => {
    if (!source.connected && !sink.connected) return cable.attached ? 'active' : 'inactive';
    if (source.eprActive || sink.eprActive)   return 'epr';
    if (source.contract)                      return 'contract';
    if (source.connected || sink.connected)   return 'active';
    return 'inactive';
  }, [source, sink, cable]);

  const srcItems   = useMemo(() => buildSourceItems(source), [source]);
  const snkItems   = useMemo(() => buildSinkItems(sink), [sink]);

  // Simple text sub when no cap list is available (rarely shown)
  const srcSub = source.connected ? (source.eprActive ? 'EPR' : 'PD') : '';
  const snkSub = sink.connected   ? (sink.eprActive   ? 'EPR' : 'PD') : '';

  // ── Cap lists for SOURCE and SINK node boxes ────────────────
  const srcCapList = useMemo(() => {
    if (!source.connected || !source.capabilities.length) return null;
    return <SourceContent source={source} />;
  }, [source]);

  const snkCapList = useMemo(() => {
    if (!sink.connected) return null;
    if (!sink.capabilities.length && !sink.lastRequest) return null;
    return <SinkContent sink={sink} />;
  }, [sink]);

  const snkNarrow = sink.connected && !sink.capabilities.length && !!sink.lastRequest;
  const contractState = source.eprActive ? 'epr' : source.contract ? 'contract' : source.connected ? 'active' : 'inactive';

  return (
    <section ref={wrapperRef} className={styles.wrapper} style={topoHeight != null ? { height: topoHeight } : undefined}>
      <header className={styles.header}>
        <span>Connection View</span>
        <button onClick={handleRefresh} className={styles.resetBtn}>Refresh</button>
      </header>
      <div className={styles.body} style={topoHeight != null ? { flex: '1 1 0', minHeight: 0 } : undefined}>
        <PropPanel title="Source" items={srcItems} width={srcPanelW} />
        <div className={styles.panelSep} onMouseDown={onSrcResize} />

        <div className={styles.center}>
          <div className={styles.chain}>
            <NodeBox label="SOURCE" capList={srcCapList} sub={srcSub} mode={source.eprActive ? 'epr' : source.contract ? 'spr' : null} state={srcState} />
            <CableWithEMarker state={contractState} sop1={eMarker.sop1} sop2={eMarker.sop2} contract={source.contract} />
            <NodeBox label="SINK" capList={snkCapList} sub={snkSub} mode={sink.eprActive ? 'epr' : sink.lastRequest ? 'spr' : null} state={snkState} narrow={snkNarrow} />
          </div>
        </div>

        <div className={styles.panelSep} onMouseDown={onSnkResize} />
        <PropPanel title="Sink" items={snkItems} width={snkPanelW} />
      </div>
      <div className={styles.heightResizeBar} onMouseDown={onHeightDragStart} />
    </section>
  );
}

