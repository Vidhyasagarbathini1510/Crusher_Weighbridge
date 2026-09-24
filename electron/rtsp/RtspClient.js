'use strict';
/**
 * RtspClient.js
 * ----------------------------------------------------------------------------
 * A HAND-WRITTEN RTSP 1.0 client (RFC 2326) built directly on top of a raw TCP
 * socket. Its job is to perform the RTSP handshake exactly the way a browser
 * performs an HTTP handshake, but for video:
 *
 *      OPTIONS  -> "what can you do?"
 *      DESCRIBE -> "describe the stream (SDP: codec, tracks)"
 *      SETUP    -> "let's agree on how RTP will be transported"
 *      PLAY     -> "start sending me video"
 *      (RTP packets stream in)
 *      PAUSE / TEARDOWN -> stop
 *
 * We transport RTP over the SAME TCP connection ("interleaved" mode,
 * Transport: RTP/AVP/TCP). That keeps everything on one socket so a beginner
 * can watch the whole conversation in one place, and it survives NAT/firewalls
 * better than UDP.
 *
 * IMPORTANT: This client is primarily for LEARNING + HEALTH-CHECKING. It proves
 * the camera is reachable, authenticates, negotiates the stream, and logs every
 * RTP packet (sequence number, timestamp, NAL type). Actual on-screen DECODING
 * is delegated to FFmpeg (see electron/ffmpeg/*). See docs/ARCHITECTURE.md for
 * why we split it this way.
 * ----------------------------------------------------------------------------
 */

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { parseSdp } = require('./sdp');
const RtpParser = require('./RtpParser');

class RtspClient extends EventEmitter {
  /**
   * @param {string} url  Full RTSP URL, e.g. rtsp://user:pass@192.168.1.10:554/stream1
   * @param {object} log  A logger with .line(direction, text) for the UI console
   */
  constructor(url, log = console) {
    super();
    this.rawUrl = url;

    // Parse rtsp://user:pass@host:port/path into pieces.
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port || 554);
    this.username = decodeURIComponent(u.username || '');
    this.password = decodeURIComponent(u.password || '');
    // The URL we put on the request line should NOT contain credentials.
    this.controlUrl = `rtsp://${this.host}:${this.port}${u.pathname}${u.search}`;

