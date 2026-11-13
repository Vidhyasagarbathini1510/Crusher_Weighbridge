import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext.jsx';

export default function UpdateModal() {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadedMB, setDownloadedMB] = useState('0');
  const [totalMB, setTotalMB] = useState('0');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Listen for background auto-detected updates
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUpdateAvailable) return;
    const unsubscribe = window.electronAPI.onUpdateAvailable((info) => {
      if (info && info.hasUpdate) {
        setUpdateInfo(info);
        setShow(true);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // 2. Listen for manual "Check Updates" button clicks
  useEffect(() => {
    const handleManualCheck = async () => {
      if (!window.electronAPI || !window.electronAPI.checkForUpdates) return;
      try {
        const info = await window.electronAPI.checkForUpdates();
        if (info && info.hasUpdate) {
          setUpdateInfo(info);
          setShow(true);
          setErrorMsg('');
          // Navbar icon click: start downloading the .exe right away
          startDownload(info);
        } else if (info && info.error) {
          toast?.warning?.('Update check: ' + info.error);
        } else {
          toast?.success?.('You are on the latest version (' + (info?.currentVersion || 'v1.0.2') + ')');
        }
      } catch (err) {
        toast?.error?.('Failed to check updates: ' + (err.message || 'Network error'));
      }
    };

    window.addEventListener('trigger-check-updates', handleManualCheck);
    return () => {
      window.removeEventListener('trigger-check-updates', handleManualCheck);
    };
  }, []);

  // 3. Listen for download progress from Electron
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUpdateProgress) return;
    const unsubscribe = window.electronAPI.onUpdateProgress((prog) => {
      if (prog) {
        setProgress(prog.percent || 0);
        const received = ((prog.receivedBytes || 0) / (1024 * 1024)).toFixed(1);
        const total = ((prog.totalBytes || 0) / (1024 * 1024)).toFixed(1);
        setDownloadedMB(received);
        setTotalMB(total);

        if (prog.percent >= 100) {
          setStatusMessage('Download complete! Installing and restarting application...');
        } else {
          setStatusMessage(`Downloading update... ${prog.percent}%`);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // 4. Listen for asynchronous download errors
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUpdateError) return;
    const unsubscribe = window.electronAPI.onUpdateError((err) => {
      setErrorMsg(err || 'Failed to download update.');
      setDownloading(false);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const startDownload = async (info) => {
    if (!info || !info.downloadUrl) return;
    setDownloading(true);
    setProgress(0);
    setErrorMsg('');
    setStatusMessage('Connecting to server...');

    try {
      await window.electronAPI.startUpdateDownload(info.downloadUrl);
    } catch (err) {
      console.error('[UpdateModal] Update failed:', err);
      setErrorMsg(err.message || 'Failed to download update. Please check internet connection.');
      setDownloading(false);
    }
  };

  const handleStartUpdate = () => startDownload(updateInfo);

  const handleClose = () => {
    if (downloading) return; // Prevent closing mid-download
    setShow(false);
  };

  if (!show || !updateInfo) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(10, 15, 25, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          overflow: 'hidden',
          border: '1px solid rgba(201, 162, 39, 0.3)',
          animation: 'fadeInUp 0.25s ease-out'
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            padding: '22px 24px',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '2px solid var(--gold-bright, #c9a227)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(201, 162, 39, 0.18)',
                border: '1px solid rgba(201, 162, 39, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#e8c25a'
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div>
              <h5 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#ffffff' }}>Software Update Available</h5>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Crusher Weighbridge Desktop</div>
            </div>
          </div>
          {!downloading && (
            <button
              onClick={handleClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '1.4rem',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '4px'
              }}
              title="Close"
            >
              ×
            </button>
          )}
        </div>

        {/* Body Content */}
        <div style={{ padding: '24px' }}>
          {/* Version Comparison Card */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '18px'
            }}
          >
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Version</span>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginTop: '2px' }}>
                v{updateInfo.currentVersion || '1.0.1'}
              </div>
            </div>

            <div style={{ color: '#c9a227', fontSize: '1.2rem', fontWeight: 'bold' }}>➔</div>

            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Version</span>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#047857', marginTop: '2px' }}>
                v{updateInfo.latestVersion || '1.0.2'}
              </div>
            </div>
          </div>

          {/* Release Notes */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>
              What's New in this Update:
            </label>
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '0.85rem',
                color: '#1e293b',
                lineHeight: '1.45',
                maxHeight: '90px',
                overflowY: 'auto'
              }}
            >
              {updateInfo.releaseNotes}
            </div>
          </div>

          {/* Download Progress Bar Section */}
          {downloading && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>
                  {statusMessage || 'Downloading update...'}
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#047857' }}>
                  {progress}%
                </span>
              </div>

              {/* Progress track */}
              <div
                style={{
                  width: '100%',
                  height: '10px',
                  backgroundColor: '#e2e8f0',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                    borderRadius: '999px',
                    transition: 'width 0.2s ease-in-out'
                  }}
                />
              </div>

              {totalMB !== '0' && totalMB !== '0.0' && (
                <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '6px', textAlign: 'right' }}>
                  {downloadedMB} MB / {totalMB} MB
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                marginBottom: '16px'
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            {!downloading ? (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '0.86rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={handleStartUpdate}
                  style={{
                    padding: '9px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                    color: '#ffffff',
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(5, 150, 105, 0.3)'
                  }}
                >
                  Update Now
                </button>
              </>
            ) : (
              <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', padding: '6px 0' }}>
                Please wait, do not turn off your computer...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
