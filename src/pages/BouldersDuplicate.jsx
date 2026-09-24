import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';
import { printTicket } from '../utils/printHelper.js';

export default function BouldersDuplicate() {
  const [cameras, setCameras] = useState(null);
  const [loadedRecord, setLoadedRecord] = useState(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');
  
  // Form fields
  const [dcNum, setDcNum] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [contractor, setContractor] = useState('');
  const [quarry, setQuarry] = useState('');
  const [material, setMaterial] = useState('');
  const [driver, setDriver] = useState('');
  const [destination, setDestination] = useState('');
  const [transporter, setTransporter] = useState('');
  const [grossVal, setGrossVal] = useState('');
  const [tareVal, setTareVal] = useState('');
  const [nettVal, setNettVal] = useState('');

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

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!dcNum) return;

    try {
      const cleanSearch = dcNum.trim().toUpperCase();
      const searchNumMatch = cleanSearch.match(/\d+/);
      const searchNum = searchNumMatch ? parseInt(searchNumMatch[0], 10) : null;

      const boulderTxs = api.boulders ? await api.boulders().catch(() => []) : [];
      const allBoulderTxs = Array.isArray(boulderTxs) ? boulderTxs : [];

      const match = allBoulderTxs.find(t => {
        if (!t) return false;
        const rawDc = String(t.dc_num || t.dcNum || t.token || '').trim().toUpperCase();
        const rawUuid = String(t.uuid || '').toUpperCase();
        const rawId = String(t.id || '');
        const rawVeh = String(t.vehicle_no || t.vehicle || '').trim().toUpperCase();

        if (rawDc === cleanSearch || rawVeh === cleanSearch || rawUuid.includes(cleanSearch) || rawId === cleanSearch) {
          return true;
        }

        if (searchNum !== null) {
          const recordNumMatch = rawDc.match(/\d+/);
          if (recordNumMatch && parseInt(recordNumMatch[0], 10) === searchNum) {
            return true;
          }
        }
        return false;
      });

      if (match) {
        setLoadedRecord(match);
        setVehicleNo(match.vehicle_no || match.vehicle || '');
        setContractor(match.contractor || match.party || '');
        setQuarry(match.quarry || match.source || '');
        setMaterial(match.product || match.material || '');
        setDriver(match.driver || '');
        setDestination(match.destination || '');
        setTransporter(match.transporter || '');
        setGrossVal(match.gross || match.grossVal || '');
        setTareVal(match.tare || match.tareVal || '');
        setNettVal(match.net || match.nettVal || '');
        showNotice('Boulder Duplicate Ticket Loaded!', 'success');
      } else {
        showNotice('No matching boulders ticket found.', 'warning');
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
          border-color: var(--line) !important;
        }
        .saas-btn-print {
          background-color: #ef4444;
          border: 1px solid #ef4444;
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.75rem;
          transition: background-color 0.15s ease;
        }
        .saas-btn-print:hover { background-color: #dc2626; }
      `}</style>

      <div className="row g-3">
        {/* Left Column: Form */}
        <div className="col-lg-8">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Boulders Duplicate Manager</span>
            </div>

            <form onSubmit={handleSearch} className="row g-2">
              <div className="col-12 mb-3">
                <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Enter DC Number to Search</label>
                <div className="input-group input-group-sm">
                  <input type="text" className="form-control saas-input" placeholder="Search DC Number..." value={dcNum} onChange={(e) => setDcNum(e.target.value)} required />
                  <button className="btn btn-primary" type="submit" style={{ backgroundcolor: 'var(--primary-ink)' }}>Search</button>
                </div>
              </div>

              <div className="col-md-6">
                <label className="saas-label">Vehicle No</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={vehicleNo} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Contractor</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={contractor} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Quarry</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={quarry} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={material} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Driver</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={driver} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Destination</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={destination} readOnly />
              </div>
              <div className="col-12">
                <label className="saas-label">Transporter</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={transporter} readOnly />
              </div>

              {/* Weights Display */}
              <div className="col-12 mt-3 p-2.5 rounded bg-light border">
                <div className="row g-2 text-center">
                  <div className="col-4">
                    <span className="saas-label text-primary">Gross (kg)</span>
                    <input type="text" className="form-control saas-input text-center saas-input-readonly fw-bold text-primary" value={grossVal} readOnly />
                  </div>
                  <div className="col-4">
                    <span className="saas-label text-success">Tare (kg)</span>
                    <input type="text" className="form-control saas-input text-center saas-input-readonly fw-bold text-success" value={tareVal} readOnly />
                  </div>
                  <div className="col-4">
                    <span className="saas-label text-danger">Nett (kg)</span>
                    <input type="text" className="form-control saas-input text-center saas-input-readonly fw-bold text-danger" value={nettVal} readOnly />
                  </div>
                </div>
              </div>

              <div className="col-12 d-flex mt-4 justify-content-end">
                <button 
                  type="button" 
                  className="saas-btn-print"
                  onClick={() => {
                    const ticket = loadedRecord ? {
                      ...loadedRecord,
                      dcNum: dcNum || loadedRecord.dc_num,
                      vehicle: vehicleNo || loadedRecord.vehicle_no,
                      party: contractor || loadedRecord.party,
                      contractor: contractor || loadedRecord.contractor,
                      material: material || loadedRecord.product,
                      destination: destination || loadedRecord.destination,
                      source: quarry || loadedRecord.quarry,
                      transporter: transporter || loadedRecord.transporter,
                      driver: driver || loadedRecord.driver,
                      gross: grossVal || loadedRecord.gross,
                      tare: tareVal || loadedRecord.tare,
                      net: nettVal || loadedRecord.net,
                      tareDate: loadedRecord.tare_date || loadedRecord.tareDate,
                      tareTime: loadedRecord.tare_time || loadedRecord.tareTime,
                      tare_date: loadedRecord.tare_date || loadedRecord.tareDate,
                      tare_time: loadedRecord.tare_time || loadedRecord.tareTime
                    } : {
                      dcNum: dcNum || 'DC-001',
                      vehicle: vehicleNo || 'TEST',
                      material: material || 'BOULDERS',
                      party: contractor || 'LOCAL',
                      destination: destination || 'HOPPER',
                      source: quarry || 'CRUSHER',
                      gross: grossVal || '0',
                      tare: tareVal || '0',
                      net: nettVal || '0',
                      transporter: transporter || 'N/A',
                      driver: driver || 'N/A'
                    };
                    printTicket(ticket);
                  }}
                >
                  Print
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Camera Views */}
        <div className="col-lg-4">
          <div className="saas-card" style={{ height: '100%' }}>
            <div className="saas-header">
              <span className="saas-title">Weighbridge Cameras</span>
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
