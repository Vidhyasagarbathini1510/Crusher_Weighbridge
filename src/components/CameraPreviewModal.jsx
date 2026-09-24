import React, { useEffect } from 'react';
import CameraPlayer from './CameraPlayer.jsx';

export default function CameraPreviewModal({ camera, onClose }) {
  // ESC key listener to quickly dismiss preview
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!camera) return null;

  return (
    <div 
      className="position-fixed top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center" 
      style={{ 
        zIndex: 9999, 
        backgroundColor: 'rgba(5, 10, 20, 0.82)', 
        backdropFilter: 'blur(8px)',
        padding: '16px'
      }}
      onClick={onClose}
    >
      {/* Centered Modal Container - Half Screen Size */}
      <div 
        className="d-flex flex-column shadow-2xl"
        style={{ 
          width: '100%', 
          maxWidth: '780px',
          maxHeight: '88vh'
        }}
        onClick={(e) => e.stopPropagation()}
      >

        {/* Main Video Frame with 16:9 ratio and contain to show full view */}
        <div 
          className="position-relative overflow-hidden rounded-3 shadow-2xl"
          style={{ 
            width: '100%', 
            aspectRatio: '16 / 9',
            maxHeight: 'calc(80vh - 60px)',
            backgroundColor: '#000000',
            border: '1.5px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {/* Live Stream with objectFit="contain" to prevent any cutting/cropping */}
          <CameraPlayer camera={camera} handshake={false} objectFit="contain" />

          {/* Bottom OSD Information Overlay */}
          <div 
            className="position-absolute bottom-0 start-0 end-0 px-3 py-2 d-flex justify-content-between align-items-center text-white"
            style={{ 
              background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
              pointerEvents: 'none',
              zIndex: 10
            }}
          >
            <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.80rem' }}>
              <span className="text-success fw-bold">● ONLINE</span>
              <span>|</span>
              <span className="fw-semibold text-white-50">{camera.rtsp_url ? 'RTSP HD Stream' : 'Camera Feed'}</span>
            </div>

            <div className="text-white-50" style={{ fontSize: '0.75rem' }}>
              Click anywhere outside or press <b className="text-white">ESC</b> to close
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
