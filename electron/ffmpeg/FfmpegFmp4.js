'use strict';
/**
 * FfmpegFmp4.js
 * ----------------------------------------------------------------------------
 * The PRODUCTION rendering pipeline — low CPU, low latency, scales to many
 * cameras.
 *
 * Instead of re-encoding to JPEG, we ask FFmpeg to COPY the camera's existing
 * H.264 bitstream (no decode/encode on our machine) and wrap it in "fragmented
 * MP4". The browser/Chromium inside Electron then decodes H.264 in hardware via
 * Media Source Extensions (MSE). Electron ships with proprietary codecs enabled,
 * so H.264 playback works out of the box.
 *
 *   RTSP camera ──▶ FFmpeg (-c:v copy, wrap as fMP4) ──▶ stdout ──▶ Electron
 *                                                                     │
 *                                                                     ▼
 *                                              IPC segments ──▶ MSE SourceBuffer ──▶ <video>
 *
 * FFmpeg command explained:
 *   -rtsp_transport tcp                          reliable RTP-over-TCP
 *   -i <url>                                     input camera
 *   -an                                          drop audio (optional)
 *   -c:v copy                                    DO NOT re-encode -> tiny CPU cost
 *   -f mp4                                       MP4 container
 *   -movflags frag_keyframe+empty_moov+default_base_moof   make it *streamable*
 *   pipe:1                                       write fMP4 to stdout
 *
 * The renderer appends each chunk to a MediaSource SourceBuffer (see
 * src/components/CameraPlayer.jsx, fMP4 branch).
 * ----------------------------------------------------------------------------
 */
const { spawn } = require('child_process');

class FfmpegFmp4 {
  constructor(url, onSegment, ffmpegPath = 'ffmpeg', log = console) {
    this.url = url;
    this.onSegment = onSegment; // called with raw fMP4 Buffers
    this.ffmpegPath = ffmpegPath;
    this.log = log;
    this.proc = null;
    this.stopped = false;
    this.restartTimer = null;
    this.initSegment = null;
    this.initAccumulator = [];
    this.hasFoundMoof = false;
  }

  start() {
    if (this.stopped) return;
    if (this.proc) this.stop(false);
    this.initSegment = null;
    this.initAccumulator = [];
    this.hasFoundMoof = false;

    const args = [
      '-rtsp_transport', 'tcp',
      '-timeout', '5000000', // 5s socket timeout for RTSP (microseconds)
      '-fflags', 'nobuffer+flush_packets',
      '-flags', 'low_delay',
      '-probesize', '100000',
      '-analyzeduration', '100000',
      '-i', this.url,
      '-an',
      '-c:v', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    ];
    this.log.line('sys', 'Spawning FFmpeg (fMP4 copy pipeline).');
    try {
      this.proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      
      this.proc.stdout.on('data', (chunk) => {
        if (!chunk || chunk.length === 0) return;

        if (!this.hasFoundMoof) {
          this.initAccumulator.push(chunk);
          const combined = Buffer.concat(this.initAccumulator);
          const moofIdx = combined.indexOf('moof');
          if (moofIdx >= 4) {
            // Found the start of the first media fragment box (4-byte size + 'moof')
            this.initSegment = combined.slice(0, moofIdx - 4);
            this.hasFoundMoof = true;
            this.initAccumulator = [];
          } else if (combined.length > 32768) {
            this.initSegment = combined;
            this.hasFoundMoof = true;
            this.initAccumulator = [];
          }
        }

        if (!this.stopped) this.onSegment(chunk);
      });
      
      this.proc.stderr.on('data', (d) => {
        const s = d.toString();
        if (/error|failed|Connection|Stream #/i.test(s)) this.log.line('ff', s.trim());
      });
      
      this.proc.on('close', (code) => {
        this.log.line('sys', `ffmpeg exited (${code}).`);
        this.proc = null;
        if (!this.stopped) {
          // Auto-reconnect after 1.5s if process closed unexpectedly
          if (this.restartTimer) clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            if (!this.stopped) {
              this.log.line('sys', 'Auto-reconnecting FFmpeg RTSP stream...');
              this.start();
            }
          }, 1500);
        }
      });

      this.proc.on('error', (err) => {
        this.log.line('err', `FFmpeg process error: ${err.message}`);
      });
    } catch (err) {
      this.log.line('err', `Failed to spawn FFmpeg: ${err.message}`);
    }
  }

  stop(markStopped = true) {
    if (markStopped) this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.proc) {
      try { this.proc.kill('SIGKILL'); } catch (_) {}
      this.proc = null;
    }
  }
}

module.exports = FfmpegFmp4;
