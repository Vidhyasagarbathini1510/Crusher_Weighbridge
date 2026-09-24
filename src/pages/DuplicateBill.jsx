import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';
import { printTicket, getSelectedTemplate, getDcPrintTemplate } from '../utils/printHelper.js';

export default function DuplicateBill() {
  const [cameras, setCameras] = useState(null);
  const [loadedMatch, setLoadedMatch] = useState(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');
  
  // Fields
  const [dcNumber, setDcNumber] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [transporter, setTransporter] = useState('');
  const [driver, setDriver] = useState('');
  const [stationary, setStationary] = useState('');
  const [billType, setBillType] = useState('NON-GST');
  const [gstin, setGstin] = useState('');
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

  const handleSearchBill = async (e) => {
    e.preventDefault();
    if (!dcNumber) return;
    
    // Search Sales transactions database (sales_weighment_units + transactions)
    try {
      const cleanSearch = dcNumber.trim().toUpperCase();
      const searchNumMatch = cleanSearch.match(/\d+/);
      const searchNum = searchNumMatch ? parseInt(searchNumMatch[0], 10) : null;

      const [salesTxs, standardTxs] = await Promise.all([
        api.salesUnits ? api.salesUnits().catch(() => []) : Promise.resolve([]),
        api.transactions ? api.transactions().catch(() => []) : Promise.resolve([])
      ]);

      const allSalesTxs = [...(salesTxs || []), ...(standardTxs || [])];

      const match = allSalesTxs.find(t => {
        if (!t) return false;
        const rawDc = String(t.dc_num || t.dcNum || t.token || t.your_dc || t.yourDc || '').trim().toUpperCase();
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
        setLoadedMatch(match);
        setVehicle(match.vehicle_no || match.vehicle || '');
        setParty(match.party || match.contractor || '');
        setMaterial(match.product || match.material || '');
        setSource(match.quarry || match.source || '');
        setDestination(match.destination || '');
        setTransporter(match.transporter || '');
        setDriver(match.driver || '');
        setStationary(match.stationary || '');
        setBillType(match.bill_type || match.billType || (match.party_gstin || match.gstin ? 'GST' : 'NON-GST'));
        setGstin(match.party_gstin || match.partyGstin || match.gstin || match.gstIn || '');
        setGrossVal(match.gross || match.grossVal || '');
        setTareVal(match.tare || match.tareVal || '');
        setNettVal(match.net || match.nettVal || match.units_val || '');
        showNotice('Sales Transaction Bill Loaded Successfully!', 'success');
      } else {
        showNotice('No matching sales transaction bill found.', 'warning');
      }
    } catch (err) {
      console.error(err);
      showNotice('Error searching sales transaction database.', 'danger');
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
        .saas-btn {
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
        }
      `}</style>

      <div className="row g-3">
        {/* Left Column: Form */}
        <div className="col-lg-8">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Duplicate Bill Manager</span>
            </div>

            <form onSubmit={handleSearchBill} className="row g-2">
              <div className="col-md-12 mb-3">
                <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Enter DC / Challan Number to Search</label>
                <div className="input-group input-group-sm">
                  <input type="text" className="form-control saas-input" placeholder="Search DC Number..." value={dcNumber} onChange={(e) => setDcNumber(e.target.value)} required />
                  <button className="btn btn-primary" type="submit" style={{ backgroundcolor: 'var(--primary-ink)' }}>Load Bill</button>
                </div>
              </div>

              <div className="col-md-6">
                <label className="saas-label">Vehicle</label>
                <input type="text" className="form-control saas-input bg-light" value={vehicle} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Party</label>
                <input type="text" className="form-control saas-input bg-light" value={party} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input bg-light" value={material} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Source</label>
                <input type="text" className="form-control saas-input bg-light" value={source} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Destination</label>
                <input type="text" className="form-control saas-input bg-light" value={destination} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Transporter</label>
                <input type="text" className="form-control saas-input bg-light" value={transporter} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Driver</label>
                <input type="text" className="form-control saas-input bg-light" value={driver} readOnly />
              </div>
              <div className="col-md-6">
                <label className="saas-label">Stationary</label>
                <input type="text" className="form-control saas-input bg-light" value={stationary} readOnly />
              </div>

              <div className="col-md-6">
                <label className="saas-label">Bill Type (GST / NON-GST)</label>
                <select 
                  className="form-select saas-input fw-bold" 
                  value={billType} 
                  onChange={(e) => setBillType(e.target.value)}
                  style={{ color: billType === 'GST' ? '#047857' : '#dc2626' }}
                >
                  <option value="NON-GST">NON-GST Bill (Blank Header)</option>
                  <option value="GST">GST Bill (Company Header)</option>
                </select>
              </div>

              <div className="col-md-6">
                <label className="saas-label">Party GSTIN</label>
                <input 
                  type="text" 
                  className="form-control saas-input" 
                  placeholder="Party GSTIN..." 
                  value={gstin} 
                  onChange={(e) => setGstin(e.target.value)} 
                />
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
                <button 
                  type="button" 
                  className="btn btn-danger saas-btn px-4" 
                  style={{ backgroundColor: '#ef4444' }}
                  onClick={() => {
                    const ticket = loadedMatch ? {
                      ...loadedMatch,
                      dcNum: dcNumber || loadedMatch.dc_num,
                      vehicle: vehicle || loadedMatch.vehicle_no,
                      material: material || loadedMatch.product,
                      party: party || loadedMatch.party,
                      destination: destination || loadedMatch.destination,
                      source: source || loadedMatch.quarry,
                      gross: grossVal || loadedMatch.gross,
                      tare: tareVal || loadedMatch.tare,
                      net: nettVal || loadedMatch.net,
                      transporter: transporter || loadedMatch.transporter,
                      driver: driver || loadedMatch.driver,
                      tareDate: loadedMatch.tare_date || loadedMatch.tareDate,
                      tareTime: loadedMatch.tare_time || loadedMatch.tareTime,
                      tare_date: loadedMatch.tare_date || loadedMatch.tareDate,
                      tare_time: loadedMatch.tare_time || loadedMatch.tareTime,
                      billType: billType,
                      bill_type: billType,
                      gstin: gstin,
                      partyGstin: gstin,
                      isGst: billType === 'GST'
                    } : {
                      dcNum: dcNumber || '1',
                      vehicle: vehicle || 'TEST',
                      material: material || 'Gravel',
                      party: party || 'BMW',
                      destination: destination || 'Stock',
                      source: source || 'BMW',
                      gross: grossVal || '0',
                      tare: tareVal || '0',
                      net: nettVal || '0',
                      transporter: transporter || 'GSM INFRA',
                      billType: billType,
                      bill_type: billType,
                      gstin: gstin,
                      partyGstin: gstin,
                      isGst: billType === 'GST'
                    };
                    printTicket(ticket, getSelectedTemplate(), 'TICKET');
                  }}
                >
                  Print Bill
                </button>
                <button 
                  type="button" 
                  className="btn btn-dark saas-btn px-3"
                  onClick={() => {
                    const ticket = loadedMatch ? {
                      ...loadedMatch,
                      dcNum: dcNumber || loadedMatch.dc_num,
                      vehicle: vehicle || loadedMatch.vehicle_no,
                      material: material || loadedMatch.product,
                      party: party || loadedMatch.party,
                      destination: destination || loadedMatch.destination,
                      source: source || loadedMatch.quarry,
                      gross: grossVal || loadedMatch.gross,
                      tare: tareVal || loadedMatch.tare,
                      net: nettVal || loadedMatch.net,
                      transporter: transporter || loadedMatch.transporter,
                      driver: driver || loadedMatch.driver,
                      tareDate: loadedMatch.tare_date || loadedMatch.tareDate,
                      tareTime: loadedMatch.tare_time || loadedMatch.tareTime,
                      tare_date: loadedMatch.tare_date || loadedMatch.tareDate,
                      tare_time: loadedMatch.tare_time || loadedMatch.tareTime,
                      billType: billType,
                      bill_type: billType,
                      gstin: gstin,
                      partyGstin: gstin,
                      isGst: billType === 'GST'
                    } : {
                      dcNum: dcNumber || '1',
                      vehicle: vehicle || 'TEST',
                      material: material || 'Gravel',
                      party: party || 'BMW',
                      destination: destination || 'Stock',
                      source: source || 'BMW',
                      gross: grossVal || '0',
                      tare: tareVal || '0',
                      net: nettVal || '0',
                      transporter: transporter || 'GSM INFRA',
                      billType: billType,
                      bill_type: billType,
                      gstin: gstin,
                      partyGstin: gstin,
                      isGst: billType === 'GST'
                    };
                    printTicket(ticket, getDcPrintTemplate(), 'DC');
                  }}
                >
                  DC Print
                </button>
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
              {cameras.map((c, index) => (
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
