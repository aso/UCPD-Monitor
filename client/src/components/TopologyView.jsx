import { useState, useMemo } from 'react';
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

// ── Property tree builders ───────────────────────────────────────

function buildSourceItems(source, vbusMv, ccPin) {
  if (!source.connected) {
    return [{ key: 'Status', value: 'Not connected', color: '#555' }];
  }
  const items = [];
  items.push({ key: 'PD Rev', value: source.pdRevision ?? '—' });

  if (source.capabilities.length) {
    items.push({
      key: 'Capabilities',
      value: `${source.capabilities.length} PDO${source.capabilities.length !== 1 ? 's' : ''}`,
      autoExpand: true,
      children: source.capabilities.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (source.contract) {
    const { pdo, objPos, opCurrent_mA, maxCurrent_mA, capMismatch } = source.contract;
    items.push({
      key: 'Contract',
      value: `PDO#${objPos}  ${(opCurrent_mA / 1000).toFixed(2)} A`,
      color: '#4caf50',
      autoExpand: true,
      children: [
        { key: 'PDO',         value: pdoLabel(pdo), color: PDO_COLORS[pdo?.pdoType] },
        { key: 'Op Current',  value: `${(opCurrent_mA / 1000).toFixed(2)} A` },
        { key: 'Max Current', value: `${(maxCurrent_mA / 1000).toFixed(2)} A` },
        ...(capMismatch ? [{ key: '⚠ CapMismatch', value: '', color: '#ff9800' }] : []),
      ],
    });
  }

  if (source.eprActive) items.push({ key: 'EPR', value: 'Active', color: '#ff9800' });
  if (vbusMv != null)   items.push({ key: 'VBUS', value: `${vbusMv} mV  (${(vbusMv / 1000).toFixed(2)} V)` });
  if (ccPin  != null)   items.push({ key: 'CC Pin', value: `CC${ccPin}` });

  return items;
}

function buildSinkItems(sink) {
  if (!sink.connected) {
    return [{ key: 'Status', value: 'Not connected', color: '#555' }];
  }
  const items = [];
  items.push({ key: 'PD Rev', value: sink.pdRevision ?? '—' });

  if (sink.capabilities.length) {
    items.push({
      key: 'Sink Caps',
      value: `${sink.capabilities.length} PDO${sink.capabilities.length !== 1 ? 's' : ''}`,
      autoExpand: true,
      children: sink.capabilities.map((pdo) => ({
        key: `#${pdo.index} ${pdoBadge(pdo)}`,
        value: pdoLabel(pdo),
        color: PDO_COLORS[pdo.pdoType],
      })),
    });
  }

  if (sink.lastRequest) {
    const { objPos, opCurrent_mA, maxCurrent_mA, capMismatch } = sink.lastRequest;
    items.push({
      key: 'Request',
      value: `PDO#${objPos}  ${(opCurrent_mA / 1000).toFixed(2)} A`,
      color: '#90caf9',
      autoExpand: false,
      children: [
        { key: 'Op Current',  value: `${(opCurrent_mA  / 1000).toFixed(2)} A` },
        { key: 'Max Current', value: `${(maxCurrent_mA / 1000).toFixed(2)} A` },
        ...(capMismatch ? [{ key: '⚠ CapMismatch', value: '', color: '#ff9800' }] : []),
      ],
    });
  }

  if (sink.eprActive) items.push({ key: 'EPR', value: 'Active', color: '#ff9800' });
  return items;
}

// ── PropTree ─────────────────────────────────────────────────────

function PropNode({ item, depth }) {
  const hasChildren = item.children?.length > 0;
  const [open, setOpen] = useState(item.autoExpand ?? false);

  return (
    <>
      <div
        className={`${styles.propRow} ${hasChildren ? styles.propRowClickable : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
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
  const { source, eMarker, sink, cable, vbusMv, ccPin } = useAppStore((s) => s.topology);
  const resetTopology = useAppStore((s) => s.resetTopology);

  const srcState = nodeState(source.connected, source.eprActive, !!source.contract);
  const snkState = nodeState(sink.connected,   sink.eprActive,   !!source.contract);

  const cableState = useMemo(() => {
    if (!source.connected && !sink.connected) return cable.attached ? 'active' : 'inactive';
    if (source.eprActive || sink.eprActive)   return 'epr';
    if (source.contract)                      return 'contract';
    if (source.connected || sink.connected)   return 'active';
    return 'inactive';
  }, [source, sink, cable]);

  const srcItems = useMemo(() => buildSourceItems(source, vbusMv, ccPin), [source, vbusMv, ccPin]);
  const snkItems = useMemo(() => buildSinkItems(sink), [sink]);

  const srcSub = source.contract
    ? `${pdoLabel(source.contract.pdo)} @ ${(source.contract.opCurrent_mA / 1000).toFixed(2)} A`
    : source.connected ? 'Connected' : '';
  const snkSub = sink.lastRequest
    ? `Req PDO#${sink.lastRequest.objPos}`
    : sink.connected ? 'Connected' : '';

  return (
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <span>Topology</span>
        <button onClick={resetTopology} className={styles.resetBtn}>Reset</button>
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
          {vbusMv != null && (
            <div className={styles.vbusBar}>
              VBUS: {(vbusMv / 1000).toFixed(2)} V
              {ccPin != null && `  ·  CC${ccPin}`}
            </div>
          )}
        </div>

        <PropPanel title="Sink" items={snkItems} />
      </div>
    </section>
  );
}

