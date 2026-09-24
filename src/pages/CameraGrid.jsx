// Camera Grid with switchable 4 / 9 / 16 layouts, plus a search box.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Loader from '../components/Loader.jsx';

export default function CameraGrid() {
  const [cameras, setCameras] = useState(null);
  const [layout, setLayout] = useState(4);   // 4, 9, or 16
  const [query, setQuery] = useState('');

  useEffect(() => { api.cameras().then(setCameras).catch(() => setCameras([])); }, []);

  const cols = { 4: 2, 9: 3, 16: 4 }[layout];
  const filtered = useMemo(
    () => (cameras || []).filter((c) => c.name.toLowerCase().includes(query.toLowerCase())),
    [cameras, query]
  );

  if (!cameras) return <Loader label="Loading grid…" />;

  return (
    <div>
      <div className="d-flex gap-2 mb-3">
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Search cameras…"
               value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="btn-group">
          {[4, 9, 16].map((n) => (
            <button key={n} className={`btn btn-sm ${layout === n ? 'btn-warning' : 'btn-outline-light'}`}
                    onClick={() => setLayout(n)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="row g-2" style={{ ['--bs-gutter-x']: '0.5rem' }}>
        {filtered.slice(0, layout).map((c) => (
          <div key={c.id} className={`col-${12 / cols}`}>
            <div className="camera-tile">
              <CameraPlayer camera={c} />
              <span className="tile-label">{c.name} <StatusBadge state={c.status} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
