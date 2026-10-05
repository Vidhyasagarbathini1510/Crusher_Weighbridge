'use strict';

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');
const healthMonitorService = require('../services/healthMonitorService');
const { getProtocolDelimiter, parseIndicatorFrame } = require('./IndicatorParsers');

class SerialPortReader extends EventEmitter {
  constructor(comPort = 'COM7', baudRate = 9600, protocol = 'Weitex') {
    super();
    this.comPort = comPort;
    this.baudRate = Number(baudRate) || 9600;
    this.protocol = protocol || 'Weitex';
    this.port = null;
    this.isReading = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.staleTimer = null;
    this.staleTimeoutMs = 15000;
  }

  start() {
    if (this.isReading) return;
    this.isReading = true;
    console.log(`[SerialPort] Starting serial port reader on ${this.comPort} (${this.baudRate} baud, protocol: ${this.protocol})...`);
    this._connect();
  }

  stop(cb) {
    this.isReading = false;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._clearStaleTimer();
    this._closePort(() => {
      console.log('[SerialPort] Stopped serial port reader.');
      if (cb) cb();
    });
  }

  _clearStaleTimer() {
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }

  _armStaleTimer() {
    if (!this.isReading) return;
    this._clearStaleTimer();
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null;
      if (!this.isReading) return;
      console.warn(`[SerialPort] No data on ${this.comPort} for ${this.staleTimeoutMs}ms — reopening port.`);
      this._connect();
    }, this.staleTimeoutMs);
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
          if (err) {
            console.error('[SerialPort] Error closing port:', err.message);
          }
          setTimeout(() => {
            if (cb) cb();
          }, 300);
        });
      } else {
        setTimeout(() => {
          if (cb) cb();
        }, 100);
      }
    } catch (err) {
      console.error('[SerialPort] Exception closing port:', err);
      if (cb) cb();
    }
  }

  _connect() {
    if (!this.isReading || this.isConnecting) return;
    this.isConnecting = true;

    this._clearStaleTimer();
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
            console.error(`[SerialPort] Failed to open port ${this.comPort}:`, err.message);
            this.emit('data', { value: 'Offline' });
            healthMonitorService.reportWeightError(`Failed to open COM port ${this.comPort}: ${err.message}`);
            this._scheduleReconnect();
            return;
          }

          console.log(`[SerialPort] Port ${this.comPort} opened successfully.`);
          this._setupListeners();
          this._armStaleTimer();
        });

      } catch (err) {
        this.isConnecting = false;
        console.error('[SerialPort] Error during connection setup:', err);
        healthMonitorService.reportWeightError(`Serial communication setup error on ${this.comPort}: ${err.message}`);
        this._scheduleReconnect();
      }
    });
  }

  _setupListeners() {
    if (!this.port) return;
    let buffer = '';
    const delimiter = getProtocolDelimiter(this.protocol);

    this.port.on('data', (data) => {
      this._armStaleTimer();
      const chunkStr = data.toString('utf8');
      buffer += chunkStr;

      // Prevent buffer memory bloat if delimiter does not match or port baud is mismatched
      if (buffer.length > 2048) {
        buffer = buffer.slice(-512);
      }

      const chunks = buffer.split(delimiter);
      // The last element is potentially incomplete, keep it in buffer
      buffer = chunks.pop();

      for (const rawChunk of chunks) {
        if (!rawChunk || !rawChunk.trim()) continue;

        const result = parseIndicatorFrame(rawChunk, this.protocol);
        if (result && result.value !== null) {
          const payload = {
            value: result.value,
            raw: result.raw,
            isStable: result.isStable !== undefined ? result.isStable : true,
            protocol: this.protocol
          };
          this.emit('data', payload);
          healthMonitorService.reportWeightReading({ value: result.value });
        }
      }
    });

    this.port.on('close', () => {
      console.warn(`[SerialPort] Port ${this.comPort} closed.`);
      this.emit('data', { value: 'Offline (Connecting...)' });
      healthMonitorService.reportWeightError(`Serial port ${this.comPort} connection closed.`);
      this._scheduleReconnect();
    });

    this.port.on('error', (err) => {
      console.error(`[SerialPort] Port ${this.comPort} error:`, err.message);
      this.emit('data', { value: 'Offline (Connecting...)' });
      healthMonitorService.reportWeightError(`Serial port ${this.comPort} error: ${err.message}`);
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (!this.isReading) return;
    this._clearStaleTimer();
    if (this.reconnectTimer) return; // Already scheduled

    console.log(`[SerialPort] Retrying connection to ${this.comPort} in 3 seconds...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, 3000);
  }
}

module.exports = SerialPortReader;
