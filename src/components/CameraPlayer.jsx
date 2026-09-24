// ---------------------------------------------------------------------------
// CameraPlayer.jsx
// ---------------------------------------------------------------------------
// The component that actually shows a live camera. It supports BOTH render
// modes exposed by the Electron backend:
//
//   mode="mjpeg" -> receives one JPEG Buffer per frame over IPC ("camera:frame")
//                   and paints it into an <img> via an object URL. Simple.
//
//   mode="fmp4"  -> receives fragmented-MP4 chunks over IPC ("camera:segment")
//                   and feeds them into a MediaSource SourceBuffer attached to a
//                   <video>. Low CPU / low latency, scales to many cameras.
//
// It also asks Electron to open the stream on mount and to close it on unmount,
// so leaving a page tears the FFmpeg process and RTSP session down cleanly.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';

export default function CameraPlayer({ camera, mode = 'fmp4', handshake = false, objectFit, style }) {
  const imgRef = useRef(null);
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const lastUrl = useRef(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) { setError('Electron bridge unavailable (run inside the desktop app).'); return; }

    let mediaSource = null;
    let sourceBuffer = null;
    let isDisposed = false;
    let queue = []; // fMP4 chunks waiting for the SourceBuffer to be ready
    let hasAppendedInit = false;
    let initSegment = null;

    // ----- MJPEG: swap the <img> src each frame -----
    function handleFrame({ cameraId, data }) {
      if (isDisposed || cameraId !== camera.id || !imgRef.current) return;
      const blob = new Blob([data], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      imgRef.current.src = url;
      // Revoke the previous URL to avoid leaking memory (one per frame!).
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
    }

    // Prune old buffered video to prevent MSE buffer from exceeding quota and freezing
    function pruneBuffer() {
      if (!sourceBuffer || sourceBuffer.updating || !videoRef.current) return;
      if (!mediaSource || mediaSource.readyState !== 'open') return;
      try {
        const video = videoRef.current;
        if (sourceBuffer.buffered && sourceBuffer.buffered.length > 0) {
          const start = sourceBuffer.buffered.start(0);
          const current = video.currentTime;
          // Keep only the last 6 seconds of history behind playhead
          if (current - start > 8) {
            sourceBuffer.remove(start, current - 4);
          }
        }
      } catch (_) {}
    }

    // ----- fMP4: append chunks to the MediaSource -----
    function pump() {
      if (isDisposed || !sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
      if (!mediaSource || mediaSource.readyState !== 'open') return;
      try {
        const chunk = queue.shift();
        if (chunk) {
          sourceBuffer.appendBuffer(chunk);
          hasAppendedInit = true;
        }
      } catch (e) {
        // If buffer is full, evict old buffered ranges
        if (sourceBuffer && !sourceBuffer.updating && sourceBuffer.buffered && sourceBuffer.buffered.length > 0 && mediaSource && mediaSource.readyState === 'open') {
          try {
            sourceBuffer.remove(sourceBuffer.buffered.start(0), sourceBuffer.buffered.end(0) - 2);
          } catch (_) {}
        }
      }
    }

    const playerId = 'player-' + Math.random().toString(36).slice(2, 9);

    function handleSegment({ cameraId, data, targetPlayerId }) {
      if (isDisposed || cameraId !== camera.id) return;
      if (targetPlayerId && targetPlayerId !== playerId) return;
      
      const uint8 = new Uint8Array(data);
      if (!hasAppendedInit && uint8.length >= 8) {
        const boxType = String.fromCharCode(uint8[4], uint8[5], uint8[6], uint8[7]);
        if (boxType === 'ftyp') {
          initSegment = uint8;
        }
      }

      queue.push(uint8);

      // Prevent memory accumulation while safely keeping the init header
      if (queue.length > 50) {
        if (!hasAppendedInit && initSegment) {
          queue = [initSegment, ...queue.slice(-20)];
        } else {
          queue = queue.slice(-25);
        }
      }

      pump();
    }

    // Low-latency catch-up controller for MSE <video> tag
    const handleTimeUpdate = () => {
      const video = videoRef.current;
      if (!video) return;
      if (video.buffered && video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const delay = bufferedEnd - video.currentTime;
        // If lag accumulates past 1.5 seconds, catch up immediately
        if (delay > 1.5) {
          video.currentTime = Math.max(0, bufferedEnd - 0.2);
        }
      }
      if (video.paused && !video.ended) {
        video.play().catch(() => {});
      }
    };

    // Watchdog to detect stalled/frozen video and auto-resume
    let lastTime = -1;
    let stallCount = 0;
    const watchdogTimer = setInterval(() => {
      if (isDisposed) return;
      const video = videoRef.current;
      if (!video) return;

      if (video.buffered && video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const delay = bufferedEnd - video.currentTime;
        
        // Auto-play if paused
        if (video.paused && !video.ended) {
          video.play().catch(() => {});
        }

        // Check if playback is stuck
        if (Math.abs(video.currentTime - lastTime) < 0.05) {
          stallCount++;
          if (stallCount >= 2) {
            // Video is frozen on a frame: jump playhead to the live tip
            video.currentTime = Math.max(0, bufferedEnd - 0.15);
            video.play().catch(() => {});
            stallCount = 0;
          }
        } else {
          stallCount = 0;
        }
        lastTime = video.currentTime;

        // Catch up on drift
        if (delay > 1.5) {
          video.currentTime = Math.max(0, bufferedEnd - 0.2);
        }
      }

      pruneBuffer();
    }, 1500);

    let unsubscribe;

    let mediaSourceUrl = null;

    const onSourceOpen = () => {
      if (isDisposed || !mediaSource || mediaSource.readyState !== 'open') return;
      if (sourceBuffer || mediaSource.sourceBuffers.length > 0) {
        sourceBuffer = sourceBuffer || mediaSource.sourceBuffers[0];
        return;
      }
      try {
        sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
        sourceBuffer.addEventListener('updateend', () => {
          pruneBuffer();
          pump();
          const v = videoRef.current;
          if (v && v.paused && !v.ended) {
            v.play().catch(() => {});
          }
        });
        sourceBuffer.addEventListener('error', () => {
          pump();
        });
        pump();
      } catch (err) {
        console.error('[CameraPlayer] addSourceBuffer failed:', err);
      }
    };

    if (mode === 'fmp4') {
      mediaSource = new MediaSource();
      const videoEl = videoRef.current;
      if (videoEl) {
        mediaSourceUrl = URL.createObjectURL(mediaSource);
        videoEl.src = mediaSourceUrl;
        mediaSource.addEventListener('sourceopen', onSourceOpen);
        videoEl.addEventListener('timeupdate', handleTimeUpdate);
      }
      unsubscribe = api.onSegment(handleSegment);
    } else {
      unsubscribe = api.onFrame(handleFrame);
    }

    // Tell the main process to start streaming this camera.
    api.openCamera({ cameraId: camera.id, url: camera.rtsp_url, mode, handshake, playerId })
      .catch((e) => setError(e.message));

    // Cleanup on unmount / camera change.
    return () => {
      isDisposed = true;
      clearInterval(watchdogTimer);
      if (unsubscribe) unsubscribe();
      if (mode === 'fmp4' && videoRef.current) {
        videoRef.current.removeEventListener('timeupdate', handleTimeUpdate);
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      if (mediaSource) {
        mediaSource.removeEventListener('sourceopen', onSourceOpen);
        if (mediaSource.readyState === 'open') {
          try {
            mediaSource.endOfStream();
          } catch (_) {}
        }
      }
      if (mediaSourceUrl) {
        URL.revokeObjectURL(mediaSourceUrl);
      }
      api.closeCamera({ cameraId: camera.id, playerId }).catch(() => {});
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, [camera.id, camera.rtsp_url, mode, handshake]);

  // The player renders the MEDIA only — never the frame. Every caller already
  // wraps it in its own sized tile (.camera-tile, .wb-cam-tile, the preview
  // modal's box), so claiming .camera-tile here nested a tile inside a tile:
  // a second border, inner rounded corners, an inner hover ring, and the
  // `max-height: 220px` short-screen clamp firing on the video itself.
  const mediaStyle = {
    ...(objectFit ? { objectFit } : {}),
    ...style
  };

  if (error) return <div className="camera-media camera-media-error" style={mediaStyle}>{error}</div>;
  return mode === 'fmp4'
    ? <video ref={videoRef} className="camera-media" style={mediaStyle} autoPlay muted playsInline />
    : <img ref={imgRef} className="camera-media" style={mediaStyle} alt={camera.name} />;
}


