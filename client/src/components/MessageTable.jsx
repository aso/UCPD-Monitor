import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { decodeDataObjects, decodePDO, buildRdoSummary } from '../parsers/pd_parser';
import styles from './MessageTable.module.css';

/** Scan backwards from msgIndexAsc to find the nearest Source_Capabilities data objects */
function findPrecedingSourceDOs(allMessages, msgIndexAsc) {
  for (let i = msgIndexAsc - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (m.header?.typeName === 'Source_Capabilities' && m.dataObjects?.length) {
      return m.dataObjects;
    }
  }
  return null;
}

/** Format a microsecond-since-boot uint32 as MM:SS.μμμμμμ */
function formatUsTs(us) {
  const totalSec = Math.floor(us / 1_000_000);
  const rem      = us % 1_000_000;
  const mm       = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const ss       = (totalSec % 60).toString().padStart(2, '0');
  const frac     = rem.toString().padStart(6, '0');
  return `${mm}:${ss}.${frac}`;
}

const SOP_QUAL_COLORS = {
  'SOP':    '#4fc3f7',
  "SOP'":   '#81c784',
  "SOP''":  '#ffb74d',
};

const DIR_LABELS = {
  'SRC→SNK': { color: '#ef9a9a', label: 'SRC→SNK' },
  'SNK→SRC': { color: '#90caf9', label: 'SNK→SRC' },
  'DEBUG':   { color: '#ce93d8', label: 'DEBUG'   },
  'EVENT':   { color: '#fff176', label: 'EVENT'   },
};

const PDO_TYPE_COLORS = {
  'Fixed':       '#80deea',
  'Battery':     '#ffcc80',
  'Variable':    '#b39ddb',
  'APDO_PPS':    '#a5d6a7',
  'APDO_AVS':    '#f48fb1',
  'APDO_Unknown':'#aaa',
};

/** Fixed-PDO capability flags as short tokens */
function fixedFlags(pdo) {
  const flags = [];
  if (pdo.dualRolePower)      flags.push('DRP');
  if (pdo.usbSuspend)         flags.push('USB-Susp');
  if (pdo.unconstrainedPower) flags.push('UCPwr');
  if (pdo.usbCommsCapable)    flags.push('USB-Comm');
  if (pdo.dualRoleData)       flags.push('DRD');
  if (pdo.unchunkedExtMsg)    flags.push('UnchukedExt');
  if (pdo.eprModeCapable)     flags.push('EPR');
  return flags.join('  ');
}

/** Render the source PDO that was resolved from RDO's objPos */
function ResolvedPdoRow({ pdo, objPos }) {
  const typeColor = PDO_TYPE_COLORS[pdo.pdoType] ?? '#aaa';
  const details = [];

  if (pdo.pdoType === 'Fixed') {
    details.push(`${(pdo.vMv / 1000).toFixed(2)} V`);
    details.push(`${(pdo.iMa / 1000).toFixed(2)} A`);
    details.push(`${((pdo.vMv * pdo.iMa) / 1e6).toFixed(2)} W`);
    const fl = fixedFlags(pdo);
    if (fl) details.push(fl);
  } else if (pdo.pdoType === 'Battery') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(pdo.wMax/1000).toFixed(2)} W`);
  } else if (pdo.pdoType === 'Variable') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(pdo.iMa/1000).toFixed(2)} A`);
  } else if (pdo.pdoType === 'APDO_PPS') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(pdo.iMa/1000).toFixed(2)} A`);
  } else if (pdo.pdoType === 'APDO_AVS') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${pdo.pdpW} W`);
  }

  const badgeLabel = pdo.pdoType === 'APDO_PPS' ? 'PPS' : pdo.pdoType === 'APDO_AVS' ? 'AVS' : pdo.pdoType;

  return (
    <tr className={styles.resolvedPdoRow}>
      <td />
      <td colSpan={2} className={styles.resolvedPdoIndex}>
        <span className={styles.treeLL}>└─└</span>
        <span className={styles.resolvedLabel}>src PDO#{objPos}</span>
        <span className={styles.pdoTypeBadge} style={{ background: typeColor + '28', borderColor: typeColor, color: typeColor }}>
          {badgeLabel}
        </span>
      </td>
      <td colSpan={5} className={styles.resolvedPdoDetail}>{details.join('  │  ')}</td>
      <td colSpan={2} className={styles.childRaw}>{pdo.raw}</td>
    </tr>
  );
}

