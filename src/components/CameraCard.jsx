// A dashboard tile: shows a live player plus name/status and quick actions.
import React from 'react';
import { Link } from 'react-router-dom';
import CameraPlayer from './CameraPlayer.jsx';
import StatusBadge from './StatusBadge.jsx';

export default function CameraCard({ camera }) {
  return (
    <div className="col">
      <div className="camera-tile mb-1">
        <CameraPlayer camera={camera} />
        <span className="tile-label">{camera.name}</span>
      </div>
      <div className="d-flex justify-content-between align-items-center px-1">
        <StatusBadge state={camera.status} />
        <Link to={`/camera/${camera.id}`} className="btn btn-sm btn-outline-light py-0">Open</Link>
      </div>
    </div>
  );
}
