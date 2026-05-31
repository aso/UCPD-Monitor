// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { parseRawFrame, parseCpdFile, isUndecodedMessage, buildUnknownRecord } from '../parsers/pd_parser';

const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? '3001';

// Pattern for the auto-injected ATTACHED timestamp: "YYYY-MM-DD HH:MM:SS"
const TS_ANCHOR_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Parse "YYYY-MM-DD HH:MM:SS" as local time → epoch ms */
function parseLocalTimeStr(s) {
  const [date, time] = s.split(' ');
  const [y, mo, d]  = date.split('-').map(Number);
  const [h, m, sec] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m, sec).getTime();
}

/**
 * Scan a frame array for the last ATTACHED event + its immediately following
 * auto-injected timestamp NOTE: packet, and return an anchor object or null.
 */
function findTsAnchor(frames) {
  let pendingAttachedTick = null;
  let anchor = null;
  for (const f of frames) {
    if (f.recordType === 'CAD_EVENT' && f.eventName === 'ATTACHED') {
      pendingAttachedTick = f.ts;
    } else if (pendingAttachedTick !== null && f.recordType === 'ASCII_LOG' && typeof f.asciiLog === 'string') {
      const noteText = f.asciiLog.startsWith('NOTE:') ? f.asciiLog.slice(5) : null;
      if (noteText && TS_ANCHOR_PATTERN.test(noteText)) {
        const wallMs = parseLocalTimeStr(noteText);
        if (!isNaN(wallMs)) anchor = { attachedTick: pendingAttachedTick, wallMs };
      }
      pendingAttachedTick = null; // consumed (matched or not)
    }
  }
  return anchor;
}
const WS_URL  = `ws://${window.location.hostname}:${SERVER_PORT}`;
const LOG_URL = `http://${window.location.hostname}:${SERVER_PORT}/api/log-unknown`;
const RECONNECT_DELAY_MS = 3000;

/** Fire-and-forget POST of unknown packet records to the server log. */
function logUnknownRecords(records) {
  if (!records.length) return;
  fetch(LOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  }).catch(() => { /* non-critical – silently discard */ });
}

/**
 * Custom hook that manages the WebSocket connection to the local server.
 * Dispatches decoded PD frames into the Zustand store.
 */
