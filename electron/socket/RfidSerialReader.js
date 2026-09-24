'use strict';

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');

/**
 * Calculates 16-bit CRC for RFID reader binary frames.
 * Uses Little-Endian 0x8408 (reversed 0x1021 CCITT polynomial).
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
 * Short Number calculation matching VB.NET:
 * Takes the last 4 bytes (last 8 hex chars) of the EPC and converts to a decimal string.
 */
function toShortNumber(epcHex) {
  if (!epcHex || epcHex.length < 8) return epcHex || '';
  const last8Hex = epcHex.slice(-8);
  const num = parseInt(last8Hex, 16);
  return isNaN(num) ? epcHex : num.toString();
}

class RfidSerialReader extends EventEmitter {
  constructor(comPort = 'COM1', baudRate = 9600) {
    super();
    let portStr = 'COM1';
    if (typeof comPort === 'string' && comPort.trim() && !comPort.includes('object')) {
      portStr = comPort.trim();
    }
    this.comPort = portStr;
    this.rawComPortArg = comPort;
    this.baudRate = Number(baudRate) || 9600;
    this.port = null;
    this.isReading = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.rxBuf = Buffer.alloc(0);
    this.asciiLineBuf = '';
  }

  start() {
    if (this.isReading) return;
    this.isReading = true;
    console.log(`[RfidReader] Starting RFID serial reader on ${this.comPort} (${this.baudRate} baud)...`);
    this._connect();
  }

  stop(cb) {
    this.isReading = false;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._closePort(() => {
      console.log('[RfidReader] Stopped RFID serial reader.');
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
          if (err) console.error('[RfidReader] Error closing port:', err.message);
          setTimeout(() => { if (cb) cb(); }, 300);
        });
      } else {
        setTimeout(() => { if (cb) cb(); }, 100);
      }
    } catch (err) {
      console.error('[RfidReader] Exception closing port:', err);
      if (cb) cb();
    }
  }

  async _connect() {
    if (!this.isReading || this.isConnecting) return;
    this.isConnecting = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Resolve port if a Promise or non-string was passed
    let targetPort = this.comPort;
    if (this.rawComPortArg && typeof this.rawComPortArg.then === 'function') {
      try {
        const resolved = await this.rawComPortArg;
        if (typeof resolved === 'string' && resolved.trim()) {
          targetPort = resolved.trim();
        }
      } catch (_) {}
    }
    if (!targetPort || typeof targetPort !== 'string' || targetPort.includes('Promise') || targetPort.includes('object')) {
      targetPort = 'COM1';
    }
    this.comPort = targetPort;

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
            console.error(`[RfidReader] Failed to open port ${this.comPort}:`, err.message);
            if (this.port) {
              try { this.port.destroy(); } catch (_) {}
              this.port = null;
            }
            this.emit('status', { connected: false, error: err.message });
            this._scheduleReconnect();
            return;
          }

          console.log(`[RfidReader] Port ${this.comPort} opened successfully.`);
          this.emit('status', { connected: true, port: this.comPort });
          this._setupListeners();
        });
      } catch (err) {
        this.isConnecting = false;
        console.error('[RfidReader] Setup error:', err);
        this._scheduleReconnect();
      }
    });
  }

  _setupListeners() {
    if (!this.port) return;

    this.port.on('data', (chunk) => {
      if (!chunk || chunk.length === 0) return;

      // 1. Process as ASCII / Line-based Serial Text Reader (e.g. "0005128492\r\n")
      const str = chunk.toString('utf8');
      this.asciiLineBuf += str;

      if (this.asciiLineBuf.includes('\r') || this.asciiLineBuf.includes('\n') || this.asciiLineBuf.includes('\x03')) {
        const lines = this.asciiLineBuf.split(/[\r\n\x03]+/);
        this.asciiLineBuf = lines.pop() || '';

        for (let rawLine of lines) {
          const cleaned = rawLine.replace(/[\x00-\x1F\x7F]/g, '').trim();
          if (cleaned.length >= 3 && cleaned.length <= 64 && /^[A-Za-z0-9\-\_]+$/.test(cleaned)) {
            console.log(`[RfidReader] Scanned ASCII RFID Tag: ${cleaned}`);
            this.emit('card', {
              epc: cleaned,
              cardNo: cleaned,
              rawHex: Buffer.from(cleaned).toString('hex').toUpperCase()
            });
          }
        }
      }

      // 2. Process as Binary Protocol Frame (UHF Reader)
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

            if (epc.length > 0) {
              console.log(`[RfidReader] Scanned Binary RFID Tag EPC: ${epc} | Card No: ${cardNo}`);
              this.emit('card', {
                epc,
                cardNo: cardNo || epc,
                rawHex: Buffer.from(f).toString('hex').toUpperCase()
              });
            }

            this.rxBuf = this.rxBuf.subarray(len + 1);
            continue;
          }
        }

        // Shift 1 byte to resync if not a valid frame header
        if (len < 5 || len > 64) {
          this.rxBuf = this.rxBuf.subarray(1);
        } else {
          // Wait for more bytes if valid len but not enough bytes accumulated yet
          break;
        }
      }

      // Prevent buffer memory leak on corrupt streams
      if (this.rxBuf.length > 1024) {
        this.rxBuf = Buffer.alloc(0);
      }
      if (this.asciiLineBuf.length > 1024) {
        this.asciiLineBuf = '';
      }
    });

    this.port.on('close', () => {
      console.warn(`[RfidReader] Port ${this.comPort} closed.`);
      this.emit('status', { connected: false });
      this._scheduleReconnect();
    });

    this.port.on('error', (err) => {
      console.error(`[RfidReader] Port ${this.comPort} error:`, err.message);
      this.emit('status', { connected: false, error: err.message });
      this._scheduleReconnect();
    });
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

module.exports = RfidSerialReader;
