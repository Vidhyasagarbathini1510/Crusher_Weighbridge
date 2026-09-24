'use strict';
/**
 * cameraHandlers.js
 * ----------------------------------------------------------------------------
 * The bridge between the React UI and the streaming engine. When React asks to
 * open a camera, we:
 *   1. Run the MANUAL RtspClient handshake (for logging/health + learning).
 *   2. Start an FFmpeg pipeline to actually produce displayable frames.
 *   3. Forward every log line and every video frame to the renderer over IPC.
 *
 * One "session" per open camera is tracked in a Map keyed by camera id, so we
 * can stop/reconnect them independently in a multi-camera grid.
 * ----------------------------------------------------------------------------
 */
const { ipcMain } = require('electron');
const RtspClient = require('../rtsp/RtspClient');
const FfmpegMjpeg = require('../ffmpeg/FfmpegMjpeg');
const FfmpegFmp4 = require('../ffmpeg/FfmpegFmp4');

const sessions = new Map(); // cameraId -> { rtsp, ffmpeg }

function makeLogger(win, cameraId) {
  // Every log line is sent to the renderer, which prints it in the on-screen
  // console so the RTSP/RTP conversation is visible "for learning purposes".
  return {
    line(direction, text) {
      if (!win.isDestroyed()) {
        win.webContents.send('camera:log', { cameraId, direction, text, at: Date.now() });
      }
    },
  };
}

/**
 * Turn a raw socket/RTSP failure into something an operator can act on.
 * The RtspClient rejects with the status line, e.g. "DESCRIBE failed:
 * RTSP/1.0 401 Unauthorized", so the status code is recoverable from the text.
 */
function classifyProbeError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (msg === '__timeout__') {
    return { code: 'timeout', message: 'No response from the camera. Check the IP address, RTSP port and network.' };
  }
  if (/\b401\b|Unauthorized/i.test(msg)) {
    return { code: 'auth', message: 'Camera rejected the username or password.' };
  }
  if (/\b40[34]\b|\b45[0-9]\b|Not Found/i.test(msg)) {
    return { code: 'path', message: 'Camera answered but refused this stream path. Check the brand and the Main/Sub selection.' };
  }
  if (/ECONNREFUSED/.test(msg)) {
    return { code: 'refused', message: 'Connection refused — nothing is listening on that RTSP port.' };
  }
  if (/EHOSTUNREACH|ENETUNREACH|EHOSTDOWN/.test(msg)) {
    return { code: 'unreachable', message: 'Camera is unreachable on the network.' };
  }
  if (/ETIMEDOUT/.test(msg)) {
    return { code: 'timeout', message: 'Connection timed out. Check the IP address and that the camera is powered on.' };
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) {
    return { code: 'dns', message: 'That host name could not be resolved.' };
  }
  return { code: 'failed', message: msg };
}

