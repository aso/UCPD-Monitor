// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useCallback, useEffect, useRef } from 'react';
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

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
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
  const monitor         = useAppStore((s) => s.measureMonitor);
  const discoMode       = useAppStore((s) => s.topology.discoMode);
  const measureScale    = useAppStore((s) => s.topology.measureScale);
  const serialConnected = useSerialConnected();
  const clearSamples    = useAppStore((s) => s.clearMeasureSamples);
  const setMeasureMonitor = useAppStore((s) => s.setMeasureMonitor);
  const setMeasureRunning = useAppStore((s) => s.setMeasureRunning);
  const appendLog        = useAppStore((s) => s.appendLog);

  // Latest reading for the live readout strip
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const recent = samples.slice(-30);

  const vbusNow = latest?.vbusMv ?? null;
  const ibusNow = latest?.ibusMa ?? null;

  const maxVbusMv = measureScale?.maxVbusMv ?? 24000;
  const maxIbusMa = measureScale?.maxIbusMa ?? 5000;

  const vbusRatio = clamp01((vbusNow ?? 0) / maxVbusMv);
  const ibusRatio = clamp01((ibusNow ?? 0) / maxIbusMa);

  const vbusRecentMax = recent.length > 0 ? Math.max(...recent.map((s) => s.vbusMv ?? 0)) : null;
  const vbusRecentMin = recent.length > 0 ? Math.min(...recent.map((s) => s.vbusMv ?? 0)) : null;
  const ibusRecentMax = recent.length > 0 ? Math.max(...recent.map((s) => s.ibusMa ?? 0)) : null;
  const ibusRecentMin = recent.length > 0 ? Math.min(...recent.map((s) => s.ibusMa ?? 0)) : null;

  const vbusScaleMinMv = 0;
  const ibusScaleMinMa = 0;
  const isMeterActive = running && monitor.phase === 'streaming';

  const ackTimerRef = useRef(null);
  const sampleTimerRef = useRef(null);
  const spyWarnedRef = useRef(false);
  const isSpyMode = discoMode === 'SPY';

  const handleStart = useCallback(() => {
    if (isSpyMode) {
      appendLog('[Measure] Disabled in SPY mode (firmware only streams measurement in SNK mode)');
      setMeasureMonitor({ phase: 'idle', lastError: null });
      return;
    }
    const now = Date.now();
    setMeasureMonitor({
      phase: 'awaiting-ack',
      command: 'start',
      lastCommandAt: now,
      lastError: null,
    });
    appendLog('[Measure] Start command sent — waiting for FW ACK');
    sendMessage({ type: 'MEASURE_START' });
  }, [appendLog, isSpyMode, sendMessage, setMeasureMonitor]);

  const handleStop = useCallback(() => {
    const now = Date.now();
    setMeasureMonitor({
      phase: 'awaiting-ack',
      command: 'stop',
      lastCommandAt: now,
      lastError: null,
    });
    appendLog('[Measure] Stop command sent — waiting for FW ACK');
    sendMessage({ type: 'MEASURE_STOP' });
  }, [appendLog, sendMessage, setMeasureMonitor]);

  useEffect(() => {
    if (isSpyMode) {
      if (!spyWarnedRef.current) {
        appendLog('[Measure] SPY mode detected: periodic ADC measurement is not available');
        spyWarnedRef.current = true;
      }
      if (running) setMeasureRunning(false);
      setMeasureMonitor({ phase: 'idle', lastError: null });
      if (ackTimerRef.current) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
      if (sampleTimerRef.current) {
        clearTimeout(sampleTimerRef.current);
        sampleTimerRef.current = null;
      }
      return undefined;
    }

    spyWarnedRef.current = false;

    if (ackTimerRef.current) {
      clearTimeout(ackTimerRef.current);
      ackTimerRef.current = null;
    }
    if (sampleTimerRef.current) {
      clearTimeout(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }

    if (monitor.phase === 'awaiting-ack') {
      ackTimerRef.current = setTimeout(() => {
        appendLog('[WARN] Measure ACK timeout — FW did not acknowledge the command');
        setMeasureMonitor({ phase: 'error', lastError: 'ACK timeout' });
      }, 1500);
    } else if (monitor.phase === 'awaiting-sample') {
      sampleTimerRef.current = setTimeout(() => {
        appendLog('[WARN] Measure sample timeout — FW ACK received but no sample stream detected');
        setMeasureMonitor({ phase: 'error', lastError: 'sample timeout' });
      }, 2000);
    }

    return () => {
      if (ackTimerRef.current) clearTimeout(ackTimerRef.current);
      if (sampleTimerRef.current) clearTimeout(sampleTimerRef.current);
    };
  }, [appendLog, isSpyMode, monitor.phase, running, setMeasureMonitor, setMeasureRunning]);

  const statusText = (() => {
    if (isSpyMode) return 'SPYモード: 測定非対応';
    switch (monitor.phase) {
      case 'awaiting-ack': return '送信済み / ACK待ち';
      case 'awaiting-sample': return 'ACK受信 / サンプル待ち';
      case 'streaming': return '送受信OK / 連続受信中';
      case 'error': return `異常: ${monitor.lastError ?? 'unknown'}`;
      default: return serialConnected ? '待機中' : '未接続';
    }
  })();

  return (
    <div className={styles.panel}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.title}>ADC Stream (0x2C)</span>
        <span className={`${styles.dot} ${running ? styles.dotActive : styles.dotIdle}`} title={running ? 'Streaming' : 'Stopped'} />
        <span className={styles.count} title="Measurement link status">{statusText}</span>
        <button
          className={styles.btnStart}
          onClick={handleStart}
          disabled={!serialConnected || running || isSpyMode}
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
      {samples.length > 0 && latest && (
        <div className={styles.meterWrap}>
          <div className={styles.meterGrid}>
            <section className={`${styles.meterCard} ${!isMeterActive ? styles.meterCardInactive : ''}`}>
              <div className={styles.meterHead}>
                <span className={styles.meterLabel}>VBUS</span>
                <span className={styles.meterPercent}>{(vbusRatio * 100).toFixed(1)}%</span>
              </div>
              <div className={styles.meterValueV}>{fmtV(vbusNow)}</div>
              <div className={`${styles.meterTrack} ${!isMeterActive ? styles.meterTrackInactive : ''}`}>
                <div
                  className={isMeterActive ? styles.meterFillV : styles.meterFillVInactive}
                  style={{ width: `${(vbusRatio * 100).toFixed(1)}%` }}
                />
              </div>
              <div className={styles.meterRange}>
                <span>{fmtV(vbusScaleMinMv)}</span>
                <span>{fmtV(maxVbusMv)}</span>
              </div>
            </section>

            <section className={`${styles.meterCard} ${!isMeterActive ? styles.meterCardInactive : ''}`}>
              <div className={styles.meterHead}>
                <span className={styles.meterLabel}>IBUS</span>
                <span className={styles.meterPercent}>{(ibusRatio * 100).toFixed(1)}%</span>
              </div>
              <div className={styles.meterValueI}>{fmtA(ibusNow)}</div>
              <div className={`${styles.meterTrack} ${!isMeterActive ? styles.meterTrackInactive : ''}`}>
                <div
                  className={isMeterActive ? styles.meterFillI : styles.meterFillIInactive}
                  style={{ width: `${(ibusRatio * 100).toFixed(1)}%` }}
                />
              </div>
              <div className={styles.meterRange}>
                <span>{fmtA(ibusScaleMinMa)}</span>
                <span>{fmtA(maxIbusMa)}</span>
              </div>
            </section>
          </div>

          <div className={styles.metaRow}>
            <span>
              FW Tick: {latest.firmwareTick ?? '—'}
              {recent.length > 0 && (
                <>
                  {' '}| Observed VBUS min/max: {fmtV(vbusRecentMin)} / {fmtV(vbusRecentMax)}
                  {' '}| Observed IBUS min/max: {fmtA(ibusRecentMin)} / {fmtA(ibusRecentMax)}
                </>
              )}
            </span>
            <span>Last Update: {fmtTs(latest.ts)}</span>
          </div>
        </div>
      )}

      {samples.length === 0 && (
        <div className={styles.empty}>
          {serialConnected
            ? (isSpyMode
                ? 'SPY mode does not provide periodic measurement stream. Switch to SNK mode.'
                : 'Press ▶ Start to begin measurement streaming.')
            : 'Connect to DISCO board first.'}
        </div>
      )}
    </div>
  );
}
