import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';
import { printTicket } from '../utils/printHelper.js';
import { useToast } from '../context/ToastContext.jsx';

export default function DuplicateWeighmentBill() {
  const { toast } = useToast();
  const [cameras, setCameras] = useState(null);
  const [loadedRecord, setLoadedRecord] = useState(null);
  const [serialNo, setSerialNo] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');
  const [grossVal, setGrossVal] = useState('');
  const [tareVal, setTareVal] = useState('');
  const [nettVal, setNettVal] = useState('');
  const [billType, setBillType] = useState('NON-GST');
  const [gstin, setGstin] = useState('');

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!serialNo) return;

    try {
      const cleanSearch = serialNo.trim().toUpperCase();
      const searchNumMatch = cleanSearch.match(/\d+/);
      const searchNum = searchNumMatch ? parseInt(searchNumMatch[0], 10) : null;

      const [salesTxs, standardTxs, boulderTxs, yardTxs] = await Promise.all([
        api.salesUnits ? api.salesUnits().catch(() => []) : Promise.resolve([]),
        api.transactions ? api.transactions().catch(() => []) : Promise.resolve([]),
        api.boulders ? api.boulders().catch(() => []) : Promise.resolve([]),
        api.yardWeighments ? api.yardWeighments().catch(() => []) : Promise.resolve([])
      ]);

      const allTxs = [...(salesTxs || []), ...(standardTxs || []), ...(boulderTxs || []), ...(yardTxs || [])];

      const match = allTxs.find(t => {
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
        setLoadedRecord(match);
        setVehicle(match.vehicle_no || match.vehicle || '');
        setParty(match.party || match.contractor || '');
        setMaterial(match.product || match.material || '');
        setQty(match.qty || match.units_val || '1');
        setGrossVal(match.gross || match.grossVal || '');
        setTareVal(match.tare || match.tareVal || '');
        setNettVal(match.net || match.nettVal || match.units_val || '');
        setBillType(match.bill_type || match.billType || (match.party_gstin || match.gstin ? 'GST' : 'NON-GST'));
        setGstin(match.party_gstin || match.partyGstin || match.gstin || match.gstIn || '');
        toast.success('Weighment Bill Loaded!');
      } else {
        toast.warning('No matching weighment ticket found.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error searching transaction database.');
    }
  };

  if (!cameras) return <Loader label="Loading security cameras..." />;

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
        {/* Left Column: Search & Display Form */}
        <div className="col-lg-8">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Duplicate Weighment Bill</span>
            </div>

            <form onSubmit={handleSearch} className="row g-2">
              <div className="col-12 mb-3">
                <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Enter Ticket / Serial Number</label>
                <div className="input-group input-group-sm">
                  <input type="text" className="form-control saas-input" placeholder="Search Serial No..." value={serialNo} onChange={(e) => setSerialNo(e.target.value)} required />
                  <button className="btn btn-primary" type="submit" style={{ backgroundcolor: 'var(--primary-ink)' }}>Load</button>
                </div>
              </div>

              <div className="col-12">
                <label className="saas-label">Vehicle</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={vehicle} readOnly />
              </div>
              <div className="col-12">
                <label className="saas-label">Party</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={party} readOnly />
              </div>
              <div className="col-12">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={material} readOnly />
              </div>
              <div className="col-12">
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
              <div className="col-12">
                <label className="saas-label">Qty</label>
                <input type="text" className="form-control saas-input saas-input-readonly" value={qty} readOnly />
              </div>
              <div className="col-4 mt-2">
                <span className="saas-label text-primary">Gross (kg)</span>
                <input type="text" className="form-control saas-input text-center saas-input-readonly fw-bold text-primary" value={grossVal} readOnly />
              </div>
              <div className="col-4 mt-2">
                <span className="saas-label text-success">Tare (kg)</span>
                <input type="text" className="form-control saas-input text-center saas-input-readonly fw-bold text-success" value={tareVal} readOnly />
              </div>
              <div className="col-4 mt-2">
                <span className="saas-label text-danger">Nett (kg)</span>
                <input type="text" className="form-control saas-input text-center saas-input-readonly fw-bold text-danger" value={nettVal} readOnly />
              </div>

              <div className="col-12 d-flex mt-4 justify-content-end">
                <button 
                  type="button" 
                  className="saas-btn-print"
                  onClick={() => {
                    const ticket = loadedRecord ? {
                      ...loadedRecord,
                      dcNum: serialNo || loadedRecord.dc_num,
                      vehicle: vehicle || loadedRecord.vehicle_no,
                      material: material || loadedRecord.product,
                      party: party || loadedRecord.party,
                      destination: loadedRecord.destination || 'N/A',
                      source: loadedRecord.quarry || 'N/A',
                      gross: grossVal || loadedRecord.gross,
                      tare: tareVal || loadedRecord.tare,
                      net: nettVal || loadedRecord.net,
                      qty: qty || loadedRecord.qty,
                      transporter: loadedRecord.transporter || 'N/A',
                      driver: loadedRecord.driver || 'N/A',
                      tareDate: loadedRecord.tare_date || loadedRecord.tareDate,
                      tareTime: loadedRecord.tare_time || loadedRecord.tareTime,
                      tare_date: loadedRecord.tare_date || loadedRecord.tareDate,
                      tare_time: loadedRecord.tare_time || loadedRecord.tareTime,
                      billType: billType,
                      bill_type: billType,
                      gstin: gstin,
                      partyGstin: gstin,
                      isGst: billType === 'GST'
                    } : {
                      dcNum: serialNo || '1',
                      vehicle: vehicle || 'TEST',
                      material: material || 'Gravel',
                      party: party || 'Party',
                      destination: 'Stock',
                      source: 'Quarry',
                      gross: grossVal || '0',
                      tare: tareVal || '0',
                      net: nettVal || '0',
                      qty: qty || '1',
                      billType: billType,
                      bill_type: billType,
                      gstin: gstin,
                      partyGstin: gstin,
                      isGst: billType === 'GST'
                    };
                    printTicket(ticket);
                  }}
                >
                  PRINT
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: 4 Camera Feeds Grid */}
        <div className="col-lg-4">
          <div className="saas-card" style={{ height: '100%' }}>
            <div className="saas-header">
              <span className="saas-title">4-Channel Live Security Grid</span>
            </div>

            <div className="row g-2">
              {/* Box 1 */}
              <div className="col-6">
                <div className="camera-tile position-relative overflow-hidden" style={{ borderRadius: '4px', border: '1px solid var(--line)' }}>
                  {cameras[0] ? <CameraPlayer camera={cameras[0]} /> : <div className="bg-dark w-100 h-100 d-flex align-items-center justify-content-center text-secondary small">Feed 1 Offline</div>}
                  <span className="position-absolute bottom-0 start-0 m-2 px-1.5 py-0.5 bg-dark bg-opacity-75 text-white fw-semibold" style={{ fontSize: '0.62rem', borderRadius: '3px' }}>
                    CAM 1: {cameras[0]?.name.toUpperCase() || 'GATE'}
                  </span>
                </div>
              </div>
              {/* Box 2 */}
              <div className="col-6">
                <div className="camera-tile position-relative overflow-hidden" style={{ borderRadius: '4px', border: '1px solid var(--line)' }}>
                  {cameras[1] ? <CameraPlayer camera={cameras[1]} /> : <div className="bg-dark w-100 h-100 d-flex align-items-center justify-content-center text-secondary small">Feed 2 Offline</div>}
                  <span className="position-absolute bottom-0 start-0 m-2 px-1.5 py-0.5 bg-dark bg-opacity-75 text-white fw-semibold" style={{ fontSize: '0.62rem', borderRadius: '3px' }}>
                    CAM 2: {cameras[1]?.name.toUpperCase() || 'WEIGHBRIDGE'}
                  </span>
                </div>
              </div>
              {/* Box 3 */}
              <div className="col-6">
                <div className="camera-tile position-relative overflow-hidden" style={{ borderRadius: '4px', border: '1px solid var(--line)' }}>
                  {cameras[2] ? <CameraPlayer camera={cameras[2]} /> : <div className="bg-dark w-100 h-100 d-flex align-items-center justify-content-center text-secondary small">Feed 3 Offline</div>}
                  <span className="position-absolute bottom-0 start-0 m-2 px-1.5 py-0.5 bg-dark bg-opacity-75 text-white fw-semibold" style={{ fontSize: '0.62rem', borderRadius: '3px' }}>
                    CAM 3: {cameras[2]?.name.toUpperCase() || 'OUTBOUND'}
                  </span>
                </div>
              </div>
              {/* Box 4 */}
              <div className="col-6">
                <div className="camera-tile position-relative overflow-hidden" style={{ borderRadius: '4px', border: '1px solid var(--line)' }}>
                  {cameras[3] ? <CameraPlayer camera={cameras[3]} /> : <div className="bg-dark w-100 h-100 d-flex align-items-center justify-content-center text-secondary small">Feed 4 Offline</div>}
                  <span className="position-absolute bottom-0 start-0 m-2 px-1.5 py-0.5 bg-dark bg-opacity-75 text-white fw-semibold" style={{ fontSize: '0.62rem', borderRadius: '3px' }}>
                    CAM 4: {cameras[3]?.name.toUpperCase() || 'YARD'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
