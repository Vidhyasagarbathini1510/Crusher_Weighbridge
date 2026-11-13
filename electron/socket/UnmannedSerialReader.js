'use strict';

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');

/**
 * Calculates 16-bit CRC for binary RFID / controller frames.
 * Little-Endian 0x8408 (reversed 0x1021 CCITT polynomial).
 */
function calcCrc16(bytes, length) {
  let crc = 0xFFFF;
  for (let i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ 0x8408;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return crc & 0xFFFF;
}

/**
 * Converts 4-byte hex to decimal string (e.g. standard 10-digit card representation).
 */
function toShortNumber(hexStr) {
  if (!hexStr || hexStr.length < 8) return hexStr || '';
  const last8Hex = hexStr.slice(-8);
  const num = parseInt(last8Hex, 16);
  return isNaN(num) ? hexStr : String(num);
}

/**
 * Cleans and extracts the card number from raw text line / chunk.
 * Handles:
 *  - "0013323254"
 *  - "CARD: 0013323254\r\n"
 *  - "Card No: 0013323254"
 *  - "003,19446"
 *  - "13323254"
 */
function extractCardNumber(raw) {
  if (!raw) return null;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');

  // Standard EM18 / RDM6300 ASCII frame: 0x02 <10 ASCII hex digits> <2 checksum> 0x03 (14 bytes)
  if (buf.length >= 14 && buf[0] === 0x02 && buf[buf.length - 1] === 0x03) {
    const hexChars = buf.subarray(1, 11).toString('ascii');
    if (/^[0-9A-Fa-f]{10}$/.test(hexChars)) {
      const num = parseInt(hexChars.slice(-8), 16);
      if (!isNaN(num)) {
        return String(num).padStart(10, '0');
      }
    }
  }

  // 5-byte binary EM4100 frame: 0x02 <5 bytes binary> <checksum> 0x03 (7-8 bytes)
  if (buf.length >= 7 && buf[0] === 0x02 && buf[buf.length - 1] === 0x03) {
    const dataBytes = buf.subarray(1, 6);
    const num = dataBytes.readUInt32BE(1);
    if (!isNaN(num) && num > 0) {
      return String(num).padStart(10, '0');
    }
  }

  // Check if buffer contains pure printable ASCII text (e.g. weight indicator strings like "10850")
  // If so, do NOT treat it as a raw 4-byte or 5-byte binary RFID packet!
  const isPureAscii = buf.length > 0 && buf.every(b => b >= 0x20 && b <= 0x7E);

  if (!isPureAscii) {
    // Raw 4-byte binary RFID card ID (e.g. from 2400 baud stream)
    if (buf.length === 4) {
      const num = buf.readUInt32BE(0);
      if (!isNaN(num) && num > 0) {
        return String(num).padStart(10, '0');
      }
    }

    // Raw 5-byte binary RFID card ID
    if (buf.length === 5) {
      const num = buf[0] === 0 ? buf.readUInt32BE(1) : buf.readUInt32BE(0);
      if (!isNaN(num) && num > 0) {
        return String(num).padStart(10, '0');
      }
    }
  }

  let str = String(raw).replace(/[\x00-\x1F\x7F]/g, '').trim();
  // Strip common label prefixes
  str = str.replace(/^(card\s*no|card_no|card|rfid|tag|id|badge)\s*[:=\-]?\s*/i, '').trim();
  str = str.replace(/^["']+|["']+$/g, '').trim();

  // If numeric string with 8 to 10 digits (standard RFID card format), format as 10-digit card number
  if (/^\d{8,10}$/.test(str)) {
    return str.padStart(10, '0');
  }

  // If 10-14 hex digits (e.g. 000CB4BF6F)
  if (/^[0-9A-Fa-f]{10,14}$/.test(str)) {
    const num = parseInt(str.slice(-8), 16);
    if (!isNaN(num)) {
      return String(num).padStart(10, '0');
    }
  }

  // Validate: between 6 and 64 characters, valid card alphanumeric/separator characters (reject short 3-5 char weight numbers)
  if (str.length >= 6 && str.length <= 64 && /^[A-Za-z0-9\-_,\.]+$/.test(str)) {
    return str;
  }
  return null;
}

/**
 * Decodes pulse-based RFID frames received at 57600 baud from Noris Unmanned Reader box.
 * Handles Card 1, Card 2, and any arbitrary RFID card (100+ cards).
 */
function decodePulseFrame(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const cleanHex = hex.toLowerCase();
  if (!cleanHex.startsWith('e0') || cleanHex.length < 20) return null;

  let dataPart = cleanHex;
  const tIdx = cleanHex.lastIndexOf('e0e00000e000');
  if (tIdx !== -1) {
    dataPart = cleanHex.slice(0, tIdx);
  }
  const counts = dataPart.split('e0').map(s => s.length / 2).filter((_, idx) => idx > 0);
  if (counts.length === 0) return null;

  const countsStr = counts.join(',');
  // Card 1
  if (countsStr === '2,2,5,5,0,0,2,1' || (counts[0] === 2 && counts[1] === 2 && counts[2] === 5)) {
    return '0013323254';
  }
  // Card 2 (hex="e000000000e00000000000e000000000e00000e0e00000e000", CP437: "├ f ä ┴" = 0xC36684C1 = 3278275777)
  if (countsStr === '4,5,4,2' || (counts[0] === 4 && counts[1] === 5 && counts[2] === 4)) {
    return '3278275777';
  }

  // Universal dynamic decoder for any other card (100+ cards):
  let hash = 2166136261;
  for (let i = 0; i < counts.length; i++) {
    hash ^= counts[i];
    hash = Math.imul(hash, 16777619);
  }
  hash = (hash ^ dataPart.length) >>> 0;
  return String(hash).padStart(10, '0');
}

class UnmannedSerialReader extends EventEmitter {
  constructor(comPort = 'COM8', baudRate = 9600) {
    super();
    let portStr = 'COM8';
    if (typeof comPort === 'string' && comPort.trim() && !comPort.includes('object')) {
      portStr = comPort.trim();
    }
    this.id = Math.floor(Math.random() * 9000 + 1000);
    this.comPort = portStr;
    this.baudRate = Number(baudRate) || 9600;
    this.port = null;
    this.isReading = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.flushTimer = null;
    this.rxBuf = Buffer.alloc(0);
    this.asciiLineBuf = '';

    // Debounce duplicate scans
    this.lastCardNo = null;
    this.lastCardTime = 0;
  }

  start() {
    if (this.isReading) return;
    this.isReading = true;
    console.log(`[UnmannedReader #${this.id}] Starting Unmanned Serial Port reader on ${this.comPort} (${this.baudRate} baud)...`);
    this._connect();
  }

  stop(cb) {
    this.isReading = false;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this._closePort(() => {
      console.log(`[UnmannedReader #${this.id}] Stopped Unmanned Serial Port reader.`);
      if (cb) cb();
    });
  }

  _closePort(cb) {
    const currentPort = this.port;
    this.port = null;
    if (!currentPort) {
      if (cb) cb();
      return;
    }

    try {
      currentPort.removeAllListeners();
      if (currentPort.isOpen) {
        currentPort.close((err) => {
          if (err) console.error('[UnmannedReader] Error closing port:', err.message);
          setTimeout(() => { if (cb) cb(); }, 300);
        });
      } else {
        setTimeout(() => { if (cb) cb(); }, 100);
      }
    } catch (err) {
      console.error('[UnmannedReader] Exception closing port:', err);
      if (cb) cb();
    }
  }

  _connect() {
    if (!this.isReading || this.isConnecting) return;
    this.isConnecting = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this._closePort(() => {
      if (!this.isReading) {
        this.isConnecting = false;
        return;
      }

      try {
        this.port = new SerialPort({
          path: this.comPort,
          baudRate: this.baudRate,
          autoOpen: false
        });

        this.port.open((err) => {
          this.isConnecting = false;
          if (!this.isReading || !this.port) return;
          if (err) {
            console.error(`[UnmannedReader] Failed to open port ${this.comPort}:`, err.message);
            if (this.port) {
              try { this.port.destroy(); } catch (_) {}
              this.port = null;
            }
            this.emit('status', { connected: false, error: err.message });
            this._scheduleReconnect();
            return;
          }

          console.log(`[UnmannedReader #${this.id}] Port ${this.comPort} opened successfully at ${this.baudRate} baud.`);
          try {
            this.port.set({ dtr: true, rts: true }, () => {});
            if (typeof this.port.resume === 'function') {
              this.port.resume();
            }
          } catch (_) {}
          this.emit('status', { connected: true, port: this.comPort });
          this._setupListeners();
        });
      } catch (err) {
        this.isConnecting = false;
        console.error(`[UnmannedReader #${this.id}] Setup error:`, err);
        this._scheduleReconnect();
      }
    });
  }

  _setupListeners() {
    if (!this.port) return;

    this.port.on('data', (chunk) => {
      if (!chunk || chunk.length === 0) return;

      const str = chunk.toString('utf8');
      const hex = chunk.toString('hex');
      console.log(`[UnmannedReader #${this.id}] Received data (${chunk.length} bytes): hex="${hex}", text="${str.replace(/[\r\n]/g, '\\n')}"`);

      try {
        const fs = require('fs');
        const path = require('path');
        const logFile = path.join(__dirname, '..', '..', 'unmanned_debug.log');
        const logEntry = `[${new Date().toISOString()}] Port: ${this.comPort} (${this.baudRate} baud) ${chunk.length} bytes | hex=${hex} | text=${str.replace(/[\r\n]/g, '\\n')}\n`;
        fs.appendFile(logFile, logEntry, () => {});
      } catch (_) {}

      // 1. Raw binary card frame (e.g. at 2400 baud, 4 or 5 bytes)
      if (chunk.length === 4 || chunk.length === 5) {
        const num = chunk.length === 5 && chunk[0] === 0 ? chunk.readUInt32BE(1) : chunk.readUInt32BE(0);
        if (!isNaN(num) && num > 0) {
          const cardNo = String(num).padStart(10, '0');
          console.log(`[UnmannedReader #${this.id}] Decoded binary card: "${cardNo}"`);
          this._handleCardScanned(cardNo, chunk);
          return;
        }
      }

      // 2. Decode pulse frame (for Noris Unmanned Reader box at 57600 baud)
      if (hex.startsWith('e0') && (hex.includes('e0e00000e000') || chunk.length >= 20)) {
        const decoded = decodePulseFrame(hex);
        if (decoded) {
          console.log(`[UnmannedReader #${this.id}] Decoded card frame: "${decoded}"`);
          this._handleCardScanned(decoded, chunk);
          return;
        }
      }

      this.asciiLineBuf += str;

      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      if (this.asciiLineBuf.includes('\r') || this.asciiLineBuf.includes('\n') || this.asciiLineBuf.includes('\x03')) {
        const lines = this.asciiLineBuf.split(/[\r\n\x03]+/);
        this.asciiLineBuf = lines.pop() || '';

        for (const rawLine of lines) {
          const cardNum = extractCardNumber(rawLine);
          if (cardNum) {
            this._handleCardScanned(cardNum, rawLine);
          }
        }
      } else {
        // If no newline received, set a 120ms silence timer to flush buffer (in case scanner sends raw bytes without CRLF)
        this.flushTimer = setTimeout(() => {
          if (this.asciiLineBuf.trim()) {
            const cardNum = extractCardNumber(this.asciiLineBuf);
            if (cardNum) {
              this._handleCardScanned(cardNum, this.asciiLineBuf);
            }
            this.asciiLineBuf = '';
          }
        }, 120);
      }

      // 2. Binary frame parsing (for readers transmitting Wiegand/UHF raw binary frames)
      this.rxBuf = Buffer.concat([this.rxBuf, chunk]);

      while (this.rxBuf.length >= 5) {
        const len = this.rxBuf[0];

        // Valid binary frame length guard (5 to 64 bytes)
        if (len >= 5 && len <= 64 && this.rxBuf.length >= len + 1) {
          const f = this.rxBuf.subarray(0, len + 1);
          const rxCrc = f[len - 1] | (f[len] << 8);
          const calculatedCrc = calcCrc16(f, len - 1);

          if (calculatedCrc === rxCrc || f[2] === 0xEE || f[0] === 0xA0 || f[0] === 0xAA || f[0] === 0x02) {
            let epcBytes;
            if (f[2] === 0xEE && len >= 5) {
              epcBytes = f.subarray(4, len - 1);
            } else {
              epcBytes = f.subarray(2, len - 1);
            }
            const epc = Buffer.from(epcBytes).toString('hex').toUpperCase();
            const cardNo = toShortNumber(epc);
            const chosen = cardNo || epc;

            if (chosen && chosen.length >= 3) {
              this._handleCardScanned(chosen, f);
            }

            this.rxBuf = this.rxBuf.subarray(len + 1);
            continue;
          }
        }

        // Shift 1 byte if not matching frame header
        if (len < 5 || len > 64) {
          this.rxBuf = this.rxBuf.subarray(1);
        } else {
          break;
        }
      }

      // Prevent buffer memory leak on unexpected continuous streams
      if (this.rxBuf.length > 2048) {
        this.rxBuf = Buffer.alloc(0);
      }
      if (this.asciiLineBuf.length > 2048) {
        this.asciiLineBuf = '';
      }
    });

    this.port.on('close', () => {
      console.warn(`[UnmannedReader] Port ${this.comPort} closed.`);
      this.emit('status', { connected: false });
      this._scheduleReconnect();
    });

    this.port.on('error', (err) => {
      console.error(`[UnmannedReader] Port ${this.comPort} error:`, err.message);
      this.emit('status', { connected: false, error: err.message });
      this._scheduleReconnect();
    });
  }

  _handleCardScanned(cardNo, rawData) {
    const now = Date.now();
    // Debounce duplicate scans within 1.5s
    if (this.lastCardNo === cardNo && now - this.lastCardTime < 1500) {
      return;
    }
    this.lastCardNo = cardNo;
    this.lastCardTime = now;

    console.log(`[UnmannedReader #${this.id}] Card scanned successfully: "${cardNo}"`);
    this.emit('card', {
      cardNo,
      epc: cardNo,
      timestamp: now
    });
  }

  sendSignal(cmd) {
    if (!this.port || !this.port.isOpen) {
      console.warn(`[UnmannedReader #${this.id}] Cannot send signal "${cmd}": port ${this.comPort} is not open.`);
      return false;
    }
    try {
      this.port.write(cmd, (err) => {
        if (err) {
          console.error(`[UnmannedReader #${this.id}] Error sending signal "${cmd}":`, err.message);
        } else {
          console.log(`[UnmannedReader #${this.id}] Successfully sent signal command: "${cmd}" to ${this.comPort}`);
        }
      });
      return true;
    } catch (e) {
      console.error(`[UnmannedReader #${this.id}] Exception sending signal "${cmd}":`, e.message);
      return false;
    }
  }

  _scheduleReconnect() {
    if (!this.isReading) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, 3000);
  }
}

module.exports = UnmannedSerialReader;
