import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import styles from './TopologyView.module.css';

// ── PDO helpers ──────────────────────────────────────────────────

const PDO_COLORS = {
  'Fixed':    '#80deea',
  'Battery':  '#ffcc80',
  'Variable': '#b39ddb',
  'APDO_PPS': '#a5d6a7',
  'APDO_AVS': '#f48fb1',
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
    case 'APDO_AVS': return `${pdo.vMinMv/1000}–${pdo.vMaxMv/1000}V / ${pdo.pdpW}W`;
    default:         return pdo.raw ?? '—';
  }
}

function pdoBadge(pdo) {
  if (!pdo) return '';
  return pdo.pdoType === 'APDO_PPS' ? 'PPS' : pdo.pdoType === 'APDO_AVS' ? 'AVS' : pdo.pdoType;
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
      key: 'Capabilities',
      value: `${source.capabilities.length} PDO${source.capabilities.length !== 1 ? 's' : ''}`,
      autoExpand: false,
      children: source.capabilities.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (source.contract) {
    const { pdo, objPos, opVoltage_mV, opCurrent_mA, maxCurrent_mA, capMismatch, rdoType } = source.contract;
    const isAdjustable = rdoType === 'PPS' || rdoType === 'AVS';
    const voltStr = opVoltage_mV != null
      ? `${(opVoltage_mV / 1000).toFixed(2)} V`   // negotiated output voltage (PPS/AVS)
      : contractVoltStr(pdo);
    const contractSummary = isAdjustable
      ? `#${objPos} ${pdo?.pdoType ?? ''} · ${voltStr} / ${(opCurrent_mA / 1000).toFixed(2)} A`
      : `#${objPos} ${pdo?.pdoType ?? ''} · ${voltStr} / ${(opCurrent_mA / 1000).toFixed(2)} A`;
    items.push({
      key: 'Contract',
      value: contractSummary,
      color: source.eprActive ? '#ffb74d' : '#4caf50',
      autoExpand: true,
      children: [
        { key: 'PDO Type',    value: pdo?.pdoType ?? '—', color: PDO_COLORS[pdo?.pdoType] },
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
        { key: 'Op Current',  value: `${(opCurrent_mA / 1000).toFixed(2)} A` },
        ...(!isAdjustable && maxCurrent_mA != null
          ? [{ key: 'Max Current', value: `${(maxCurrent_mA / 1000).toFixed(2)} A` }]
          : []),
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
      key: 'Sink Caps',
      value: `${sink.capabilities.length} PDO${sink.capabilities.length !== 1 ? 's' : ''}`,
      autoExpand: false,
      children: sink.capabilities.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (sink.lastRequest) {
    const { objPos, opVoltage_mV, opCurrent_mA, maxCurrent_mA, capMismatch, rdoType } = sink.lastRequest;
    const isAdj = rdoType === 'PPS' || rdoType === 'AVS';
    const rdoSummary = isAdj && opVoltage_mV != null
      ? `PDO#${objPos}  ${(opVoltage_mV / 1000).toFixed(2)} V / ${(opCurrent_mA / 1000).toFixed(2)} A`
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
        { key: 'Op Current',  value: `${(opCurrent_mA  / 1000).toFixed(2)} A` },
        ...(!isAdj && maxCurrent_mA != null
          ? [{ key: 'Max Current', value: `${(maxCurrent_mA / 1000).toFixed(2)} A` }]
          : []),
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

function PropPanel({ title, items }) {
  return (
    <div className={styles.sidePanel}>
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

function NodeBox({ label, sub, state }) {
  const boxCls = { inactive: styles.nodeInactive, active: styles.nodeActive, contract: styles.nodeContract, epr: styles.nodeEPR }[state] ?? styles.nodeInactive;
  const dotCls = { inactive: styles.dotGray, active: styles.dotGreen, contract: styles.dotBlue, epr: styles.dotOrange }[state] ?? styles.dotGray;
  return (
    <div className={`${styles.node} ${boxCls}`}>
      <div className={styles.nodeHeader}>
        <span className={`${styles.statusDot} ${dotCls}`} />
        <span className={styles.nodeLabel}>{label}</span>
      </div>
      {sub && <div className={styles.nodeSub}>{sub}</div>}
    </div>
  );
}

function Cable({ state }) {
  const cls = {
    inactive: styles.cableInactive,
    active:   styles.cableActive,
    contract: styles.cableContract,
    epr:      styles.cableEPR,
  }[state] ?? styles.cableInactive;
  return <div className={`${styles.cable} ${cls}`} />;
}

function EMarkerBox({ sop1, sop2 }) {
  const anyDetected = sop1 || sop2;
  return (
    <div className={`${styles.eMarker} ${anyDetected ? styles.eMarkerActive : ''}`}>
      <div className={styles.eMarkerTitle}>eMarker</div>
      <div className={styles.eMarkerSops}>
        <span style={{ color: sop1 ? '#4caf50' : '#334' }}>SOP'</span>
        <span className={styles.eMarkerSep}>/</span>
        <span style={{ color: sop2 ? '#4caf50' : '#334' }}>SOP''</span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────

export default function TopologyView() {
  const { source, eMarker, sink, cable } = useAppStore((s) => s.topology);
  const messages     = useAppStore((s) => s.messages);
  const replayFrames = useAppStore((s) => s.replayFrames);

  const handleRefresh = useCallback(() => replayFrames(messages), [replayFrames, messages]);

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
  const cableItems = useMemo(() => buildCableItems(eMarker), [eMarker]);

  const srcSub = (() => {
    if (source.contract) {
      const { pdo, opCurrent_mA } = source.contract;
      const vStr = contractVoltStr(pdo);
      const eprBadge = source.eprActive ? ' EPR' : '';
      return `${vStr} / ${(opCurrent_mA / 1000).toFixed(2)} A  [${pdo?.pdoType ?? ''}]${eprBadge}`;
    }
    return source.connected ? (source.eprActive ? 'EPR' : 'PD') : '';
  })();
  const snkSub = (() => {
    if (sink.lastRequest) {
      const eprBadge = sink.eprActive ? ' EPR' : '';
      return `Req #${sink.lastRequest.objPos}  ${(sink.lastRequest.opCurrent_mA / 1000).toFixed(2)} A${eprBadge}`;
    }
    return sink.connected ? (sink.eprActive ? 'EPR' : 'PD') : '';
  })();

  return (
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <span>Topology</span>
        <button onClick={handleRefresh} className={styles.resetBtn}>Refresh</button>
      </header>
      <div className={styles.body}>
        <PropPanel title="Source" items={srcItems} />

        <div className={styles.center}>
          <div className={styles.chain}>
            <NodeBox label="SOURCE" sub={srcSub} state={srcState} />
            <Cable state={cableState} />
            <EMarkerBox sop1={eMarker.sop1Detected} sop2={eMarker.sop2Detected} />
            <Cable state={cableState} />
            <NodeBox label="SINK" sub={snkSub} state={snkState} />
          </div>

        </div>

        <PropPanel title="Cable" items={cableItems} />
        <PropPanel title="Sink" items={snkItems} />
      </div>
    </section>
  );
}

