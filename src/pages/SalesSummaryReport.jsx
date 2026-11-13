import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client.js';
import { printReport, printSingleTicketSlip } from '../utils/reportPrinter.js';
import { printClassicSalesReport, printClassicSummaryReport, toReportStamp } from '../utils/classicReportPrinter.js';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { compareMaterials } from '../utils/materialOrder.js';
import {
  getSalesSummaryPrintMode,
  SALES_SUMMARY_PRINT_MODES,
  generateDotMatrixPreviewText,
  sortRowsByCompletionTime,
  generateDotMatrixQuarryReportText,
  generateSummarySalesMPreviewText,
  generateSummarySalesMReportText,
  sendRawToPrinter
} from '../utils/salesSummaryPrinter.js';
import {
  REPORT_GST_MODES,
  getReportGstModeSync,
  getRecordBillType,
  getReportGstShortcutsSync,
  getReportGstShortcuts
} from '../utils/reportGstUtil.js';

export default function SalesSummaryReport() {
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

  // Escape key closes dot matrix modal
  useEffect(() => {
    if (!showDotMatrixModal) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowDotMatrixModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDotMatrixModal]);

  // Filters
  // With the F1 / F2 / F3 switch on, the report opens on GST only (F2 = Non-GST, F3 = both)
  const defaultGstMode = () => (getReportGstShortcutsSync() ? REPORT_GST_MODES.GST : getReportGstModeSync());
  const [gstMode, setGstMode] = useState(defaultGstMode);
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [payment, setPayment] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Master Data States
  const [debitorsMaster, setDebitorsMaster] = useState([]);
  const [materialsMaster, setMaterialsMaster] = useState([]);
  const [sourcesMaster, setSourcesMaster] = useState([]);
  const [otherVehicles, setOtherVehicles] = useState([]);
  const [quarryVehicles, setQuarryVehicles] = useState([]);
  
  // Tabs
  const [activeTab, setActiveTab] = useState('Report');

  // Summary Metrics
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

  const parseTxDateTime = (dtStr) => {
    if (!dtStr) return null;
    const str = String(dtStr).trim();
    if (!str || str === 'N/A') return null;

    // 1. ISO / Standard YYYY-MM-DD or YYYY/MM/DD with optional time
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

    // 2. Indian date format: DD-MM-YYYY or DD/MM/YYYY with optional time and AM/PM
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

    // 3. Fallback standard JS Date
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
      api.salesUnits ? api.salesUnits().catch(() => []) : [],
      api.transactions().catch(() => []),
      api.getDebitors ? api.getDebitors().catch(() => []) : Promise.resolve([]),
      api.getMaterials ? api.getMaterials().catch(() => []) : Promise.resolve([]),
      api.getVehicleTares ? api.getVehicleTares().catch(() => []) : Promise.resolve([]),
      api.getSources ? api.getSources().catch(() => []) : Promise.resolve([])
    ]).then(([salesUnits, allTx, debitorsData, materialsData, vehicleTaresData, sourcesData]) => {
      setDebitorsMaster(debitorsData || []);
      setMaterialsMaster(materialsData || []);
      setSourcesMaster(sourcesData || []);

      const isOtherVeh = (t) => {
        const own = (t.ownership || '').toUpperCase();
        return own === 'OTHERS' || own === '';
      };

      const isQuarryVeh = (t) => {
        const own = (t.ownership || '').toUpperCase();
        return own === 'OWN' || own === 'QUARRY';
      };

      let otherVehs = (vehicleTaresData || [])
        .filter(isOtherVeh)
        .map(t => t.vehicle);

      let quarryVehs = (vehicleTaresData || [])
        .filter(isQuarryVeh)
        .map(t => t.vehicle);

      const cached = localStorage.getItem('noris_vehicle_tares');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const cachedOtherVehs = parsed
            .filter(isOtherVeh)
            .map(t => t.vehicle);
          otherVehs = [...otherVehs, ...cachedOtherVehs];

          const cachedQuarryVehs = parsed
            .filter(isQuarryVeh)
            .map(t => t.vehicle);
          quarryVehs = [...quarryVehs, ...cachedQuarryVehs];
        } catch (e) {}
      }
      setOtherVehicles([...new Set(otherVehs)].filter(Boolean));
      setQuarryVehicles([...new Set(quarryVehs)].filter(Boolean).map(v => v.trim().toUpperCase()));

      const combinedMap = new Map();
      [...(salesUnits || []), ...(allTx || [])].forEach(r => {
        const key = r.uuid || r.id || `${r.dc_num || r.dcNum}-${r.vehicle_no || r.vehicle}`;
        if (!combinedMap.has(key)) combinedMap.set(key, r);
        else {
          const existing = combinedMap.get(key);
          if (!existing.image_base64 && r.image_base64) {
            combinedMap.set(key, { ...existing, image_base64: r.image_base64, image_path: r.image_path });
          }
        }
      });
      const processed = Array.from(combinedMap.values());
      setTransactions(processed);
      const initGst = defaultGstMode();
      setGstMode(initGst);
      filterData(processed, '', '', '', '', '', '', minD, maxD, initGst);
    }).catch(console.error);
  }, []);

  const calculateMetrics = (data) => {
    const gross = data.reduce((acc, t) => acc + Number(t.gross || 0), 0);
    const tare = data.reduce((acc, t) => acc + Number(t.tare || 0), 0);
    const nett = data.reduce((acc, t) => acc + Number(t.net || t.nettVal || 0), 0);
    const totalAmt = data.reduce((acc, t) => {
      const amtStr = String(t.grand_total || t.grandTotal || t.amount || 0).replace(/[^0-9.-]/g, '');
      return acc + (parseFloat(amtStr) || 0);
    }, 0);
    setMetrics({ gross, tare, nett, trips: data.length, totalAmt });
  };

  const filterData = (dataList, partyVal, matVal, vehVal, srcVal, destVal, payVal, fDate, tDate, gstVal = gstMode) => {
    let res = dataList;

    if (fDate || tDate) {
      const fTime = fDate ? new Date(fDate).getTime() : null;
      const tTime = tDate ? new Date(tDate).getTime() : null;

      res = res.filter(t => {
        const txD = parseTxDateTime(t.date_time || t.dateTime || t.date);
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
    if (srcVal) res = res.filter(t => (t.quarry || t.source || '').toLowerCase().includes(srcVal.toLowerCase()));
    if (destVal) res = res.filter(t => (t.destination || '').toLowerCase().includes(destVal.toLowerCase()));
    if (payVal) res = res.filter(t => (t.payment || '').toLowerCase().includes(payVal.toLowerCase()));

    if (gstVal && gstVal !== REPORT_GST_MODES.ALL) {
      res = res.filter(t => getRecordBillType(t) === gstVal);
    }

    setFiltered(res);
    calculateMetrics(res);
  };

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    filterData(transactions, party, material, vehicle, source, destination, payment, fromDate, toDate, gstMode);
  };

  const handleResetFilters = () => {
    setParty('');
    setMaterial('');
    setVehicle('');
    setSource('');
    setDestination('');
    setPayment('');
    const defaultGst = defaultGstMode();
    setGstMode(defaultGst);
    const minD = getMinDateTime();
    const maxD = getMaxDateTime();
    setFromDate(minD);
    setToDate(maxD);
    filterData(transactions, '', '', '', '', '', '', minD, maxD, defaultGst);
  };

  // Settings switch: OFF = normal report (all GST & Non-GST), ON = F1 / F2 filter
  const [gstShortcuts, setGstShortcuts] = useState(() => getReportGstShortcutsSync());
  useEffect(() => {
    getReportGstShortcuts().then(setGstShortcuts);
    const handleShortcutsChange = (e) => setGstShortcuts(Boolean(e?.detail?.enabled));
    window.addEventListener('report-gst-shortcuts-changed', handleShortcutsChange);
    return () => window.removeEventListener('report-gst-shortcuts-changed', handleShortcutsChange);
  }, []);

  // Switch turned on while the report is open: start on GST only, like a fresh open
  const prevGstShortcutsRef = useRef(gstShortcuts);
  useEffect(() => {
    if (gstShortcuts && !prevGstShortcutsRef.current) {
      setGstMode(REPORT_GST_MODES.GST);
      filterData(transactions, party, material, vehicle, source, destination, payment, fromDate, toDate, REPORT_GST_MODES.GST);
    }
    prevGstShortcutsRef.current = gstShortcuts;
  }, [gstShortcuts]);

  // F1 = GST only, F2 = Non-GST only, F3 = both.
  useEffect(() => {
    if (!gstShortcuts) {
      // Switched off while filtered: go back to showing everything
      if (gstMode !== REPORT_GST_MODES.ALL) {
        setGstMode(REPORT_GST_MODES.ALL);
        filterData(transactions, party, material, vehicle, source, destination, payment, fromDate, toDate, REPORT_GST_MODES.ALL);
      }
      return;
    }
    const handleGstShortcut = (e) => {
      const keyModes = { F1: REPORT_GST_MODES.GST, F2: REPORT_GST_MODES.NON_GST, F3: REPORT_GST_MODES.ALL };
      const nextMode = keyModes[e.key];
      if (!nextMode) return;
      e.preventDefault();
      setGstMode(nextMode);
      filterData(transactions, party, material, vehicle, source, destination, payment, fromDate, toDate, nextMode);
    };
    window.addEventListener('keydown', handleGstShortcut);
    return () => window.removeEventListener('keydown', handleGstShortcut);
  }, [gstShortcuts, gstMode, transactions, party, material, vehicle, source, destination, payment, fromDate, toDate]);

  const handlePartyChange = (selectedParty) => {
    setParty(selectedParty);
    if (selectedParty && material) {
      const pLower = selectedParty.toLowerCase();
      const matchedMaster = materialsMaster.filter(m => (m.party || '').toLowerCase() === pLower).map(m => m.material);
      const matchedTx = transactions.filter(t => (t.party || '').toLowerCase() === pLower).map(t => t.product || t.material);
      const combined = [...matchedMaster, ...matchedTx].filter(Boolean);
      if (combined.length > 0 && !combined.includes(material)) {
        setMaterial('');
      }
    }
  };

  const uniqueParties = [...new Set([
    'LOCAL SALE',
    ...debitorsMaster.map(d => d.party).filter(Boolean),
    ...transactions.map(t => t.party).filter(Boolean)
  ])];

  const availableMaterials = [...new Set((() => {
    if (!party) {
      return [
        ...materialsMaster.map(m => m.material).filter(Boolean),
        ...transactions.map(t => t.product || t.material).filter(Boolean)
      ];
    }
    const pLower = party.toLowerCase();
    const matchedMaster = materialsMaster
      .filter(m => (m.party || '').toLowerCase() === pLower)
      .map(m => m.material);
    const matchedTx = transactions
      .filter(t => (t.party || '').toLowerCase() === pLower)
      .map(t => t.product || t.material);
    const combined = [...matchedMaster, ...matchedTx].filter(Boolean);
    if (combined.length > 0) return combined;
    return [
      ...materialsMaster.map(m => m.material).filter(Boolean),
      ...transactions.map(t => t.product || t.material).filter(Boolean)
    ];
  })())];

  const txOtherVehicles = transactions
    .filter(t => !t.ownership || (t.ownership || '').toUpperCase() === 'OTHERS')
    .map(t => t.vehicle_no || t.vehicle);

  const uniqueVehicles = [...new Set([...otherVehicles, ...txOtherVehicles].filter(Boolean))]
    .filter(v => !quarryVehicles.includes(v.trim().toUpperCase()));

  const uniqueSources = [...new Set([
    'CRUSHER',
    'YARD',
    'QUARRY',
    ...(sourcesMaster || []).map(s => s.sourceName || s.source).filter(Boolean),
    ...transactions.map(t => t.quarry || t.source || t.sourceName).filter(Boolean)
  ])];

  const uniqueDestinations = [...new Set(transactions.map(t => t.destination).filter(Boolean))];

  // Grouped summary generator for Material, Source, Party, Payment, and Party & Material tabs
  const getGroupedSummary = (keyName) => {
    const groups = {};
    const normKey = (keyName || '').toLowerCase().replace(/\s+/g, '_');
    const isPartyMat = normKey.includes('party') && normKey.includes('material');

    filtered.forEach(t => {
      let val = '';
      if (isPartyMat) {
        const partyVal = String(t.party || 'LOCAL SALE').trim().toUpperCase();
        const matVal = String(t.product || t.material || 'UNSPECIFIED').trim().toUpperCase();
        const key = `${partyVal}||${matVal}`;
        if (!groups[key]) {
          groups[key] = {
            party: partyVal,
            material: matVal,
            name: `${partyVal} - ${matVal}`,
            trips: 0,
            gross: 0,
            tare: 0,
            nett: 0
          };
        }
        groups[key].trips += 1;
        groups[key].gross += Number(t.gross || 0);
        groups[key].tare += Number(t.tare || 0);
        groups[key].nett += Number(t.net || t.nettVal || 0);
        return;
      }

      if (normKey === 'material') val = t.product || t.material || 'UNSPECIFIED';
      else if (normKey === 'vehicle') val = t.vehicle_no || t.vehicle || 'UNSPECIFIED';
      else if (normKey === 'source') val = t.quarry || t.source || 'UNSPECIFIED';
      else if (normKey === 'party') val = t.party || 'UNSPECIFIED';
      else if (normKey === 'payment') val = t.payment || 'UNSPECIFIED';
      
      val = String(val).trim() ? String(val).trim().toUpperCase() : 'UNSPECIFIED';

      if (!groups[val]) {
        groups[val] = {
          name: val,
          trips: 0,
          gross: 0,
          tare: 0,
          nett: 0
        };
      }

      groups[val].trips += 1;
      groups[val].gross += Number(t.gross || 0);
      groups[val].tare += Number(t.tare || 0);
      groups[val].nett += Number(t.net || t.nettVal || 0);
    });

    if (isPartyMat) {
      return Object.values(groups).sort((a, b) => {
        const pComp = a.party.localeCompare(b.party);
        if (pComp !== 0) return pComp;
        return compareMaterials(a.material, b.material);
      });
    }

    const list = Object.values(groups);
    return normKey === 'material' ? list.sort((a, b) => compareMaterials(a.name, b.name)) : list;
  };

  const handleClassicPrint = () => {
    const from = toReportStamp(fromDate, false);
    const to = toReportStamp(toDate, true);

    if (printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX) {
      // F1 / F2 filtered prints say so in the title
      const gstTag = '';
      if (activeTab === 'Report') {
        const payload = {
          title: 'SALES Report / Summary' + gstTag,
          filters: { party, material, vehicle, source, destination, payment },
          fromDate: from,
          toDate: to,
          rows: sortRowsByCompletionTime(filtered),
          totals: {
            gross: metrics.gross,
            tare: metrics.tare,
            nett: metrics.nett,
            trips: metrics.trips
          }
        };
        const preview = generateDotMatrixPreviewText(payload);
        const raw = generateDotMatrixQuarryReportText(payload);
        setDotMatrixTitle('🖨️ Dot Matrix Print Preview — ' + payload.title);
        setDotMatrixPreviewText(preview);
        setDotMatrixRawText(raw);
        setShowDotMatrixModal(true);
        return;
      }

      // Grouped Summary Dot Matrix Report (Images 3, 4, 5)
      const isPartyMat = activeTab === 'Party & Material';
      const summaryName = isPartyMat ? 'Party and Material Wise' : activeTab;
      const columnName = isPartyMat ? 'Party / Material' : activeTab;
      const groups = getGroupedSummary(isPartyMat ? 'party_material' : activeTab.toLowerCase());
      const totalTrips = groups.reduce((acc, g) => acc + Number(g.trips || 0), 0);
      const totalNett = groups.reduce((acc, g) => acc + Number(g.nett || 0), 0);

      const payload = {
        reportTitle: 'Sales Summary' + gstTag,
        summaryName,
        columnName,
        filters: { party, material, vehicle, source, destination, payment },
        fromDate: from,
        toDate: to,
        groups,
        totalTrips,
        totalNett
      };
      const preview = generateSummarySalesMPreviewText(payload);
      const raw = generateSummarySalesMReportText(payload);
      setDotMatrixTitle(`🖨️ Dot Matrix Print Preview — ${payload.reportTitle} :${summaryName}`);
      setDotMatrixPreviewText(preview);
      setDotMatrixRawText(raw);
      setShowDotMatrixModal(true);
      return;
    }

    if (activeTab === 'Report') {
      printClassicSalesReport({ fromDate: from, toDate: to, rows: sortRowsByCompletionTime(filtered) });
      return;
    }

    const isPartyMat = activeTab === 'Party & Material';

    printClassicSummaryReport({
      summaryTitle: 'Sales Summary',
      groupBy: isPartyMat ? 'Party and Material Wise' : activeTab,
      fromDate: from,
      toDate: to,
      filters: { party, material, source, destination },
      groups: getGroupedSummary(isPartyMat ? 'party_material' : activeTab.toLowerCase())
    });
  };

  const handleExecuteDotMatrixPrint = async () => {
    try {
      setIsSendingPrint(true);
      await sendRawToPrinter(dotMatrixRawText);
      setShowDotMatrixModal(false);
    } catch (err) {
      console.error('[SalesSummaryReport] Failed to print:', err);
      alert('Failed to print: ' + (err?.message || err));
    } finally {
      setIsSendingPrint(false);
    }
  };

  const handlePrint = () => {
    const dateRangeStr = (fromDate || toDate) ? `${fromDate || 'Start'} to ${toDate || 'Today'}` : 'All Dates';
    
    let reportHeaders = [];
    let reportRows = [];

    if (activeTab === 'Report') {
      reportHeaders = [
        { label: 'DC Num', align: 'left' },
        { label: 'Date & Time', align: 'left' },
        { label: 'Vehicle', align: 'left' },
        { label: 'Party', align: 'left' },
        // Bill Type only matters when F1 / F2 GST filtering is switched on
        ...(gstShortcuts ? [{ label: 'Bill Type', align: 'center' }] : []),
        { label: 'Source', align: 'left' },
        { label: 'Material', align: 'left' },
        { label: 'Payment', align: 'left' },
        { label: 'Gross (kg)', align: 'right' },
        { label: 'Tare (kg)', align: 'right' },
        { label: 'Nett (kg)', align: 'right' }
      ];

      reportRows = sortRowsByCompletionTime(filtered).map(t => {
        return [
          t.dc_num || t.dcNum || t.token || `TK-${t.id}`,
          t.date_time || t.created_at || 'N/A',
          t.vehicle_no || t.vehicle || 'N/A',
          t.party || 'LOCAL SALE',
          ...(gstShortcuts ? [getRecordBillType(t)] : []),
          t.quarry || t.source || 'CRUSHER',
          t.product || t.material || 'N/A',
          t.payment || 'Credit',
          Number(t.gross || 0).toLocaleString(),
          Number(t.tare || 0).toLocaleString(),
          Number(t.net || t.nettVal || 0).toLocaleString()
        ];
      });
    } else if (activeTab === 'Party & Material') {
      reportHeaders = [
        { label: 'Party / Customer', align: 'left' },
        { label: 'Material Name', align: 'left' },
        { label: 'Total Trips', align: 'center' },
        { label: 'Total Gross (kg)', align: 'right' },
        { label: 'Total Tare (kg)', align: 'right' },
        { label: 'Total Nett (kg)', align: 'right' }
      ];

      reportRows = getGroupedSummary('party_material').map(row => [
        row.party,
        row.material,
        row.trips,
        row.gross.toLocaleString(),
        row.tare.toLocaleString(),
        row.nett.toLocaleString()
      ]);
    } else {
      const colLabel = activeTab === 'Material' ? 'Material Name' : activeTab === 'Source' ? 'Source / Quarry' : activeTab === 'Party' ? 'Party / Customer' : 'Payment Mode';
      reportHeaders = [
        { label: colLabel, align: 'left' },
        { label: 'Total Trips', align: 'center' },
        { label: 'Total Gross (kg)', align: 'right' },
        { label: 'Total Tare (kg)', align: 'right' },
        { label: 'Total Nett (kg)', align: 'right' }
      ];

      reportRows = getGroupedSummary(activeTab.toLowerCase()).map(row => [
        row.name,
        row.trips,
        row.gross.toLocaleString(),
        row.tare.toLocaleString(),
        row.nett.toLocaleString()
      ]);
    }

    printReport({
      title: 'SALES SUMMARY REPORT',
      subtitle: activeTab,
      dateRange: dateRangeStr,
      metrics: [
        { label: 'Total Trips', value: metrics.trips },
        { label: 'Total Gross Wt', value: `${metrics.gross.toLocaleString()} kg` },
        { label: 'Total Tare Wt', value: `${metrics.tare.toLocaleString()} kg` },
        { label: 'Total Nett Wt', value: `${metrics.nett.toLocaleString()} kg` }
      ],
      headers: reportHeaders,
      rows: reportRows
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
                <span className="saas-title">Sales Summary Filters</span>
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
                  <SearchableSelect className="saas-input" value={party} onChange={handlePartyChange}
                    options={uniqueParties} emptyLabel="ALL PARTIES" placeholder="Type to search party..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Material</label>
                  <SearchableSelect className="saas-input" value={material} onChange={setMaterial}
                    options={availableMaterials} emptyLabel="ALL MATERIALS" placeholder="Type to search material..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Vehicle</label>
                  <SearchableSelect className="saas-input" value={vehicle} onChange={setVehicle}
                    options={uniqueVehicles} emptyLabel="ALL VEHICLES" placeholder="Type to search vehicle..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Source / Quarry</label>
                  <SearchableSelect className="saas-input" value={source} onChange={setSource}
                    options={uniqueSources} emptyLabel="ALL SOURCES" placeholder="Type to search source..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Destination</label>
                  <SearchableSelect className="saas-input" value={destination} onChange={setDestination}
                    options={uniqueDestinations} emptyLabel="ALL DESTINATIONS" placeholder="Type to search destination..." />
                </div>

                <div className="col-6">
                  <label className="saas-label">Payment Mode</label>
                  <SearchableSelect
                    className="saas-input"
                    value={payment}
                    onChange={setPayment}
                    emptyLabel="ALL PAYMENT MODES"
                    placeholder="Type to search payment mode..."
                    options={[
                      { value: 'Credit', label: 'CREDIT' },
                      { value: 'Cash', label: 'CASH' },
                      { value: 'UPI', label: 'UPI' },
                      { value: 'Pending', label: 'PENDING' },
                      { value: 'Paid', label: 'PAID' },
                      { value: 'To Pay', label: 'TO PAY' }
                    ]}
                  />
                </div>

                <div className="col-12 mt-3 d-flex gap-2">
                  <button type="submit" className="btn btn-primary flex-grow-1 btn-sm fw-bold py-2" style={{ backgroundcolor: 'var(--primary-ink)' }}>Search Summary</button>
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
                <span className="saas-title">Summary Output Grid</span>
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
                  onClick={handleClassicPrint}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  title={printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX ? 'Dot Matrix Printer (ESC/P 120-Column Quarry Report)' : 'Normal A4 Print Window'}
                >
                  🖨️ Print Full Report {printMode === SALES_SUMMARY_PRINT_MODES.DOT_MATRIX ? '⚡ (Dot Matrix)' : ''}
                </button>
              </div>

              <ul className="nav nav-tabs border-bottom-0">
                {['Report', 'Party & Material', 'Material', 'Vehicle', 'Source', 'Party', 'Payment'].map(tab => (
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
                      <th>Party</th>
                      {gstShortcuts && <th>Bill Type</th>}
                      <th>Source</th>
                      <th>Material</th>
                      <th>Payment</th>
                      <th className="text-end">Gross (kg)</th>
                      <th className="text-end">Tare (kg)</th>
                      <th className="text-end">Nett (kg)</th>
                      <th className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, idx) => (
                      <tr key={idx}>
                        <td className="fw-bold">{t.dc_num || t.dcNum || t.token || `TK-${t.id}`}</td>
                        <td>{t.date_time || t.created_at || 'N/A'}</td>
                        <td className="fw-semibold text-primary">{t.vehicle_no || t.vehicle || 'N/A'}</td>
                        <td>{t.party || 'LOCAL SALE'}</td>
                        {gstShortcuts && (
                          <td>
                            <span className={`badge ${getRecordBillType(t) === 'GST' ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-secondary-subtle text-secondary border'} px-1.5 py-0.5`} style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                              {getRecordBillType(t)}
                            </span>
                          </td>
                        )}
                        <td>{t.quarry || t.source || 'CRUSHER'}</td>
                        <td>{t.product || t.material || 'N/A'}</td>
                        <td>
                          <span className="badge bg-light text-dark border" style={{ fontSize: '0.7rem' }}>
                            {t.payment || 'Credit'}
                          </span>
                        </td>
                        <td className="text-end text-secondary">{Number(t.gross || 0).toLocaleString()}</td>
                        <td className="text-end text-secondary">{Number(t.tare || 0).toLocaleString()}</td>
                        <td className="text-end fw-bold text-danger">{Number(t.net || t.nettVal || 0).toLocaleString()}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary py-0 px-2 fw-semibold"
                            style={{ fontSize: '0.72rem' }}
                            onClick={() => printSingleTicketSlip(t)}
                            title={`Print DC Slip for ${t.dc_num || t.dcNum || t.token || t.id}`}
                          >
                            🖨️ Print
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={gstShortcuts ? 12 : 11} className="text-center py-4 text-muted">No summary records found for selected filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'Party & Material' && (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                  <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
                    <tr>
                      <th>Party / Customer</th>
                      <th>Material Name</th>
                      <th className="text-center">Total Trips</th>
                      <th className="text-end">Total Gross (kg)</th>
                      <th className="text-end">Total Tare (kg)</th>
                      <th className="text-end">Total Nett (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getGroupedSummary('party_material').map((row, idx) => (
                      <tr key={idx}>
                        <td className="fw-bold text-primary">{row.party}</td>
                        <td className="fw-semibold">{row.material}</td>
                        <td className="text-center fw-semibold">{row.trips}</td>
                        <td className="text-end text-secondary">{row.gross.toLocaleString()}</td>
                        <td className="text-end text-secondary">{row.tare.toLocaleString()}</td>
                        <td className="text-end fw-bold text-danger">{row.nett.toLocaleString()}</td>
                      </tr>
                    ))}
                    {getGroupedSummary('party_material').length === 0 && (
                      <tr>
                        <td colSpan="6" className="text-center py-4 text-muted">No summary grouped data found for selected filters.</td>
                      </tr>
                    )}
                  </tbody>
                  {getGroupedSummary('party_material').length > 0 && (
                    <tfoot className="table-secondary fw-bold" style={{ fontSize: '0.8rem' }}>
                      <tr>
                        <td colSpan="2" className="text-end fw-bold">Total:</td>
                        <td className="text-center">{getGroupedSummary('party_material').reduce((a, r) => a + r.trips, 0)}</td>
                        <td className="text-end">{getGroupedSummary('party_material').reduce((a, r) => a + r.gross, 0).toLocaleString()}</td>
                        <td className="text-end">{getGroupedSummary('party_material').reduce((a, r) => a + r.tare, 0).toLocaleString()}</td>
                        <td className="text-end text-danger">{getGroupedSummary('party_material').reduce((a, r) => a + r.nett, 0).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {activeTab !== 'Report' && activeTab !== 'Party & Material' && (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.8rem' }}>
                  <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
                    <tr>
                      <th>{activeTab === 'Material' ? 'Material Name' : activeTab === 'Vehicle' ? 'Vehicle Number' : activeTab === 'Source' ? 'Source / Quarry' : activeTab === 'Party' ? 'Party / Customer' : 'Payment Mode'}</th>
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
                        <td colSpan="5" className="text-center py-4 text-muted">No summary grouped data found for selected filters.</td>
                      </tr>
                    )}
                  </tbody>
                  {getGroupedSummary(activeTab.toLowerCase()).length > 0 && (
                    <tfoot className="table-secondary fw-bold" style={{ fontSize: '0.8rem' }}>
                      <tr>
                        <td className="text-end fw-bold">Total:</td>
                        <td className="text-center">{getGroupedSummary(activeTab.toLowerCase()).reduce((a, r) => a + r.trips, 0)}</td>
                        <td className="text-end">{getGroupedSummary(activeTab.toLowerCase()).reduce((a, r) => a + r.gross, 0).toLocaleString()}</td>
                        <td className="text-end">{getGroupedSummary(activeTab.toLowerCase()).reduce((a, r) => a + r.tare, 0).toLocaleString()}</td>
                        <td className="text-end text-danger">{getGroupedSummary(activeTab.toLowerCase()).reduce((a, r) => a + r.nett, 0).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DOT MATRIX PRINT PREVIEW MODAL */}
      {showDotMatrixModal && typeof document !== 'undefined' && createPortal(
        <div
          className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-75 d-flex align-items-center justify-content-center p-2 p-md-3"
          style={{ zIndex: 99999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDotMatrixModal(false);
          }}
        >
          <div
            className="card shadow-lg w-100 d-flex flex-column border-0"
            style={{
              maxWidth: '1120px',
              height: '92vh',
              maxHeight: '92vh',
              borderRadius: '10px',
              overflow: 'hidden'
            }}
          >
            {/* Header: Fixed/Sticky */}
            <div className="card-header bg-dark text-white d-flex flex-wrap justify-content-between align-items-center py-2 px-3 flex-shrink-0 gap-2" style={{ zIndex: 10 }}>
              <div className="d-flex align-items-center gap-2">
                <span className="fw-bold text-truncate" style={{ fontSize: '0.92rem' }}>
                  {dotMatrixTitle}
                </span>
                <span className="badge bg-success text-white" style={{ fontSize: '0.72rem' }}>
                  {activeTab === 'Report' ? `${filtered.length} Rows` : `${getGroupedSummary(activeTab === 'Party & Material' ? 'party_material' : activeTab.toLowerCase()).length} Groups`}
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
                  className="btn btn-sm btn-outline-light fw-semibold px-2 py-1.5"
                  onClick={(e) => {
                    navigator.clipboard?.writeText(dotMatrixPreviewText);
                    const btn = e.currentTarget;
                    btn.innerText = '✓ Copied';
                    setTimeout(() => { btn.innerText = '📋 Copy'; }, 2000);
                  }}
                  title="Copy preview text"
                  style={{ fontSize: '0.8rem' }}
                >
                  📋 Copy
                </button>

                <button
                  type="button"
                  className="btn btn-sm btn-success fw-bold px-3 py-1.5 d-flex align-items-center gap-1.5 shadow-sm"
                  onClick={handleExecuteDotMatrixPrint}
                  disabled={isSendingPrint}
                  style={{ fontSize: '0.82rem' }}
                >
                  {isSendingPrint ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                      Printing...
                    </>
                  ) : (
                    '🖨️ Send to Printer'
                  )}
                </button>

                <button
                  type="button"
                  className="btn btn-sm btn-light fw-bold px-2.5 py-1.5"
                  onClick={() => setShowDotMatrixModal(false)}
                  style={{ fontSize: '0.8rem' }}
                  title="Close modal (Esc)"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div
              className={`card-body p-0 overflow-auto flex-grow-1 ${dotMatrixTheme === 'white' ? 'bg-light' : 'bg-dark'}`}
              style={{
                minHeight: 0,
                backgroundColor: dotMatrixTheme === 'white' ? '#f1f5f9' : '#090d16'
              }}
            >
              <div className="p-3 d-flex justify-content-center">
                <div
                  className="p-4"
                  style={{
                    backgroundColor: dotMatrixTheme === 'white' ? '#ffffff' : '#0f172a',
                    color: dotMatrixTheme === 'white' ? '#000000' : '#38bdf8',
                    fontFamily: '"Courier New", Courier, Consolas, monospace',
                    fontSize: '0.82rem',
                    fontWeight: dotMatrixTheme === 'white' ? '600' : '500',
                    lineHeight: '1.45',
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                    minWidth: '980px',
                    width: '100%',
                    borderRadius: '6px',
                    border: dotMatrixTheme === 'white' ? '1px solid #cbd5e1' : '1px solid #1e293b',
                    boxShadow: dotMatrixTheme === 'white' ? '0 4px 15px rgba(0,0,0,0.06)' : 'none'
                  }}
                >
                  {dotMatrixPreviewText}
                </div>
              </div>
            </div>

            {/* Sticky Bottom Action Bar with Always-Visible Print Button */}
            <div className="card-footer bg-light border-top d-flex flex-wrap justify-content-between align-items-center py-2 px-3 flex-shrink-0 gap-2">
              <span className="text-muted small">
                Continuous stationery format • ESC/P high-speed dot matrix output
              </span>
              <div className="d-flex align-items-center gap-2 ms-auto">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary fw-semibold px-3 py-1.5"
                  onClick={() => setShowDotMatrixModal(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-success fw-bold px-4 py-1.5 d-flex align-items-center gap-1.5 shadow"
                  onClick={handleExecuteDotMatrixPrint}
                  disabled={isSendingPrint}
                  style={{ fontSize: '0.85rem' }}
                >
                  {isSendingPrint ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                      Printing...
                    </>
                  ) : (
                    '🖨️ Send to Printer'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
