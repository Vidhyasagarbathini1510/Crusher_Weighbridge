import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { getNextDcNumber, incrementDcNumber } from '../utils/dcHelper.js';
import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';

export default function LoadingSlip() {
  const [slips, setSlips] = useState([]);
  const [copyNum, setCopyNum] = useState('');
  const [party, setParty] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [material, setMaterial] = useState('');
  const [destination, setDestination] = useState('');
  const [source, setSource] = useState('');
  const [transporter, setTransporter] = useState('');
  const [payment, setPayment] = useState('Credit');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    // Seed slip data
    setSlips([
      { dcNum: 'DC-90812', vehicle: 'AP 39 AB 1234', party: 'SAI CONSTRUCTIONS', material: 'STONE AGGREGATE', destination: 'Site-A', payment: 'Paid', weight: '12,560' },
      { dcNum: 'DC-90813', vehicle: 'AP 16 CD 5678', party: 'R.K. BUILDERS', material: 'BOULDERS', destination: 'City Yard', payment: 'To Pay', weight: '15,430' },
    ]);
    setCopyNum(`CP-${Math.floor(100000 + Math.random() * 900000)}`);
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const cleanVehAlpha = cleanVehicle.replace(/[\s\-\.]/g, '');
    if (!cleanVehicle || cleanVehAlpha === 'N/A' || cleanVehAlpha === 'NA' || cleanVehAlpha === 'NONE' || cleanVehAlpha.length === 0) {
      return alert('Please enter a valid Vehicle Number.');
    }
    
    const draftSlip = {
      copy_num: copyNum,
      vehicle_no: cleanVehicle,
      vehicle: cleanVehicle,
      party: party || '',
      material: material || 'BOULDERS',
      destination: destination || '',
      source: source || '',
      transporter: transporter || '',
      payment: (payment && payment.trim()) ? payment.trim() : 'Credit',
      phone: phone || '',
      weight: 'Pending'
    };

    try {
      const base64Img = captureCameraSnapshot();
      let savedRecord = null;
      if (api.addLoadingSlip) {
        savedRecord = await api.addLoadingSlip(draftSlip, base64Img);
      }
      const officialDc = (savedRecord && (savedRecord.dc_num || savedRecord.dcNum)) || 'DC-1';
      const newSlip = { ...draftSlip, dc_num: officialDc, dcNum: officialDc };
      setSlips([newSlip, ...slips]);
      alert('Loading Slip Saved Successfully!');
      setCopyNum(`CP-${Math.floor(100000 + Math.random() * 900000)}`);
    } catch (err) {
      console.error('[LoadingSlip] Error saving loading slip:', err);
      alert('Error saving loading slip into database.');
    }
  };

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
        .saas-btn {
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
        }
      `}</style>

      <div className="row g-3">
        {/* Form Column */}
        <div className="col-md-5">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Sales Order Generator</span>
            </div>

            <form onSubmit={handleSave} className="row g-2">
              <div className="col-12">
                <label className="saas-label">Copy Number</label>
                <input type="text" className="form-control saas-input bg-light" value={copyNum} readOnly />
              </div>
              <div className="col-12">
                <label className="saas-label">Party</label>
                <input type="text" className="form-control saas-input" placeholder="Party Name" value={party} onChange={(e) => setParty(e.target.value)} />
              </div>
              <div className="col-12">
                <label className="saas-label">Vehicle</label>
                <input type="text" className="form-control saas-input" placeholder="Vehicle No" value={vehicle} onChange={(e) => setVehicle(e.target.value)} required />
              </div>
              <div className="col-12">
                <label className="saas-label">Material</label>
                <input type="text" className="form-control saas-input" placeholder="Material Type" value={material} onChange={(e) => setMaterial(e.target.value)} />
              </div>
              <div className="col-12">
                <label className="saas-label">Destination</label>
                <input type="text" className="form-control saas-input" placeholder="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} />
              </div>
              <div className="col-12">
                <label className="saas-label">Source</label>
                <input type="text" className="form-control saas-input" placeholder="Source" value={source} onChange={(e) => setSource(e.target.value)} />
              </div>
              <div className="col-12">
                <label className="saas-label">Transporter</label>
                <input type="text" className="form-control saas-input" placeholder="Transporter" value={transporter} onChange={(e) => setTransporter(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="saas-label">Payment Mode</label>
                <select
                  className="form-select saas-input"
                  value={payment || 'Credit'}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="Credit">Credit (Default)</option>
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <div className="col-6">
                <label className="saas-label">Phone</label>
                <input type="text" className="form-control saas-input" placeholder="Phone No" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="col-12 d-flex gap-2 mt-3 justify-content-end">
                <button type="button" className="btn btn-outline-secondary saas-btn">Re Print</button>
                <button type="submit" className="btn btn-primary saas-btn px-4" style={{ backgroundcolor: 'var(--primary-ink)' }}>Save</button>
              </div>
            </form>
          </div>
        </div>

        {/* Table Column */}
        <div className="col-md-7">
          <div className="table-card" style={{ height: '100%' }}>
            <div className="saas-header">
              <span className="saas-title">Active Orders / Slips</span>
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
                  <tr>
                    <th>DC Num</th>
                    <th>Vehicle</th>
                    <th>Party</th>
                    <th>Material</th>
                    <th>Destination</th>
                    <th>Payment</th>
                    <th className="text-end">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {slips.map((s, idx) => (
                    <tr key={idx}>
                      <td className="fw-bold">{s.dcNum}</td>
                      <td className="fw-semibold text-primary">{s.vehicle}</td>
                      <td>{s.party}</td>
                      <td>{s.material}</td>
                      <td>{s.destination}</td>
                      <td><span className="badge bg-light border text-dark">{s.payment}</span></td>
                      <td className="text-end fw-semibold text-danger">{s.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
