// Single camera view with fullscreen, snapshot, reconnect, and — importantly —
// the LIVE PROTOCOL CONSOLE that streams every RTSP/RTP log line from the main
// process. This is the "learning mode" surface described in the spec.
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';

export default function SingleCamera() {
  const { id } = useParams();
  const [camera, setCamera] = useState(null);
  const [logs, setLogs] = useState([]);
  const [reloadKey, setReloadKey] = useState(0); // bump to force a reconnect
  const tileRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    api.cameras().then((list) => setCamera(list.find((c) => String(c.id) === id)));
  }, [id]);

  useEffect(() => {
    if (!window.electronAPI) return;
    // Subscribe to protocol log lines coming from Electron main.
    const unsubscribe = window.electronAPI.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-400), entry]); // keep last 400 lines
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => { // auto-scroll console
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function fullscreen() { tileRef.current?.requestFullscreen?.(); }

  function snapshot() {
    // Grab the currently displayed <img>/<video> into a canvas and download it.
    const el = tileRef.current.querySelector('img, video');
    if (!el) return;
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth || el.naturalWidth || 1280;
    canvas.height = el.videoHeight || el.naturalHeight || 720;
    canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${camera.name}-${Date.now()}.png`;
    a.click();
  }

  if (!camera) return <Loader label="Loading camera…" />;

  return (
    <div className="row g-3">
      <div className="col-lg-8">
        <div className="camera-tile" ref={tileRef}>
          {/* reloadKey in the key forces CameraPlayer to remount = reconnect */}
          <CameraPlayer key={reloadKey} camera={camera} handshake={true} />
          <span className="tile-label">{camera.name}</span>
        </div>
        <div className="d-flex gap-2 mt-2">
          <button className="btn btn-sm btn-outline-light" onClick={() => setReloadKey((k) => k + 1)}>Reconnect</button>
          <button className="btn btn-sm btn-outline-light" onClick={fullscreen}>Fullscreen</button>
          <button className="btn btn-sm btn-outline-light" onClick={snapshot}>Snapshot</button>
        </div>
      </div>
      <div className="col-lg-4">
        <div className="fw-bold mb-1 small text-secondary">RTSP / RTP protocol console</div>
        <div className="console-log" ref={logRef}>
          {logs.map((l, i) => (
            <div key={i} className={`log-${l.direction}`}>
              {l.direction === 'out' ? '>>> ' : l.direction === 'in' ? '<<< ' : ''}
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
