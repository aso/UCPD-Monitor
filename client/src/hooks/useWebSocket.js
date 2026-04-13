import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { parseRawFrame, isUndecodedMessage, buildUnknownRecord } from '../parsers/pd_parser';

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
  const { setWsStatus, addMessage, appendLog, applyFrame } = useAppStore();

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

        default:
          appendLog(`[WS] Unknown type: ${payload.type}`);
      }
    },
    [addMessage, appendLog, applyFrame]
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

  return { sendPing };
}