export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const { setWsStatus, setSerialStatus, setSerialPorts, hexDump, addMessage, appendLog, applyFrame, clearMessages, setMessages, replayFrames, setImportStatus, setReplayNote, clearReplayNote, setTsAnchor, addMeasureSample, setMeasureRunning } = useAppStore();
  // Tracks the firmware tick of the most recent ATTACHED event seen in live stream
  const pendingAttachedTickRef = useRef(null);
  // tPSSourceOn timer: Accept seen from SRC — expect PS_RDY within 480 ms (§8.3.3.2.5)
  const acceptTimerRef = useRef(null);

  const handleMessage = useCallback(
    (evt) => {
      let payload;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        appendLog(`[WS] Non-JSON: ${evt.data}`);
        return;
      }

      switch (payload.type) {
        case 'WELCOME':
          appendLog(`[WS] Server v${payload.version} connected`);
          break;

        case 'HISTORY': {
          // Sent by server on every (re)connect — rebuilds messages + topology from ring buffer
          const records  = payload.records ?? [];
          const filename = payload.filename ?? null;
          if (filename) {
            // File import: flush any live messages before loading imported data
            clearMessages();
            clearReplayNote();
            setImportStatus({ filename });
          }
          appendLog(`[WS] Replaying ${records.length} record(s) from server history…`);
          const allFrames = [];
          const unknowns  = [];
          let firstNote   = null;
          for (const rec of records) {
            try {
              const bytes = Uint8Array.from(rec.hex.split(' ').map((b) => parseInt(b, 16)));
              const { frames } = parseCpdFile(bytes.buffer);
              for (const frame of frames) {
                allFrames.push(frame);
                if (frame.recordType === 'ASCII_LOG' && typeof frame.asciiLog === 'string' && frame.asciiLog.startsWith('NOTE:')) {
                  const noteText = frame.asciiLog.slice(5);
                  // Only inherit user-authored memos (not auto-injected timestamps)
                  if (!TS_ANCHOR_PATTERN.test(noteText) && firstNote === null) {
                    firstNote = noteText;
                  }
                }
                if (isUndecodedMessage(frame.header)) {
                  unknowns.push(buildUnknownRecord(frame, 'serial'));
                }
              }
            } catch { /* skip malformed record */ }
          }
          if (firstNote !== null) setReplayNote(firstNote);
          setTsAnchor(findTsAnchor(allFrames));
          setMessages(allFrames);
          replayFrames(allFrames);
          if (unknowns.length) logUnknownRecords(unknowns);
          break;
        }

        case 'PONG':
          // heartbeat ack – silently ignore
          break;

        case 'RAW_FRAME': {
          const decoded = parseRawFrame(payload.raw, payload.source);
          if (decoded) {
            addMessage(decoded);
            applyFrame(decoded);
            if (decoded.parseViolations?.length) {
              const id = decoded.header?.typeName ?? 'frame';
              for (const v of decoded.parseViolations) {
                appendLog(`[ERROR] [Parser] ${id}: ${v}`);
              }
            }
            if (isUndecodedMessage(decoded.header)) {
              logUnknownRecords([buildUnknownRecord(decoded, 'websocket')]);
            }
          } else {
            appendLog(`[Parser] Failed to decode frame: ${payload.raw}`);
          }
          break;
        }

        case 'CPD_RECORD': {
          // payload.hex: space-separated uppercase hex string of one raw CPD record
          if (hexDump) appendLog(`[HEX] ${payload.hex}`);
          try {
            const bytes = Uint8Array.from(
              payload.hex.split(' ').map((b) => parseInt(b, 16))
            );
            const { frames } = parseCpdFile(bytes.buffer);
            const unknowns = [];
            for (const frame of frames) {
              addMessage(frame);
              applyFrame(frame);
              // ── Accept→PS_RDY timeout (tPSSourceOn = 480 ms, §8.3.3.2.5) ──────────
              // Only for live SOP Accept from Source; clear on PS_RDY / Reject / reset.
              {
                const tn  = frame.header?.typeName;
                const dir = frame.cpd?.dir;  // 0x07=SRC→SNK, 0x08=SNK→SRC
                const sop = frame.cpd?.sopQualName;
                // dir 0x07=TRACE_SRC(SPY) | 0x01=MSG_IN(SNK mode) → message from SRC
                if (tn === 'Accept' && (dir === 0x07 || dir === 0x01) && sop === 'SOP') {
                  if (acceptTimerRef.current) clearTimeout(acceptTimerRef.current);
                  acceptTimerRef.current = setTimeout(() => {
                    acceptTimerRef.current = null;
                    appendLog('[WARN] tPSSourceOn: PS_RDY not received within 480 ms after Accept — §8.3.3.2.5 violation');
                  }, 480);
                } else if (
                  (tn === 'PS_RDY' && (dir === 0x07 || dir === 0x01)) ||
                  tn === 'Reject' || tn === 'Wait' || tn === 'Hard_Reset' ||
                  (frame.recordType === 'CAD_EVENT' && frame.eventName === 'DETACHED')
                ) {
                  if (acceptTimerRef.current) {
                    clearTimeout(acceptTimerRef.current);
                    acceptTimerRef.current = null;
                  }
                }
              }
              // ─────────────────────────────────────────────────────────────────────────
              if (frame.recordType === 'CAD_EVENT' && frame.eventName === 'ATTACHED') {
                pendingAttachedTickRef.current = frame.ts;
              }
              if (frame.recordType === 'ASCII_LOG' && typeof frame.asciiLog === 'string' && frame.asciiLog.startsWith('NOTE:')) {
                const noteText = frame.asciiLog.slice(5);
                if (pendingAttachedTickRef.current !== null && TS_ANCHOR_PATTERN.test(noteText)) {
                  // Auto-injected timestamp: update tsAnchor only, do NOT overwrite user memo
                  const wallMs = parseLocalTimeStr(noteText);
                  if (!isNaN(wallMs)) setTsAnchor({ attachedTick: pendingAttachedTickRef.current, wallMs });
                } else if (!TS_ANCHOR_PATTERN.test(noteText)) {
                  // User-authored memo: update replayNote
                  setReplayNote(noteText);
                }
                pendingAttachedTickRef.current = null;
              }
              if (frame.parseViolations?.length) {
                const id = frame.header?.typeName ?? 'frame';
                for (const v of frame.parseViolations) {
                  appendLog(`[ERROR] [Parser] ${id}: ${v}`);
                }
              }
              if (isUndecodedMessage(frame.header)) {
                unknowns.push(buildUnknownRecord(frame, 'serial'));
              }
            }
            if (unknowns.length) logUnknownRecords(unknowns);
          } catch (e) {
            appendLog(`[Serial] CPD_RECORD parse error: ${e.message}`);
          }
          break;
        }

        case 'SERIAL_STATUS':
          setSerialStatus({
            connected: !!payload.connected,
            port:      payload.port ?? null,
            baudRate:  payload.baudRate ?? null,
            error:     payload.error ?? null,
          });
          if (payload.error) appendLog(`[Serial] Error: ${payload.error}`);
          else if (payload.connected) appendLog(`[Serial] Connected: ${payload.port} @ ${payload.baudRate}`);
          else appendLog('[Serial] Disconnected');
          break;

        case 'PORT_LIST':
          setSerialPorts(Array.isArray(payload.ports) ? payload.ports : []);
          break;

        case 'MEASURE_SAMPLE':
          addMeasureSample({
            ts:           payload.ts,
            outerTag:     payload.outerTag,
            raw:          payload.raw,
            firmwareTick: payload.firmwareTick ?? null,
            vbusMv:       payload.vbusMv       ?? null,
            ibusMa:       payload.ibusMa       ?? null,
          });
          break;

        case 'MEASURE_RUNNING':
          setMeasureRunning(!!payload.running);
          break;

        default:
          appendLog(`[WS] Unknown type: ${payload.type}`);
      }
    },
    [addMessage, appendLog, applyFrame, setSerialStatus, setSerialPorts, hexDump, clearMessages, setMessages, replayFrames, setTsAnchor, setReplayNote, clearReplayNote, addMeasureSample, setMeasureRunning]
  );

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState < 2) return; // already open/connecting

    setWsStatus('connecting');
    appendLog(`[WS] Connecting to ${WS_URL}…`);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      appendLog('[WS] Connection established');
      // Request current port list immediately on (re)connect
      ws.send(JSON.stringify({ type: 'GET_PORT_LIST' }));
    };

    ws.onmessage = handleMessage;

    ws.onerror = (err) => {
      appendLog(`[WS] Error: ${err.type}`);
      setWsStatus('error');
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      appendLog(`[WS] Disconnected. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s…`);
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }, [handleMessage, setWsStatus, appendLog]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (acceptTimerRef.current) clearTimeout(acceptTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendPing = useCallback(() => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'PING' }));
    }
  }, []);

  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { sendPing, sendMessage };
}
