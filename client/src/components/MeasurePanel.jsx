// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import styles from './MeasurePanel.module.css';

const useSerialConnected = () => useAppStore((s) => s.serialStatus.connected);

/** Format epoch ms → HH:MM:SS.mmm (local time) */
function fmtTs(ms) {
  const d = new Date(ms);
  const pad2 = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

/** Format mV → "15.000 V" */
function fmtV(mv) {
  if (mv == null) return '—';
  return `${(mv / 1000).toFixed(3)} V`;
}

/** Format mA → "1500 mA" */
function fmtA(ma) {
  if (ma == null) return '—';
  return `${ma} mA`;
}

/**
 * MeasurePanel — displays periodic VBUS/IBUS measurement stream from DISCO.
 *
 * Protocol: outer TLV tag=0x2C contains nested inner TLVs:
 *   0x13 (GUI_IND_TIMESTAMP)  → LE uint32 firmware tick
 *   0x0C (GUI_IND_VBUS_LEVEL + GUI_IND_IBUS_LEVEL packed)
 *             bytes[0-1]: VBUS in mV (LE uint16)
 *             bytes[2-3]: IBUS in mA (LE uint16)
 *
 * Props:
 *   sendMessage(obj)  — WebSocket send function from useWebSocket()
 */
export default function MeasurePanel({ sendMessage }) {
  const samples         = useAppStore((s) => s.measureSamples);
  const running         = useAppStore((s) => s.measureRunning);
  const serialConnected = useSerialConnected();
  const clearSamples    = useAppStore((s) => s.clearMeasureSamples);

  // Latest reading for the live readout strip
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;

  const handleStart = useCallback(() => {
    sendMessage({ type: 'MEASURE_START' });
  }, [sendMessage]);

  const handleStop = useCallback(() => {
    sendMessage({ type: 'MEASURE_STOP' });
  }, [sendMessage]);

  return (
    <div className={styles.panel}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.title}>ADC Stream (0x2C)</span>
        <span className={`${styles.dot} ${running ? styles.dotActive : styles.dotIdle}`} title={running ? 'Streaming' : 'Stopped'} />
        <button
          className={styles.btnStart}
          onClick={handleStart}
          disabled={!serialConnected || running}
          title="Send MEASURE_START command to DISCO"
        >▶ Start</button>
        <button
          className={styles.btnStop}
          onClick={handleStop}
          disabled={!serialConnected || !running}
          title="Send MEASURE_STOP command to DISCO"
        >■ Stop</button>
        <button
          className={styles.btnClear}
          onClick={clearSamples}
          title="Clear sample buffer"
        >Clear</button>
        <span className={styles.count}>{samples.length} samples</span>

        {/* Live readout */}
        {latest && (
          <span className={styles.liveReadout}>
            <span className={styles.liveVbus}>{fmtV(latest.vbusMv)}</span>
            <span className={styles.liveSep}>/</span>
            <span className={styles.liveIbus}>{fmtA(latest.ibusMa)}</span>
          </span>
        )}
      </div>

      {/* Sample table */}
      {samples.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thTs}>Time</th>
                <th className={styles.thVal}>VBUS</th>
                <th className={styles.thVal}>IBUS</th>
                <th className={styles.thTick}>FW Tick</th>
                <th className={styles.thHex}>Raw (hex)</th>
              </tr>
            </thead>
            <tbody>
              {samples.slice().reverse().map((s, idx) => (
                <tr key={idx} className={styles.row}>
                  <td className={styles.tdTs}>{fmtTs(s.ts)}</td>
                  <td className={styles.tdVbus}>{fmtV(s.vbusMv)}</td>
                  <td className={styles.tdIbus}>{fmtA(s.ibusMa)}</td>
                  <td className={styles.tdTick}>{s.firmwareTick ?? '—'}</td>
                  <td className={styles.tdHex}>{s.raw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {samples.length === 0 && (
        <div className={styles.empty}>
          {serialConnected
            ? 'Press ▶ Start to begin measurement streaming.'
            : 'Connect to DISCO board first.'}
        </div>
      )}
    </div>
  );
}
