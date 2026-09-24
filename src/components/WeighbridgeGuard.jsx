import React from 'react';
import { useScale } from '../context/ScaleContext.jsx';

export default function WeighbridgeGuard({ children }) {
  const { isConnected } = useScale();

  if (!isConnected) {
    return (
      <div 
        className="d-flex flex-column align-items-center justify-content-center text-center p-5 rounded-3 animate-fade-in" 
        style={{ 
          minHeight: '450px',
          background: 'var(--surface-2, #F8FAFC)',
          border: '1px dashed var(--danger, #EF4444)',
          margin: '20px auto',
          maxWidth: '800px',
          borderRadius: 'var(--radius, 12px)',
          boxShadow: 'var(--shadow, 0 4px 16px rgba(0,0,0,0.05))'
        }}
      >
        <div 
          className="d-flex align-items-center justify-content-center mb-4" 
          style={{ 
            width: '80px', 
            height: '80px', 
            borderRadius: '50%', 
            backgroundColor: 'var(--danger-soft, #FDECEC)', 
            color: 'var(--danger, #EF4444)',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.15)'
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.5a3 3 0 0 0-2.67-2.5" />
            <path d="M5 12.5a10.94 10.94 0 0 1 5.83-2.84" />
            <path d="M12 5V3" />
            <path d="M12 13v8" />
            <path d="M19.07 4.93l-1.41 1.41" />
            <path d="M6.34 17.66l-1.41 1.41" />
            <path d="M4.93 4.93l1.41 1.41" />
            <path d="M17.66 17.66l1.41 1.41" />
          </svg>
        </div>
        
        <h4 className="fw-bold text-danger mb-2" style={{ letterSpacing: '-0.01em' }}>
          Weighbridge Status: Disconnected
        </h4>
        
        <p className="text-muted mb-4" style={{ maxWidth: '460px', fontSize: '0.9rem', lineHeight: '1.5' }}>
          Please connect the weighbridge to perform weighment operations.
        </p>

        <div className="d-flex align-items-center gap-2 px-3 py-1.5 rounded-pill bg-white border border-secondary-subtle">
          <span className="spinner-border spinner-border-sm text-danger" role="status"></span>
          <span className="text-secondary fw-semibold text-uppercase" style={{ fontSize: '0.68rem', letterSpacing: '0.06em' }}>
            Waiting for connection...
          </span>
        </div>
      </div>
    );
  }

  return children;
}
