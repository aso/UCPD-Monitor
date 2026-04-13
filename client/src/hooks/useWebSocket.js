import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { parseRawFrame, parseCpdFile, isUndecodedMessage, buildUnknownRecord } from '../parsers/pd_parser';

const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? '3001';
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
  const { setWsStatus, setSerialStatus, setSerialPorts, hexDump, addMessage, appendLog, applyFrame, clearMessages, setMessages, replayFrames, setImportStatus } = useAppStore();

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
          if (filename) setImportStatus({ filename });
          appendLog(`[WS] Replaying ${records.length} record(s) from server history…`);
          const allFrames = [];
          const unknowns  = [];
          for (const rec of records) {
            try {
              const bytes = Uint8Array.from(rec.hex.split(' ').map((b) => parseInt(b, 16)));
              const { frames } = parseCpdFile(bytes.buffer);
              for (const frame of frames) {
                allFrames.push(frame);
                if (isUndecodedMessage(frame.header)) {
                  unknowns.push(buildUnknownRecord(frame, 'serial'));
                }
              }
            } catch { /* skip malformed record */ }
          }
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

        default:
          appendLog(`[WS] Unknown type: ${payload.type}`);
      }
    },
    [addMessage, appendLog, applyFrame, setSerialStatus, setSerialPorts, hexDump, clearMessages, setMessages, replayFrames]
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
