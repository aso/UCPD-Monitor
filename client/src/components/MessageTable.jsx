import { useMemo, useState, useCallback, useEffect, useRef, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from '../store/appStore';
import { decodeDataObjects, decodePDO, buildRdoSummary } from '../parsers/pd_parser';
import styles from './MessageTable.module.css';

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
  'Fixed':        '#80deea',
  'Battery':      '#ffcc80',
  'Variable':     '#b39ddb',
  'APDO_PPS':     '#a5d6a7',
  'APDO_AVS':     '#f48fb1',
  'APDO_SPR_AVS': '#ce93d8',
  'APDO_Unknown': '#aaa',
};

/** Fixed-PDO capability flags as short tokens */
function fixedFlags(pdo) {
  const flags = [];
  if (pdo.dualRolePower)      flags.push('DRP');
  if (pdo.isSink) {
    if (pdo.higherCapability)   flags.push('HigherCap');
    if (pdo.unconstrainedPower) flags.push('UCPwr');
    if (pdo.usbCommsCapable)    flags.push('USB-Comm');
    if (pdo.dualRoleData)       flags.push('DRD');
    if (pdo.fastRoleSwap > 0)   flags.push(pdo.fastRoleSwapLabel);
  } else {
    if (pdo.usbSuspend)         flags.push('USB-Susp');
    if (pdo.unconstrainedPower) flags.push('UCPwr');
    if (pdo.usbCommsCapable)    flags.push('USB-Comm');
    if (pdo.dualRoleData)       flags.push('DRD');
    if (pdo.unchunkedExtMsg)    flags.push('UnchukedExt');
    if (pdo.eprModeCapable)     flags.push('EPR');
  }
  return flags.join('  ');
}

