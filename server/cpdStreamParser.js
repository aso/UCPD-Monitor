// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
'use strict';

const { Transform } = require('stream');

// ── TLV frame structure (all DISCO frame types) ─────────────────────────────
// All frames share the same envelope:
//   [0-3]  TLV_SOF = FD FD FD FD
//   [4]    Tag    : frame type byte
//   [5-6]  Length : byte count from [7] up to (but NOT including) sentinel, BE
//   [7..]  Value  : content (Tag-dependent)
//   [-4..] TLV_EOF = A5 A5 A5 A5
//
// Total frame size = 4 (sync) + 1 (tag) + 2 (len) + Length + 4 (sentinel)
//                  = 11 + Length
//
// CPD frames (tag=0x32) nest a 12-byte sub-header inside Value:
//   [7] Dir  [8-11] Timestamp  [12] Pad0  [13] SopQual  [14] Pad1  [15] PayloadLen
//   Length = PayloadLen + 9  (the 9 fixed sub-header bytes after [6])
// ──────────────────────────────────────────────────────────────────────────────
const SYNC_BYTE      = 0xFD;
const SYNC_LENGTH    = 4;        // FD FD FD FD
const SENTINEL_LEN   = 4;        // A5 A5 A5 A5
const TLV_LENGTH_HIGH_OFFSET = 5;
const TLV_LENGTH_LOW_OFFSET  = 6;
const TLV_VALUE_OFFSET       = 7;
const PAYLOAD_LEN_OFFSET = 15;   // absolute offset of PayloadLen inside CPD sub-header

// Tag byte identifying a CPD (USB-PD monitor) frame
const CPD_TAG = 0x32;

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

      // 2. Need at least sync(4) + tag(1) + length(2) = 7 bytes
      if (this._buf.length < TLV_VALUE_OFFSET) return;

      const tag    = this._buf[4];
      const tlvLen = ((this._buf[TLV_LENGTH_HIGH_OFFSET] << 8) | this._buf[TLV_LENGTH_LOW_OFFSET]);
      const frameLength = SYNC_LENGTH + 1 + 2 + tlvLen + SENTINEL_LEN;  // = 11 + tlvLen

      // 3. Wait for the complete frame
      if (this._buf.length < frameLength) return;

      const frame = this._buf.slice(0, frameLength);
      this._buf   = this._buf.slice(frameLength);

      if (tag === CPD_TAG) {
        // CPD (USB-PD monitor) frame — PayloadLen is at offset 15 inside sub-header
        this.emit('frame', Buffer.from(frame));
      } else {
        // Other TLV frame (command response, measurement stream, etc.)
        this.emit('measure_frame', Buffer.from(frame));
      }
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
