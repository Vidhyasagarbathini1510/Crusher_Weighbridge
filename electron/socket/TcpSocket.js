'use strict';
/**
 * TcpSocket.js
 * ----------------------------------------------------------------------------
 * A thin, well-logged wrapper around Node's `net.Socket` that demonstrates the
 * raw TCP lifecycle a beginner should understand:
 *
 *   open  -> connect (OS does the SYN / SYN-ACK / ACK 3-way handshake)
 *   send  -> socket.write(bytes)
 *   recv  -> 'data' event gives you a Buffer of bytes
 *   close -> either side sends FIN
 *   error -> connection refused / reset / timeout
 *
 * It adds automatic exponential-backoff reconnection, which is what makes a CCTV
 * app resilient when a camera reboots or the network blips. RtspClient uses its
 * own net socket for the protocol work; this wrapper is provided as a clean,
 * reusable building block and for the "socket implementation" learning section.
 * ----------------------------------------------------------------------------
 */
const net = require('net');
const { EventEmitter } = require('events');

class TcpSocket extends EventEmitter {
  constructor(host, port, log = console) {
    super();
    this.host = host;
    this.port = port;
    this.log = log;
    this.socket = null;
    this.shouldReconnect = true;
    this.retries = 0;
    this.maxDelay = 30000; // cap backoff at 30s
  }

  open() {
    this.shouldReconnect = true;
    this._connect();
  }

  _connect() {
    this.log.line('sys', `TCP connect -> ${this.host}:${this.port}`);
    this.socket = net.connect(this.port, this.host);

    this.socket.on('connect', () => {
      this.retries = 0; // reset backoff on success
      this.log.line('sys', 'TCP connected.');
      this.emit('open');
    });

    this.socket.on('data', (buf) => {
      this.log.line('rx', `received ${buf.length} bytes`);
      this.emit('data', buf);
    });

    this.socket.on('error', (err) => {
      this.log.line('err', `TCP error: ${err.code || err.message}`);
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      this.emit('close');
      if (this.shouldReconnect) this._scheduleReconnect();
    });
  }

  /** Exponential backoff: 1s, 2s, 4s, 8s ... capped at maxDelay. */
  _scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.retries, this.maxDelay);
    this.retries += 1;
    this.log.line('sys', `Reconnecting in ${delay}ms (attempt ${this.retries}) ...`);
    setTimeout(() => this._connect(), delay);
  }

  /** Send raw bytes down the wire. */
  send(bytes) {
    if (this.socket && !this.socket.destroyed) this.socket.write(bytes);
  }

  close() {
    this.shouldReconnect = false;
    if (this.socket) this.socket.destroy();
  }
}

module.exports = TcpSocket;
