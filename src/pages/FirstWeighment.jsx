import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';

import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getNextDcNumber, incrementDcNumber } from '../utils/dcHelper.js';
import { printTicket, getSelectedTemplate } from '../utils/printHelper.js';

export default function FirstWeighment() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [serialNo, setSerialNo] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');
  const [weight, setWeight] = useState('');
  const [savedTicket, setSavedTicket] = useState(null);

  const [netronWeight, setNetronWeight] = useState('0');
  const [manualMode, setManualMode] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');

  const fetchNextSerialNo = async () => {
    try {
      const val = await getNextDcNumber('NON-GST', 'SN-', 'first_weighment');
      if (val) setSerialNo(val);
    } catch (e) {
      setSerialNo('SN-01');
    }
  };

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));
    fetchNextSerialNo();
  }, []);

  // Listen to scale
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const numeric = data.value.replace(/[^0-9.-]/g, '');
        if (numeric) {
          setNetronWeight(numeric);
          if (!manualMode) setWeight(numeric);
        } else {
          setNetronWeight(data.value);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [manualMode]);

  const handleResetForm = () => {
    setSavedTicket(null);
    setVehicle('');
    setParty('');
    setMaterial('');
    setQty('');
    setWeight('');
    fetchNextSerialNo();
  };

  const handlePrint = () => {
    if (!savedTicket) {
      setMsgType('warning');
      setMsg('Please save the weighment first before printing.');
      setTimeout(() => setMsg(''), 4000);
      return;
    }

    printTicket(savedTicket, getSelectedTemplate(), 'PRINT');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const cleanVehAlpha = cleanVehicle.replace(/[\s\-\.]/g, '');
    if (!cleanVehicle || cleanVehAlpha === 'N/A' || cleanVehAlpha === 'NA' || cleanVehAlpha === 'NONE' || cleanVehAlpha.length === 0) {
      setMsgType('warning');
      setMsg('Please enter a valid Vehicle Number.');
      return;
    }
    const base64Img = captureCameraSnapshot();

    const assignedSn = await incrementDcNumber('NON-GST', 'SN-', 'first_weighment');
    const finalSn = assignedSn || serialNo || 'SN-01';

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(now.getDate());
    const month = pad(now.getMonth() + 1);
    const year = now.getFullYear();
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());

    const nowDateFormatted = `${day}-${month}-${year}`;
    const nowTimeFormatted = `${hours}:${minutes}:${seconds}`;

    const txData = {
      dc_num: finalSn,
      date_time: `${nowDateFormatted} ${nowTimeFormatted}`,
      vehicle_no: cleanVehicle,
      party: party ? party.toUpperCase() : '',
      material: material ? material.toUpperCase() : '',
      gross: weight || '0',
      tare: '0',
      net: weight || '0',
      operator: user?.username || 'Operator'
    };

    try {
      if (api.addFirstWeighment) {
        await api.addFirstWeighment(txData, base64Img);
      }
      setSavedTicket({
        dcNum: finalSn,
        serial_no: finalSn,
        token: finalSn,
        vehicle: cleanVehicle,
        vehicle_no: cleanVehicle,
        party: party ? party.toUpperCase() : '',
        material: material ? material.toUpperCase() : '',
        gross: weight || '0',
        tare: '0',
        net: weight || '0',
        nett: weight || '0',
        first_weight: weight || '0',
        qty: qty || weight || '0',
        units_val: qty || weight || '0',
        date: nowDateFormatted,
        time: nowTimeFormatted,
        date_time: `${nowDateFormatted} ${nowTimeFormatted}`,
        operator: user?.username || 'Operator',
        card: '1ST WEIGHMENT',
        ticket_type: '1ST WEIGHMENT'
      });
      setMsgType('success');
      setMsg(`First Weighment Saved successfully! Ticket #${finalSn}`);
      setTimeout(() => setMsg(''), 4000);
    } catch (err) {
      console.error('[FirstWeighment] Error saving:', err);
      setMsgType('danger');
      setMsg('Error saving first weighment into database.');
    }
  };

  if (!cameras) return <Loader label="Loading weighbridge cameras..." />;

  return (
    <div className="container-fluid p-0 animate-fade-in" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
      <style>{`
        .saas-card {
          background: #ffffff;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 1.25rem;
          margin-bottom: 1rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .saas-header {
          border-bottom: 1.5px solid var(--line-soft);
          padding-bottom: 0.75rem;
          margin-bottom: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .saas-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--ink);
          text-transform: uppercase;
        }
        .saas-section {
          border: 1px solid var(--line-soft);
          border-radius: 6px;
          padding: 1rem;
          background-color: var(--surface-2);
          margin-bottom: 1rem;
        }
        .saas-label {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--ink-label);
          text-transform: uppercase;
          margin-bottom: 0.25rem;
          display: block;
        }
        .saas-input {
          font-size: 0.8rem !important;
          border-radius: 4px !important;
          border: 1px solid var(--line-strong) !important;
          padding: 0.4rem 0.6rem !important;
        }
        .saas-input-readonly {
          background-color: var(--surface-3) !important;
          color: var(--ink-soft) !important;
        }
        .saas-btn-save {
          background-color: var(--primary);
          border: 1px solid var(--primary);
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
          transition: background-color 0.15s ease;
        }
        .saas-btn-save:hover { background-color: var(--primary-ink); }
        .saas-btn-print {
          background-color: #ef4444;
          border: 1px solid #ef4444;
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
          transition: background-color 0.15s ease;
        }
        .saas-btn-print:hover { background-color: #dc2626; }
      `}</style>

      {msg && (
        <div className={`alert alert-${msgType || 'success'} alert-dismissible fade show py-2 px-3 mb-3 shadow-sm`} role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>{msgType === 'danger' ? 'Error:' : msgType === 'warning' ? 'Warning:' : 'Notice:'}</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}

      <div className="row g-3">
        {/* Left Column: Form */}
        <div className="col-lg-6">
          <div className="saas-card">
            <div className="saas-header d-flex justify-content-between align-items-center">
              <span className="saas-title">Other 1st Weighment</span>
              {savedTicket && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                  style={{ fontSize: '0.72rem', fontWeight: '600', padding: '0.25rem 0.65rem', borderRadius: '4px' }}
                  title="Clear form and load next ticket"
                >
                  ↻ New Entry
                </button>
              )}
            </div>

            <form onSubmit={handleSave} className="row g-2">
              <div className="col-md-6">
                <label className="saas-label">Serial No</label>
                <input type="text" className="form-control saas-input saas-input-readonly fw-semibold" value={serialNo} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Vehicle</label>
                <input
                  type="text"
                  className="form-control saas-input"
                  value={vehicle}
                  onChange={(e) => {
                    if (savedTicket) setSavedTicket(null);
                    setVehicle(e.target.value);
                  }}
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Party</label>
                <input type="text" className="form-control saas-input" value={party} onChange={(e) => setParty(e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input" value={material} onChange={(e) => setMaterial(e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Qty</label>
                <input type="number" className="form-control saas-input" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Weight (kg)</label>
                <input 
                  type="number" 
                  className="form-control saas-input fw-bold" 
                  style={{ color: 'var(--primary-ink)' }}
                  value={weight} 
                  onChange={(e) => setWeight(e.target.value)} 
                  disabled={!manualMode}
                />
              </div>

              {/* Action Buttons */}
              <div className="col-12 d-flex gap-2 mt-4 justify-content-end align-items-center">
                {savedTicket ? (
                  <>
                    <span className="text-secondary small me-auto">
                      Saved as <b>{savedTicket.dcNum || savedTicket.serial_no}</b>
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      style={{ fontSize: '0.8rem', fontWeight: 600, padding: '0.45rem 1.25rem' }}
                      onClick={handleResetForm}
                    >
                      + NEW ENTRY
                    </button>
                    <button
                      type="button"
                      className="saas-btn-print"
                      onClick={handlePrint}
                    >
                      PRINT
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="saas-btn-print"
                      disabled
                      style={{ opacity: 0.45, cursor: 'not-allowed' }}
                      title="Save first to open Print button"
                    >
                      PRINT
                    </button>
                    <button type="submit" className="saas-btn-save">
                      SAVE
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Camera Views */}
        <div className="col-lg-6">
          <div className="saas-card" style={{ height: '100%' }}>
            <div className="saas-header">
              <span className="saas-title">Live Camera Views</span>
              <div className="d-flex align-items-center gap-1.5 text-success small fw-semibold" style={{ fontSize: '0.72rem' }}>
                <span className="indicator-light light-green active"></span> Stream Online
              </div>
            </div>

            <div className="row g-2">
              {cameras.map((c, index) => (
                <div key={c.id} className="col-md-6">
                  <div className="camera-tile position-relative overflow-hidden" style={{ borderRadius: '4px', border: '1px solid var(--line)' }}>
                    <CameraPlayer camera={c} />
                    <span className="position-absolute bottom-0 start-0 m-2 px-2 py-0.5 bg-dark bg-opacity-75 text-white fw-semibold" style={{ fontSize: '0.68rem', borderRadius: '3px' }}>
                      CAM {index + 1}: {c.name.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
