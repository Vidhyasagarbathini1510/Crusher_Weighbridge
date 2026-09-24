import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import { printTicket, getDcPrintTemplate, getGatePassTemplate } from '../utils/printHelper.js';

export default function YardDuplicate() {
  const [cameras, setCameras] = useState(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');
  
  // Fields
  const [dcNumber, setDcNumber] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [material, setMaterial] = useState('');
  const [grossVal, setGrossVal] = useState('');
  const [tareVal, setTareVal] = useState('');
  const [nettVal, setNettVal] = useState('');
  const [dateVal, setDateVal] = useState('');
  const [timeVal, setTimeVal] = useState('');

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));
  }, []);

  const showNotice = (text, type = 'success') => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => {
      setMsg('');
    }, 4000);
  };

  const handleSearchBill = async (e) => {
    e.preventDefault();
    if (!dcNumber) return;
    
    const searchVal = dcNumber.trim().toUpperCase();
    const searchNumMatch = searchVal.match(/\d+/);
    const searchNum = searchNumMatch ? parseInt(searchNumMatch[0], 10) : null;

    const isMatch = (t) => {
      if (!t) return false;
      const rawDc = String(t.dc_num || t.dcNum || t.token || '').trim().toUpperCase();
      const rawVeh = String(t.vehicle_no || t.vehicle || '').trim().toUpperCase();
      const rawId = String(t.id || '');
      const rawUuid = String(t.uuid || '').toUpperCase();

      if (rawDc === searchVal || rawVeh === searchVal || rawUuid.includes(searchVal) || rawId === searchVal) {
        return true;
      }
      if (searchNum !== null) {
        const recordNumMatch = rawDc.match(/\d+/);
        if (recordNumMatch && parseInt(recordNumMatch[0], 10) === searchNum) {
          return true;
        }
      }
      return false;
    };

    try {
      // 1. Search in SQLite database (yard_weighments)
      const yardRecords = api.yardWeighments ? await api.yardWeighments().catch(() => []) : [];
      let match = (yardRecords || []).find(isMatch);

      // 2. Search in localStorage fallback
      if (!match) {
        const storageKey = 'noris_yard_transactions';
        const cached = localStorage.getItem(storageKey);
        const list = cached ? JSON.parse(cached) : [];
        match = (list || []).find(isMatch);
      }
      
      if (match) {
        setVehicle(match.vehicle_no || '');
        setMaterial(match.material || match.product || '');
        setGrossVal(match.gross || '');
        setTareVal(match.tare || '');
        setNettVal(match.net || '');
        setDateVal(match.date || (match.date_time ? match.date_time.split(',')[0] : ''));
        setTimeVal(match.time || (match.date_time ? match.date_time.split(',')[1] : ''));
        showNotice('Yard Transaction Bill Loaded Successfully!', 'success');
      } else {
        showNotice('No matching yard transaction bill found.', 'warning');
      }
    } catch (err) {
      console.error(err);
      showNotice('Error searching transaction database.', 'danger');
    }
  };

  if (!cameras) return <Loader label="Loading weighbridge cameras..." />;

  return (
    <div className="container-fluid p-0 animate-fade-in" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show py-2 px-3 mb-2 shadow-sm`} role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}
      <style>{`
        .saas-card {
          background: #ffffff;
          border: 1px solid var(--line-strong);
          border-radius: 4px;
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
        .saas-btn {
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
        }
        .camera-container-box {
          background-color: var(--surface-3);
          border: 1px solid var(--line);
          border-radius: 4px;
          height: 180px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }
      `}</style>

      <div className="row g-3">
        {/* Left Column: Form */}
        <div className="col-lg-8">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Duplicate Yard Bill Manager</span>
            </div>

            <form onSubmit={handleSearchBill} className="row g-2">
              <div className="col-md-12 mb-3">
                <label className="saas-label" style={{ color: '#0f4c4c' }}>Enter DC / Vehicle Number to Search</label>
                <div className="input-group input-group-sm">
                  <input 
                    type="text" 
                    className="form-control saas-input" 
                    placeholder="Search DC or Vehicle Number (e.g. DC-1234)..." 
                    value={dcNumber} 
                    onChange={(e) => setDcNumber(e.target.value)} 
                    required 
                  />
                  <button className="btn btn-primary" type="submit" style={{ backgroundColor: '#0f4c4c', borderColor: '#0f4c4c' }}>Load Bill</button>
                </div>
              </div>

              <div className="col-md-6">
                <label className="saas-label">Vehicle</label>
                <input type="text" className="form-control saas-input bg-light" value={vehicle} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input bg-light" value={material} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Date</label>
                <input type="text" className="form-control saas-input bg-light" value={dateVal} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Time</label>
                <input type="text" className="form-control saas-input bg-light" value={timeVal} readOnly />
              </div>

              {/* Weights Display */}
              <div className="col-12 mt-3 p-2.5 rounded bg-light border">
                <div className="row g-2 text-center">
                  <div className="col-4">
                    <span className="saas-label text-primary">Gross (kg)</span>
                    <input type="text" className="form-control saas-input text-center bg-white text-primary fw-bold" value={grossVal} readOnly />
                  </div>
                  <div className="col-4">
                    <span className="saas-label text-success">Tare (kg)</span>
                    <input type="text" className="form-control saas-input text-center bg-white text-success fw-bold" value={tareVal} readOnly />
                  </div>
                  <div className="col-4">
                    <span className="saas-label text-danger">Nett (kg)</span>
                    <input type="text" className="form-control saas-input text-center bg-white text-danger fw-bold" value={nettVal} readOnly />
                  </div>
                </div>
              </div>

              <div className="col-12 d-flex gap-2 mt-4 justify-content-end">
                <button type="button" onClick={() => {
                  const ticket = { dcNum: searchDc || '1', vehicle: vehicle || '-', material: material || '-', gross: grossVal || '0', tare: tareVal || '0', net: nettVal || '0' };
                  printTicket(ticket);
                }} className="btn btn-danger saas-btn px-4" style={{ backgroundColor: '#ef4444' }}>Print Bill</button>
                <button type="button" onClick={() => {
                  const ticket = { dcNum: searchDc || '1', vehicle: vehicle || '-', material: material || '-', gross: grossVal || '0', tare: tareVal || '0', net: nettVal || '0' };
                  printTicket(ticket, getDcPrintTemplate());
                }} className="btn btn-dark saas-btn px-3">DC Print</button>
                <button type="button" onClick={() => {
                  const ticket = { dcNum: searchDc || '1', vehicle: vehicle || '-', material: material || '-', gross: grossVal || '0', tare: tareVal || '0', net: nettVal || '0' };
                  printTicket(ticket, getGatePassTemplate());
                }} className="btn btn-secondary saas-btn px-3">Gate Pass</button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Camera Views */}
        <div className="col-lg-4">
          <div className="saas-card" style={{ height: '100%' }}>
            <div className="saas-header">
              <span className="saas-title">Security Feeds</span>
            </div>
            <div className="row g-2">
              {cameras.slice(0, 2).map((c, index) => (
                <div key={c.id} className="col-12">
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
