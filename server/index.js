// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
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
// In a packaged Electron app __dirname is inside an asar (read-only).
// UCPD_USER_DATA is set by electron/main.js to app.getPath('userData')
// BEFORE startServer() is called, so we resolve the path lazily here.
function getLogsDir() {
  return process.env.UCPD_USER_DATA
    ? path.join(process.env.UCPD_USER_DATA, 'logs')
    : path.join(__dirname, '../logs');
}
function getUnknownLogPath() {
  return path.join(getLogsDir(), 'unknown_packets.yaml');
}

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

// ----- CPD record history (ring buffer for live serial replay on browser reload) -----
const MAX_HISTORY = 50000;
const recordHistory = [];  // Array of { hex: string, ts: number }

// ----- File import state (bypasses ring buffer) -----
// Non-null while the last load was a file import (not live serial).
// Cleared when a live serial port opens so serial data takes over.
let importedRecords  = null;  // Array<{hex, ts}> | null
let importedFilename = null;  // string | null

// ----- Session .cpd file save (one timestamped file per session) -----
let sessionFileStream = null;  // current fs.WriteStream
let sessionFilePath   = null;  // current file path

/** Generate a timestamped filename: logs/session_YYYY-MM-DDTHH-MM-SS.cpd */
function makeSessionPath() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = [
    now.getFullYear(),
    '-', pad(now.getMonth() + 1),
    '-', pad(now.getDate()),
    'T', pad(now.getHours()),
    '-', pad(now.getMinutes()),
    '-', pad(now.getSeconds()),
  ].join('');
  return path.join(getLogsDir(), `session_${stamp}.cpd`);
}

/** Detect event type from a raw CPD frame Buffer.
 *  Dir=0x03 (EVENT), SopQual: 0x01=DETACHED, 0x02=ATTACHED */
function cpdEventType(buf) {
  if (buf.length < 14) return null;
  if (buf[7] !== 0x03) return null;  // not an EVENT frame
  if (buf[13] === 0x01) return 'DETACHED';
  if (buf[13] === 0x02) return 'ATTACHED';
  return null;
}

/** Close current session file (if any) and open a new timestamped one. */
function openSessionFile() {
  if (sessionFileStream) {
    try { sessionFileStream.end(); } catch (_) {}
    sessionFileStream = null;
  }
  sessionFilePath   = makeSessionPath();
  sessionFileStream = fs.createWriteStream(sessionFilePath, { flags: 'w' });
  sessionFileStream.on('error', (e) => console.error('[CPD] File write error:', e.message));
  console.log(`[CPD] New session file: ${path.basename(sessionFilePath)}`);
}

/** Close current session and start a new one (called on connect/disconnect/DETACHED). */
function resetSessionFile() {
  openSessionFile();
  console.log('[CPD] Session file rotated');
}

// Open initial session file on startup
openSessionFile();

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
  // Flush history so next session starts clean
  recordHistory.length = 0;
  resetSessionFile();
  broadcastSerialStatus();
}

