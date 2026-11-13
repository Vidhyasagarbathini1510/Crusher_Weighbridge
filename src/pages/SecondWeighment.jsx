import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import { useAuth } from '../context/AuthContext.jsx';
import { printTicket, getSelectedTemplate } from '../utils/printHelper.js';

export default function SecondWeighment() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [serialNo, setSerialNo] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');
  const [stationary, setStationary] = useState('');
  const [savedTicket, setSavedTicket] = useState(null);

  // 1st Weighment Lookup & Auto-fill state
  const [pendingFirstWeighments, setPendingFirstWeighments] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Weights
  const [grossVal, setGrossVal] = useState('');
  const [tareVal, setTareVal] = useState('');
  const [nettVal, setNettVal] = useState('0');

  const [netronWeight, setNetronWeight] = useState('0');
  const [manualMode, setManualMode] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');

  const loadPendingFirstWeighments = async () => {
    if (!api.firstWeighments) return;
    try {
      const [firsts, seconds] = await Promise.all([
        api.firstWeighments().catch(() => []),
        api.secondWeighments ? api.secondWeighments().catch(() => []) : Promise.resolve([])
      ]);
      const firstsArr = Array.isArray(firsts) ? firsts : [];
      const secondsArr = Array.isArray(seconds) ? seconds : [];

      const completedIds = new Set();
      // Serial numbers restart (e.g. SN-01 after a reset), so a serial match only counts
      // when that second weighment was created after the first one.
      const latestSecondByDc = new Map();
      secondsArr.forEach(s => {
        if (s.first_weighment_id) completedIds.add(s.first_weighment_id);
        const dc = (s.dc_num || '').trim().toUpperCase();
        if (!dc) return;
        const at = String(s.created_at || '');
        if (!latestSecondByDc.has(dc) || at > latestSecondByDc.get(dc)) latestSecondByDc.set(dc, at);
      });

      const pending = firstsArr.filter(f => {
        if (f.uuid && completedIds.has(f.uuid)) return false;
        const dc = (f.dc_num || '').trim().toUpperCase();
        if (!dc || !latestSecondByDc.has(dc)) return true;
        return !(latestSecondByDc.get(dc) >= String(f.created_at || ''));
      });

      setPendingFirstWeighments(pending);
    } catch (err) {
      console.error('[SecondWeighment] Error loading pending weighments:', err);
    }
  };

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));
    loadPendingFirstWeighments();

    const handleFocus = () => loadPendingFirstWeighments();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const pendingVehicleOptions = Array.from(
    new Set(pendingFirstWeighments.map(r => (r.vehicle_no || r.vehicle || '').trim().toUpperCase()).filter(Boolean))
  );

  const pendingTicketOptions = Array.from(
    new Set(pendingFirstWeighments.map(r => (r.dc_num || r.dcNum || '').trim().toUpperCase()).filter(Boolean))
  );

  // Helper to auto-fill form fields from a selected 1st Weighment record
  const applyFirstWeighmentRecord = (record) => {
    if (savedTicket) setSavedTicket(null);
    if (!record) {
      setSelectedRecord(null);
      setSerialNo('');
      setVehicle('');
      setParty('');
      setMaterial('');
      setQty('');
      setTareVal('');
      setStationary('');
      return;
    }
    setSelectedRecord(record);
    setSerialNo(record.dc_num || record.dcNum || '');
    setVehicle(record.vehicle_no || record.vehicle || '');
    setParty(record.party || record.contractor || '');
    setMaterial(record.material || record.product || '');
    setTareVal(String(record.gross || record.tare || record.weight || '0'));
    if (record.stationary || record.stationary_no) {
      setStationary(record.stationary || record.stationary_no || '');
    }
    if (record.units_val || record.unitsVal || record.qty) {
      setQty(String(record.units_val || record.unitsVal || record.qty));
    }
    setMsgType('info');
    setMsg(`✔ Auto-filled 1st Weighment details for Vehicle ${record.vehicle_no || record.vehicle} (Ticket #${record.dc_num})`);
  };

  const handleResetForm = () => {
    setSavedTicket(null);
    setSelectedRecord(null);
    setSerialNo('');
    setVehicle('');
    setParty('');
    setMaterial('');
    setQty('');
    setStationary('');
    setGrossVal('');
    setTareVal('');
    setNettVal('0');
    loadPendingFirstWeighments();
  };

  const handleTicketChange = (val) => {
    if (savedTicket) setSavedTicket(null);
    setSerialNo(val);
    if (!val) return;
    const cleanVal = val.trim().toUpperCase();
    const match = pendingFirstWeighments.find(r => (r.dc_num || r.dcNum || '').trim().toUpperCase() === cleanVal);
    if (match) {
      applyFirstWeighmentRecord(match);
    }
  };

  const handleVehicleChange = (val) => {
    if (savedTicket) setSavedTicket(null);
    setVehicle(val);
    if (!val) return;
    const cleanInput = val.trim().toUpperCase();
    const cleanVehAlpha = cleanInput.replace(/[\s\-\.]/g, '');
    const match = pendingFirstWeighments.find(r => {
      const v = (r.vehicle_no || r.vehicle || '').toUpperCase().replace(/[\s\-\.]/g, '');
      const s = (r.dc_num || r.dcNum || '').toUpperCase();
      return v === cleanVehAlpha || s === cleanInput;
    });
    if (match) {
      applyFirstWeighmentRecord(match);
    }
  };

  // Listen to scale
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const numeric = data.value.replace(/[^0-9.-]/g, '');
        if (numeric) {
          setNetronWeight(numeric);
          // Frozen once saved, so the saved/printed weights stay on screen
          if (!manualMode && !savedTicket) setGrossVal(numeric);
        } else {
          setNetronWeight(data.value);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [manualMode, savedTicket]);

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
      dc_num: serialNo || (selectedRecord ? selectedRecord.dc_num : `SN-${Math.floor(100000 + Math.random() * 900000)}`),
      date_time: `${nowDateFormatted} ${nowTimeFormatted}`,
      vehicle_no: cleanVehicle,
      party: party ? party.toUpperCase() : '',
      material: material ? material.toUpperCase() : '',
      gross: finalGross,
      tare: finalTare,
      net: nettVal,
      qty: qty || nettVal,
      units_val: qty || nettVal,
      stationary: stationary || '',
      first_weighment_id: selectedRecord ? selectedRecord.uuid : '',
      tare_date: selectedRecord ? (selectedRecord.tare_date || selectedRecord.date_time || '') : '',
      tare_time: selectedRecord ? (selectedRecord.tare_time || '') : '',
      operator: user?.username || 'Operator'
    };

    try {
      if (api.addSecondWeighment) {
        await api.addSecondWeighment(txData, base64Img);
      }
      setSavedTicket({
        dcNum: txData.dc_num,
        serial_no: txData.dc_num,
        token: txData.dc_num,
        vehicle: cleanVehicle,
        vehicle_no: cleanVehicle,
        party: txData.party,
        material: txData.material,
        gross: finalGross,
        tare: finalTare,
        net: nettVal,
        nett: nettVal,
        qty: qty || nettVal,
        units_val: qty || nettVal,
        stationary: stationary || '',
        date: nowDateFormatted,
        time: nowTimeFormatted,
        date_time: `${nowDateFormatted} ${nowTimeFormatted}`,
        tare_date: selectedRecord ? (selectedRecord.tare_date || selectedRecord.date_time || '') : '',
        tare_time: selectedRecord ? (selectedRecord.tare_time || '') : '',
        operator: user?.username || 'Operator',
        card: '2ND WEIGHMENT',
        ticket_type: '2ND WEIGHMENT'
      });
      setMsgType('success');
      setMsg(`Second Weighment Saved successfully! Ticket #${txData.dc_num}`);
      setTimeout(() => setMsg(''), 4000);

      // Refresh 1st weighment list
      loadPendingFirstWeighments();
    } catch (err) {
      console.error('[SecondWeighment] Error saving:', err);
      setMsgType('danger');
      setMsg('Error saving second weighment into database.');
    }
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
            <div className="saas-header d-flex justify-content-between align-items-center">
              <span className="saas-title">Second Weighment Form</span>
              <div className="d-flex align-items-center gap-2">
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
                <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2 py-1" style={{ fontSize: '0.72rem' }}>
                  {pendingFirstWeighments.length} Pending 1st Weighment(s)
                </span>
              </div>
            </div>

            <form onSubmit={handleSave} className="row g-2">
              <div className="col-md-6">
                <label className="saas-label">Serial No / Ticket #</label>
                <SearchableSelect
                  className="saas-input fw-semibold"
                  value={serialNo}
                  onChange={handleTicketChange}
                  options={pendingTicketOptions}
                  placeholder="Type or select Ticket #"
                  allowCustom={true}
                />
              </div>

              <div className="col-md-6">
                <label className="saas-label">Vehicle No</label>
                <SearchableSelect
                  className="saas-input text-uppercase fw-semibold"
                  value={vehicle}
                  onChange={handleVehicleChange}
                  options={pendingVehicleOptions}
                  placeholder="Type or select vehicle number..."
                  allowCustom={true}
                  required
                />
              </div>

              <div className="col-md-6">
                <label className="saas-label">Party / Contractor</label>
                <input type="text" className="form-control saas-input" value={party} onChange={(e) => setParty(e.target.value)} placeholder="Party Name" />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Material Name" />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Qty</label>
                <input type="number" className="form-control saas-input" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity (leave blank for Net Weight)" />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Stationary No</label>
                <input type="text" className="form-control saas-input" value={stationary} onChange={(e) => setStationary(e.target.value)} placeholder="Stationary No" />
              </div>

              {/* Weight Grid */}
              <div className="col-md-12 p-3 my-3 bg-light border rounded">
                <div className="row g-2">
                  <div className="col-4">
                    <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Gross (kg)</label>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: 'var(--primary-ink)' }} value={tareVal === '' ? grossVal : Math.max(parseFloat(grossVal) || 0, parseFloat(tareVal) || 0)} readOnly />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#16a34a' }}>Tare (kg)</label>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#16a34a' }} value={tareVal === '' ? tareVal : Math.min(parseFloat(grossVal) || 0, parseFloat(tareVal) || 0)} readOnly />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#dc2626' }}>Nett (kg)</label>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#dc2626', backgroundColor: '#ffffff' }} value={nettVal} readOnly />
                  </div>
                </div>
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
