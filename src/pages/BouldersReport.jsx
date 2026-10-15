import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { printReport, printSingleTicketSlip } from '../utils/reportPrinter.js';
import { printClassicSalesReport, printClassicSummaryReport, toReportStamp } from '../utils/classicReportPrinter.js';
import SearchableSelect from '../components/SearchableSelect.jsx';
import {
  getSalesSummaryPrintMode,
  SALES_SUMMARY_PRINT_MODES,
  generateDotMatrixPreviewText,
  generateDotMatrixQuarryReportText,
  generateSummarySalesMPreviewText,
  generateSummarySalesMReportText,
  sendRawToPrinter
} from '../utils/salesSummaryPrinter.js';

export default function BouldersReport() {
  const [transactions, setTransactions] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [showFilters, setShowFilters] = useState(true);
  const [printMode, setPrintMode] = useState(() => getSalesSummaryPrintMode());
  const [showDotMatrixModal, setShowDotMatrixModal] = useState(false);
  const [dotMatrixTitle, setDotMatrixTitle] = useState('🖨️ Dot Matrix Print Preview');
  const [dotMatrixPreviewText, setDotMatrixPreviewText] = useState('');
  const [dotMatrixRawText, setDotMatrixRawText] = useState('');
  const [isSendingPrint, setIsSendingPrint] = useState(false);
  const [dotMatrixTheme, setDotMatrixTheme] = useState(() => {
    return localStorage.getItem('noris_dot_matrix_preview_theme') || 'white';
  });

  useEffect(() => {
    const handleModeUpdate = () => {
      setPrintMode(getSalesSummaryPrintMode());
    };
    window.addEventListener('storage', handleModeUpdate);
    window.addEventListener('sales-summary-print-mode-changed', handleModeUpdate);
    return () => {
      window.removeEventListener('storage', handleModeUpdate);
      window.removeEventListener('sales-summary-print-mode-changed', handleModeUpdate);
    };
  }, []);
  
  // Filters
  const [contractor, setContractor] = useState('');
  const [quarry, setQuarry] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [transporter, setTransporter] = useState('');
  const [destination, setDestination] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  
  // Active Tab
  const [activeTab, setActiveTab] = useState('Report');

  // Image Preview State
  const [selectedImage, setSelectedImage] = useState(null);

  // Boulders Metrics
  const [metrics, setMetrics] = useState({ gross: 0, tare: 0, nett: 0, trips: 0 });

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

  // Master Data States for Dropdowns
  const [masterContractors, setMasterContractors] = useState([]);
  const [masterQuarries, setMasterQuarries] = useState([]);
  const [masterTransporters, setMasterTransporters] = useState([]);
  const [masterVehicles, setMasterVehicles] = useState([]);
  const [masterDestinations, setMasterDestinations] = useState([]);

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
      api.boulders ? api.boulders().catch(() => []) : (api.getBoulders ? api.getBoulders().catch(() => []) : []),
      api.transactions ? api.transactions().catch(() => []) : [],
      api.getContractors ? api.getContractors().catch(() => []) : Promise.resolve([]),
      api.getContractorMaterials ? api.getContractorMaterials().catch(() => []) : Promise.resolve([]),
      api.getSources ? api.getSources().catch(() => []) : Promise.resolve([]),
      api.getTransporters ? api.getTransporters().catch(() => []) : Promise.resolve([]),
      api.getVehicleTares ? api.getVehicleTares().catch(() => []) : Promise.resolve([]),
      api.getDestinations ? api.getDestinations().catch(() => []) : Promise.resolve([])
    ]).then(([boulderRecords, allTx, contractorsData, contractorMaterialsData, sourcesData, transportersData, vehicleTaresData, destinationsData]) => {
      const listContractors = [
        ...(contractorMaterialsData || []).map(cm => cm.contractorName),
        ...(contractorsData || []).map(c => c.contractorName || c.contractor)
      ].filter(Boolean);
      const listQuarries = [
        ...(contractorMaterialsData || []).map(cm => cm.quarryName),
        ...(sourcesData || []).map(s => s.sourceName),
        ...(contractorsData || []).map(c => c.quarryName || c.quarry)
      ].filter(Boolean);
      const listTransporters = (transportersData || []).map(t => t.transporterName || t.transporter).filter(Boolean);
      const listDestinations = (destinationsData || []).map(d => d.destination).filter(Boolean);

      const isQuarryVeh = (t) => {
        const own = (t.ownership || '').toUpperCase();
        return own === 'OWN' || own === 'QUARRY';
      };
      let quarryVehs = (vehicleTaresData || []).filter(isQuarryVeh).map(t => t.vehicle);
      const cached = localStorage.getItem('noris_vehicle_tares');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const cachedVehs = parsed.filter(isQuarryVeh).map(t => t.vehicle);
          quarryVehs = [...quarryVehs, ...cachedVehs];
        } catch (e) {}
      }

      setMasterContractors([...new Set(listContractors)]);
      setMasterQuarries([...new Set(listQuarries)]);
      setMasterTransporters(listTransporters);
      setMasterVehicles([...new Set(quarryVehs)].filter(Boolean));
      setMasterDestinations(listDestinations);

      const filteredTx = (allTx || []).filter(t => 
        t.card === 'BOULDERS' || 
        (t.product || '').toLowerCase().includes('boulder') || 
        (t.material || '').toLowerCase().includes('boulder')
      );
      
      const combinedMap = new Map();
      [...(boulderRecords || []), ...filteredTx].forEach(r => {
        const key = r.uuid || r.id || `${r.dc_num || r.dcNum || r.token}-${r.vehicle_no || r.vehicle}`;
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
      filterData(data, '', '', '', '', '', minD, maxD);
    }).catch(console.error);
  }, []);

  const calculateMetrics = (data) => {
    const gross = data.reduce((acc, t) => acc + Number(t.gross || 0), 0);
    const tare = data.reduce((acc, t) => acc + Number(t.tare || 0), 0);
    const nett = data.reduce((acc, t) => acc + Number(t.net || t.nettVal || 0), 0);
    setMetrics({ gross, tare, nett, trips: data.length });
  };

  const filterData = (dataList, contractorVal, quarryVal, vehVal, transVal, destVal, fDate, tDate) => {
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

    if (contractorVal) res = res.filter(t => (t.contractor || t.party || '').toLowerCase().includes(contractorVal.toLowerCase()));
    if (quarryVal) res = res.filter(t => (t.quarry || t.source || '').toLowerCase().includes(quarryVal.toLowerCase()));
    if (vehVal) res = res.filter(t => (t.vehicle_no || t.vehicle || '').toLowerCase().includes(vehVal.toLowerCase()));
    if (transVal) res = res.filter(t => (t.transporter || '').toLowerCase().includes(transVal.toLowerCase()));
    if (destVal) res = res.filter(t => (t.destination || '').toLowerCase().includes(destVal.toLowerCase()));

    setFiltered(res);
    calculateMetrics(res);
  };

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    filterData(transactions, contractor, quarry, vehicle, transporter, destination, fromDate, toDate);
  };

  const uniqueContractors = [...new Set([
    ...masterContractors,
    ...transactions.map(t => t.contractor || t.party).filter(Boolean)
  ])].filter(c => c && c.trim().toUpperCase() !== 'OTHERS');

  const uniqueQuarries = [...new Set([
    'CRUSHER',
    'YARD',
    'QUARRY',
    ...masterQuarries,
    ...transactions.map(t => t.quarry || t.source).filter(Boolean)
  ])];

  const uniqueVehicles = [...new Set([
    ...masterVehicles,
    ...transactions.map(t => t.vehicle_no || t.vehicle).filter(Boolean)
  ])];

  const uniqueTransporters = [...new Set([
    ...masterTransporters,
    ...transactions.map(t => t.transporter).filter(Boolean)
  ])];

  const uniqueDestinations = [...new Set([
    'HOPPER',
    'YARD',
    'STOCKPILE',
    ...masterDestinations,
    ...transactions.map(t => t.destination).filter(Boolean)
  ])];

  const handleResetFilters = () => {
    setContractor('');
    setQuarry('');
    setVehicle('');
    setTransporter('');
    setDestination('');
    const minD = getMinDateTime();
    const maxD = getMaxDateTime();
    setFromDate(minD);
    setToDate(maxD);
    filterData(transactions, '', '', '', '', '', minD, maxD);
  };

  // Grouped summary calculation for Quarry, Contractor, and Vehicle tabs
  const getGroupedSummary = (keyName) => {
    const groups = {};
    filtered.forEach(t => {
      let val = '';
      if (keyName === 'quarry') val = t.quarry || t.source || 'UNSPECIFIED';
      else if (keyName === 'contractor') val = t.contractor || t.party || 'UNSPECIFIED';
      else if (keyName === 'vehicle') val = t.vehicle_no || t.vehicle || 'UNSPECIFIED';

      val = String(val).trim() ? String(val).trim().toUpperCase() : 'UNSPECIFIED';

      if (!groups[val]) {
        groups[val] = { name: val, trips: 0, gross: 0, tare: 0, nett: 0 };
      }

      groups[val].trips += 1;
      groups[val].gross += Number(t.gross || 0);
      groups[val].tare += Number(t.tare || 0);
      groups[val].nett += Number(t.net || t.nettVal || 0);
    });
    return Object.values(groups);
  };

  const handlePrint = () => {
    const from = toReportStamp(fromDate, false);
    const to = toReportStamp(toDate, true);

    if (printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX) {
      if (activeTab === 'Report') {
        const payload = {
          title: 'QUARRY Report / Summary',
          filters: { party: contractor, contractor, quarry, vehicle, transporter, destination },
          fromDate: from,
          toDate: to,
          rows: filtered,
          totals: {
            gross: metrics.gross,
            tare: metrics.tare,
            nett: metrics.nett,
            trips: metrics.trips
          }
        };
        const preview = generateDotMatrixPreviewText(payload);
        const raw = generateDotMatrixQuarryReportText(payload);
        setDotMatrixTitle('🖨️ Dot Matrix Print Preview — QUARRY Report / Summary');
        setDotMatrixPreviewText(preview);
        setDotMatrixRawText(raw);
        setShowDotMatrixModal(true);
        return;
      }

      // Grouped Summary Dot Matrix Report (Image 5 format: QUARRY SUMMARY :Vehicle, etc.)
      const summaryName = activeTab;
      const columnName = activeTab;
      const groups = getGroupedSummary(activeTab.toLowerCase());
      const totalTrips = groups.reduce((acc, g) => acc + Number(g.trips || 0), 0);
      const totalNett = groups.reduce((acc, g) => acc + Number(g.nett || 0), 0);

      const payload = {
        reportTitle: 'QUARRY SUMMARY',
        summaryName,
        columnName,
        filters: { party: contractor, contractor, quarry, vehicle, transporter, destination },
        fromDate: from,
        toDate: to,
        groups,
        totalTrips,
        totalNett
      };
      const preview = generateSummarySalesMPreviewText(payload);
      const raw = generateSummarySalesMReportText(payload);
      setDotMatrixTitle(`🖨️ Dot Matrix Print Preview — QUARRY SUMMARY :${summaryName}`);
      setDotMatrixPreviewText(preview);
      setDotMatrixRawText(raw);
      setShowDotMatrixModal(true);
      return;
    }

    if (activeTab === 'Report') {
      printClassicSalesReport({
        reportTitle: 'Boulders Report',
        fromDate: from,
        toDate: to,
        rows: filtered
      });
      return;
    }

    printClassicSummaryReport({
      summaryTitle: 'Boulders Summary',
      groupBy: activeTab,
      fromDate: from,
      toDate: to,
      filters: { party: contractor, source: quarry, destination, vehicle },
      groups: getGroupedSummary(activeTab.toLowerCase())
    });
  };

  const handleExecuteDotMatrixPrint = async () => {
    try {
      setIsSendingPrint(true);
      await sendRawToPrinter(dotMatrixRawText);
      setShowDotMatrixModal(false);
    } catch (err) {
      console.error('[BouldersReport] Failed to print:', err);
      alert('Failed to print: ' + (err?.message || err));
    } finally {
      setIsSendingPrint(false);
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
                <span className="saas-title">Boulders Filters</span>
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
                  <label className="saas-label">Contractor / Party</label>
                  <SearchableSelect className="saas-input" value={contractor} onChange={setContractor}
                    options={uniqueContractors} emptyLabel="ALL CONTRACTORS" placeholder="Type to search contractor..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Source / Quarry</label>
                  <SearchableSelect className="saas-input" value={quarry} onChange={setQuarry}
                    options={uniqueQuarries} emptyLabel="ALL QUARRIES" placeholder="Type to search quarry..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Vehicle</label>
                  <SearchableSelect className="saas-input" value={vehicle} onChange={setVehicle}
                    options={uniqueVehicles} emptyLabel="ALL VEHICLES" placeholder="Type to search vehicle..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Transporter</label>
                  <SearchableSelect className="saas-input" value={transporter} onChange={setTransporter}
                    options={uniqueTransporters} emptyLabel="ALL TRANSPORTERS" placeholder="Type to search transporter..." />
                </div>

                <div className="col-12">
                  <label className="saas-label">Destination</label>
                  <SearchableSelect className="saas-input" value={destination} onChange={setDestination}
                    options={uniqueDestinations} emptyLabel="ALL DESTINATIONS" placeholder="Type to search destination..." />
                </div>

                <div className="col-12 mt-3 d-flex gap-2">
                  <button type="submit" className="btn btn-primary flex-grow-1 btn-sm fw-bold py-2" style={{ backgroundcolor: 'var(--primary-ink)' }}>Search Boulders</button>
                  <button type="button" className="btn btn-outline-secondary btn-sm fw-bold py-2" onClick={handleResetFilters}>Reset</button>
                </div>
              </form>

              {/* Metrics display */}
              <div className="saas-section mt-4">
                <div className="row g-2">
                  <div className="col-6 border-bottom pb-2">
                    <div className="metric-label">Total Gross</div>
                    <div className="metric-value text-primary">{metrics.gross.toLocaleString()} kg</div>
                  </div>
                  <div className="col-6 border-bottom pb-2">
                    <div className="metric-label">Total Tare</div>
                    <div className="metric-value text-success">{metrics.tare.toLocaleString()} kg</div>
                  </div>
                  <div className="col-6 pt-2">
                    <div className="metric-label">Total Nett</div>
                    <div className="metric-value text-danger">{metrics.nett.toLocaleString()} kg</div>
                  </div>
                  <div className="col-6 pt-2">
                    <div className="metric-label">Total Trips</div>
                    <div className="metric-value">{metrics.trips}</div>
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
                <span className="saas-title">Boulders Output Statement</span>
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
                  className={`btn btn-sm ${printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX ? 'btn-success text-white' : 'btn-dark'} fw-bold ms-1`}
                  onClick={handlePrint}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  title={printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX ? 'Dot Matrix Printer (ESC/P 120-Column Quarry Report)' : 'Normal A4 Print Window'}
                >
                  🖨️ Print Full Report {printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX ? '⚡ (Dot Matrix)' : ''}
                </button>
              </div>

              <ul className="nav nav-tabs border-bottom-0">
                {['Report', 'Quarry', 'Contractor', 'Vehicle'].map(tab => (
                  <li key={tab} className="nav-item">
                    <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                  </li>
                ))}
              </ul>
            </div>

            {activeTab === 'Report' && (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                  <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
                    <tr>
                      <th>DC Num</th>
                      <th>Date & Time</th>
                      <th>Vehicle</th>
                      <th>Contractor / Party</th>
                      <th>Source</th>
                      <th className="text-end">Gross (kg)</th>
                      <th className="text-end">Tare (kg)</th>
                      <th className="text-end">Nett (kg)</th>
                      <th className="text-center">Camera Image</th>
                      <th className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, idx) => (
                      <tr key={idx}>
                        <td className="fw-bold">{t.dc_num || t.dcNum || t.token || `TK-${t.id}`}</td>
                        <td>{t.date_time || t.created_at || 'N/A'}</td>
                        <td className="fw-semibold text-primary">{t.vehicle_no || t.vehicle || 'N/A'}</td>
                        <td>{t.contractor || t.party || 'N/A'}</td>
                        <td>{t.quarry || t.source || 'CRUSHER'}</td>
                        <td className="text-end text-secondary">{Number(t.gross || 0).toLocaleString()}</td>
                        <td className="text-end text-secondary">{Number(t.tare || 0).toLocaleString()}</td>
                        <td className="text-end fw-bold text-danger">{Number(t.net || t.nettVal || 0).toLocaleString()}</td>
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
                            title={`Print Boulder Slip for ${t.dc_num || t.dcNum || t.token || t.id}`}
                          >
                            🖨️ Print
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan="9" className="text-center py-4 text-muted">No boulder records found for selected filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab !== 'Report' && (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                  <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
                    <tr>
                      <th>{activeTab === 'Quarry' ? 'Quarry / Source' : activeTab === 'Contractor' ? 'Contractor / Party' : 'Vehicle Number'}</th>
                      <th className="text-center">Total Trips</th>
                      <th className="text-end">Total Gross (kg)</th>
                      <th className="text-end">Total Tare (kg)</th>
                      <th className="text-end">Total Nett (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getGroupedSummary(activeTab.toLowerCase()).map((row, idx) => (
                      <tr key={idx}>
                        <td className="fw-bold text-primary">{row.name}</td>
                        <td className="text-center fw-semibold">{row.trips}</td>
                        <td className="text-end text-secondary">{row.gross.toLocaleString()}</td>
                        <td className="text-end text-secondary">{row.tare.toLocaleString()}</td>
                        <td className="text-end fw-bold text-danger">{row.nett.toLocaleString()}</td>
                      </tr>
                    ))}
                    {getGroupedSummary(activeTab.toLowerCase()).length === 0 && (
                      <tr>
                        <td colSpan="5" className="text-center py-4 text-muted">No grouped summary records found for selected filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DOT MATRIX PRINT PREVIEW MODAL */}
      {showDotMatrixModal && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-75 d-flex align-items-center justify-content-center p-3 animate-fade-in"
          style={{ zIndex: 1060 }}
        >
          <div className="card shadow-lg w-100 d-flex flex-column border-0" style={{ maxWidth: '1080px', maxHeight: '92vh', borderRadius: '10px', overflow: 'hidden' }}>
            <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center py-2.5 px-3">
              <div className="d-flex align-items-center gap-2">
                <span className="fw-bold" style={{ fontSize: '0.92rem' }}>
                  {dotMatrixTitle}
                </span>
                <span className="badge bg-success text-white" style={{ fontSize: '0.72rem' }}>
                  {activeTab === 'Report' ? `${filtered.length} Rows` : `${getGroupedSummary(activeTab.toLowerCase()).length} Groups`}
                </span>
              </div>
              <div className="d-flex align-items-center gap-2">
                {/* Theme toggle: White Paper vs Dark Terminal */}
                <button
                  type="button"
                  className={`btn btn-sm ${dotMatrixTheme === 'white' ? 'btn-light text-dark fw-bold' : 'btn-outline-light'} px-2 py-1.5`}
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => {
                    const next = dotMatrixTheme === 'white' ? 'dark' : 'white';
                    setDotMatrixTheme(next);
                    localStorage.setItem('noris_dot_matrix_preview_theme', next);
                  }}
                  title="Toggle White Paper / Dark Terminal mode"
                >
                  {dotMatrixTheme === 'white' ? '📄 White Paper' : '🌙 Dark Terminal'}
                </button>

                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setShowDotMatrixModal(false)}
                ></button>
              </div>
            </div>

            <div
              className="card-body p-3 overflow-auto flex-grow-1"
              style={{
                backgroundColor: dotMatrixTheme === 'white' ? '#ffffff' : '#0c1017',
                color: dotMatrixTheme === 'white' ? '#000000' : '#39ff14',
                fontFamily: '"Courier New", Courier, monospace',
                fontSize: '0.76rem',
                lineHeight: '1.25',
                whiteSpace: 'pre',
                border: dotMatrixTheme === 'white' ? '1px solid #d0d7de' : 'none'
              }}
            >
              {dotMatrixPreviewText}
            </div>

            <div className="card-footer bg-light d-flex justify-content-between align-items-center py-2 px-3 border-top">
              <span className="text-muted small">
                Continuous stationery format • ESC/P high-speed dot matrix output
              </span>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm fw-semibold"
                  onClick={() => setShowDotMatrixModal(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-success btn-sm fw-bold px-3 d-flex align-items-center gap-1.5"
                  onClick={handleExecuteDotMatrixPrint}
                  disabled={isSendingPrint}
                >
                  {isSendingPrint ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                      Sending...
                    </>
                  ) : (
                    <>
                      🖨️ Print Direct to Dot Matrix
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