/** Render a single PDO child row */
function PdoRow({ child }) {
  const typeColor = PDO_TYPE_COLORS[child.pdoType] ?? '#aaa';
  const details = [];

  if (child.pdoType === 'Fixed') {
    details.push(`${(child.vMv / 1000).toFixed(2)} V`);
    details.push(`${(child.iMa / 1000).toFixed(2)} A`);
    details.push(`${((child.vMv * child.iMa) / 1e6).toFixed(2)} W`);
    const fl = fixedFlags(child);
    if (fl) details.push(fl);
  } else if (child.pdoType === 'Battery') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(child.wMax/1000).toFixed(2)} W`);
  } else if (child.pdoType === 'Variable') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(child.iMa/1000).toFixed(2)} A`);
  } else if (child.pdoType === 'APDO_PPS') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(child.iMa/1000).toFixed(2)} A`);
  } else if (child.pdoType === 'APDO_AVS') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${child.pdpW} W`);
    if (child.peakCurrentLabel) details.push(child.peakCurrentLabel);
  } else if (child.rdoType === 'PPS' || child.rdoType === 'AVS') {
    // PPS / AVS RDO
    details.push(`PDO#${child.objPos}`);
    details.push(`Out:${(child.opVoltage_mV / 1000).toFixed(3)} V`);
    details.push(`Op:${(child.opCurrent_mA / 1000).toFixed(2)} A`);
    if (child.capMismatch) details.push('CapMismatch');
  } else if (child.opCurrent_mA !== undefined) {
    // RDO
    details.push(`PDO#${child.objPos}`);
    details.push(`Op:${(child.opCurrent_mA/1000).toFixed(2)} A`);
    details.push(`Max:${(child.maxCurrent_mA/1000).toFixed(2)} A`);
    if (child.capMismatch) details.push('CapMismatch');
    if (child.eprMode)     details.push('EPR');
  }

  // EPR_Mode action badge colour
  const EPR_ACTION_COLORS = {
    'Enter':               '#a5d6a7',
    'Enter Acknowledged':  '#80deea',
    'Enter Succeeded':     '#4fc3f7',
    'Enter Failed':        '#ef9a9a',
    'Exit':                '#bdbdbd',
  };
  const isEprMode  = child.action !== undefined;
  const eprColor   = isEprMode ? (EPR_ACTION_COLORS[child.action] ?? '#bdbdbd') : null;
  // Generic key-value row (e.g. SCEDB fields from Source_Capabilities_Extended)
  const isKeyValue = !isEprMode && child.pdoType === undefined && child.opCurrent_mA === undefined
                     && child.label !== undefined && child.value !== undefined;

  if (isKeyValue) {
    return (
      <tr className={styles.childRow}>
        <td />
        <td colSpan={2} className={styles.childIndex}>
          <span className={styles.treeL}>└</span>
          <span className={styles.fieldLabel}>{child.label}</span>
        </td>
        <td colSpan={7} className={styles.childLabel}>{child.value}</td>
      </tr>
    );
  }

  return (
    <tr className={styles.childRow}>
      <td />
      <td colSpan={2} className={styles.childIndex}>
        <span className={styles.treeL}>└</span>
        {isEprMode ? (
          <span className={styles.pdoTypeBadge} style={{ background: eprColor + '40', borderColor: eprColor, color: eprColor }}>
            {child.action}
          </span>
        ) : (
          <>
            {child.pdoType && (
              <span className={styles.pdoTypeBadge} style={{ background: typeColor + '28', borderColor: typeColor, color: typeColor }}>
                {child.pdoType === 'APDO_PPS' ? 'PPS' : child.pdoType === 'APDO_AVS' ? 'AVS' : child.pdoType}
              </span>
            )}
            {child.eprMirror
              ? <span className={styles.pdoIndex} title="Mirror of the selected EPR source PDO (DO2)">EPR PDO mirror</span>
              : child.index != null && <span className={styles.pdoIndex}>#{child.index}</span>}
          </>
        )}
      </td>
      <td colSpan={5} className={styles.childLabel}>
        {isEprMode ? child.label : details.join('  │  ')}
      </td>
      <td colSpan={2} className={styles.childRaw}>{child.raw}</td>
    </tr>
  );
}

