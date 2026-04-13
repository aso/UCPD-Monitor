'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { CpdStreamParser } = require('./cpdStreamParser');

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

// ----- Serial port state -----
let activePort   = null;   // SerialPort instance
let activeParser = null;   // CpdStreamParser instance
let serialStatus = { connected: false, port: null, baudRate: null };

// ----- Port list hotplug polling -----
let _lastPortsKey = '';   // JSON fingerprint of last port list
let _cachedPorts  = [];   // last known port list

async function pollPorts() {
  let list;
  try {
    list = await SerialPort.list();
  } catch {
    list = [];
  }
  // Fingerprint: sorted paths joined
  const key = list.map((p) => p.path).sort().join(',');
  if (key !== _lastPortsKey) {
    _lastPortsKey = key;
    _cachedPorts  = list;
    console.log(`[Ports] List changed: [${key || 'none'}]`);
    broadcast({ type: 'PORT_LIST', ports: list });
    // If the active port was removed, disconnect
    if (serialStatus.connected && !list.some((p) => p.path === serialStatus.port)) {
      console.warn(`[Serial] Active port ${serialStatus.port} disappeared — disconnecting`);
      disconnectSerial('port removed');
    }
  }
}

const PORT_POLL_INTERVAL_MS = 2000;
setInterval(pollPorts, PORT_POLL_INTERVAL_MS);
pollPorts(); // immediate first scan

// ----- Serial port helpers -----
function broadcastSerialStatus() {
  broadcast({ type: 'SERIAL_STATUS', ...serialStatus });
}

function disconnectSerial(reason) {
  if (activePort) {
    try { activePort.close(); } catch (_) { /* ignore */ }
    activePort   = null;
    activeParser = null;
  }
  serialStatus = { connected: false, port: null, baudRate: null };
  console.log(`[Serial] Disconnected${reason ? ` (${reason})` : ''}`);
  broadcastSerialStatus();
}

function connectSerial(portPath, baudRate) {
  if (activePort) disconnectSerial('superseded');

  const sp = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  const parser = new CpdStreamParser();

  sp.open((err) => {
    if (err) {
      console.error(`[Serial] Failed to open ${portPath}: ${err.message}`);
      broadcast({ type: 'SERIAL_STATUS', connected: false, port: portPath, baudRate, error: err.message });
      return;
    }

    activePort   = sp;
    activeParser = parser;
    serialStatus = { connected: true, port: portPath, baudRate };
    console.log(`[Serial] Opened ${portPath} @ ${baudRate} baud`);

    // Assert DTR — required for STM32CubeMonitor-UCPD firmware to start the CPD stream.
    // Without DTR the firmware sends a different response (not CPD sync FD FD FD FD).
    sp.set({ dtr: true }, (dtrErr) => {
      if (dtrErr) console.warn(`[Serial] DTR assert failed: ${dtrErr.message}`);
      else        console.log('[Serial] DTR asserted → firmware should start CPD stream');
    });

    broadcastSerialStatus();

    sp.pipe(parser);

    // Each complete CPD record → hex string → broadcast to all WS clients
    parser.on('frame', (buf) => {
      const hex = buf.toString('hex').toUpperCase().match(/.{2}/g).join(' ');
      broadcast({ type: 'CPD_RECORD', hex, ts: Date.now() });
    });

    sp.on('error', (e) => {
      console.error(`[Serial] Error on ${portPath}: ${e.message}`);
      disconnectSerial('error');
    });

    sp.on('close', () => {
      if (serialStatus.connected) disconnectSerial('closed');
    });
  });
}

// ----- Static files (production build of React client) -----
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

      case 'GET_SERIAL_STATUS':
        ws.send(JSON.stringify({ type: 'SERIAL_STATUS', ...serialStatus }));
        break;

      case 'GET_PORT_LIST':
        ws.send(JSON.stringify({ type: 'PORT_LIST', ports: _cachedPorts }));
        break;

      case 'SERIAL_CONNECT': {
        const { port: portPath, baudRate = 115200 } = parsed;  // baud rate is a dummy for USB-CDC
        if (!portPath) {
          ws.send(JSON.stringify({ type: 'SERIAL_STATUS', connected: false, error: 'port is required' }));
          break;
        }
        connectSerial(portPath, baudRate);
        break;
      }

      case 'SERIAL_DISCONNECT':
        disconnectSerial('user request');
        break;

      default:
        console.warn(`[WS] Unknown message type: ${parsed.type}`);
    }
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
  ws.on('error', (err) => console.error('[WS] Error:', err.message));

  // Send initial handshake + current state
  ws.send(JSON.stringify({ type: 'WELCOME', ts: Date.now(), version: '1.0.0' }));
  ws.send(JSON.stringify({ type: 'SERIAL_STATUS', ...serialStatus }));
  ws.send(JSON.stringify({ type: 'PORT_LIST', ports: _cachedPorts }));
});

// ----- REST API -----
app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', clients: wss.clients.size });
});

// List available serial ports
app.get('/api/serial/ports', async (_req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json(ports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