    this.cseq = 0;              // RTSP command sequence counter (like HTTP but mandatory)
    this.session = null;        // Session id handed back by the server on SETUP
    this.auth = null;           // Digest/Basic auth state once we've been challenged
    this.socket = null;
    this.buffer = Buffer.alloc(0); // Accumulates bytes until we have a full message
    this.pending = null;        // Resolver for the in-flight request
    this.rtp = new RtpParser(log); // Understands RTP headers + H.264 NAL units
    this.log = log;
    this.playing = false;
  }

  // ---- Public API ----------------------------------------------------------

  /** Connect the TCP socket and run the full handshake up to PLAY. */
  async start() {
    await this._openSocket();
    await this.options();     // 1. capability discovery
    await this.describe();    // 2. get SDP (codecs / tracks)
    await this.setup();       // 3. negotiate RTP transport
    await this.play();        // 4. start the stream
    this.playing = true;
    this.emit('playing');
    this._startKeepAlive();
  }

  /**
   * Connectivity check only: connect, ask what the camera supports, and fetch
   * the SDP. That is enough to prove the host is reachable, the credentials are
   * accepted and the stream path exists — without starting a video session.
   * Throws the underlying socket/RTSP error so the caller can classify it.
   */
  async probe() {
    await this._openSocket();
    await this.options();
    await this.describe();
    return true;
  }

  /** Gracefully stop: TEARDOWN then close the socket. */
  async stop() {
    this._stopKeepAlive();
    try { if (this.session) await this.teardown(); } catch (_) {}
    this.playing = false;
    if (this.socket) this.socket.destroy();
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this.keepAliveTimer = setInterval(async () => {
      if (!this.playing || !this.socket) return;
      try {
        await this._request('OPTIONS', this.controlUrl, { Session: this.session });
      } catch (err) {
        this.log.line('sys', `Keep-alive ping failed: ${err.message}`);
      }
    }, 20000); // ping every 20 seconds
  }

  _stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // ---- RTSP methods --------------------------------------------------------

  options() {
    return this._request('OPTIONS', this.controlUrl);
  }

  async describe() {
    const res = await this._request('DESCRIBE', this.controlUrl, {
      Accept: 'application/sdp',
    });
    // The SDP body tells us the codec (H.264/H.265) and the per-track control URL.
    this.sdp = parseSdp(res.body);
    this.rtp.configureFromSdp(this.sdp);
    // Pick the video track's control URL (may be relative to the base URL).
    const video = this.sdp.media.find((m) => m.type === 'video') || this.sdp.media[0];
    this.trackUrl = this._resolveControl(video ? video.control : null);
    return res;
  }

  async setup() {
    // interleaved=0-1 => RTP arrives on channel 0, RTCP on channel 1, both
    // multiplexed onto THIS TCP socket, each framed by a 4-byte header.
    const res = await this._request('SETUP', this.trackUrl, {
      Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1',
    });
    if (res.headers.session) {
      // "Session: 12345678;timeout=60" -> keep just the id.
      this.session = res.headers.session.split(';')[0].trim();
    }
    return res;
  }

  play() {
    return this._request('PLAY', this.controlUrl, {
      Session: this.session,
      Range: 'npt=0.000-',
    });
  }

  pause() {
    return this._request('PAUSE', this.controlUrl, { Session: this.session });
  }

  teardown() {
    return this._request('TEARDOWN', this.controlUrl, { Session: this.session });
  }

  // ---- Socket lifecycle ----------------------------------------------------

  _openSocket() {
    return new Promise((resolve, reject) => {
      this.log.line('sys', `Opening TCP socket to ${this.host}:${this.port} ...`);
      this.socket = net.connect(this.port, this.host, () => {
        this.log.line('sys', 'TCP socket connected (3-way handshake done by the OS).');
        resolve();
      });
      this.socket.on('data', (chunk) => this._onData(chunk));
      this.socket.on('error', (err) => {
        this.log.line('err', `Socket error: ${err.message}`);
        this.emit('error', err);
        reject(err);
      });
      this.socket.on('close', () => {
        this.log.line('sys', 'Socket closed.');
        this.emit('close');
      });
    });
  }

  // ---- Request/response engine --------------------------------------------

  /**
   * Send an RTSP request and wait for its text response.
   * Adds CSeq, Authorization and User-Agent automatically. If the server
   * answers 401, we compute Digest auth and transparently retry once.
   */
  _request(method, uri, headers = {}, isRetry = false) {
    return new Promise((resolve, reject) => {
      this.cseq += 1;
      const cseq = this.cseq;

      let lines = `${method} ${uri} RTSP/1.0\r\n`;
      lines += `CSeq: ${cseq}\r\n`;
      lines += `User-Agent: NorisCCTV/1.0\r\n`;
      const authHeader = this._authHeader(method, uri);
      if (authHeader) lines += `Authorization: ${authHeader}\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (v != null) lines += `${k}: ${v}\r\n`;
      }
      lines += '\r\n';

      this.log.line('out', lines.trim()); // >>> show the exact bytes we send

      this.pending = { cseq, method, uri, resolve, reject, isRetry, headers };
      this.socket.write(lines);
    });
  }

  /** Called every time the OS hands us a chunk of bytes from the socket. */
  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // A single TCP read may contain: part of a message, a whole message, or
    // several messages back to back. We loop until we can't parse a full one.
    // Two kinds of "messages" can appear on this socket after PLAY:
    //   1. Text RTSP responses ("RTSP/1.0 200 OK\r\n...\r\n\r\n[body]")
    //   2. Interleaved binary RTP frames, framed as: '$' ch length(2) payload
    for (;;) {
      if (this.buffer.length === 0) return;

      if (this.buffer[0] === 0x24 /* '$' */) {
        // ---- Interleaved binary RTP/RTCP frame ----
        if (this.buffer.length < 4) return;                 // need the 4-byte header
        const channel = this.buffer[1];
        const len = this.buffer.readUInt16BE(2);
        if (this.buffer.length < 4 + len) return;           // wait for full payload
        const payload = this.buffer.subarray(4, 4 + len);
        this.buffer = this.buffer.subarray(4 + len);
        if (channel === 0) this.rtp.handlePacket(payload);  // RTP (video)
        // channel 1 = RTCP (sender reports); ignored here for brevity
        continue;
      }

      // ---- Text RTSP response ----
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;                          // headers not complete yet
      const head = this.buffer.subarray(0, headerEnd).toString('utf8');
      const headers = this._parseHeaders(head);
      const contentLength = Number(headers['content-length'] || 0);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) return; // wait for body
      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      this.log.line('in', head);                             // <<< show the response
      this._dispatchResponse(head, headers, body);
    }
  }

  _dispatchResponse(head, headers, body) {
    const statusLine = head.split('\r\n')[0];
    const status = Number(statusLine.split(' ')[1]);
    const p = this.pending;
    if (!p) return;

    // 401 Unauthorized -> build Digest/Basic auth from the challenge, retry once.
    if (status === 401 && !p.isRetry) {
      this._buildAuth(headers['www-authenticate']);
      this.pending = null;
      this._request(p.method, p.uri, p.headers, true).then(p.resolve, p.reject);
      return;
    }

    this.pending = null;
    if (status >= 200 && status < 300) {
      p.resolve({ status, headers, body });
    } else {
      p.reject(new Error(`${p.method} failed: ${statusLine}`));
    }
  }

  // ---- Small helpers -------------------------------------------------------

  _parseHeaders(text) {
    const out = {};
    text.split('\r\n').slice(1).forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return out;
  }

  /** Turn "WWW-Authenticate: Digest realm=..., nonce=..." into reusable state. */
  _buildAuth(header = '') {
    if (/^Digest/i.test(header)) {
      const realm = /realm="([^"]+)"/.exec(header);
      const nonce = /nonce="([^"]+)"/.exec(header);
      this.auth = {
        type: 'digest',
        realm: realm ? realm[1] : '',
        nonce: nonce ? nonce[1] : '',
      };
    } else {
      this.auth = { type: 'basic' };
    }
    this.log.line('sys', `Server requested ${this.auth.type} authentication.`);
  }

  /** Compute the Authorization header value for a given method/uri. */
  _authHeader(method, uri) {
    if (!this.auth) return null;
    if (this.auth.type === 'basic') {
      const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      return `Basic ${token}`;
    }
    // Digest (RFC 2617): response = md5( md5(user:realm:pass) : nonce : md5(method:uri) )
    const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
    const ha1 = md5(`${this.username}:${this.auth.realm}:${this.password}`);
    const ha2 = md5(`${method}:${uri}`);
    const response = md5(`${ha1}:${this.auth.nonce}:${ha2}`);
    return (
      `Digest username="${this.username}", realm="${this.auth.realm}", ` +
      `nonce="${this.auth.nonce}", uri="${uri}", response="${response}"`
    );
  }

  /** Track control URLs in SDP can be absolute or relative; resolve them. */
  _resolveControl(control) {
    if (!control || control === '*') return this.controlUrl;
    if (/^rtsp:\/\//i.test(control)) return control;
    return this.controlUrl.replace(/\/?$/, '/') + control.replace(/^\//, '');
  }
}

module.exports = RtspClient;
