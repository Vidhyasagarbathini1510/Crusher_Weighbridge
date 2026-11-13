import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { sendRawToPrinter } from '../utils/salesSummaryPrinter.js';

/**
 * Dot matrix print preview with "Send to Printer", shared by the reports that
 * follow Settings → "Reports Print Output Mode". Render it only while open.
 * Same look as the Sales Summary preview (white paper / dark terminal, copy).
 */
export default function DotMatrixPreviewModal({ title, badge, previewText, rawText, onClose }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('noris_dot_matrix_preview_theme') || 'white');
  const [isSending, setIsSending] = useState(false);
  const isWhite = theme === 'white';

  // Escape closes the preview
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSend = async () => {
    try {
      setIsSending(true);
      await sendRawToPrinter(rawText);
      onClose();
    } catch (err) {
      console.error('[DotMatrixPreviewModal] Failed to print:', err);
      alert('Failed to print: ' + (err?.message || err));
    } finally {
      setIsSending(false);
    }
  };

  const sendLabel = isSending ? (
    <>
      <span className="spinner-border spinner-border-sm me-1" role="status"></span>
      Printing...
    </>
  ) : '🖨️ Send to Printer';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-75 d-flex align-items-center justify-content-center p-2 p-md-3"
      style={{ zIndex: 99999 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card shadow-lg w-100 d-flex flex-column border-0"
        style={{ maxWidth: '1120px', height: '92vh', maxHeight: '92vh', borderRadius: '10px', overflow: 'hidden' }}
      >
        <div className="card-header bg-dark text-white d-flex flex-wrap justify-content-between align-items-center py-2 px-3 flex-shrink-0 gap-2" style={{ zIndex: 10 }}>
          <div className="d-flex align-items-center gap-2">
            <span className="fw-bold text-truncate" style={{ fontSize: '0.92rem' }}>{title}</span>
            {badge && <span className="badge bg-success text-white" style={{ fontSize: '0.72rem' }}>{badge}</span>}
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className={`btn btn-sm ${isWhite ? 'btn-light text-dark fw-bold' : 'btn-outline-light'} px-2 py-1.5`}
              style={{ fontSize: '0.78rem' }}
              onClick={() => {
                const next = isWhite ? 'dark' : 'white';
                setTheme(next);
                localStorage.setItem('noris_dot_matrix_preview_theme', next);
              }}
              title="Toggle White Paper / Dark Terminal mode"
            >
              {isWhite ? '📄 White Paper' : '🌙 Dark Terminal'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-light fw-semibold px-2 py-1.5"
              onClick={(e) => {
                navigator.clipboard?.writeText(previewText);
                const btn = e.currentTarget;
                btn.innerText = '✓ Copied';
                setTimeout(() => { btn.innerText = '📋 Copy'; }, 2000);
              }}
              title="Copy preview text"
              style={{ fontSize: '0.8rem' }}
            >
              📋 Copy
            </button>
            <button
              type="button"
              className="btn btn-sm btn-success fw-bold px-3 py-1.5 d-flex align-items-center gap-1.5 shadow-sm"
              onClick={handleSend}
              disabled={isSending}
              style={{ fontSize: '0.82rem' }}
            >
              {sendLabel}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-light fw-bold px-2.5 py-1.5"
              onClick={onClose}
              style={{ fontSize: '0.8rem' }}
              title="Close (Esc)"
            >
              ✕ Close
            </button>
          </div>
        </div>

        <div
          className={`card-body p-0 overflow-auto flex-grow-1 ${isWhite ? 'bg-light' : 'bg-dark'}`}
          style={{ minHeight: 0, backgroundColor: isWhite ? '#f1f5f9' : '#090d16' }}
        >
          <div className="p-3 d-flex justify-content-center">
            <div
              className="p-4"
              style={{
                backgroundColor: isWhite ? '#ffffff' : '#0f172a',
                color: isWhite ? '#000000' : '#38bdf8',
                fontFamily: '"Courier New", Courier, Consolas, monospace',
                fontSize: '0.82rem',
                fontWeight: isWhite ? '600' : '500',
                lineHeight: '1.45',
                whiteSpace: 'pre',
                overflowX: 'auto',
                minWidth: '980px',
                width: '100%',
                borderRadius: '6px',
                border: isWhite ? '1px solid #cbd5e1' : '1px solid #1e293b',
                boxShadow: isWhite ? '0 4px 15px rgba(0,0,0,0.06)' : 'none'
              }}
            >
              {previewText}
            </div>
          </div>
        </div>

        <div className="card-footer bg-light border-top d-flex flex-wrap justify-content-between align-items-center py-2 px-3 flex-shrink-0 gap-2">
          <span className="text-muted small">Continuous stationery format • ESC/P high-speed dot matrix output</span>
          <div className="d-flex align-items-center gap-2 ms-auto">
            <button type="button" className="btn btn-sm btn-secondary fw-semibold px-3 py-1.5" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-sm btn-success fw-bold px-4 py-1.5 d-flex align-items-center gap-1.5 shadow"
              onClick={handleSend}
              disabled={isSending}
              style={{ fontSize: '0.85rem' }}
            >
              {sendLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