function connectSerial(portPath, baudRate) {
  if (activePort) disconnectSerial('superseded');

  // Clear import state and flush live ring buffer on every new connection
  importedRecords  = null;
  importedFilename = null;
  recordHistory.length = 0;
  resetSessionFile();

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

    // Each complete CPD record → classify → persist → broadcast
    parser.on('frame', (buf) => {
      const eventType = cpdEventType(buf);

      if (eventType === 'DETACHED') {
        // Flush ring buffer: only keep frames from the next ATTACHED onwards
        recordHistory.length = 0;
        resetSessionFile();
      }

      // Append raw bytes to session .cpd file
      if (sessionFileStream) sessionFileStream.write(buf);

      // Add to ring buffer (after DETACHED flush, so DETACHED frame itself is entry #0)
      const hex = buf.toString('hex').toUpperCase().match(/.{2}/g).join(' ');
      const ts  = Date.now();
      recordHistory.push({ hex, ts });
      if (recordHistory.length > MAX_HISTORY) recordHistory.shift();

      broadcast({ type: 'CPD_RECORD', hex, ts });
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
  // Replay history so reloaded browser pages can rebuild their state.
  // If a file was imported, replay that directly (importedRecords takes priority).
  const replayRecords = importedRecords ?? recordHistory;
  ws.send(JSON.stringify({ type: 'HISTORY', records: replayRecords, filename: importedFilename ?? null }));
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
    const unknownLogPath = getUnknownLogPath();
    fs.appendFileSync(unknownLogPath, yaml, 'utf8');
    console.log(`[Log] Appended ${records.length} unknown-packet record(s) \u2192 ${unknownLogPath}`);
    res.json({ ok: true, appended: records.length, file: unknownLogPath });
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

// ----- Import a .cpd file from the client (POST /api/import-cpd) -----
// Body: raw binary (application/octet-stream)
// Parses raw bytes directly through CpdStreamParser and broadcasts HISTORY.
// The ring buffer (recordHistory) is NOT touched — import data is kept separately
// so live serial history and file-import history never mix.
// NOTE: imported data is NOT written to the session file (it is the source file).
app.post('/api/import-cpd', (req, res) => {
  const filename = req.headers['x-filename'] ?? null;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (!raw.length) return res.status(400).json({ error: 'empty body' });

    // Parse directly — no ring buffer involved, no DETACHED flush
    // Do NOT open a new session file and do NOT write frames to it;
    // the source .cpd already is the file; writing it again would be a duplicate.
    const records = [];
    const parser = new CpdStreamParser();
    parser.on('frame', (buf) => {
      const hex = buf.toString('hex').toUpperCase().match(/.{2}/g).join(' ');
      records.push({ hex, ts: Date.now() });
    });
    parser.write(raw);
    parser.end();

    // Store for browser-reload replay (bypasses ring buffer)
    importedRecords  = records;
    importedFilename = filename;

    console.log(`[Import] Loaded ${importedRecords.length} record(s) from "${filename ?? '(unknown)'}"`);

    // Push directly to all connected clients
    broadcast({ type: 'HISTORY', records: importedRecords, filename: importedFilename });

    res.json({ ok: true, records: importedRecords.length });
  });
  req.on('error', (err) => res.status(500).json({ error: err.message }));
});

// ----- Import a .cpd file by filesystem path (POST /api/import-cpd-by-path) -----
// Body (JSON): { paths: string[] }  — already parsed by express.json() middleware.
// The server reads the files directly and processes them like /api/import-cpd.
// Used by the Electron renderer after dialog.showOpenDialog returns file paths.
// NOTE: imported data is NOT written to the session file (it is the source file).
app.post('/api/import-cpd-by-path', (req, res) => {
  // express.json() has already parsed the body into req.body; do NOT re-read the stream.
  const paths = req.body?.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'no paths provided' });
  }

  // Validate: only allow absolute paths to avoid path traversal
  for (const p of paths) {
    if (!path.isAbsolute(p)) return res.status(400).json({ error: `relative path rejected: ${p}` });
  }

  try {
    const buffers = paths.map((p) => fs.readFileSync(p));
    const raw = Buffer.concat(buffers);
    const filename = paths.map((p) => path.basename(p)).join(', ');

    // Parse directly — do NOT open a new session file and do NOT write frames to it;
    // the source .cpd files are the originals; writing them again would be duplicates.
    const records = [];
    const parser = new CpdStreamParser();
    parser.on('frame', (buf) => {
      const hex = buf.toString('hex').toUpperCase().match(/.{2}/g).join(' ');
      records.push({ hex, ts: Date.now() });
    });
    parser.write(raw);
    parser.end();

    importedRecords  = records;
    importedFilename = filename;

    console.log(`[Import] Loaded ${importedRecords.length} record(s) from "${filename}" (by path)`);
    broadcast({ type: 'HISTORY', records: importedRecords, filename: importedFilename });

    res.json({ ok: true, records: importedRecords.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback: serve React app for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

/**
 * Start the HTTP/WS server.
 * Returns a Promise that resolves with the bound port, or rejects on error.
 * When run directly (node server/index.js) starts immediately.
 * When required by Electron main process, call startServer() explicitly.
 */
function startServer(port) {
  const p = port ?? PORT;
  // Ensure logs/ directory exists (deferred so UCPD_USER_DATA is already set)
  const logsDir = getLogsDir();
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return new Promise((resolve, reject) => {
    server.listen(p, () => {
      console.log(`[Server] Listening on http://localhost:${p}`);
      resolve(p);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Server] Port ${p} already in use — assuming server already running`);
        resolve(p);  // treat as success; Electron will load the existing instance
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Graceful shutdown: disconnect serial port and flush session log file.
 * Called by Electron's before-quit handler.
 */
function shutdown() {
  // Close serial port without opening a new session file
  if (activePort) {
    try { activePort.close(); } catch (_) {}
    activePort   = null;
    activeParser = null;
  }
  serialStatus = { connected: false, port: null, baudRate: null };
  console.log('[Server] Serial disconnected on shutdown');

  // Flush and close session file
  if (sessionFileStream) {
    try { sessionFileStream.end(); } catch (_) {}
    sessionFileStream = null;
    console.log('[Server] Session file flushed on shutdown');
  }
}

// Auto-start when invoked directly via `node server/index.js`
if (require.main === module) {
  startServer();
}

module.exports = { startServer, shutdown };
