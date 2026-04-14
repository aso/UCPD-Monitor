// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
'use strict';

const { Transform } = require('stream');

// CPD frame constants (mirrors pd_parser.js)
const SYNC_BYTE      = 0xFD;
const SYNC_LENGTH    = 4;        // FD FD FD FD
const HEADER_LENGTH  = 12;       // bytes 4-15 after sync word
const SENTINEL_LEN   = 4;        // A5 A5 A5 A5  (or variant)
const PAYLOAD_LEN_OFFSET = 15;   // absolute offset from frame start

/**
 * Node.js Transform stream that ingests raw serial bytes and emits complete CPD records.
 *
 * Each emitted event is a Buffer containing one full raw CPD record:
 *   [FD FD FD FD] [12-byte header] [payloadLen bytes] [4-byte sentinel]
 *   = 20 + payloadLen bytes total
 *
 * Usage:
 *   const parser = new CpdStreamParser();
 *   parser.on('frame', (buf) => { ... });
 *   serialPort.pipe(parser);
 */
class CpdStreamParser extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this._buf = Buffer.alloc(0);
  }

  _transform(chunk, _enc, done) {
    // Append incoming bytes to internal accumulation buffer
    this._buf = Buffer.concat([this._buf, chunk]);
    this._processBuffer();
    done();
  }

  _flush(done) {
    // Stream ended — discard any partial frame
    this._buf = Buffer.alloc(0);
    done();
  }

  _processBuffer() {
    while (true) {
      // 1. Find sync word FD FD FD FD
      const syncIdx = this._findSync();
      if (syncIdx === -1) {
        // No sync found — keep last 3 bytes in case sync straddles chunk boundaries
        if (this._buf.length > 3) {
          this._buf = this._buf.slice(this._buf.length - 3);
        }
        return;
      }

      // Discard bytes before sync
      if (syncIdx > 0) {
        this._buf = this._buf.slice(syncIdx);
      }

      // 2. Wait until we have enough bytes to read payloadLen (at offset 15)
      if (this._buf.length < PAYLOAD_LEN_OFFSET + 1) return;

      const payloadLen  = this._buf[PAYLOAD_LEN_OFFSET];
      const frameLength = SYNC_LENGTH + HEADER_LENGTH + payloadLen + SENTINEL_LEN; // 20 + payloadLen

      // 3. Wait for the complete frame
      if (this._buf.length < frameLength) return;

      // 4. Extract and emit the frame
      const frame = this._buf.slice(0, frameLength);
      this._buf   = this._buf.slice(frameLength);

      this.emit('frame', Buffer.from(frame));
    }
  }

  /**
   * Find the first occurrence of [FD FD FD FD] in _buf.
   * Returns index, or -1 if not found.
   */
  _findSync() {
    const b = this._buf;
    for (let i = 0; i <= b.length - SYNC_LENGTH; i++) {
      if (b[i] === SYNC_BYTE && b[i + 1] === SYNC_BYTE && b[i + 2] === SYNC_BYTE && b[i + 3] === SYNC_BYTE) {
        return i;
      }
    }
    return -1;
  }
}

module.exports = { CpdStreamParser };