/** Single message row (expandable if it has Data Objects) */
function MessageRow({ msg, msgIndexAsc, allMessages, showRaw }) {
  const { header, cpd, recordType } = msg;
  const [expanded, setExpanded] = useState(false);

  const children = useMemo(() => {
    // parsedPayload (e.g. SCEDB from extended messages) takes priority over DO decode
    if (msg.parsedPayload?.length) return msg.parsedPayload;
    if (!header || !msg.dataObjects?.length) return null;
    return decodeDataObjects(header.typeName, msg.dataObjects);
  }, [header, msg.dataObjects, msg.parsedPayload]);

  const hasChildren = children && children.length > 0;

  // For Request/EPR_Request: resolve the source PDO referenced by RDO's objPos,
  // scanning backwards through the timeline to the nearest Source_Capabilities.
  // objPos lives in bits 31..28 of the first DO — no need to depend on `children`.
  const isRequest = header?.typeName === 'Request' || header?.typeName === 'EPR_Request';
  const rdoObjPos = isRequest && msg.dataObjects?.[0] != null
    ? (msg.dataObjects[0] >>> 28) & 0xF
    : null;

  const resolvedSourcePdo = useMemo(() => {
    if (rdoObjPos == null) return null;
    const srcDOs = findPrecedingSourceDOs(allMessages, msgIndexAsc);
    if (!srcDOs) return null;
    const pdoIdx = rdoObjPos - 1; // objPos is 1-based
    if (pdoIdx < 0 || pdoIdx >= srcDOs.length) return null;
    return { pdo: decodePDO(srcDOs[pdoIdx], rdoObjPos), objPos: rdoObjPos };
  }, [rdoObjPos, allMessages, msgIndexAsc]);

  // Re-decode RDO children with the resolved PDO type so PPS/AVS layouts are correct.
  const childrenTyped = useMemo(() => {
    if (!isRequest || !msg.dataObjects?.length || !resolvedSourcePdo) return children;
    return decodeDataObjects(header.typeName, msg.dataObjects, resolvedSourcePdo.pdo.pdoType);
  }, [isRequest, header, msg.dataObjects, resolvedSourcePdo, children]);

  const dirInfo  = DIR_LABELS[cpd?.dirName] ?? { color: '#aaa', label: cpd?.dirName ?? '—' };
  const sopColor = SOP_QUAL_COLORS[cpd?.sopQualName] ?? '#aaa';
  const isDebug  = recordType === 'ASCII_LOG';
  const isEvent  = recordType === 'EVENT';

  const toggle = useCallback(() => { if (hasChildren) setExpanded((v) => !v); }, [hasChildren]);

  return (
    <>
      <tr
        className={`${styles.row} ${isDebug ? styles.rowDebug : ''} ${isEvent ? styles.rowEvent : ''} ${hasChildren ? styles.rowExpandable : ''}`}
        onClick={toggle}
      >
        <td className={styles.num}>
          {hasChildren
            ? <span className={styles.expander}>{expanded ? '▾' : '▸'}</span>
            : <span className={styles.expanderPlaceholder} />}
          {msg.id}
        </td>
        <td className={styles.ts}>
          {cpd ? formatUsTs(msg.ts) : new Date(msg.ts).toISOString().substring(11, 23)}
        </td>
        <td style={{ color: dirInfo.color, fontWeight: 'bold' }}>
          {dirInfo.label}
          {header && (
            <span style={{ color: '#888', fontWeight: 'normal', marginLeft: 4, fontSize: 11 }}>
              {header.cablePlug !== null
                ? (header.cablePlug ? ' Plug' : ' Port')
                : ` ${header.portPowerRole}/${header.portDataRole}`}
            </span>
          )}
        </td>
        <td style={{ color: sopColor }}>{cpd?.sopQualName ?? '—'}</td>
        <td>{header?.specRevision ?? ''}</td>
        <td>{header?.msgId ?? ''}</td>
        <td className={isDebug || isEvent ? styles.special : header?.extended ? styles.ext : header?.isControl ? styles.ctrl : styles.data}>
          {isDebug ? 'ASCII_LOG' : isEvent ? (msg.eventName ?? 'EVENT') : header?.typeName ?? '—'}
        </td>
        <td>{header?.numDataObjects ?? ''}</td>
        <td className={isDebug ? styles.ascii : (msg.pdoSummary && !showRaw) ? styles.pdoSummary : styles.raw}>
          {(msg.pdoSummary && !showRaw)
            ? <>
                {/* For Request messages, recompute summary with the resolved PDO type */}
                <span className={styles.pdoSummaryText}>
                  {isRequest && resolvedSourcePdo && msg.dataObjects?.[0] != null
                    ? buildRdoSummary(msg.dataObjects[0], resolvedSourcePdo.pdo.pdoType)
                    : msg.pdoSummary}
                </span>
                {resolvedSourcePdo && (
                  <span className={styles.rdoResolvedPdo}>
                    {' → '}<span style={{ color: PDO_TYPE_COLORS[resolvedSourcePdo.pdo.pdoType] ?? '#aaa' }}>{resolvedSourcePdo.pdo.label}</span>
                  </span>
                )}
                {msg.eprCapable && <span className={styles.eprBadge}>EPR</span>}
              </>
            : msg.raw}
        </td>
      </tr>
      {expanded && hasChildren && (childrenTyped ?? children).map((child, i) => (
        <PdoRow key={i} child={child} />
      ))}
      {expanded && resolvedSourcePdo && (
        <ResolvedPdoRow pdo={resolvedSourcePdo.pdo} objPos={resolvedSourcePdo.objPos} />
      )}
    </>
  );
}