/** Render the source PDO that was resolved from RDO's objPos */
function ResolvedPdoRow({ pdo, objPos, isParentSelected }) {
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
    details.push(`${pdo.isSink ? 'Op' : 'Max'}:${(pdo.wMax/1000).toFixed(2)} W`);
  } else if (pdo.pdoType === 'Variable') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${pdo.isSink ? 'Op' : 'Max'}:${(pdo.iMa/1000).toFixed(2)} A`);
  } else if (pdo.pdoType === 'APDO_PPS') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${pdo.pdpW} W`);
  } else if (pdo.pdoType === 'APDO_SPR_AVS') {
    details.push(`${(pdo.vMinMv/1000).toFixed(2)}–${(pdo.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(pdo.iMa_9_15/1000).toFixed(2)} A (9–15V)`);
    if (pdo.iMa_15_20 > 0) details.push(`${(pdo.iMa_15_20/1000).toFixed(2)} A (15–20V)`);
  }

  const badgeLabel = pdo.pdoType === 'APDO_PPS' ? 'PPS'
    : pdo.pdoType === 'APDO_AVS' ? 'AVS'
    : pdo.pdoType === 'APDO_SPR_AVS' ? 'SPR-AVS'
    : pdo.pdoType;

  return (
    <tr className={`${styles.resolvedPdoRow} ${isParentSelected ? styles.childRowSelected : ''}`}>
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
function PdoRow({ child, isParentSelected }) {
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
    details.push(`${child.isSink ? 'Op' : 'Max'}:${(child.wMax/1000).toFixed(2)} W`);
  } else if (child.pdoType === 'Variable') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${child.isSink ? 'Op' : 'Max'}:${(child.iMa/1000).toFixed(2)} A`);
  } else if (child.pdoType === 'APDO_PPS') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(child.iMa/1000).toFixed(2)} A`);
  } else if (child.pdoType === 'APDO_AVS') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${child.pdpW} W`);
    if (child.peakCurrentLabel) details.push(child.peakCurrentLabel);
  } else if (child.pdoType === 'APDO_SPR_AVS') {
    details.push(`${(child.vMinMv/1000).toFixed(2)}–${(child.vMaxMv/1000).toFixed(2)} V`);
    details.push(`${(child.iMa_9_15/1000).toFixed(2)} A (9–15V)`);
    if (child.iMa_15_20 > 0) details.push(`${(child.iMa_15_20/1000).toFixed(2)} A (15–20V)`);
    if (child.peakCurrentLabel) details.push(child.peakCurrentLabel);
  } else if (child.rdoType === 'PPS' || child.rdoType === 'AVS') {
    details.push(`PDO#${child.objPos}`);
    details.push(`Out:${(child.opVoltage_mV / 1000).toFixed(3)} V`);
    details.push(`Op:${(child.opCurrent_mA / 1000).toFixed(2)} A`);
    if (child.capMismatch) details.push('CapMismatch');
    if (child.eprMode)     details.push('EPR');
  } else if (child.rdoType === 'Battery') {
    details.push(`PDO#${child.objPos}`);
    details.push(`Op:${(child.opPower_mW/1000).toFixed(2)} W`);
    details.push(`${child.giveBack ? 'Min' : 'Max'}:${(child.limPower_mW/1000).toFixed(2)} W`);
    if (child.giveBack)    details.push('GiveBack');
    if (child.capMismatch) details.push('CapMismatch');
    if (child.eprMode)     details.push('EPR');
  } else if (child.opCurrent_mA !== undefined) {
    details.push(`PDO#${child.objPos}`);
    details.push(`Op:${(child.opCurrent_mA/1000).toFixed(2)} A`);
    details.push(`${child.giveBack ? 'Min' : 'Max'}:${(child.maxCurrent_mA/1000).toFixed(2)} A`);
    if (child.giveBack)    details.push('GiveBack');
    if (child.capMismatch) details.push('CapMismatch');
    if (child.eprMode)     details.push('EPR');
  }

  const EPR_ACTION_COLORS = {
    'Enter':               '#a5d6a7',
    'Enter Acknowledged':  '#80deea',
    'Enter Succeeded':     '#4fc3f7',
    'Enter Failed':        '#ef9a9a',
    'Exit':                '#bdbdbd',
  };
  const isEprMode  = child.action !== undefined;
  const eprColor   = isEprMode ? (EPR_ACTION_COLORS[child.action] ?? '#bdbdbd') : null;
  const isKeyValue = !isEprMode && child.pdoType === undefined && child.opCurrent_mA === undefined
                     && child.label !== undefined && child.value !== undefined;

  if (isKeyValue) {
    return (
      <tr className={`${styles.childRow} ${isParentSelected ? styles.childRowSelected : ''}`}>
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
    <tr className={`${styles.childRow} ${isParentSelected ? styles.childRowSelected : ''}`}>
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
                {child.pdoType === 'APDO_PPS' ? 'PPS'
                  : child.pdoType === 'APDO_AVS' ? 'AVS'
                  : child.pdoType === 'APDO_SPR_AVS' ? 'SPR-AVS'
                  : child.pdoType}
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

/**
 * Single message row — memoized to prevent re-render when unrelated rows change.
 * expanded / onToggle are lifted to the parent to survive virtual-scroll unmount.
 */
const MessageRow = memo(function MessageRow({
  msg, resolvedSourcePdo, showRaw, isSelected, expanded, onToggle, onSelect, onContextMenu,
}) {
  const { header, cpd, recordType } = msg;

  const isRequest = header?.typeName === 'Request' || header?.typeName === 'EPR_Request';

  const children = useMemo(() => {
    if (msg.parsedPayload?.length) return msg.parsedPayload;
    if (!header || !msg.dataObjects?.length) return null;
    return decodeDataObjects(header.typeName, msg.dataObjects);
  }, [header, msg.dataObjects, msg.parsedPayload]);

  const hasChildren = children && children.length > 0;

  const childrenTyped = useMemo(() => {
    if (!isRequest || !msg.dataObjects?.length || !resolvedSourcePdo) return children;
    return decodeDataObjects(header.typeName, msg.dataObjects, resolvedSourcePdo.pdo.pdoType);
  }, [isRequest, header, msg.dataObjects, resolvedSourcePdo, children]);

  const dirInfo  = DIR_LABELS[cpd?.dirName] ?? { color: '#aaa', label: cpd?.dirName ?? '—' };
  const sopColor = SOP_QUAL_COLORS[cpd?.sopQualName] ?? '#aaa';
  const isDebug  = recordType === 'ASCII_LOG';
  const isEvent  = recordType === 'EVENT';

  const handleClick = useCallback((e) => {
    onSelect(e);
    if (!e.shiftKey && hasChildren) onToggle();
  }, [onSelect, hasChildren, onToggle]);

  return (
    <>
      <tr
        className={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${isDebug ? styles.rowDebug : ''} ${isEvent ? styles.rowEvent : ''} ${hasChildren ? styles.rowExpandable : ''}`}
        onClick={handleClick}
        onContextMenu={onContextMenu}
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
            : (msg.raw ? `DATA:${msg.raw}` : '')}
        </td>
      </tr>
      {expanded && hasChildren && (childrenTyped ?? children).map((child, i) => (
        <PdoRow key={i} child={child} isParentSelected={isSelected} />
      ))}
      {expanded && resolvedSourcePdo && (
        <ResolvedPdoRow pdo={resolvedSourcePdo.pdo} objPos={resolvedSourcePdo.objPos} isParentSelected={isSelected} />
      )}
    </>
  );
});

/** Format one message as a tab-separated line for clipboard copy */
function formatMsgForCopy(msg) {
  const ts   = msg.cpd ? formatUsTs(msg.ts) : new Date(msg.ts).toISOString().substring(11, 23);
  const dir  = msg.cpd?.dirName ?? (msg.recordType === 'EVENT' ? 'EVENT' : 'LOG');
  const sop  = msg.cpd?.sopQualName ?? '';
  const rev  = msg.header?.specRevision ?? '';
  const mid  = msg.header?.msgId ?? '';
  const type = msg.recordType === 'ASCII_LOG' ? 'ASCII_LOG'
             : msg.recordType === 'EVENT'     ? (msg.eventName ?? 'EVENT')
             : (msg.header?.typeName ?? '');
  const ndo  = msg.header?.numDataObjects ?? '';
  const body = msg.pdoSummary ?? msg.raw ?? '';
  const raw  = msg.raw ? `DATA:${msg.raw}` : '';
  return [msg.id, ts, dir, sop, rev, mid, type, ndo, body, raw].join('\t');
}

// Estimated row heights for virtualizer size hints
const ROW_H        = 28;  // collapsed message row
const CHILD_ROW_H  = 24;  // PDO / RDO child row

export default function MessageTable() {
  const messages      = useAppStore((s) => s.messages);
  const clearMessages = useAppStore((s) => s.clearMessages);

  const [newestAtBottom, setNewestAtBottom] = useState(true);
  const [showRaw,        setShowRaw]        = useState(false);
  const [userScrolled,   setUserScrolled]   = useState(false);
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [anchorId,       setAnchorId]       = useState(null);
  const [contextMenu,    setContextMenu]    = useState(null);
  // expanded state lifted here so rows survive virtual-scroll unmount
  const [expandedIds,    setExpandedIds]    = useState(new Set());

  const wrapperRef = useRef(null);

  const rows = useMemo(
    () => newestAtBottom ? messages : [...messages].reverse(),
    [messages, newestAtBottom]
  );

  // O(n) forward scan: build a map from Request msg.id → resolved source PDO.
  // Replaces the per-row O(n) backward scan (which was O(n²) total).
  const reqToSrcPdo = useMemo(() => {
    const map = new Map();
    let lastSrcDOs = null;
    for (const msg of messages) {
      const tn = msg.header?.typeName;
      if ((tn === 'Source_Capabilities' || tn === 'EPR_Source_Capabilities') && msg.dataObjects?.length) {
        lastSrcDOs = msg.dataObjects;
      }
      if ((tn === 'Request' || tn === 'EPR_Request') && lastSrcDOs && msg.dataObjects?.[0] != null) {
        const objPos = (msg.dataObjects[0] >>> 28) & 0xF;
        const pdoIdx = objPos - 1;
        if (pdoIdx >= 0 && pdoIdx < lastSrcDOs.length) {
          map.set(msg.id, { pdo: decodePDO(lastSrcDOs[pdoIdx], objPos), objPos });
        }
      }
    }
    return map;
  }, [messages]);

  // Estimate height per row for the virtualizer
  const estimateSize = useCallback((i) => {
    const msg = rows[i];
    if (!msg) return ROW_H;
    if (!expandedIds.has(msg.id)) return ROW_H;
    const childCount   = msg.parsedPayload?.length ?? msg.dataObjects?.length ?? 0;
    const resolvedExtra = reqToSrcPdo.has(msg.id) ? 1 : 0;
    return ROW_H + (childCount + resolvedExtra) * CHILD_ROW_H;
  }, [rows, expandedIds, reqToSrcPdo]);

  const virtualizer = useVirtualizer({
    count:           rows.length,
    getScrollElement: () => wrapperRef.current,
    estimateSize,
    overscan:        20,
  });

  const virtualItems  = virtualizer.getVirtualItems();
  const totalSize     = virtualizer.getTotalSize();
  const paddingTop    = virtualItems.length > 0 ? virtualItems[0].start                               : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  // Toggle a row's expanded state
  const toggleExpanded = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const copySelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const text = rows.filter((m) => selectedIds.has(m.id)).map(formatMsgForCopy).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  }, [selectedIds, rows]);

  const handleRowClick = useCallback((msg, e) => {
    if (e.shiftKey && anchorId != null) {
      const ai = rows.findIndex((r) => r.id === anchorId);
      const ci = rows.findIndex((r) => r.id === msg.id);
      const [lo, hi] = ai <= ci ? [ai, ci] : [ci, ai];
      setSelectedIds(new Set(rows.slice(lo, hi + 1).map((r) => r.id)));
    } else {
      setSelectedIds(new Set([msg.id]));
      setAnchorId(msg.id);
    }
    setContextMenu(null);
  }, [anchorId, rows]);

  const handleRowContextMenu = useCallback((msg, e) => {
    e.preventDefault();
    if (!selectedIds.has(msg.id)) {
      setSelectedIds(new Set([msg.id]));
      setAnchorId(msg.id);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [selectedIds]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedIds.size > 0) copySelected();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, copySelected]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  // Detect when user scrolls away from the bottom
  const handleScroll = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setUserScrolled(!atBottom);
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setUserScrolled(false);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (newestAtBottom && !userScrolled) {
      const el = wrapperRef.current;
      if (el) el.scrollTop = el.scrollHeight;
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
              {paddingTop > 0 && <tr><td colSpan={9} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>}
              {virtualItems.map((vItem) => {
                const msg = rows[vItem.index];
                return (
                  <MessageRow
                    key={msg.id}
                    msg={msg}
                    resolvedSourcePdo={reqToSrcPdo.get(msg.id) ?? null}
                    showRaw={showRaw}
                    isSelected={selectedIds.has(msg.id)}
                    expanded={expandedIds.has(msg.id)}
                    onToggle={() => toggleExpanded(msg.id)}
                    onSelect={(e) => handleRowClick(msg, e)}
                    onContextMenu={(e) => handleRowContextMenu(msg, e)}
                  />
                );
              })}
              {paddingBottom > 0 && <tr><td colSpan={9} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>}
            </tbody>
          </table>
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
        {contextMenu && (
          <div
            className={styles.contextMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={styles.contextMenuItem}
              onClick={() => { copySelected(); setContextMenu(null); }}
            >
              Copy {selectedIds.size} row{selectedIds.size !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
