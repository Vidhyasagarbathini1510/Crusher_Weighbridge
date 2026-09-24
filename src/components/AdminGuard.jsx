import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function AdminGuard({ children }) {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div 
        className="d-flex flex-column align-items-center justify-content-center text-center p-5 rounded-3 animate-fade-in" 
        style={{ 
          minHeight: '450px',
          background: 'var(--surface-2, #F8FAFC)',
          border: '1px dashed var(--danger, #EF4444)',
          margin: '40px auto',
          maxWidth: '650px',
          borderRadius: 'var(--radius, 12px)',
          boxShadow: 'var(--shadow, 0 4px 16px rgba(0,0,0,0.05))'
        }}
      >
        <div 
          className="d-flex align-items-center justify-content-center mb-4" 
          style={{ 
            width: '72px', 
            height: '72px', 
            borderRadius: '50%', 
            backgroundColor: 'var(--danger-soft, #FDECEC)', 
            color: 'var(--danger, #EF4444)',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.15)'
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        
        <h4 className="fw-bold text-danger mb-2">
          Access Denied
        </h4>
        
        <p className="text-muted mb-4" style={{ maxWidth: '420px', fontSize: '0.9rem', lineHeight: '1.5' }}>
          Settings and system configurations are restricted to <strong>Administrator</strong> accounts only.
        </p>

        <button 
          className="btn btn-primary px-4 py-2 rounded-3 fw-semibold"
          onClick={() => navigate('/')}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return children;
}
