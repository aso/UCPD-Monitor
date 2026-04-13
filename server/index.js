'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3001;

// YAML log file for undecoded / unknown packets
const LOGS_DIR        = path.join(__dirname, '../logs');
const UNKNOWN_LOG_PATH = path.join(LOGS_DIR, 'unknown_packets.yaml');

// Ensure logs/ directory exists
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

/**
 * Serialise one unknown-packet record to a YAML document block.
 * Uses block-scalar style for raw_hex and a simple sequence for data_objects.
 * No external YAML library required.
 *
 * @param {object} rec
 * @param {string} capturedAt  ISO-8601 timestamp string (server wall-clock)
 * @returns {string}
 */
function recordToYaml(rec, capturedAt) {
  const esc = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = ['---'];
  lines.push(`captured_at: ${esc(capturedAt)}`);
  lines.push(`context: ${esc(rec.context ?? '')}`);
  lines.push(`ts_raw: ${esc(rec.ts_raw ?? 0)}`);
  lines.push(`source: ${esc(rec.source ?? '')}`);
  lines.push(`direction: ${esc(rec.direction ?? '')}`);
  lines.push(`sop: ${esc(rec.sop ?? 'SOP')}`);
  lines.push(`spec_revision: ${esc(rec.spec_revision ?? '')}`);
  lines.push(`msg_id: ${Number(rec.msg_id ?? 0)}`);
  lines.push(`type_name: ${esc(rec.type_name ?? '')}`);
  lines.push(`is_extended: ${!!rec.is_extended}`);
  lines.push(`is_control: ${!!rec.is_control}`);
  lines.push(`num_data_objects: ${Number(rec.num_data_objects ?? 0)}`);
  lines.push(`raw_hex: ${esc(rec.raw_hex ?? '')}`);
  const dos = Array.isArray(rec.data_objects) ? rec.data_objects : [];
  if (dos.length > 0) {
    lines.push('data_objects:');
    dos.forEach((dw) => lines.push(`  - ${esc(dw)}`));
  } else {
    lines.push('data_objects: []');
  }
  lines.push(''); // trailing newline between documents
  return lines.join('\n');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Static files (production build of React client)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use(express.json());

// ----- WebSocket broadcast helper -----
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  });
}

// ----- WebSocket connection handler -----
wss.on('connection', (ws, req) => {
  console.log(`[WS] Client connected: ${req.socket.remoteAddress}`);

  ws.on('message', (rawMsg) => {
    let parsed;
    try {
      parsed = JSON.parse(rawMsg.toString());
    } catch {
      console.warn('[WS] Non-JSON message received, ignoring.');
      return;
    }

    // Route commands from the browser client
    switch (parsed.type) {
      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG', ts: Date.now() }));
        break;

      // Future: handle CONNECT_SERIAL, DISCONNECT_SERIAL, etc.
      default:
        console.warn(`[WS] Unknown message type: ${parsed.type}`);
    }
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
  ws.on('error', (err) => console.error('[WS] Error:', err.message));

  // Send initial handshake
  ws.send(JSON.stringify({ type: 'WELCOME', ts: Date.now(), version: '1.0.0' }));
});

// ----- REST API -----
app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', clients: wss.clients.size });
});

// ----- Log undecoded / unknown packets (POST /api/log-unknown) -----
// Body: { records: Array<UnknownRecord> }
// Each record is appended as a YAML document to logs/unknown_packets.yaml.
app.post('/api/log-unknown', (req, res) => {
  const records = req.body?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: '`records` array is required and must not be empty' });
  }
  const capturedAt = new Date().toISOString();
  try {
    const yaml = records.map((r) => recordToYaml(r, capturedAt)).join('\n');
    fs.appendFileSync(UNKNOWN_LOG_PATH, yaml, 'utf8');
    console.log(`[Log] Appended ${records.length} unknown-packet record(s) → ${UNKNOWN_LOG_PATH}`);
    res.json({ ok: true, appended: records.length, file: UNKNOWN_LOG_PATH });
  } catch (err) {
    console.error('[Log] Failed to write unknown_packets.yaml:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----- Inject sniffer data (for testing / future serial bridge) -----
// POST /api/ingest  { raw: "hex string", source: "STM32"|"KM003C" }
app.post('/api/ingest', (req, res) => {
  const { raw, source } = req.body;
  if (!raw || !source) {
    return res.status(400).json({ error: 'raw and source are required' });
  }
  broadcast({ type: 'RAW_FRAME', raw, source, ts: Date.now() });
  res.json({ ok: true });
});

// Fallback: serve React app for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
