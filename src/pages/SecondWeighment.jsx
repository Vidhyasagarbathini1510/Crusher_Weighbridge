import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';

import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function SecondWeighment() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [serialNo, setSerialNo] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');

  // Weights
  const [grossVal, setGrossVal] = useState('');
  const [tareVal, setTareVal] = useState('');
  const [nettVal, setNettVal] = useState('0');

  const [netronWeight, setNetronWeight] = useState('0');
  const [manualMode, setManualMode] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));
    setSerialNo(`SN-${Math.floor(100000 + Math.random() * 900000)}`);
  }, []);

  // Listen to scale
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const numeric = data.value.replace(/[^0-9.-]/g, '');
        if (numeric) {
          setNetronWeight(numeric);
          if (!manualMode) setGrossVal(numeric);
        } else {
          setNetronWeight(data.value);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [manualMode]);

  // Calculate Net Weight (higher value - lower value = net)
  useEffect(() => {
    const g = parseFloat(grossVal) || 0;
    const t = parseFloat(tareVal) || 0;
    setNettVal(Math.abs(g - t).toString());
  }, [grossVal, tareVal]);

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
    const g = parseFloat(grossVal) || 0;
    const t = parseFloat(tareVal) || 0;
    const finalGross = Math.max(g, t).toString();
    const finalTare = Math.min(g, t).toString();

    const txData = {
      dc_num: serialNo,
      date_time: new Date().toLocaleString(),
      vehicle_no: cleanVehicle,
      party: party ? party.toUpperCase() : '',
      material: material ? material.toUpperCase() : '',
      gross: finalGross,
      tare: finalTare,
      net: nettVal,
      operator: user?.username || 'Operator'
    };

    try {
      if (api.addSecondWeighment) {
        await api.addSecondWeighment(txData, base64Img);
      }
      setMsgType('success');
      setMsg('Second Weighment Saved successfully!');
      setTimeout(() => setMsg(''), 4000);
      setSerialNo(`SN-${Math.floor(100000 + Math.random() * 900000)}`);
      setVehicle('');
      setParty('');
      setMaterial('');
      setQty('');
      setGrossVal('');
      setTareVal('');
    } catch (err) {
      console.error('[SecondWeighment] Error saving:', err);
      setMsgType('danger');
      setMsg('Error saving second weighment into database.');
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
            <div className="saas-header">
              <span className="saas-title">Second Weighment Form</span>
            </div>

            <form onSubmit={handleSave} className="row g-2">
              <div className="col-md-6">
                <label className="saas-label">Serial No</label>
                <input type="text" className="form-control saas-input saas-input-readonly fw-semibold" value={serialNo} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Vehicle</label>
                <input type="text" className="form-control saas-input" value={vehicle} onChange={(e) => setVehicle(e.target.value)} required />
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

              {/* Weight Grid */}
              <div className="col-md-12 p-3 my-3 bg-light border rounded">
                <div className="row g-2">
                  <div className="col-4">
                    <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Gross (kg)</label>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: 'var(--primary-ink)' }} value={grossVal} readOnly />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#16a34a' }}>Tare (kg)</label>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#16a34a' }} value={tareVal} readOnly />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#dc2626' }}>Nett (kg)</label>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#dc2626', backgroundColor: '#ffffff' }} value={nettVal} readOnly />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="col-12 d-flex gap-2 mt-2 justify-content-end">
                <button type="button" className="saas-btn-print">PRINT</button>
                <button type="submit" className="saas-btn-save">SAVE</button>
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
