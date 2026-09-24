'use strict';
/**
 * FfmpegMjpeg.js
 * ----------------------------------------------------------------------------
 * The SIMPLE, easy-to-understand rendering pipeline.
 *
 * We ask FFmpeg to connect to the RTSP camera, decode H.264/H.265, and re-encode
 * the video as a stream of JPEG images (Motion-JPEG). Each JPEG is one frame. We
 * split the stream on JPEG start/end markers and push each finished frame to the
 * React renderer over IPC, which draws it into an <img>/<canvas>.
 *
 *   RTSP camera ──▶ FFmpeg (decode + re-encode to JPEG) ──▶ stdout ──▶ Electron
 *                                                                        │
 *                                                                        ▼
 *                                                          IPC frame ──▶ React <img>
 *
 * PROS: dead simple, works everywhere, no browser codec needed.
 * CONS: re-encoding every frame is CPU-heavy and JPEG is bandwidth-heavy, so it
 *       does not scale to a 16-camera grid. For production use FfmpegFmp4.js,
 *       which copies the H.264 stream without re-encoding.
 *
 * FFmpeg command explained:
 *   -rtsp_transport tcp   force RTP over TCP (reliable, firewall-friendly)
 *   -i <url>              the input RTSP URL (FFmpeg does its OWN handshake here)
 *   -f mpjpeg             output format: multipart motion-JPEG
 *   -q:v 6                JPEG quality (2=best .. 31=worst); 6 is a good balance
 *   pipe:1               write to stdout so we can read frames in Node
 * ----------------------------------------------------------------------------
 */
const { spawn } = require('child_process');

const SOI = Buffer.from([0xff, 0xd8]); // JPEG Start Of Image
const EOI = Buffer.from([0xff, 0xd9]); // JPEG End Of Image

class FfmpegMjpeg {
  /**
   * @param {string} url          RTSP URL (may include user:pass@)
   * @param {function} onFrame    called with a Buffer per JPEG frame
   * @param {string} ffmpegPath   path to ffmpeg binary (default: 'ffmpeg' on PATH)
   * @param {object} log
   */
  constructor(url, onFrame, ffmpegPath = 'ffmpeg', log = console) {
    this.url = url;
    this.onFrame = onFrame;
    this.ffmpegPath = ffmpegPath;
    this.log = log;
    this.proc = null;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    const args = [
      '-rtsp_transport', 'tcp',
      '-timeout', '5000000', // 5s socket timeout for RTSP
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-probesize', '100000',
      '-analyzeduration', '100000',
      '-i', this.url,
      '-f', 'mpjpeg',
      '-q:v', '6',
      '-r', '15',        // cap output to 15 fps to save CPU
      'pipe:1',
    ];
    this.log.line('sys', `Spawning: ffmpeg ${args.join(' ').replace(this.url, this._safeUrl())}`);
    this.proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.proc.stdout.on('data', (chunk) => this._extractFrames(chunk));
    this.proc.stderr.on('data', (d) => {
      // FFmpeg prints diagnostics to stderr; surface the interesting lines only.
      const s = d.toString();
      if (/error|failed|Connection|Stream #/i.test(s)) this.log.line('ff', s.trim());
    });
    this.proc.on('close', (code) => this.log.line('sys', `ffmpeg exited (${code}).`));
  }

  /** Pull complete JPEG frames (SOI ... EOI) out of the byte stream. */
  _extractFrames(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const start = this.buffer.indexOf(SOI);
      if (start === -1) return;
      const end = this.buffer.indexOf(EOI, start + 2);
      if (end === -1) return; // frame not fully received yet
      const frame = this.buffer.subarray(start, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      this.onFrame(frame); // one full JPEG image
    }
  }

  _safeUrl() {
    return this.url.replace(/\/\/[^@]+@/, '//***:***@'); // hide credentials in logs
  }

  stop() {
    if (this.proc) this.proc.kill('SIGKILL');
    this.proc = null;
  }
}

module.exports = FfmpegMjpeg;
