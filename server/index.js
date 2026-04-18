// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
'use strict';

const express = require('express');
const http = require('http');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { CpdStreamParser } = require('./cpdStreamParser');

/**
 * Return the process name owning the given TCP LISTEN port, or null if
 * it cannot be determined.  No network I/O is performed — OS-level only.
 * Supported on Windows (netstat+tasklist) and Linux/macOS (lsof).
 *
 * @param {number} port
 * @returns {string|null}  e.g. "node.exe", "node", "python.exe", null
 */
function getPortOwnerProcessName(port) {
  try {
    if (process.platform === 'win32') {
      // netstat -ano lists TCP listeners with their PID
      const netstat = execSync('netstat -ano', { timeout: 3000 }).toString();
      const re = new RegExp(`TCP\\s+[^:]+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
      const m = netstat.match(re);
      if (!m) return null;
      const pid = m[1];
      const tasklist = execSync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
        { timeout: 3000 }
      ).toString().trim();
      if (!tasklist) return null;
      // CSV first field is the image name: "node.exe","12345",...
      return tasklist.split(',')[0].replace(/"/g, '').trim() || null;
    } else {
      // lsof -Fp gives lines like "p12345" then "cnode"
      const out = execSync(
        `lsof -i :${port} -sTCP:LISTEN -Fp -Fc`,
        { timeout: 3000 }
      ).toString();
      const cm = out.match(/^c(.+)$/m);
      return cm ? cm[1].trim() : null;
    }
  } catch {
    return null;  // OS command failed or permission denied — treat as unknown
  }
}

const PORT = parseInt(process.env.UCPD_PORT ?? '57321', 10);

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

// ── Security: WebSocket Origin validation ──────────────────────────────────
// Reject WS upgrades whose Origin is not localhost/127.0.0.1.
// This blocks DNS-Rebinding attacks via the WebSocket channel.
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin, req }, cb) => {
    // Electron renderer sends no Origin header — allow it.
    if (!origin) return cb(true);
    try {
      const u = new URL(origin);
      const ok = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (!ok) console.warn(`[WS] Rejected connection from origin: ${origin}`);
      cb(ok, 403, 'Forbidden');
    } catch {
      cb(false, 403, 'Forbidden');
    }
  },
});

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

/** Close the current session file stream. If the file is 0 bytes, delete it. */
function closeSessionFile() {
  if (!sessionFileStream) return;
  const closingPath = sessionFilePath;
  try { sessionFileStream.end(); } catch (_) {}
  sessionFileStream = null;
  // Delete empty files (no frames were written)
  if (closingPath) {
    try {
      const stat = fs.statSync(closingPath);
      if (stat.size === 0) {
        fs.unlinkSync(closingPath);
        console.log(`[CPD] Removed empty session file: ${path.basename(closingPath)}`);
      }
    } catch (_) {}
  }
}

/** Close current session file (if any) and open a new timestamped one. */
function openSessionFile() {
  closeSessionFile();
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

// ── Security: Host header validation (DNS-Rebinding protection) ───────────
// Allow only localhost / 127.0.0.1 as the HTTP Host header value.
// This prevents a malicious webpage from using DNS rebinding to reach the API.
app.use((req, res, next) => {
  const host = (req.headers['host'] ?? '').split(':')[0].toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '') return next();
  console.warn(`[Security] Rejected request with Host: ${req.headers['host']} ${req.method} ${req.path}`);
  res.status(403).json({ error: 'Forbidden: invalid Host header' });
});

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
// Unique fingerprint identifying this application.
// Must match the value checked in startServer()'s EADDRINUSE probe.
const APP_ID = 'ucpd-monitor-server';

app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok', appId: APP_ID, clients: wss.clients.size });
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

// ----- Graceful remote shutdown (POST /api/shutdown) -----
// Dev-mode only: allows a newly-starting dev instance to displace this one.
// Disabled in Electron builds to prevent end-user exposure.
app.post('/api/shutdown', (_req, res) => {
  if (process.versions.electron) {
    console.warn('[Security] POST /api/shutdown rejected in Electron build');
    return res.status(403).json({ error: 'Forbidden in production build' });
  }
  res.json({ ok: true, message: 'shutting down' });
  console.log('[Server] Remote shutdown requested via POST /api/shutdown');
  shutdown();
  // Give the response a moment to flush before exiting
  setTimeout(() => process.exit(0), 200);
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
    // Bind explicitly to loopback only — never expose to the network.
    server.listen(p, '127.0.0.1', () => {
      console.log(`[Server] Listening on http://127.0.0.1:${p}`);
      resolve(p);
    }).on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        // ── Electron (production) context: never probe or displace ────────
        // When loaded by electron/main.js, process.versions.electron is set.
        // End-user Electron builds must not send any bytes to unknown owners.
        if (process.versions.electron) {
          reject(new Error(
            `Port ${p} is already in use. ` +
            'Cannot displace another process from an Electron build.'
          ));
          return;
        }

        // ── Dev context (node server/index.js) ────────────────────────────
        // Step 1: OS-level process name check — no network I/O.
        // If the port owner is not a Node.js process we must NOT send any
        // bytes to it; doing so could corrupt a binary-protocol server.
        const ownerName = getPortOwnerProcessName(p);
        console.warn(`[Server] Port ${p} already in use — owner process: ${ownerName ?? '(unknown)'}`);
        const isNodeProcess = ownerName === null   // unknown → give HTTP probe a chance
          || /^node(\.exe)?$/i.test(ownerName);
        if (!isNodeProcess) {
          reject(new Error(
            `Port ${p} is occupied by "${ownerName}" (not a Node.js process). ` +
            'Refusing to probe it to avoid protocol corruption.'
          ));
          return;
        }
        // Step 2: HTTP probe — verify appId fingerprint.
        console.warn(`[Server] Probing for existing UCPD-Monitor instance on port ${p}...`);
        const isOurApp = await new Promise((res2) => {
          const req = http.get(`http://127.0.0.1:${p}/api/status`, { timeout: 1500 }, (r) => {
            let body = '';
            r.on('data', (chunk) => { body += chunk; });
            r.on('end', () => {
              try {
                const json = JSON.parse(body);
                res2(json && json.appId === APP_ID);
              } catch { res2(false); }
            });
          });
          req.on('error', () => res2(false));
          req.on('timeout', () => { req.destroy(); res2(false); });
        });
        if (!isOurApp) {
          reject(new Error(`Port ${p} is occupied by an unrelated Node.js process. Aborting.`));
          return;
        }
        // Step 3: Ask the existing dev-server instance to shut down gracefully.
        console.log(`[Server] Sending shutdown request to existing instance on port ${p}...`);
        await new Promise((res3) => {
          const body = '{}';
          const req2 = http.request({
            hostname: 'localhost', port: p,
            path: '/api/shutdown', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 2000,
          }, () => res3());
          req2.on('error', () => res3());
          req2.on('timeout', () => { req2.destroy(); res3(); });
          req2.write(body);
          req2.end();
        });
        // Wait for the old process to release the port, then retry.
        console.log(`[Server] Waiting for port ${p} to be released...`);
        await new Promise((res4) => setTimeout(res4, 800));
        server.listen(p, '127.0.0.1', () => {
          console.log(`[Server] Listening on http://127.0.0.1:${p} (after displacing old dev instance)`);
          resolve(p);
        }).on('error', (err2) => reject(err2));
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

  // Flush and close session file (deletes if empty)
  closeSessionFile();
  console.log('[Server] Session file flushed on shutdown');
}

// Auto-start when invoked directly via `node server/index.js`
if (require.main === module) {
  startServer();
}

module.exports = { startServer, shutdown };
