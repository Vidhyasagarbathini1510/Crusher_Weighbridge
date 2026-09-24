import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { printReport, printSingleTicketSlip } from '../utils/reportPrinter.js';
import { printClassicSalesReport, printClassicSummaryReport, toReportStamp } from '../utils/classicReportPrinter.js';
import SearchableSelect from '../components/SearchableSelect.jsx';

export default function NormalReport() {
  const [transactions, setTransactions] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [showFilters, setShowFilters] = useState(true);
  
  // Filters
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  
  // Tabs
  const [activeTab, setActiveTab] = useState('Report');

  // Metrics
  const [metrics, setMetrics] = useState({ charges: 0, gross: 0, tare: 0, nett: 0, trips: 0 });

  const [selectedImage, setSelectedImage] = useState(null);

  const getMinDateTime = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T00:00`;
  };

  const getMaxDateTime = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T23:59`;
  };

  const parseTxDateTime = (dtStr) => {
    if (!dtStr) return null;
    const str = String(dtStr).trim();
    if (!str || str === 'N/A') return null;

    const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      const hours = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
      const mins = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
      const secs = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
      const d = new Date(year, month, day, hours, mins, secs);
      if (!isNaN(d.getTime())) return d;
    }

    const cleanStr = str.replace(/,/g, ' ').replace(/\s+/g, ' ');
    const dmyMatch = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]\.?M\.?))?)?/i);
    if (dmyMatch) {
      let p1 = parseInt(dmyMatch[1], 10);
      let p2 = parseInt(dmyMatch[2], 10);
      const year = parseInt(dmyMatch[3], 10);
      let day = p1;
      let month = p2;

      if (p1 <= 12 && p2 > 12) {
        month = p1;
        day = p2;
      }

      let hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
      const mins = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
      const secs = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
      const ampm = dmyMatch[7] ? dmyMatch[7].toUpperCase().replace(/\./g, '') : null;

      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const d = new Date(year, month - 1, day, hours, mins, secs);
      if (!isNaN(d.getTime())) return d;
    }

    const fallback = new Date(str);
    if (!isNaN(fallback.getTime())) return fallback;

    return null;
  };

  useEffect(() => {
    const minD = getMinDateTime();
    const maxD = getMaxDateTime();
    setFromDate(minD);
    setToDate(maxD);

    Promise.all([
      api.firstWeighments ? api.firstWeighments({ withImages: true }).catch(() => []) : [],
      api.secondWeighments ? api.secondWeighments({ withImages: true }).catch(() => []) : [],
      api.transactions({ withImages: true }).catch(() => [])
    ]).then(([firstRecs, secondRecs, allTx]) => {
      const combinedMap = new Map();
      [...(firstRecs || []), ...(secondRecs || []), ...(allTx || [])].forEach(r => {
        const key = r.uuid || r.id || `${r.dc_num}-${r.vehicle_no}`;
        if (!combinedMap.has(key)) combinedMap.set(key, r);
        else {
          const existing = combinedMap.get(key);
          if (!existing.image_base64 && r.image_base64) {
            combinedMap.set(key, { ...existing, image_base64: r.image_base64, image_path: r.image_path });
          }
        }
      });
      const data = Array.from(combinedMap.values());
      setTransactions(data);
      filterData(data, '', '', '', minD, maxD);
    }).catch(console.error);
  }, []);

  const calculateMetrics = (data) => {
    const gross = data.reduce((acc, t) => acc + (t.gross || 0), 0);
    const tare = data.reduce((acc, t) => acc + (t.tare || 0), 0);
    const nett = data.reduce((acc, t) => acc + (t.net || 0), 0);
    const charges = data.reduce((acc, t) => acc + (Number(t.charges || t.amount || 0) || ((t.net || 0)/1000 * 350)), 0);
    setMetrics({ charges, gross, tare, nett, trips: data.length });
  };

  const filterData = (dataList, partyVal, matVal, vehVal, fDate, tDate) => {
    let res = dataList;

    if (fDate || tDate) {
      const fTime = fDate ? new Date(fDate).getTime() : null;
      const tTime = tDate ? new Date(tDate).getTime() : null;

      res = res.filter(t => {
        const txD = parseTxDateTime(t.date_time || t.created_at || t.date || t.dateTime);
        if (!txD) return true;
        const txTime = txD.getTime();
        if (fTime && txTime < fTime) return false;
        if (tTime && txTime > tTime) return false;
        return true;
      });
    }

    if (partyVal) res = res.filter(t => (t.party || '').toLowerCase().includes(partyVal.toLowerCase()));
    if (matVal) res = res.filter(t => (t.product || t.material || '').toLowerCase().includes(matVal.toLowerCase()));
    if (vehVal) res = res.filter(t => (t.vehicle_no || t.vehicle || '').toLowerCase().includes(vehVal.toLowerCase()));

    setFiltered(res);
    calculateMetrics(res);
  };

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    filterData(transactions, party, material, vehicle, fromDate, toDate);
  };

  const uniqueParties = [...new Set(transactions.map(t => t.party).filter(Boolean))];
  const uniqueMaterials = [...new Set(transactions.map(t => t.product || t.material).filter(Boolean))];
  const uniqueVehicles = [...new Set(transactions.map(t => t.vehicle_no || t.vehicle).filter(Boolean))];

  const handleResetFilters = () => {
    setParty('');
    setMaterial('');
    setVehicle('');
    const minD = getMinDateTime();
    const maxD = getMaxDateTime();
    setFromDate(minD);
    setToDate(maxD);
    filterData(transactions, '', '', '', minD, maxD);
  };

  const handlePrint = () => {
    const from = toReportStamp(fromDate, false);
    const to = toReportStamp(toDate, true);

    if (activeTab === 'Report') {
      printClassicSalesReport({
        reportTitle: 'Normal Weighment Report',
        fromDate: from,
        toDate: to,
        rows: filtered
      });
      return;
    }

    printClassicSummaryReport({
      summaryTitle: 'Weighment Summary',
      groupBy: activeTab === 'Material' ? 'Material' : 'Party',
      fromDate: from,
      toDate: to,
      filters: { party, material, vehicle },
      groups: getGroupedSummary(activeTab.toLowerCase())
    });
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
        .metric-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--ink-soft);
        }
        .metric-value {
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--ink);
        }
        .nav-tabs .nav-link {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--ink-label);
          border: none;
          border-bottom: 2px solid transparent;
        }
        .nav-tabs .nav-link.active {
          color: var(--primary-ink);
          border-bottom: 2px solid var(--primary);
          background: transparent;
        }
      `}</style>

      <div className="row g-3">
        {/* Left Filter Panel */}
        {showFilters && (
          <div className="col-lg-4 animate-fade-in">
            <div className="saas-card">
              <div className="saas-header">
                <span className="saas-title">Normal Report Filters</span>
                <div className="d-flex align-items-center gap-2">
                  <button className="btn btn-sm btn-link text-secondary p-0 text-decoration-none fw-semibold" onClick={handleResetFilters}>Reset All</button>
                  <button className="btn btn-sm btn-outline-secondary py-0 px-2 fw-semibold" onClick={() => setShowFilters(false)}>Hide ▲</button>
                </div>
              </div>

              <form onSubmit={handleSearch} className="row g-2">
                <div className="col-6">
                  <label className="saas-label">From Date & Time</label>
                  <input
                    type="datetime-local"
                    className="form-control saas-input"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="col-6">
                  <label className="saas-label">To Date & Time</label>
                  <input
                    type="datetime-local"
                    className="form-control saas-input"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>

                <div className="col-6">
                  <label className="saas-label">Party / Customer</label>
                  <SearchableSelect className="saas-input" value={party} onChange={setParty}
                    options={uniqueParties} emptyLabel="ALL PARTIES" placeholder="Type to search party..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Material</label>
                  <SearchableSelect className="saas-input" value={material} onChange={setMaterial}
                    options={uniqueMaterials} emptyLabel="ALL MATERIALS" placeholder="Type to search material..." />
                </div>

                <div className="col-12">
                  <label className="saas-label">Vehicle</label>
                  <SearchableSelect className="saas-input" value={vehicle} onChange={setVehicle}
                    options={uniqueVehicles} emptyLabel="ALL VEHICLES" placeholder="Type to search vehicle..." />
                </div>

                <div className="col-12 mt-3 d-flex gap-2">
                  <button type="submit" className="btn btn-primary flex-grow-1 btn-sm fw-bold py-2" style={{ backgroundcolor: 'var(--primary-ink)' }}>Search Normal Report</button>
                  <button type="button" className="btn btn-outline-secondary btn-sm fw-bold py-2" onClick={handleResetFilters}>Reset</button>
                </div>
              </form>

              {/* Metrics display */}
              <div className="saas-section mt-4">
                <div className="row g-2">
                  <div className="col-6 border-bottom pb-2">
                    <div className="metric-label">Total Charges</div>
                    <div className="metric-value text-primary">₹ {metrics.charges.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="col-6 border-bottom pb-2">
                    <div className="metric-label">Total Trips</div>
                    <div className="metric-value text-success">{metrics.trips}</div>
                  </div>
                  <div className="col-4 pt-2">
                    <div className="metric-label">Total Gross</div>
                    <div className="metric-value text-secondary" style={{ fontSize: '0.9rem' }}>{metrics.gross.toLocaleString()} kg</div>
                  </div>
                  <div className="col-4 pt-2">
                    <div className="metric-label">Total Tare</div>
                    <div className="metric-value text-secondary" style={{ fontSize: '0.9rem' }}>{metrics.tare.toLocaleString()} kg</div>
                  </div>
                  <div className="col-4 pt-2">
                    <div className="metric-label">Total Nett</div>
                    <div className="metric-value text-danger" style={{ fontSize: '0.9rem' }}>{metrics.nett.toLocaleString()} kg</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Right Data Grid & Tabs */}
        <div className={showFilters ? "col-lg-8" : "col-lg-12"}>
          <div className="saas-card" style={{ minHeight: '500px' }}>
            <div className="saas-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div className="d-flex align-items-center gap-2">
                <span className="saas-title">Normal Weighments Statement</span>
                <button
                  type="button"
                  className={`btn btn-sm ${showFilters ? 'btn-outline-secondary' : 'btn-primary'} fw-bold ms-2`}
                  onClick={() => setShowFilters(!showFilters)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                >
                  {showFilters ? 'Hide Filters ▲' : '🔍 Open All Filters ▼'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-dark fw-bold ms-1"
                  onClick={handlePrint}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                >
                  🖨️ Print Full Report
                </button>
              </div>

              <ul className="nav nav-tabs border-bottom-0">
                {['Report', 'Material', 'Party'].map(tab => (
                  <li key={tab} className="nav-item">
                    <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
                  <tr>
                    <th>DC / Ticket</th>
                    <th>Date & Time</th>
                    <th>Vehicle</th>
                    <th>Party</th>
                    <th>Material</th>
                    <th className="text-end">Gross (kg)</th>
                    <th className="text-end">Tare (kg)</th>
                    <th className="text-end">Nett (kg)</th>
                    <th className="text-end">Charges (₹)</th>
                    <th className="text-center">Camera Image</th>
                    <th className="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, idx) => {
                    const rowCharge = Number(t.charges || t.amount || 0) || ((t.net || 0)/1000 * 350);
                    return (
                      <tr key={idx}>
                        <td className="fw-bold">{t.dc_num || t.dcNum || t.serial_no || t.token || `TK-${t.id}`}</td>
                        <td>{t.date_time || t.created_at || 'N/A'}</td>
                        <td className="fw-semibold text-primary">{t.vehicle_no || t.vehicle || 'N/A'}</td>
                        <td>{t.party || 'LOCAL SALE'}</td>
                        <td>{t.product || t.material || 'N/A'}</td>
                        <td className="text-end text-secondary">{Number(t.gross || 0).toLocaleString()}</td>
                        <td className="text-end text-secondary">{Number(t.tare || 0).toLocaleString()}</td>
                        <td className="text-end fw-bold text-danger">{Number(t.net || t.nettVal || 0).toLocaleString()}</td>
                        <td className="text-end fw-bold text-success">₹ {rowCharge.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="text-center">
                          {t.image_base64 ? (
                            <img
                              src={t.image_base64.startsWith('data:') ? t.image_base64 : `data:image/jpeg;base64,${t.image_base64}`}
                              alt="Snapshot"
                              style={{ width: '42px', height: '28px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--line-strong)' }}
                              onClick={() => setSelectedImage(t.image_base64.startsWith('data:') ? t.image_base64 : `data:image/jpeg;base64,${t.image_base64}`)}
                              title="Click to expand snapshot"
                            />
                          ) : (
                            <span className="badge bg-secondary opacity-50" style={{ fontSize: '0.65rem' }}>No Img</span>
                          )}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary py-0 px-2 fw-semibold"
                            style={{ fontSize: '0.72rem' }}
                            onClick={() => printSingleTicketSlip(t)}
                            title={`Print Slip for ${t.dc_num || t.dcNum || t.serial_no || t.id}`}
                          >
                            🖨️ Print
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan="11" className="text-center py-4 text-muted">No normal weighment records found for selected filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Image Preview Modal */}
      {selectedImage && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1055 }} onClick={() => setSelectedImage(null)}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">Camera Snapshot Preview</h6>
                <button type="button" className="btn-close" onClick={() => setSelectedImage(null)}></button>
              </div>
              <div className="modal-body text-center p-2 bg-dark">
                <img src={selectedImage} alt="Full Snapshot" style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: '4px', objectFit: 'contain' }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
