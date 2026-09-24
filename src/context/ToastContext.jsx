import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 7);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (msg, duration) => addToast(msg, 'success', duration),
    error: (msg, duration) => addToast(msg, 'danger', duration),
    warning: (msg, duration) => addToast(msg, 'warning', duration),
    info: (msg, duration) => addToast(msg, 'info', duration),
  };

  return (
    <ToastContext.Provider value={{ toast, addToast, removeToast }}>
      {children}
      {/* Toast floating container */}
      <div
        className="toast-container position-fixed top-0 end-0 p-3"
        style={{ zIndex: 9999, pointerEvents: 'none' }}
      >
        {toasts.map((t) => {
          let bgClass = 'bg-primary text-white';
          let icon = 'ℹ️';
          if (t.type === 'success') {
            bgClass = 'bg-success text-white';
            icon = '✓';
          } else if (t.type === 'danger' || t.type === 'error') {
            bgClass = 'bg-danger text-white';
            icon = '⚠️';
          } else if (t.type === 'warning') {
            bgClass = 'bg-warning text-dark';
            icon = '⚠️';
          }

          return (
            <div
              key={t.id}
              className={`toast show align-items-center ${bgClass} border-0 mb-2 shadow-lg`}
              role="alert"
              style={{
                pointerEvents: 'auto',
                minWidth: '260px',
                borderRadius: '6px',
                animation: 'fadeIn 0.2s ease-in-out'
              }}
            >
              <div className="d-flex">
                <div className="toast-body d-flex align-items-center gap-2 py-2 px-3 fw-medium" style={{ fontSize: '0.85rem' }}>
                  <span>{icon}</span>
                  <span>{t.message}</span>
                </div>
                <button
                  type="button"
                  className={`btn-close ${t.type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto`}
                  onClick={() => removeToast(t.id)}
                  style={{ fontSize: '0.75rem' }}
                ></button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      toast: {
        success: (msg) => console.log('[Toast Success]', msg),
        error: (msg) => console.error('[Toast Error]', msg),
        warning: (msg) => console.warn('[Toast Warning]', msg),
        info: (msg) => console.log('[Toast Info]', msg),
      },
      addToast: () => {},
      removeToast: () => {}
    };
  }
  return context;
}