export default function MessageTable() {
  const messages      = useAppStore((s) => s.messages);
  const clearMessages = useAppStore((s) => s.clearMessages);

  // true = newest at bottom (chronological, default); false = newest at top
  const [newestAtBottom, setNewestAtBottom] = useState(true);
  // false = show parsed/summary (default); true = show raw hex
  const [showRaw, setShowRaw] = useState(false);
  // true = user has scrolled up and is reading history
  const [userScrolled, setUserScrolled] = useState(false);
  const bottomRef  = useRef(null);
  const wrapperRef = useRef(null);

  const rows = useMemo(
    () => newestAtBottom ? messages : [...messages].reverse(),
    [messages, newestAtBottom]
  );

  // Detect when user scrolls away from the bottom
  const handleScroll = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // Consider "at bottom" when within 60px
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setUserScrolled(!atBottom);
  }, []);

  // Scroll to bottom imperatively
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
    setUserScrolled(false);
  }, []);

  // Auto-scroll to bottom on new messages — only when user is NOT scrolled away
  useEffect(() => {
    if (newestAtBottom && !userScrolled) {
      bottomRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [messages, newestAtBottom, userScrolled]);

  return (
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <span>Message Log ({messages.length})</span>
        <button onClick={clearMessages} className={styles.clearBtn}>Clear</button>
      </header>
      <div className={styles.tableWrapperOuter}>
        <div
          ref={wrapperRef}
          className={styles.tableWrapper}
          onScroll={handleScroll}
        >
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th
                className={styles.thSort}
                onClick={() => setNewestAtBottom((v) => !v)}
                title={newestAtBottom ? 'Newest at bottom — click to flip' : 'Newest at top — click to flip'}
              >
                Timestamp {newestAtBottom ? '↓' : '↑'}
              </th>
              <th>Dir / Role</th>
              <th>SOP</th>
              <th>Rev</th>
              <th>MsgID</th>
              <th>Type</th>
              <th title="Number of Data Objects">#DO</th>
              <th
                className={styles.thRaw}
                onClick={() => setShowRaw((v) => !v)}
                title={showRaw ? 'Showing raw HEX — click for parsed view' : 'Showing parsed — click for raw HEX'}
              >
                {showRaw ? 'HEX ⇄' : 'Parsed ⇄'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((msg, dispIdx) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                msgIndexAsc={newestAtBottom ? dispIdx : messages.length - 1 - dispIdx}
                allMessages={messages}
                showRaw={showRaw}
              />
            ))}
          </tbody>
        </table>
        <div ref={bottomRef} />
        </div>
        {userScrolled && newestAtBottom && (
          <button
            className={styles.jumpBtn}
            onClick={scrollToBottom}
            title="Jump to latest"
          >
            ↓ Latest
          </button>
        )}
      </div>
    </section>
  );
}


