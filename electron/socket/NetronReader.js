'use strict';

const http = require('http');
const { EventEmitter } = require('events');
const healthMonitorService = require('../services/healthMonitorService');

class NetronReader extends EventEmitter {
  constructor(url = 'http://192.168.0.50/weight', intervalMs = 500) {
    super();
    this.url = url;
    this.baseInterval = intervalMs;
    this.currentInterval = intervalMs;
    this.timer = null;
    this.isReading = false;
    this.activeRequest = null;
    this.lastValue = null;
    this.failCount = 0;
    this.offlineThreshold = 3;
  }

  start() {
    if (this.isReading) return;
    this.isReading = true;
    this._poll();
  }

  stop(cb) {
    this.isReading = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activeRequest) {
      try { this.activeRequest.destroy(); } catch (_) {}
      this.activeRequest = null;
    }
    if (cb) cb();
  }

  _poll() {
    if (!this.isReading) return;

    if (this.activeRequest) {
      try { this.activeRequest.destroy(); } catch (_) {}
      this.activeRequest = null;
    }

    let finished = false;
    let watchdog = null;
    const finish = (err, data) => {
      if (finished) return;
      finished = true;
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      this.activeRequest = null;

      if (err) {
        this.failCount++;
        this.currentInterval = Math.min(this.currentInterval * 1.5, 5000);
        if (this.failCount >= this.offlineThreshold || this.lastValue === null) {
          this.emit('data', { value: 'Offline' });
          healthMonitorService.reportWeightError(`Network scale unreachable: ${err.message}`);
        } else {
          this.emit('data', { value: this.lastValue });
        }
      } else {
        this.failCount = 0;
        this.lastValue = data;
        this.currentInterval = this.baseInterval;
        this.emit('data', { value: data });
        healthMonitorService.reportWeightReading({ value: data });
      }

      this._scheduleNext();
    };

    const req = http.get(this.url, { timeout: 4000, agent: false }, (res) => {
      let rawData = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = this._parseData(rawData);
          finish(null, parsed);
        } catch (e) {
          console.error('[Netron] Parse error:', e);
          finish(e);
        }
      });
    });

    this.activeRequest = req;

    req.on('error', (err) => {
      console.error('[Netron] HTTP Error:', err.message);
      finish(err);
    });

    req.on('timeout', () => {
      try { req.destroy(new Error('Request timed out')); } catch (_) {}
      finish(new Error('Request timed out'));
    });

    watchdog = setTimeout(() => {
      if (finished) return;
      try { req.destroy(new Error('Read stalled')); } catch (_) {}
      finish(new Error('Read stalled'));
    }, 8000);
  }

  _scheduleNext() {
    if (!this.isReading) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this._poll(), this.currentInterval);
  }

  _parseData(data) {
    if (typeof data !== 'string') {
      data = String(data);
    }

    // Try parsing as JSON first
    try {
      const parsed = JSON.parse(data);
      // Prioritize live indicator / weight over raw ADC count
      if (parsed.indicator !== undefined && parsed.indicator !== null && String(parsed.indicator).trim() !== '') {
        return `${parsed.indicator}`;
      }
      if (parsed.weight !== undefined && parsed.weight !== null && String(parsed.weight).trim() !== '') {
        return `${parsed.weight}`;
      }
      if (parsed.value !== undefined && parsed.value !== null && String(parsed.value).trim() !== '') {
        return `${parsed.value}`;
      }
      if (parsed.data !== undefined && parsed.data !== null && String(parsed.data).trim() !== '') {
        return `${parsed.data}`;
      }
      if (parsed.raw !== undefined && parsed.raw !== null && String(parsed.raw).trim() !== '') {
        return `${parsed.raw}`;
      }
    } catch (_) {
      // Not JSON
    }

    // Check if the response contains "indicator: <number>" or "Weight <number>"
    const indicatorMatch = data.match(/indicator\s*:\s*([0-9.-]+)/i);
    if (indicatorMatch && indicatorMatch[1]) {
      return indicatorMatch[1];
    }

    const weightMatch = data.match(/weight\s*[:\s]+([0-9.-]+)/i);
    if (weightMatch && weightMatch[1]) {
      return weightMatch[1];
    }

    // Strip HTML tags if there are any
    if (data.includes('<') && data.includes('>')) {
      data = data.replace(/<[^>]*>/g, ' ').trim();
    }

    // Clean up carriage returns/newlines and extra spaces
    let cleaned = data.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    if (cleaned.length > 0 && cleaned.length < 30) {
      return cleaned;
    }

    return 'No Data';
  }
}

module.exports = NetronReader;