function registerCameraHandlers(win, getFfmpegPath) {
  // ---- TEST CAMERA ---------------------------------------------------------
  // Used by the Add Camera form to validate a generated RTSP URL before the
  // camera is saved. Read-only: it never creates or touches a streaming session.
  ipcMain.handle('camera:test', async (_e, { url, timeoutMs = 8000 } = {}) => {
    if (!url) return { ok: false, code: 'no-url', message: 'No RTSP URL to test.' };

    let client;
    try {
      client = new RtspClient(url, { line() {} });
    } catch (err) {
      return { ok: false, code: 'bad-url', message: `Invalid RTSP URL: ${err.message}` };
    }
    // The socket forwards failures as an 'error' event; an EventEmitter with no
    // listener would rethrow and take the main process down.
    client.on('error', () => {});

    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('__timeout__')), timeoutMs);
    });

    try {
      await Promise.race([client.probe(), timeout]);
      return { ok: true, code: 'connected', message: 'Connected — stream found on this path.' };
    } catch (err) {
      return { ok: false, ...classifyProbeError(err) };
    } finally {
      if (timer) clearTimeout(timer);
      try { if (client.socket) client.socket.destroy(); } catch (_) {}
    }
  });

  // ---- OPEN CAMERA ---------------------------------------------------------
  ipcMain.handle('camera:open', async (_e, { cameraId, url, mode = 'mjpeg', handshake = false, playerId }) => {
    let s = sessions.get(cameraId);

    // If an active session for this camera already exists with the same URL and mode
    if (s && s.url === url && s.mode === mode && s.ffmpeg && !s.ffmpeg.stopped) {
      if (s.closeTimer) {
        clearTimeout(s.closeTimer);
        s.closeTimer = null;
      }
      if (playerId) s.subscribers.add(playerId);

      // If in fMP4 mode and the stream has already captured the initSegment,
      // dispatch it immediately to the new player subscriber so MSE initializes without restarting FFmpeg
      if (mode === 'fmp4' && s.ffmpeg.initSegment && playerId) {
        if (!win.isDestroyed()) {
          win.webContents.send('camera:segment', { cameraId, data: s.ffmpeg.initSegment, targetPlayerId: playerId });
        }
      }
      return { ok: true };
    }

    // Otherwise close previous session and start fresh
    await closeSession(cameraId);
    const log = makeLogger(win, cameraId);
    const ffmpegPath = getFfmpegPath();

    let rtsp = null;
    if (handshake) {
      // (1) Manual RTSP handshake — the educational/health-check path (only if requested).
      rtsp = new RtspClient(url, log);
      rtsp.on('error', () => {}); // errors already logged; keep FFmpeg going anyway
      rtsp.start().catch((err) => log.line('err', `RTSP handshake failed: ${err.message}`));
    }

    // (2) FFmpeg — the path that actually paints pixels on screen.
    let ffmpeg;
    if (mode === 'fmp4') {
      ffmpeg = new FfmpegFmp4(url, (seg) => {
        if (!win.isDestroyed())
          win.webContents.send('camera:segment', { cameraId, data: seg });
      }, ffmpegPath, log);
    } else {
      ffmpeg = new FfmpegMjpeg(url, (frame) => {
        if (!win.isDestroyed())
          win.webContents.send('camera:frame', { cameraId, data: frame });
      }, ffmpegPath, log);
    }
    ffmpeg.start();

    const subscribers = new Set();
    if (playerId) subscribers.add(playerId);

    sessions.set(cameraId, { url, mode, rtsp, ffmpeg, subscribers, closeTimer: null });
    return { ok: true };
  });

  // ---- CONTROL: pause / resume / snapshot ----------------------------------
  ipcMain.handle('camera:pause', async (_e, { cameraId }) => {
    const s = sessions.get(cameraId);
    if (s && s.rtsp && s.rtsp.playing) await s.rtsp.pause();
    return { ok: true };
  });

  // ---- CLOSE CAMERA --------------------------------------------------------
  ipcMain.handle('camera:close', async (_e, { cameraId, playerId }) => {
    const s = sessions.get(cameraId);
    if (!s) return { ok: true };

    if (playerId && s.subscribers && s.subscribers.size > 0) {
      s.subscribers.delete(playerId);
      // If other players/views are still watching this camera, keep the stream alive!
      if (s.subscribers.size > 0) {
        return { ok: true };
      }
    }

    // Keep stream warm across page navigations and window refreshes for 2 minutes
    if (s.closeTimer) clearTimeout(s.closeTimer);
    s.closeTimer = setTimeout(async () => {
      if (s.subscribers.size === 0) {
        await closeSession(cameraId);
      }
    }, 120000);

    return { ok: true };
  });
}

async function closeSession(cameraId) {
  const s = sessions.get(cameraId);
  if (!s) return;
  if (s.closeTimer) {
    clearTimeout(s.closeTimer);
    s.closeTimer = null;
  }
  try { s.ffmpeg.stop(); } catch (_) {}
  try { if (s.rtsp) await s.rtsp.stop(); } catch (_) {}
  sessions.delete(cameraId);
}

module.exports = { registerCameraHandlers, classifyProbeError };
