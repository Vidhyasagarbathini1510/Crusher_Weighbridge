import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import CameraPreviewModal from '../components/CameraPreviewModal.jsx';
import Loader from '../components/Loader.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { getNextDcNumber, incrementDcNumber, resetDcCounter, syncDcCounterFromTransactions } from '../utils/dcHelper.js';
import { printTicket, getSelectedTemplate, getDcPrintTemplate, getGatePassTemplate } from '../utils/printHelper.js';
import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import { useScale } from '../context/ScaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getVehicleOptionMode, filterVehiclesBySetting, fetchAllTransactions, cleanupVehicleOnWeighmentCompletion } from '../utils/vehicleFilterUtil.js';



function todayForDateInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function calculateTransportAmount(quantity, rate, measurement, netWeightKg) {
  if (!rate || isNaN(rate)) return 0;
  const r = parseFloat(rate);
  const m = (measurement || '').trim().toLowerCase();
  const netKg = parseFloat(netWeightKg) || 0;
  const unitsCount = parseFloat(quantity) || 0;

  switch (m) {
    case 'tonnes':
    case 'tonne':
    case 'ton':
    case 'tons':
      return Number(((netKg / 1000) * r).toFixed(2));

    case 'units':
    case 'unit':
      if (unitsCount <= 0) return 0;
      return Number((unitsCount * r).toFixed(2));

    case 'trip':
    case 'trips':
      return Number(r.toFixed(2));

    default:
      return 0;
  }
}

export default function SalesWeighmentUnits() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [previewCamera, setPreviewCamera] = useState(null);
  const [showCameraPanel, setShowCameraPanel] = useState(false);

  // Form fields
  const location = useLocation();
  const [dcNum, setDcNum] = useState('');
  const [yourDc, setYourDc] = useState('');
  const [activeLoadingSlip, setActiveLoadingSlip] = useState(null);
  const isLocked = Boolean(activeLoadingSlip);
  const {
    vehicle, setVehicle,
    gross: grossVal, setGross: setGrossVal,
    tare: tareVal, setTare: setTareVal,
    nett: nettVal, setNett: setNettVal
  } = useScale();

  // Read incoming vehicle from location state if passed from Vehicles / Loading Slip
  useEffect(() => {
    if (location.state?.vehicle) {
      setVehicle(location.state.vehicle);
    }
  }, [location.state]);

  // Vehicle lives in the shared scale context so the bottom status bar mirrors
  // this field — but it is wiped on unmount, so leaving this page never carries
  // the truck over to Boulders or Yard.
  useEffect(() => () => setVehicle(''), []);
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const userManuallyChangedMaterialRef = useRef(false);
  const lastVehicleRef = useRef('');
  const [unitType, setUnitType] = useState('tonnes'); // tonnes or units
  const [unitsVal, setUnitsVal] = useState('');
  const [destination, setDestination] = useState('');


  const [source, setSource] = useState('');
  const [transporter, setTransporter] = useState('');
  const [driver, setDriver] = useState('');
  const [phone, setPhone] = useState('');
  const [stationary, setStationary] = useState('');
  const [royaltyType, setRoyaltyType] = useState('None'); // 'None', 'Government', 'General'
  const [royaltyAmount, setRoyaltyAmount] = useState('0');

  // Automatically calculate Royalty Amount
  useEffect(() => {
    if (!royaltyType || royaltyType === 'None') {
      setRoyaltyAmount('0');
      return;
    }
    const govRate = parseFloat(localStorage.getItem('noris_royalty_gov_rate')) || 0;
    const genRate = parseFloat(localStorage.getItem('noris_royalty_gen_rate')) || 0;
    const activeRate = royaltyType === 'Government' ? govRate : (royaltyType === 'General' ? genRate : 0);

    let qty = 0;
    if (unitType === 'units') {
      qty = parseFloat(unitsVal) || 0;
    } else {
      qty = (parseFloat(nettVal) || 0) / 1000; // Nett weight in tonnes
    }

    if (activeRate > 0 && qty > 0) {
      const calcRoyalty = (activeRate * qty).toFixed(2);
      setRoyaltyAmount(calcRoyalty);
    } else {
      setRoyaltyAmount('0');
    }
  }, [royaltyType, nettVal, unitsVal, unitType]);
  const [poNumber, setPoNumber] = useState('');
  // Defaults to today; the operator can still pick any other date.
  const [poDate, setPoDate] = useState(todayForDateInput);
  const [payment, setPayment] = useState('Credit');
  const [localScaleMode, setLocalScaleMode] = useState(false);
  const [layoutDesign, setLayoutDesign] = useState(
    () => localStorage.getItem('noris_sales_layout_design') || 'compact'
  );

  useEffect(() => {
    const handleLayoutChange = (e) => {
      const mode = e?.detail?.design || localStorage.getItem('noris_sales_layout_design') || 'compact';
      setLayoutDesign(mode);
    };
    window.addEventListener('sales-layout-changed', handleLayoutChange);
    window.addEventListener('storage', handleLayoutChange);
    return () => {
      window.removeEventListener('sales-layout-changed', handleLayoutChange);
      window.removeEventListener('storage', handleLayoutChange);
    };
  }, []);

  // Weights
  const [savedWeight, setSavedWeight] = useState('');

  // Payment
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('0');
  const [billType, setBillType] = useState('NON-GST'); // 'GST' or 'NON-GST'
  
  // Dual Transport Rates (Party Transport vs Transporter Freight)
  const [partyTransportRate, setPartyTransportRate] = useState('');
  const [partyTransportMeasurement, setPartyTransportMeasurement] = useState('Tonnes');
  const [partyTransportAmount, setPartyTransportAmount] = useState('0'); // Party Full Transport Amount
  
  const [transporterRate, setTransporterRate] = useState('');
  const [transporterMeasurement, setTransporterMeasurement] = useState('Units');
  const [transporterAmount, setTransporterAmount] = useState('0'); // Transporter Freight Amount (Vendor Cost)

  const [transport, setTransport] = useState(''); // Net Transport Difference (Party Transport Amount - Transporter Amount)

  const [discount, setDiscount] = useState('');
  const [grandTotal, setGrandTotal] = useState('0');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [creditAmount, setCreditAmount] = useState('');

  // Scale state
  const [netronWeight, setNetronWeight] = useState('0');
  const [manualMode, setManualMode] = useState(false);

  const [vehiclesList, setVehiclesList] = useState([]);
  const [vehicleTares, setVehicleTares] = useState([]);
  const [msg, setMsg] = useState('');
  const [allDebitors, setAllDebitors] = useState([]);
  const [partiesList, setPartiesList] = useState(['LOCAL SALE']);
  const [allMaterials, setAllMaterials] = useState([]);
  const [availableMaterials, setAvailableMaterials] = useState([]);
  const [allDestinations, setAllDestinations] = useState([]);
  const [availableDestinations, setAvailableDestinations] = useState([]);
  const [allTransporters, setAllTransporters] = useState([]);
  const [transportersList, setTransportersList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);

  const [savedTicket, setSavedTicket] = useState(null);
  const [isSaved, setIsSaved] = useState(false);
  const [errors, setErrors] = useState({});

  const loadMasterData = () => {
    Promise.all([
      fetchAllTransactions(),
      api.getDebitors ? api.getDebitors().catch(() => []) : Promise.resolve([]),
      api.getMaterials ? api.getMaterials().catch(() => []) : Promise.resolve([]),
      api.getDestinations ? api.getDestinations().catch(() => []) : Promise.resolve([]),
      api.getSources ? api.getSources().catch(() => []) : Promise.resolve([]),
      api.getTransporters ? api.getTransporters().catch(() => []) : Promise.resolve([]),
      api.getVehicleTares ? api.getVehicleTares().catch(() => []) : Promise.resolve([]),
      api.getLoadingSlips ? api.getLoadingSlips().catch(() => []) : Promise.resolve([])
    ]).then(([txs, debitorsData, materialsData, destinationsData, sourcesData, transportersData, vehicleTaresData, loadingSlipsData]) => {
      syncDcCounterFromTransactions(txs, 'sales');
      setVehicleTares(vehicleTaresData || []);
      setAllDebitors(debitorsData || []);

      if (api.getTransporterVehicles) {
        api.getTransporterVehicles().then(tv => {
          if (Array.isArray(tv) && tv.length > 0) {
            localStorage.setItem('noris_transporter_vehicles', JSON.stringify(tv));
          }
        }).catch(() => {});
      }

      // Extract pending loading slips (unfulfilled only)
      const pendingSlips = (loadingSlipsData || []).filter(s => {
        const status = String(s.status || '').trim().toLowerCase();
        return status !== 'completed' && status !== 'fulfilled';
      });
      const pendingVehicles = [...new Set(
        pendingSlips.map(s => String(s.vehicle_no || s.vehicle || '').trim().toUpperCase()).filter(Boolean)
      )];

      // Vehicles
      let tareObjs = [];
      const cachedTares = localStorage.getItem('noris_vehicle_tares');
      if (cachedTares) {
        try {
          const parsed = JSON.parse(cachedTares);
          tareObjs = parsed.filter(t => (t.ownership || '').toUpperCase() === 'OTHERS');
        } catch (e) {
          console.error(e);
        }
      }
      const dbTareObjs = (vehicleTaresData || []).filter(t => (t.ownership || '').toUpperCase() === 'OTHERS');
      const allOtherVehObjs = [...tareObjs, ...dbTareObjs];

      getVehicleOptionMode().then(mode => {
        const filteredObjs = filterVehiclesBySetting(allOtherVehObjs, txs, mode);
        const vehNos = filteredObjs.map(t => (t.vehicle || t.vehicleNo || '').trim().toUpperCase());
        const combined = [...new Set([...pendingVehicles, ...vehNos])].filter(Boolean);

        const menuMode = localStorage.getItem('noris_loading_slip_menu_mode') || (localStorage.getItem('noris_enable_loading_slip') === 'true' ? 'both' : 'vehicles');

        if (menuMode === 'loading_slip') {
          // Loading Slip Only: show only vehicles from pending loading slips
          setVehiclesList(pendingVehicles);
        } else if (menuMode === 'vehicles') {
          // Vehicles Only: show only vehicles from vehicle records
          setVehiclesList(vehNos);
        } else {
          // Both: show both loading slip vehicles and master vehicles
          setVehiclesList(combined);
        }
      });


      // Parties strictly from debitors master data (synced from server endpoint) + LOCAL SALE
      const debitorsParties = (debitorsData || []).map(d => d.party).filter(Boolean);
      const uniqueParties = [...new Set(['LOCAL SALE', ...debitorsParties])];
      setPartiesList(uniqueParties);

      // Materials from local SQLite
      setAllMaterials(materialsData || []);

      // Destinations from local SQLite
      setAllDestinations(destinationsData || []);

      // Transporters from local SQLite / API (flatten nested destination rates if present)
      const flattenedTransporters = [];
      (transportersData || []).forEach(t => {
        const dests = (t.destinations && Array.isArray(t.destinations) && t.destinations.length > 0)
          ? t.destinations
          : ((t.transporterDestinations && Array.isArray(t.transporterDestinations) && t.transporterDestinations.length > 0)
            ? t.transporterDestinations
            : null);
        if (dests) {
          dests.forEach(d => {
            flattenedTransporters.push({
              id: d.id,
              transporterName: t.transporterName || t.transporter || d.transporterName,
              destination: d.destination || t.destination,
              measurement: d.measurement || t.measurement,
              rate: d.rate !== undefined && d.rate !== null ? d.rate : t.rate,
              status: d.status || t.status
            });
          });
        } else {
          flattenedTransporters.push(t);
        }
      });
      setAllTransporters(flattenedTransporters);
      const transNames = flattenedTransporters.map(t => t.transporterName || t.transporter).filter(Boolean);
      const txTrans = (txs || []).map(t => t.transporter).filter(Boolean);
      const uniqueTrans = [...new Set(['OWN', ...transNames, ...txTrans])];
      setTransportersList(uniqueTrans);

      // Sources from local SQLite (synced from server endpoint)
      const sNames = (sourcesData || []).map(s => s.sourceName).filter(Boolean);
      const txSources = (txs || []).map(t => t.source).filter(Boolean);
      const uniqueSources = [...new Set([...sNames, ...txSources])];
      setSourcesList(uniqueSources);
    }).catch(console.error);
  };

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));

    loadMasterData();

    // Trigger an immediate background sync on mount to fetch the latest from server
    if (api.syncMasterData) {
      api.syncMasterData().then((res) => {
        if (res && res.success) {
          loadMasterData();
        }
      }).catch(console.error);
    }

    const onRefresh = () => handleResetForm();
    window.addEventListener('page-refresh', onRefresh);

    const onSlipSaved = () => loadMasterData();
    window.addEventListener('loading-slip-saved', onSlipSaved);
    window.addEventListener('workflow-setting-changed', onSlipSaved);
    window.addEventListener('storage', onSlipSaved);

    let unsubscribeSync = null;
    if (window.electronAPI && window.electronAPI.onMasterDataSynced) {
      unsubscribeSync = window.electronAPI.onMasterDataSynced(() => {
        loadMasterData();
      });
    }

    return () => {
      window.removeEventListener('page-refresh', onRefresh);
      window.removeEventListener('loading-slip-saved', onSlipSaved);
      window.removeEventListener('workflow-setting-changed', onSlipSaved);
      window.removeEventListener('storage', onSlipSaved);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, []);

  // AI Material Detection Auto-Fill
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onAiMaterialDetected) return;
    const unsubscribe = window.electronAPI.onAiMaterialDetected((data) => {
      if (data && data.material && data.stable) {
        if (!userManuallyChangedMaterialRef.current) {
          setMaterial(prev => prev || data.material);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Update DC Number whenever the billing type (GST vs NON-GST) changes
  useEffect(() => {
    Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val));
  }, [billType]);

  // Dynamically update materials list strictly based on selected Party
  useEffect(() => {
    if (!party) {
      const allMatNames = [...new Set(allMaterials.map(m => m.material))].filter(Boolean);
      setAvailableMaterials(allMatNames);
      return;
    }

    const partyUpper = party.trim().toUpperCase();
    const isLocalSale = partyUpper === 'LOCAL SALE' || partyUpper.startsWith('LOCAL SALE');
    const matchedMaterials = allMaterials.filter(
      m => m.party && m.party.trim().toUpperCase() === partyUpper
    );

    let matNames = [];
    if (matchedMaterials.length > 0) {
      matNames = [...new Set(matchedMaterials.map(m => m.material))].filter(Boolean);
    } else if (isLocalSale) {
      // General walk-in / local cash sale has access to all materials
      matNames = [...new Set(allMaterials.map(m => m.material))].filter(Boolean);
    } else {
      // Specific party with no mapped materials strictly shows empty
      matNames = [];
    }

    setAvailableMaterials(matNames);

    if (matNames.length > 0) {
      const existingMatch = matNames.find(m => material && m.toUpperCase() === material.toUpperCase());
      if (existingMatch) {
        setMaterial(existingMatch);
        const matchEntry = matchedMaterials.find(m => (m.material || '').toUpperCase() === existingMatch.toUpperCase());
        if (matchEntry && matchEntry.rate !== undefined && matchEntry.rate !== null) {
          setRate(matchEntry.rate.toString());
        }
      } else if (!material) {
        const firstMat = matNames[0];
        setMaterial(firstMat);
        const matchEntry = matchedMaterials.find(m => m.material === firstMat);
        if (matchEntry && matchEntry.rate !== undefined && matchEntry.rate !== null) {
          setRate(matchEntry.rate.toString());
        }
      }
    }
  }, [party, allMaterials]);

  // Dynamically update destinations list based on selected Party while keeping 'OUT' option
  useEffect(() => {
    const partyUpper = (party || '').trim().toUpperCase();
    const isLocalSale = partyUpper === 'LOCAL SALE' || partyUpper.startsWith('LOCAL SALE');
    const matchedDestinations = allDestinations.filter(
      d => d.party && d.party.trim().toUpperCase() === partyUpper
    );

    let destNames = [];
    if (matchedDestinations.length > 0) {
      destNames = [...new Set(matchedDestinations.map(d => d.destination))].filter(Boolean);
    } else if (isLocalSale) {
      destNames = [...new Set(allDestinations.map(d => d.destination))].filter(Boolean);
    }

    const combinedDests = [...new Set(['OUT', ...destNames])];
    setAvailableDestinations(combinedDests);
  }, [party, allDestinations]);

  // 1. Resolve Party Destination Transport Rate
  useEffect(() => {
    if (!party || !destination) {
      setPartyTransportRate('');
      setPartyTransportMeasurement('Tonnes');
      return;
    }
    const partyUpper = party.trim().toUpperCase();
    const destUpper = destination.trim().toUpperCase();
    const matched = allDestinations.find(d => 
      (d.party || '').trim().toUpperCase() === partyUpper &&
      (d.destination || '').trim().toUpperCase() === destUpper
    );
    if (matched && matched.rate !== undefined && matched.rate !== null && matched.rate > 0) {
      setPartyTransportRate(matched.rate.toString());
      setPartyTransportMeasurement(matched.measurement || 'Tonnes');
    } else {
      setPartyTransportRate('');
      setPartyTransportMeasurement('Tonnes');
    }
  }, [party, destination, allDestinations]);

  // 2. Resolve Transporter Destination Rate (Flexible matching with fallback)
  useEffect(() => {
    if (!transporter) {
      setTransporterRate('');
      setTransporterMeasurement('Units');
      setTransporterAmount('0.00');
      return;
    }
    const transUpper = transporter.trim().toUpperCase();
    const destUpper = (destination || '').trim().toUpperCase();

    // 1. Try exact match: Transporter Name + Destination
    let matched = allTransporters.find(t => 
      (t.transporterName || t.transporter || '').trim().toUpperCase() === transUpper &&
      (t.destination || '').trim().toUpperCase() === destUpper
    );

    // 2. Flexible match on destination (ignore spaces/hyphens or minor variations e.g. hyderbad vs hyderabad)
    if (!matched && destUpper && destUpper !== 'OUT') {
      const cleanDest = destUpper.replace(/[\s\-_]/g, '');
      matched = allTransporters.find(t => {
        const tName = (t.transporterName || t.transporter || '').trim().toUpperCase();
        if (tName !== transUpper) return false;
        const tDest = (t.destination || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
        return tDest === cleanDest || tDest.startsWith(cleanDest.slice(0, 5)) || cleanDest.startsWith(tDest.slice(0, 5));
      });
    }

    // 3. Fallback: match by Transporter Name alone (using registered rate)
    if (!matched) {
      matched = allTransporters.find(t => 
        (t.transporterName || t.transporter || '').trim().toUpperCase() === transUpper &&
        t.rate !== undefined && t.rate !== null && Number(t.rate) > 0
      ) || allTransporters.find(t => 
        (t.transporterName || t.transporter || '').trim().toUpperCase() === transUpper
      );
    }

    if (matched && matched.rate !== undefined && matched.rate !== null && Number(matched.rate) > 0) {
      setTransporterRate(matched.rate.toString());
      setTransporterMeasurement(matched.measurement || 'Units');
    } else {
      setTransporterRate('');
      setTransporterMeasurement('Units');
      setTransporterAmount('0.00');
    }
  }, [transporter, destination, allTransporters]);

  // 3. Auto-calculate Party Transport Amount
  useEffect(() => {
    if (partyTransportRate) {
      const qty = unitType === 'units' ? (parseFloat(unitsVal) || 0) : 0;
      const calculated = calculateTransportAmount(qty, partyTransportRate, partyTransportMeasurement, parseFloat(nettVal) || 0);
      setPartyTransportAmount(calculated > 0 ? calculated.toFixed(2) : '0.00');
    } else {
      setPartyTransportAmount('0.00');
    }
  }, [partyTransportRate, partyTransportMeasurement, nettVal, unitsVal, unitType]);

  // 4. Auto-calculate Transporter Freight Amount
  useEffect(() => {
    if (transporterRate) {
      const qty = unitType === 'units' ? (parseFloat(unitsVal) || 0) : 0;
      const calculated = calculateTransportAmount(qty, transporterRate, transporterMeasurement, parseFloat(nettVal) || 0);
      setTransporterAmount(calculated > 0 ? calculated.toFixed(2) : '0.00');
    } else {
      setTransporterAmount('0.00');
    }
  }, [transporterRate, transporterMeasurement, nettVal, unitsVal, unitType]);

  // 5. Customer Transport Amount (Billed on Invoice = Party Transport Amount - Transporter Freight Amount)
  useEffect(() => {
    const pAmt = parseFloat(partyTransportAmount) || 0;
    const tAmt = parseFloat(transporterAmount) || 0;
    if (partyTransportRate) {
      const diff = pAmt - tAmt;
      if (diff < 0) {
        setTransport('0.00');
      } else {
        setTransport(diff.toFixed(2));
      }
    } else {
      setTransport('0.00');
    }
  }, [partyTransportAmount, transporterAmount, partyTransportRate]);

  // Real-time validation error clearing when user enters/selects a valid value
  useEffect(() => {
    setErrors(prev => {
      if (!Object.keys(prev).length) return prev;
      const updated = { ...prev };
      let changed = false;

      const cleanVeh = (vehicle || '').trim().toUpperCase().replace(/[\s\-\.]/g, '');
      if (updated.vehicle && cleanVeh && cleanVeh !== 'N/A' && cleanVeh !== 'NA' && cleanVeh !== 'NONE' && cleanVeh.length >= 4) {
        delete updated.vehicle;
        changed = true;
      }
      const cleanParty = (party || '').trim();
      if (updated.party && cleanParty && cleanParty.toUpperCase() !== 'N/A' && cleanParty.toUpperCase() !== 'NA' && cleanParty.toUpperCase() !== 'NONE') {
        delete updated.party;
        changed = true;
      }
      const cleanMat = (material || '').trim();
      if (updated.material && cleanMat && cleanMat.toUpperCase() !== 'N/A' && cleanMat.toUpperCase() !== 'NA' && cleanMat.toUpperCase() !== 'NONE') {
        delete updated.material;
        changed = true;
      }
      const cleanTrans = (transporter || '').trim();
      if (updated.transporter && cleanTrans && cleanTrans.toUpperCase() !== 'N/A' && cleanTrans.toUpperCase() !== 'NA' && cleanTrans.toUpperCase() !== 'NONE') {
        delete updated.transporter;
        changed = true;
      }
      const cleanDest = (destination || '').trim();
      if (updated.destination && cleanDest && cleanDest.toUpperCase() !== 'N/A' && cleanDest.toUpperCase() !== 'NA' && cleanDest.toUpperCase() !== 'NONE') {
        delete updated.destination;
        changed = true;
      }

      return changed ? updated : prev;
    });
  }, [vehicle, party, material, transporter, destination]);

  // Auto-fill tare and transporter when vehicle is selected & perform order validation
  useEffect(() => {
    if (!vehicle) {
      setSavedWeight('');
      setTareVal('');
      lastVehicleRef.current = '';
      userManuallyChangedMaterialRef.current = false;
      return;
    }
    const cleanVehicle = vehicle.replace(/\s+/g, '').toUpperCase();
    if (cleanVehicle !== lastVehicleRef.current) {
      lastVehicleRef.current = cleanVehicle;
      userManuallyChangedMaterialRef.current = false;
    }

    // Auto-fill Transporter mapped to this vehicle
    const storedTransporterVehicles = localStorage.getItem('noris_transporter_vehicles');
    if (storedTransporterVehicles) {
      try {
        const transList = JSON.parse(storedTransporterVehicles);
        if (Array.isArray(transList)) {
          const matchedTrans = transList.find(
            m => m.vehicleNo && m.vehicleNo.replace(/\s+/g, '').toUpperCase() === cleanVehicle
          );
          if (matchedTrans && matchedTrans.transporter && matchedTrans.transporter.trim()) {
            const mappedTransporter = matchedTrans.transporter.trim();
            if (!activeLoadingSlip || !activeLoadingSlip.transporter) {
              setTransporter(mappedTransporter);
              setTransportersList(prev => {
                const exists = prev.some(t => t.toUpperCase() === mappedTransporter.toUpperCase());
                return exists ? prev : [...prev, mappedTransporter];
              });
            }
          }
        }
      } catch (err) {
        console.error('Error auto-filling transporter for vehicle:', err);
      }
    }

    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try { localTares = JSON.parse(cachedTares); } catch (e) { }
    }
    const combined = [...vehicleTares, ...localTares];

    const matched = combined.find(
      t => t.vehicle && t.vehicle.replace(/\s+/g, '').toUpperCase() === cleanVehicle
    );

    const liveWeightNum = parseFloat(netronWeight) || 0;
    const currentGrossNum = parseFloat(grossVal) || 0;
    const currentScaleWeight = liveWeightNum > 0 ? liveWeightNum : currentGrossNum;

    if (matched) {
      // Auto-fill material from vehicle tare record (only if not loaded from active loading slip)
      if (!activeLoadingSlip && matched.material && matched.material.trim()) {
        const vehMat = matched.material.trim();
        if (!userManuallyChangedMaterialRef.current) {
          setMaterial(vehMat);
          setAvailableMaterials(prev => {
            const hasIt = prev.some(m => m.toUpperCase() === vehMat.toUpperCase());
            return hasIt ? prev : [...prev, vehMat];
          });
          const matchEntry = allMaterials.find(m =>
            (!party || (m.party || '').trim().toUpperCase() === (party || '').trim().toUpperCase()) &&
            (m.material || '').trim().toUpperCase() === vehMat.toUpperCase()
          );
          if (matchEntry && matchEntry.rate !== undefined && matchEntry.rate !== null) {
            setRate(matchEntry.rate.toString());
          }
        }
      }

      if (matched.weight) {
        const rawSavedWeight = String(matched.weight).replace(/,/g, '');
        const savedTareNum = parseFloat(rawSavedWeight) || 0;
        setSavedWeight(rawSavedWeight);

        if (currentScaleWeight > 0) {
          const high = Math.max(currentScaleWeight, savedTareNum).toString();
          const low = Math.min(currentScaleWeight, savedTareNum).toString();
          setGrossVal(high);
          setTareVal(low);
        } else {
          setTareVal(rawSavedWeight);
        }
      }
    } else {
      setSavedWeight('');
      if (currentScaleWeight > 0) {
        setGrossVal(currentScaleWeight.toString());
      }
    }
  }, [vehicle, vehicleTares, allMaterials, party]);

  // Auto-detect and prefill pending Loading Slip for this vehicle
  useEffect(() => {
    if (!vehicle || !vehicle.trim()) {
      setActiveLoadingSlip(null);
      return;
    }
    const cleanVeh = vehicle.trim().toUpperCase();
    if (api.getLoadingSlips) {
      api.getLoadingSlips().then(slips => {
        if (!Array.isArray(slips)) return;
        const hit = slips.find(s => {
          const sVeh = String(s.vehicle_no || s.vehicle || '').trim().toUpperCase();
          const sStatus = String(s.status || '').trim().toLowerCase();
          return sVeh === cleanVeh && sStatus !== 'completed' && sStatus !== 'fulfilled';
        });

        if (hit) {
          setActiveLoadingSlip(hit);
                if (hit.party) {
            setParty(hit.party);
            setPartiesList(prev => {
              const hasIt = prev.some(p => p.trim().toUpperCase() === hit.party.trim().toUpperCase());
              return hasIt ? prev : [hit.party, ...prev];
            });
          }
          if (hit.material) {
            const hitMat = hit.material.trim();
            if (!userManuallyChangedMaterialRef.current) {
              setMaterial(hitMat);
              setAvailableMaterials(prev => {
                const hasIt = prev.some(m => m.toUpperCase() === hitMat.toUpperCase());
                return hasIt ? prev : [...prev, hitMat];
              });
              const matchEntry = allMaterials.find(m =>
                (!hit.party || (m.party || '').trim().toUpperCase() === (hit.party || '').trim().toUpperCase()) &&
                (m.material || '').trim().toUpperCase() === hitMat.toUpperCase()
              );
              if (matchEntry && matchEntry.rate !== undefined && matchEntry.rate !== null) {
                setRate(matchEntry.rate.toString());
              }
            }
          }
          if (hit.destination) {
            setDestination(hit.destination.trim());
          }
          if (hit.source) {
            setSource(hit.source.trim());
          }
          const isHitLocal = hit.party && (hit.party.trim().toUpperCase() === 'LOCAL SALE' || hit.party.trim().toUpperCase().startsWith('LOCAL SALE'));
          if (hit.payment && hit.payment.trim()) {
            const slipPay = hit.payment.trim();
            if (isHitLocal) {
              setPayment(slipPay.toUpperCase() === 'CREDIT' ? 'Cash' : slipPay);
            } else {
              setPayment(slipPay);
            }
          } else {
            setPayment(isHitLocal ? 'Cash' : 'Credit');
          }
          if (hit.phone) {
            setPhone(hit.phone.trim());
          }
          if (hit.transporter && hit.transporter.trim()) {
            setTransporter(hit.transporter.trim());
          }
          // Do NOT overwrite yourDc from loading slip ("dont consier the dc -number in loading slip")

          // Consider loading slip weight for Gross vs Tare calculation
          const rawSlipWeight = String(hit.weight || '').trim().replace(/,/g, '');
          const slipWeightNum = parseFloat(rawSlipWeight) || 0;
          if (slipWeightNum > 0) {
            setSavedWeight(rawSlipWeight);
            const liveWeightNum = parseFloat(netronWeight) || 0;
            const currentGrossNum = parseFloat(grossVal) || 0;
            const currentScale = liveWeightNum > 0 ? liveWeightNum : currentGrossNum;

            if (currentScale > 0) {
              const high = Math.max(currentScale, slipWeightNum).toString();
              const low = Math.min(currentScale, slipWeightNum).toString();
              setGrossVal(high);
              setTareVal(low);
            } else {
              setTareVal(rawSlipWeight);
            }
          }
        } else {
          setActiveLoadingSlip(null);
              }
      }).catch(err => {
        console.error('[SalesWeighmentUnits] Error checking loading slips:', err);
      });
    }
  }, [vehicle]);

  // Listen to scale
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const numeric = data.value.replace(/[^0-9.-]/g, '');
        if (numeric) {
          setNetronWeight(numeric);
          if (!manualMode) {
            const liveNum = parseFloat(numeric) || 0;
            const savedNum = parseFloat(savedWeight) || 0;
            if (savedNum > 0 && liveNum > 0) {
              const high = Math.max(liveNum, savedNum).toString();
              const low = Math.min(liveNum, savedNum).toString();
              setGrossVal(high);
              setTareVal(low);
            } else {
              setGrossVal(numeric);
            }
          }
        } else {
          setNetronWeight(data.value);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [manualMode, savedWeight]);

  // Calculate Net Weight (higher value - lower value = net)
  useEffect(() => {
    const g = parseFloat(grossVal) || 0;
    const t = parseFloat(tareVal) || 0;
    setNettVal(Math.abs(g - t).toString());
  }, [grossVal, tareVal]);

  // Calculate Payment Details & Auto-balance Credit
  useEffect(() => {
    const r = parseFloat(rate) || 0;
    const n = parseFloat(nettVal) || 0;
    const u = parseFloat(unitsVal) || 0;
    const baseAmt = unitType === 'tonnes' ? (n / 1000) * r : u * r;
    const amtStr = isNaN(baseAmt) ? '0.00' : baseAmt.toFixed(2);
    setAmount(amtStr);

    const trans = parseFloat(transport) || 0;
    const disc = parseFloat(discount) || 0;
    const royalty = parseFloat(royaltyAmount) || 0;
    const gt = isNaN(baseAmt + trans - disc + royalty) ? 0 : (baseAmt + trans - disc + royalty);
    const gtStr = gt.toFixed(2);
    setGrandTotal(gtStr);

    if (payment === 'Pending') {
      setCreditAmount('0');
    } else {
      const cashNum = parseFloat(cashAmount) || 0;
      const upiNum = parseFloat(upiAmount) || 0;
      const remaining = Math.max(0, gt - cashNum - upiNum);
      setCreditAmount(remaining > 0 ? remaining.toFixed(2) : '0');
    }
  }, [rate, nettVal, unitsVal, unitType, transport, discount, royaltyAmount, cashAmount, upiAmount, payment]);

  const handleCashChange = (val) => {
    setCashAmount(val);
    const cashNum = parseFloat(val) || 0;
    const upiNum = parseFloat(upiAmount) || 0;
    const gtNum = parseFloat(grandTotal) || 0;
    const remaining = Math.max(0, gtNum - cashNum - upiNum);
    setCreditAmount(remaining > 0 ? remaining.toFixed(2) : '0');
    if (cashNum > 0 && upiNum === 0 && remaining === 0) {
      setPayment('Cash');
    }
  };

  const handleUpiChange = (val) => {
    setUpiAmount(val);
    const upiNum = parseFloat(val) || 0;
    const cashNum = parseFloat(cashAmount) || 0;
    const gtNum = parseFloat(grandTotal) || 0;
    const remaining = Math.max(0, gtNum - cashNum - upiNum);
    setCreditAmount(remaining > 0 ? remaining.toFixed(2) : '0');
    if (upiNum > 0 && cashNum === 0 && remaining === 0) {
      setPayment('UPI');
    }
  };

  const [partyGstin, setPartyGstin] = useState('');

  // Auto-detect GST vs Non-GST & open payment calculation when LOCAL SALE or LOCAL SALE - <Name> is selected
  useEffect(() => {
    const isLocal = party && (party.trim().toUpperCase() === 'LOCAL SALE' || party.trim().toUpperCase().startsWith('LOCAL SALE'));
    if (isLocal) {
      setLocalScaleMode(true);
      setBillType('NON-GST');
      setPartyGstin('');
      setPayment('Cash');
    } else {
      setLocalScaleMode(false);
      if (party) {
        setPayment('Credit');
      }
      if (party) {
        const matchedDebitor = (allDebitors || []).find(
          d => d.party && d.party.trim().toUpperCase() === party.trim().toUpperCase()
        );
        if (matchedDebitor) {
          const gstinVal = matchedDebitor.gstin || matchedDebitor.gst || '';
          setPartyGstin(gstinVal);
          const debPhone = matchedDebitor.phone || matchedDebitor.phoneNumber || matchedDebitor.mobile || matchedDebitor.contact_number || '';
          if (debPhone) {
            setPhone(String(debPhone).trim());
          }

          const bType = matchedDebitor.billingType || matchedDebitor.billing_type;
          if (bType) {
            const normBType = String(bType).trim().toUpperCase();
            setBillType(normBType.includes('GST') && !normBType.includes('NON') ? 'GST' : 'NON-GST');
          } else if (matchedDebitor.gstSale !== undefined && matchedDebitor.gstSale !== null) {
            const isGst = matchedDebitor.gstSale === true || String(matchedDebitor.gstSale).toLowerCase() === 'true' || matchedDebitor.gstSale === 1;
            setBillType(isGst ? 'GST' : 'NON-GST');
          } else {
            setBillType(gstinVal ? 'GST' : 'NON-GST');
          }
        } else {
          setPartyGstin('');
          setBillType('NON-GST');
        }
      } else {
        setPartyGstin('');
        setBillType('NON-GST');
      }
    }
  }, [party, allDebitors]);

  const getTicketData = () => {
    const currentDc = dcNum || 'DC-001';
    const effectiveYourDc = (yourDc && yourDc.trim()) ? yourDc.trim() : currentDc;
    return {
      dcNum: currentDc,
      yourDc: effectiveYourDc,
    vehicle: vehicle ? vehicle.toUpperCase() : 'N/A',
    party: party ? party.toUpperCase() : 'N/A',
    material: material ? material.toUpperCase() : 'N/A',
    unitType,
    unitsVal,
    destination: destination || 'N/A',
    source: source || 'N/A',
    transporter: transporter || 'N/A',
    transporterRate: transporterRate || '0',
    transporterMeasurement: transporterMeasurement || 'Units',
    transporterAmount: transporterAmount || '0',
    partyTransportRate: partyTransportRate || '0',
    partyTransportMeasurement: partyTransportMeasurement || 'Tonnes',
    partyTransportAmount: partyTransportAmount || '0',
    driver: driver || 'N/A',
    phone: phone || 'N/A',
    gross: grossVal || '0',
    tare: tareVal || '0',
    net: nettVal || '0',
    billType,
    bill_type: billType,
    gstin: partyGstin,
    partyGstin,
    amount: grandTotal !== '0' ? `₹ ${grandTotal}` : (amount !== '0' ? `₹ ${amount}` : '₹ 0.00'),
    rate,
    transport: transport || '0',
    cashAmount,
    upiAmount,
    creditAmount
    };
  };

  const handlePrint = () => {
    if (!savedTicket) return;
    printTicket(savedTicket, getSelectedTemplate(), 'TICKET');
  };

  const handleDcPrint = () => {
    if (!savedTicket) return;
    printTicket(savedTicket, getDcPrintTemplate(), 'DC');
  };

  const handleGatePassPrint = () => {
    if (!savedTicket) return;
    printTicket(savedTicket, getGatePassTemplate(), 'GATE_PASS');
  };

  const handleResetForm = () => {
    setSavedTicket(null);
    setIsSaved(false);
    setActiveLoadingSlip(null);
    setErrors({});
    setVehicle('');
    setGrossVal('');
    setTareVal('');
    setNettVal('0');
    setYourDc('');
    setParty('');
    setMaterial('');
    userManuallyChangedMaterialRef.current = false;
    lastVehicleRef.current = '';
    setUnitType('tonnes');
    setUnitsVal('');
    setDestination('');
    setTransporter('');
    setPartyTransportRate('');
    setPartyTransportMeasurement('Tonnes');
    setPartyTransportAmount('0');
    setTransporterRate('');
    setTransporterMeasurement('Units');
    setTransporterAmount('0');
    setDriver('');
    setPhone('');
    setStationary('');
    setRoyaltyType('None');
    setRoyaltyAmount('0');
    setPoNumber('');
    setPoDate(todayForDateInput());
    setPayment('Credit');
    setSavedWeight('');
    setRate('');
    setAmount('0');
    setTransport('');
    setDiscount('');
    setGrandTotal('0');
    setCashAmount('');
    setUpiAmount('');
    setCreditAmount('');
    Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val));
  };

  const validateForm = () => {
    const newErrors = {};

    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const cleanVehAlpha = cleanVehicle.replace(/[\s\-\.]/g, '');
    if (!cleanVehicle || cleanVehAlpha === 'N/A' || cleanVehAlpha === 'NA' || cleanVehAlpha === 'NONE' || cleanVehAlpha.length === 0) {
      newErrors.vehicle = 'Vehicle No is required';
    }

    const cleanParty = (party || '').trim();
    if (!cleanParty || cleanParty.toUpperCase() === 'N/A' || cleanParty.toUpperCase() === 'NA' || cleanParty.toUpperCase() === 'NONE') {
      newErrors.party = 'Party is required';
    }

    const cleanMaterial = (material || '').trim();
    if (!cleanMaterial || cleanMaterial.toUpperCase() === 'N/A' || cleanMaterial.toUpperCase() === 'NA' || cleanMaterial.toUpperCase() === 'NONE') {
      newErrors.material = 'Material is required';
    }

    return newErrors;
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});

    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const g = parseFloat(grossVal) || 0;
    const t = parseFloat(tareVal) || 0;
    // Look up matching vehicle tare details to extract tare date and time
    const vehicleKey = cleanVehicle.replace(/\s+/g, '');
    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try { localTares = JSON.parse(cachedTares); } catch (e) { }
    }
    const combined = [...vehicleTares, ...localTares];
    const matched = combined.find(
      vt => vt.vehicle && vt.vehicle.replace(/\s+/g, '').toUpperCase() === vehicleKey
    );

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowFormatted = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const nowDateFormatted = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
    const nowTimeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const liveWeight = parseFloat(netronWeight) || 0;
    const slipWeightVal = (activeLoadingSlip && activeLoadingSlip.weight && activeLoadingSlip.weight !== 'Pending')
      ? (parseFloat(String(activeLoadingSlip.weight).replace(/,/g, '')) || 0)
      : 0;
    const previousWeight = matched ? (parseFloat(String(matched.weight).replace(/,/g, '')) || slipWeightVal) : slipWeightVal;
    const previousDate = matched ? (matched.date || matched.tare_date || matched.date_time || '') : (activeLoadingSlip?.date_time || '');
    const previousTime = matched ? (matched.time || matched.tare_time || '') : '';

    let finalGross = '0';
    let finalTare = '0';
    let tareDate = '';
    let tareTime = '';
    let grossDateTime = nowFormatted;

    if (previousWeight > 0 && liveWeight > 0) {
      if (liveWeight >= previousWeight) {
        // Case 1: Live scale is higher (Gross was weighed NOW, Tare was from Master/Loading Slip)
        finalGross = liveWeight.toString();
        finalTare = previousWeight.toString();
        grossDateTime = nowFormatted;
        tareDate = previousDate || nowDateFormatted;
        tareTime = previousTime || nowTimeFormatted;
      } else {
        // Case 2: Live scale is lower (Tare is weighed NOW, Gross was from Master/Loading Slip)
        finalGross = previousWeight.toString();
        finalTare = liveWeight.toString();
        grossDateTime = (previousDate && previousTime) ? `${previousDate} ${previousTime}:00` : (previousDate || nowFormatted);
        tareDate = nowDateFormatted;
        tareTime = nowTimeFormatted;
      }
    } else {
      const g = parseFloat(grossVal) || liveWeight || 0;
      const t = parseFloat(tareVal) || 0;
      if (g >= t) {
        finalGross = g.toString();
        finalTare = t.toString();
        grossDateTime = nowFormatted;
        tareDate = previousDate || nowDateFormatted;
        tareTime = previousTime || nowTimeFormatted;
      } else {
        finalGross = t.toString();
        finalTare = g.toString();
        grossDateTime = (previousDate && previousTime) ? `${previousDate} ${previousTime}:00` : (previousDate || nowFormatted);
        tareDate = nowDateFormatted;
        tareTime = nowTimeFormatted;
      }
    }

    // Auto-swap on save to ensure high is gross and less is tare
    setGrossVal(finalGross);
    setTareVal(finalTare);

    const effectiveYourDc = (yourDc && yourDc.trim()) ? yourDc.trim() : (dcNum || '');

    const txData = {
      uuid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now(),
      dc_num: dcNum,
      dcNum,
      your_dc: effectiveYourDc,
      yourDc: effectiveYourDc,
      date_time: grossDateTime,
      vehicle_no: cleanVehicle,
      vehicle: cleanVehicle,
      party: party ? party.toUpperCase() : '',
      material: material ? material.toUpperCase() : '',
      unit_type: unitType,
      unitType,
      units_val: unitsVal,
      unitsVal,
      destination: destination ? destination.trim() : 'OUT',
      source: source || '',
      transporter: transporter || '',
      driver: driver || '',
      phone: phone || '',
      stationary: stationary || '',
      royalty_type: royaltyType || 'None',
      royaltyType: royaltyType || 'None',
      royalty_amount: Number(royaltyAmount || 0),
      royaltyAmount: Number(royaltyAmount || 0),
      po_number: poNumber || '',
      po_date: poDate || '',
      payment: (payment && payment.trim()) ? payment.trim() : 'Credit',
      gross: finalGross,
      grossVal: finalGross,
      tare: finalTare,
      tareVal: finalTare,
      net: nettVal,
      nettVal,
      rate: rate || '0',
      amount: amount || '0',
      bill_type: billType,
      billType,
      gstin: partyGstin,
      partyGstin,
      transport: transport || '0',
      party_transport_rate: partyTransportRate || '0',
      party_transport_measurement: partyTransportMeasurement || 'Tonnes',
      party_transport_amount: partyTransportAmount || '0',
      transporter_rate: transporterRate || '0',
      transporter_measurement: transporterMeasurement || 'Units',
      transporter_amount: transporterAmount || '0',
      destination_rate: partyTransportRate || '0',
      destination_amount: partyTransportAmount || '0',
      trate: transporterRate || '0',
      tamount: transporterAmount || '0',
      discount: discount || '0',
      grand_total: grandTotal || '0',
      grandTotal: grandTotal || '0',
      cash_amount: (payment && payment.trim().toLowerCase() === 'pending') ? '0' : (cashAmount || '0'),
      upi_amount: (payment && payment.trim().toLowerCase() === 'pending') ? '0' : (upiAmount || '0'),
      credit_amount: (payment && payment.trim().toLowerCase() === 'pending') ? '0' : (creditAmount || '0'),
      operator: user?.username || 'Operator',
      tare_date: tareDate,
      tare_time: tareTime
    };

    try {
      const base64Img = captureCameraSnapshot();
      let savedRecord = null;
      if (api.addSalesUnits) {
        savedRecord = await api.addSalesUnits(txData, base64Img);
      } else {
        savedRecord = await api.addTransaction({ ...txData, base64Image: base64Img }, base64Img);
      }

      const confirmedDc = (savedRecord && (savedRecord.dc_num || savedRecord.dcNum)) || dcNum || 'DC-1';

      if (activeLoadingSlip) {
        const slipId = activeLoadingSlip.uuid || activeLoadingSlip.dc_num || cleanVehicle;
        if (api.fulfillLoadingSlip) {
          api.fulfillLoadingSlip(slipId, nettVal || finalGross).catch(err => {
            console.error('[SalesWeighmentUnits] Error fulfilling loading slip:', err);
          });
        }
        const completionMode = localStorage.getItem('noris_loading_slip_completion_mode') || 'stay';
        if (completionMode === 'delete') {
          if (api.deleteLoadingSlip) {
            api.deleteLoadingSlip(slipId).catch(() => {});
          }
        }
        // Remove this completed vehicle from vehiclesList immediately so it doesn't show in the dropdown anymore
        setVehiclesList(prev => prev.filter(v => v.toUpperCase() !== cleanVehicle.toUpperCase()));
        window.dispatchEvent(new CustomEvent('loading-slip-fulfilled', { 
          detail: { 
            vehicle: cleanVehicle, 
            slipId, 
            finalWeight: nettVal || finalGross,
            mode: completionMode 
          } 
        }));
        setActiveLoadingSlip(null);
      }

      const ticketSnapshot = {
        dcNum: confirmedDc,
        yourDc: effectiveYourDc,
        vehicle: cleanVehicle,
        party: party ? party.toUpperCase() : '',
        material: material ? material.toUpperCase() : '',
        unitType,
        unitsVal,
        destination: destination ? destination.trim() : 'OUT',
        source: source || '',
        transporter: transporter || '',
        driver: driver || '',
        phone: phone || '',
        gross: finalGross,
        tare: finalTare,
        net: nettVal || '0',
        billType,
        bill_type: billType,
        gstin: partyGstin,
        partyGstin,
        amount: grandTotal !== '0' ? `₹ ${grandTotal}` : (amount !== '0' ? `₹ ${amount}` : '₹ 0.00'),
        rate: rate || '0',
        cashAmount: cashAmount || '0',
        upiAmount: upiAmount || '0',
        creditAmount: creditAmount || '0',
        date_time: grossDateTime,
        date: grossDateTime ? grossDateTime.split(' ')[0] : nowDateFormatted,
        time: grossDateTime ? grossDateTime.split(' ')[1] : nowTimeFormatted,
        tareDate: tareDate || nowDateFormatted,
        tareTime: tareTime || nowTimeFormatted,
        tare_date: tareDate || nowDateFormatted,
        tare_time: tareTime || nowTimeFormatted
      };

      setSavedTicket(ticketSnapshot);
      setIsSaved(true);
      await cleanupVehicleOnWeighmentCompletion(cleanVehicle, 'OTHERS');
      loadMasterData();
      setMsg('Sales Transaction (Units Mode) Saved successfully!');

      setTimeout(() => setMsg(''), 4000);
    } catch (err) {
      console.error('[SalesWeighmentUnits] Error saving transaction:', err);
      setMsg('Error saving transaction: ' + err.message);
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
        .saas-section {
          border: 1px solid var(--line-soft);
          border-radius: 6px;
          padding: 1rem;
          background-color: var(--surface-2);
          margin-bottom: 1rem;
        }
        .saas-section-title {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--ink-label);
          margin-bottom: 0.75rem;
          border-bottom: 1px dashed var(--line);
          padding-bottom: 0.25rem;
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
        .saas-btn {
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
        }
        .saas-card-compact {
          padding: 0.45rem 0.8rem 0.55rem 0.8rem !important;
          margin-bottom: 0.15rem !important;
        }
        .saas-card-compact .saas-header {
          padding-bottom: 0.25rem !important;
          margin-bottom: 0.35rem !important;
        }
        .saas-card-compact .saas-label {
          font-size: 0.65rem !important;
          margin-bottom: 0.06rem !important;
          letter-spacing: 0.02em;
        }
        .saas-card-compact .saas-input {
          height: 29px !important;
          font-size: 0.76rem !important;
          padding: 0.18rem 0.45rem !important;
        }
        .saas-card-compact select.saas-input,
        .saas-card-compact .form-select.saas-input {
          height: 29px !important;
          padding-right: 1.8rem !important;
          color: #111827 !important;
          background-color: #ffffff !important;
          font-weight: 600 !important;
          font-size: 0.77rem !important;
          line-height: 1.2 !important;
        }
        .sales-compact-no-scroll {
          overflow-y: hidden !important;
          padding-bottom: 6px !important;
        }
        .saas-card-compact .saas-section {
          padding: 0.55rem 0.75rem !important;
          margin-bottom: 0.45rem !important;
          border-radius: 5px !important;
        }
        .saas-card-compact .saas-section-title {
          font-size: 0.68rem !important;
          margin-bottom: 0.35rem !important;
          padding-bottom: 0.15rem !important;
        }
        .saas-card-compact .weight-display-input {
          height: 31px !important;
          font-size: 0.92rem !important;
          font-weight: 700 !important;
          padding: 0.18rem 0.5rem !important;
        }
        .saas-card-compact .btn-action-save {
          height: 35px !important;
          font-size: 0.9rem !important;
          font-weight: 700 !important;
          padding: 0.35rem 1rem !important;
        }
      `}</style>

      {msg && (
        <div className="alert alert-success alert-dismissible fade show py-2 px-3 mb-2 shadow-sm mx-3 mt-2" role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}

      <div className="row g-3">
        {/* Left Column: Form */}
        <div className={layoutDesign === 'compact' ? 'col-lg-5 sales-compact-no-scroll' : 'col-lg-4'}>
          <div className={layoutDesign === 'compact' ? 'saas-card saas-card-compact' : 'saas-card'}>
            <div className="saas-header d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center gap-2">
                <span className="saas-title">Sales Weighment (Units)</span>
              </div>
              {savedTicket && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                  style={{ fontSize: '0.72rem', fontWeight: '600', padding: '0.25rem 0.65rem', borderRadius: '4px' }}
                  title="Clear form and load next DC"
                >
                  ↻ New Entry
                </button>
              )}
            </div>

            {layoutDesign === 'compact' ? (
              /* ✨ NEW DESIGN: Compact Screen-Fit (No Scroll) */
              <form onSubmit={handleSave} className="row g-1.5">
                {/* Row 1: DC Num/RST & Your DC */}
                <div className="col-6">
                  <div className="d-flex justify-content-between align-items-center mb-0.5">
                    <label className="saas-label mb-0">DC Num/RST</label>
                    <button
                      type="button"
                      className="btn btn-link p-0 text-decoration-none small fw-semibold text-primary"
                      style={{ fontSize: '0.72rem' }}
                      onClick={() => Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val))}
                      title="Refresh DC Number"
                    >
                      ↻ Refresh
                    </button>
                  </div>
                  <input type="text" className="form-control saas-input saas-input-readonly fw-semibold" value={dcNum} readOnly />
                </div>
                <div className="col-6">
                  <label className="saas-label">Your DC</label>
                  <input type="text" className="form-control saas-input" value={yourDc} onChange={(e) => setYourDc(e.target.value)} />
                </div>

                {/* Row 2: Vehicle & Party */}
                <div className="col-6">
                  <label className="saas-label">Vehicle</label>
                  <SearchableSelect
                    className="saas-input"
                    value={vehicle}
                    onChange={(val) => {
                      setVehicle(val);
                      if (errors.vehicle) setErrors(prev => ({ ...prev, vehicle: undefined }));
                    }}
                    options={vehiclesList}
                    placeholder="Select Vehicle..."
                    allowCustom={true}
                    required
                  />
                  {errors.vehicle && (
                    <div className="text-danger mt-0.5" style={{ fontSize: '0.68rem', fontWeight: '500' }}>
                      {errors.vehicle}
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <label className="saas-label">Party</label>
                  <SearchableSelect
                    className="saas-input"
                    value={party}
                    onChange={setParty}
                    options={partiesList}
                    placeholder="Select Party..."
                    disabled={isLocked}
                  />
                  {errors.party && (
                    <div className="text-danger mt-0.5" style={{ fontSize: '0.68rem', fontWeight: '500' }}>
                      {errors.party}
                    </div>
                  )}
                </div>

                {/* Row 3: Material & Mode / Units */}
                <div className="col-6">
                  <label className="saas-label">Material</label>
                  <SearchableSelect
                    className="saas-input"
                    value={material}
                    options={availableMaterials}
                    placeholder={!party ? '-- Select Party First --' : (availableMaterials.length > 0 ? '-- Select Material --' : '-- No Materials --')}
                    disabled={isLocked}
                    onChange={(newMat) => {
                      userManuallyChangedMaterialRef.current = true;
                      setMaterial(newMat);
                      const matchEntry = allMaterials.find(m =>
                        (m.party || '').trim().toUpperCase() === party.trim().toUpperCase() &&
                        (m.material || '').trim().toUpperCase() === newMat.trim().toUpperCase()
                      );
                      if (matchEntry && matchEntry.rate !== undefined && matchEntry.rate !== null) {
                        setRate(matchEntry.rate.toString());
                      }
                    }}
                  />
                  {errors.material && (
                    <div className="text-danger mt-0.5" style={{ fontSize: '0.68rem', fontWeight: '500' }}>
                      {errors.material}
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <div className="d-flex justify-content-between align-items-center mb-0.5">
                    <label className="saas-label mb-0">Mode</label>
                    <div className="d-flex gap-2 align-items-center">
                      <div className="form-check form-check-inline m-0">
                        <input className="form-check-input" type="radio" name="unitType" id="tonnesCheckCompact" checked={unitType === 'tonnes'} onChange={() => setUnitType('tonnes')} style={{ cursor: 'pointer' }} />
                        <label className="form-check-label small fw-semibold" htmlFor="tonnesCheckCompact" style={{ fontSize: '0.72rem', cursor: 'pointer' }}>Tonnes</label>
                      </div>
                      <div className="form-check form-check-inline m-0">
                        <input className="form-check-input" type="radio" name="unitType" id="unitsCheckCompact" checked={unitType === 'units'} onChange={() => setUnitType('units')} style={{ cursor: 'pointer' }} />
                        <label className="form-check-label small fw-semibold" htmlFor="unitsCheckCompact" style={{ fontSize: '0.72rem', cursor: 'pointer' }}>Units</label>
                      </div>
                    </div>
                  </div>
                  {unitType === 'units' ? (
                    <input type="number" className="form-control saas-input" placeholder="Enter Units" value={unitsVal} onChange={(e) => setUnitsVal(e.target.value)} />
                  ) : (
                    <input type="text" className="form-control saas-input saas-input-readonly text-center" value="Tonnes Weighment" readOnly disabled />
                  )}
                </div>

                {/* Row 4: Destination & Source */}
                <div className="col-6">
                  <label className="saas-label">Destination</label>
                  <SearchableSelect
                    className="saas-input"
                    value={destination}
                    onChange={setDestination}
                    options={availableDestinations.length > 0 ? availableDestinations : ['OUT']}
                    placeholder="OUT"
                    allowCustom={true}
                    disabled={isLocked}
                  />
                  {errors.destination && (
                    <div className="text-danger mt-0.5" style={{ fontSize: '0.68rem', fontWeight: '500' }}>
                      {errors.destination}
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <label className="saas-label">Source</label>
                  <SearchableSelect
                    className="saas-input"
                    value={source}
                    onChange={setSource}
                    options={sourcesList}
                    placeholder="Select Source..."
                    allowCustom={true}
                    disabled={isLocked}
                  />
                </div>

                {/* Row 5: Transporter & Driver */}
                <div className="col-6">
                  <label className="saas-label">Transporter</label>
                  <SearchableSelect
                    className="saas-input"
                    value={transporter}
                    options={transportersList}
                    placeholder="-- Select Transporter --"
                    allowCustom={true}
                    onChange={(selectedTrans) => {
                      setTransporter(selectedTrans);
                      if (selectedTrans) {
                        const transUpper = selectedTrans.trim().toUpperCase();
                        const transRecord = allTransporters.find(t =>
                          (t.transporterName || t.transporter || '').trim().toUpperCase() === transUpper &&
                          t.destination && t.destination.trim().toUpperCase() !== 'OUT'
                        );
                        if (transRecord && transRecord.destination && (!destination || destination === 'OUT')) {
                          setDestination(transRecord.destination);
                          setAvailableDestinations(prev =>
                            prev.includes(transRecord.destination) ? prev : [...prev, transRecord.destination]
                          );
                        }
                      }
                    }}
                  />
                  {errors.transporter && (
                    <div className="text-danger mt-0.5" style={{ fontSize: '0.68rem', fontWeight: '500' }}>
                      {errors.transporter}
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <label className="saas-label">Driver</label>
                  <input type="text" className="form-control saas-input" placeholder="Driver Name" value={driver} onChange={(e) => setDriver(e.target.value)} />
                </div>

                {/* Row 6: Phone, Payment Mode & Stationary */}
                <div className="col-4">
                  <label className="saas-label">Phone</label>
                  <input
                    type="text"
                    className="form-control saas-input"
                    placeholder="Phone No"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    readOnly={isLocked}
                    style={isLocked ? { backgroundColor: 'var(--surface-2)', cursor: 'not-allowed' } : {}}
                  />
                </div>
                <div className="col-4">
                  <label className="saas-label">Payment Mode</label>
                  <select
                    className="form-select saas-input"
                    disabled={isLocked}
                    style={{
                      color: '#111827',
                      backgroundColor: isLocked ? 'var(--surface-2)' : '#ffffff',
                      fontWeight: '600',
                      fontSize: '0.76rem',
                      lineHeight: '1.2',
                      paddingRight: '1.8rem',
                      cursor: isLocked ? 'not-allowed' : 'pointer'
                    }}
                    value={payment || 'Credit'}
                    onChange={(e) => {
                      const mode = e.target.value;
                      setPayment(mode);
                      if (mode === 'Pending') {
                        setCashAmount('0');
                        setUpiAmount('0');
                        setCreditAmount('0');
                      }
                    }}
                  >
                    <option value="Credit" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Credit</option>
                    <option value="Cash" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Cash</option>
                    <option value="UPI" style={{ color: '#111827', backgroundColor: '#ffffff' }}>UPI</option>
                    <option value="Pending" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Pending</option>
                  </select>
                </div>
                <div className="col-4">
                  <label className="saas-label">Stationary</label>
                  <input type="text" className="form-control saas-input" placeholder="Stationary" value={stationary} onChange={(e) => setStationary(e.target.value)} />
                </div>

                {/* Row 7: Royalty Type, PO Number & PO Date */}
                <div className="col-4">
                  <label className="saas-label">Royalty Type</label>
                  <select className="form-select saas-input" value={royaltyType} onChange={(e) => setRoyaltyType(e.target.value)}>
                    <option value="None">None</option>
                    <option value="Government">Government</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div className="col-4">
                  <label className="saas-label">PO Number</label>
                  <input type="text" className="form-control saas-input" placeholder="PO Number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                </div>
                <div className="col-4">
                  <label className="saas-label">PO Date</label>
                  <input type="date" className="form-control saas-input" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                </div>
              </form>
            ) : (
              /* 🏛️ OLD DESIGN: Classic Stacked Layout */
              <form onSubmit={handleSave} className="row g-2">
                <div className="col-6">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <label className="saas-label mb-0">DC Num/RST</label>
                    <button
                      type="button"
                      className="btn btn-link p-0 text-decoration-none small fw-semibold text-primary"
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val))}
                      title="Refresh DC Number"
                    >
                      ↻ Refresh
                    </button>
                  </div>
                  <input type="text" className="form-control saas-input saas-input-readonly fw-semibold" value={dcNum} readOnly />
                </div>
                <div className="col-6">
                  <label className="saas-label">Your DC</label>
                  <input type="text" className="form-control saas-input" value={yourDc} onChange={(e) => setYourDc(e.target.value)} />
                </div>
                <div className="col-12">
                  <label className="saas-label">Vehicle</label>
                  <SearchableSelect
                    className="saas-input"
                    value={vehicle}
                    onChange={(val) => {
                      setVehicle(val);
                      if (errors.vehicle) setErrors(prev => ({ ...prev, vehicle: undefined }));
                    }}
                    options={vehiclesList}
                    placeholder="Select Vehicle..."
                    allowCustom={true}
                    required
                  />
                  {errors.vehicle && (
                    <div className="text-danger mt-1" style={{ fontSize: '0.72rem', fontWeight: '500' }}>
                      {errors.vehicle}
                    </div>
                  )}
                </div>
                <div className="col-12">
                  <label className="saas-label">Party</label>
                  <SearchableSelect
                    className="saas-input"
                    value={party}
                    onChange={setParty}
                    options={partiesList}
                    placeholder="Select Party..."
                    disabled={isLocked}
                  />
                  {errors.party && (
                    <div className="text-danger mt-1" style={{ fontSize: '0.72rem', fontWeight: '500' }}>
                      {errors.party}
                    </div>
                  )}
                </div>

                <div className="col-12 my-2">
                  <label className="saas-label">Material</label>
                  <SearchableSelect
                    className="saas-input mb-1"
                    value={material}
                    options={availableMaterials}
                    placeholder={!party ? '-- Select Party First --' : (availableMaterials.length > 0 ? '-- Select Material --' : '-- No Materials for Party --')}
                    disabled={isLocked}
                    onChange={(newMat) => {
                      userManuallyChangedMaterialRef.current = true;
                      setMaterial(newMat);
                      const matchEntry = allMaterials.find(m =>
                        (m.party || '').trim().toUpperCase() === party.trim().toUpperCase() &&
                        (m.material || '').trim().toUpperCase() === newMat.trim().toUpperCase()
                      );
                      if (matchEntry && matchEntry.rate !== undefined && matchEntry.rate !== null) {
                        setRate(matchEntry.rate.toString());
                      }
                    }}
                  />
                  {errors.material && (
                    <div className="text-danger mb-2" style={{ fontSize: '0.72rem', fontWeight: '500' }}>
                      {errors.material}
                    </div>
                  )}
                  <div className="d-flex gap-4 align-items-center">
                    <div className="form-check">
                      <input className="form-check-input" type="radio" name="unitType" id="tonnesCheck" checked={unitType === 'tonnes'} onChange={() => setUnitType('tonnes')} />
                      <label className="form-check-label small fw-semibold" htmlFor="tonnesCheck">Tonnes Mode</label>
                    </div>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" name="unitType" id="unitsCheck" checked={unitType === 'units'} onChange={() => setUnitType('units')} />
                      <label className="form-check-label small fw-semibold" htmlFor="unitsCheck">Units Mode</label>
                    </div>
                  </div>
                </div>

                {unitType === 'units' && (
                  <div className="col-12">
                    <label className="saas-label">Units</label>
                    <input type="number" className="form-control saas-input" placeholder="Number of Units" value={unitsVal} onChange={(e) => setUnitsVal(e.target.value)} />
                  </div>
                )}

                <div className="col-6">
                  <label className="saas-label">Destination</label>
                  <SearchableSelect
                    className="saas-input"
                    value={destination}
                    onChange={setDestination}
                    options={availableDestinations.length > 0 ? availableDestinations : ['OUT']}
                    placeholder="OUT"
                    allowCustom={true}
                  />
                  {errors.destination && (
                    <div className="text-danger mt-1" style={{ fontSize: '0.72rem', fontWeight: '500' }}>
                      {errors.destination}
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <label className="saas-label">Source</label>
                  <SearchableSelect
                    className="saas-input"
                    value={source}
                    onChange={setSource}
                    options={sourcesList}
                    placeholder="Select Source..."
                    allowCustom={true}
                  />
                </div>
                <div className="col-6">
                  <label className="saas-label">Transporter</label>
                  <SearchableSelect
                    className="saas-input"
                    value={transporter}
                    options={transportersList}
                    placeholder="-- Select Transporter --"
                    allowCustom={true}
                    onChange={(selectedTrans) => {
                      setTransporter(selectedTrans);
                      if (selectedTrans) {
                        const transUpper = selectedTrans.trim().toUpperCase();
                        const transRecord = allTransporters.find(t =>
                          (t.transporterName || t.transporter || '').trim().toUpperCase() === transUpper &&
                          t.destination && t.destination.trim().toUpperCase() !== 'OUT'
                        );
                        if (transRecord && transRecord.destination && (!destination || destination === 'OUT')) {
                          setDestination(transRecord.destination);
                          setAvailableDestinations(prev =>
                            prev.includes(transRecord.destination) ? prev : [...prev, transRecord.destination]
                          );
                        }
                      }
                    }}
                  />
                  {errors.transporter && (
                    <div className="text-danger mt-1" style={{ fontSize: '0.72rem', fontWeight: '500' }}>
                      {errors.transporter}
                    </div>
                  )}
                </div>
                <div className="col-6">
                  <label className="saas-label">Driver</label>
                  <input type="text" className="form-control saas-input" value={driver} onChange={(e) => setDriver(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="saas-label">Phone</label>
                  <input
                    type="text"
                    className="form-control saas-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    readOnly={isLocked}
                    style={isLocked ? { backgroundColor: 'var(--surface-2)', cursor: 'not-allowed' } : {}}
                  />
                </div>
                <div className="col-6">
                  <label className="saas-label">Stationary</label>
                  <input type="text" className="form-control saas-input" value={stationary} onChange={(e) => setStationary(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="saas-label">Royalty Type</label>
                  <select className="form-select saas-input" value={royaltyType} onChange={(e) => setRoyaltyType(e.target.value)}>
                    <option value="None">None</option>
                    <option value="Government">Government</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div className="col-6">
                  <label className="saas-label">PO Number</label>
                  <input type="text" className="form-control saas-input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="saas-label">PO Date</label>
                  <input type="date" className="form-control saas-input" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="saas-label">Payment Mode</label>
                  <select
                    className="form-select saas-input"
                    value={payment || 'Credit'}
                    disabled={isLocked}
                    onChange={(e) => {
                      const mode = e.target.value;
                      setPayment(mode);
                      if (mode === 'Pending') {
                        setCashAmount('0');
                        setUpiAmount('0');
                        setCreditAmount('0');
                      }
                    }}
                  >
                    <option value="Credit">Credit</option>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Pending">Pending</option>
                  </select>
                </div>

              </form>
            )}
          </div>
        </div>

        {/* Middle Column: Weighment & Payment Details */}
        <div className={layoutDesign === 'compact' ? 'col-lg-4 sales-compact-no-scroll' : 'col-lg-4'}>
          <div className={layoutDesign === 'compact' ? 'saas-card saas-card-compact' : 'saas-card'}>
            <div className="saas-header">
              <span className="saas-title">Weighment Details</span>
            </div>

            {layoutDesign === 'compact' ? (
              <div className="saas-section mb-1.5" style={{ backgroundColor: 'var(--surface-2)', padding: '0.4rem 0.6rem' }}>
                <div className="row g-2 text-center">
                  <div className="col-4">
                    <span className="saas-label mb-0.5 d-block" style={{ color: 'var(--primary-ink)', fontWeight: 700, fontSize: '0.7rem' }}>Gross</span>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold weight-display-input" style={{ color: 'var(--primary-ink)', fontSize: '0.92rem' }} value={grossVal} readOnly />
                  </div>
                  <div className="col-4">
                    <span className="saas-label mb-0.5 d-block" style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.7rem' }}>Tare</span>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold weight-display-input" style={{ color: '#16a34a' }} value={tareVal} readOnly />
                  </div>
                  <div className="col-4">
                    <span className="saas-label mb-0.5 d-block" style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.7rem' }}>Nett</span>
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold weight-display-input" style={{ color: '#dc2626', backgroundColor: '#ffffff' }} value={nettVal} readOnly />
                  </div>
                </div>
              </div>
            ) : (
              <div className="saas-section" style={{ backgroundColor: 'var(--surface-2)' }}>
                <div className="row g-2 align-items-center mb-2">
                  <div className="col-4"><span className="saas-label mb-0" style={{ color: 'var(--primary-ink)' }}>Gross</span></div>
                  <div className="col-8">
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: 'var(--primary-ink)' }} value={grossVal} readOnly />
                  </div>
                </div>
                <div className="row g-2 align-items-center mb-2">
                  <div className="col-4"><span className="saas-label mb-0" style={{ color: '#16a34a' }}>Tare</span></div>
                  <div className="col-8">
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#16a34a' }} value={tareVal} readOnly />
                  </div>
                </div>
                <div className="row g-2 align-items-center">
                  <div className="col-4"><span className="saas-label mb-0" style={{ color: '#dc2626' }}>Nett</span></div>
                  <div className="col-8">
                    <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#dc2626', backgroundColor: '#ffffff' }} value={nettVal} readOnly />
                  </div>
                </div>
              </div>
            )}

            {localScaleMode && (
              layoutDesign === 'compact' ? (
                <div className="saas-section mt-1.5" style={{ padding: '0.4rem 0.6rem' }}>
                  <div className="saas-section-title mb-1">Payment Calculation</div>
                  <div className="row g-2">
                    <div className="col-4">
                      <label className="saas-label mb-0.5">Rate</label>
                      <input type="number" className="form-control saas-input" value={rate} onChange={(e) => setRate(e.target.value)} />
                    </div>
                    <div className="col-4">
                      <label className="saas-label mb-0.5">Amount</label>
                      <input type="text" className="form-control saas-input saas-input-readonly" value={amount} readOnly />
                    </div>
                    <div className="col-4">
                      <label className="saas-label mb-0.5">Discount</label>
                      <input type="number" className="form-control saas-input" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                    </div>
                    <div className="col-6">
                      <label className="saas-label mb-0.5 d-flex justify-content-between align-items-center">
                        <span>Transport</span>
                        {partyTransportRate && (
                          <span className="text-muted fw-normal" style={{ fontSize: '0.62rem' }}>
                            {transporterRate ? `₹${partyTransportAmount}` : `₹${partyTransportRate}`}
                          </span>
                        )}
                      </label>
                      <input type="number" className="form-control saas-input" value={transport} onChange={(e) => setTransport(e.target.value)} />
                    </div>
                    <div className="col-6">
                      <label className="saas-label mb-0.5" style={{ color: 'var(--primary-ink)', fontWeight: 700 }}>Grand Total</label>
                      <input type="text" className="form-control saas-input saas-input-readonly fw-bold text-center text-primary" style={{ fontSize: '0.88rem' }} value={grandTotal} readOnly />
                    </div>
                    <div className="col-4">
                      <label className="saas-label mb-0.5">Cash</label>
                      <input type="number" className="form-control saas-input text-center fw-bold text-success" value={cashAmount} onChange={(e) => handleCashChange(e.target.value)} placeholder="0" />
                    </div>
                    <div className="col-4">
                      <label className="saas-label mb-0.5">UPI</label>
                      <input type="number" className="form-control saas-input text-center fw-bold text-info" value={upiAmount} onChange={(e) => handleUpiChange(e.target.value)} placeholder="0" />
                    </div>
                    <div className="col-4">
                      <label className="saas-label mb-0.5">Credit</label>
                      <input type="number" className="form-control saas-input text-center fw-bold text-warning" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="0" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="saas-section mt-3">
                  <div className="saas-section-title mb-1.5">Payment Calculation</div>
                  <div className="row g-2">
                    <div className="col-6">
                      <label className="saas-label">Rate</label>
                      <input type="number" className="form-control saas-input" value={rate} onChange={(e) => setRate(e.target.value)} />
                    </div>
                    <div className="col-6">
                      <label className="saas-label">Amount</label>
                      <input type="text" className="form-control saas-input saas-input-readonly" value={amount} readOnly />
                    </div>
                    <div className="col-6">
                      <label className="saas-label d-flex justify-content-between align-items-center">
                        <span>Transport</span>
                        {partyTransportRate && (
                          <span className="text-muted fw-normal" style={{ fontSize: '0.68rem' }}>
                            {transporterRate ? `₹${partyTransportAmount} - ₹${transporterAmount}` : `₹${partyTransportRate}/${partyTransportMeasurement}`}
                          </span>
                        )}
                      </label>
                      <input type="number" className="form-control saas-input" value={transport} onChange={(e) => setTransport(e.target.value)} />
                    </div>
                    <div className="col-6">
                      <label className="saas-label">Discount</label>
                      <input type="number" className="form-control saas-input" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                    </div>
                    <div className="col-12 mt-2">
                      <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Grand Total</label>
                      <input type="text" className="form-control saas-input saas-input-readonly fw-bold text-center text-primary" style={{ fontSize: '1rem' }} value={grandTotal} readOnly />
                    </div>
                    <div className="col-4">
                      <label className="saas-label">Cash</label>
                      <input type="number" className="form-control saas-input text-center fw-bold text-success" value={cashAmount} onChange={(e) => handleCashChange(e.target.value)} placeholder="0" />
                    </div>
                    <div className="col-4">
                      <label className="saas-label">UPI</label>
                      <input type="number" className="form-control saas-input text-center fw-bold text-info" value={upiAmount} onChange={(e) => handleUpiChange(e.target.value)} placeholder="0" />
                    </div>
                    <div className="col-4">
                      <label className="saas-label">Credit</label>
                      <input type="number" className="form-control saas-input text-center fw-bold text-warning" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="0" />
                    </div>
                  </div>
                </div>
              )
            )}

            <div className={`d-flex flex-wrap gap-2 ${layoutDesign === 'compact' ? 'mt-2' : 'mt-4'} justify-content-end align-items-center`}>
              {savedTicket ? (
                <>
                  <span className="text-secondary w-100 text-end mb-1" style={{ fontSize: '0.75rem' }}>
                    Saved as <b>{savedTicket.dcNum}</b>
                  </span>
                  <button type="button" onClick={handlePrint} className="btn btn-danger saas-btn flex-grow-1" style={{ backgroundColor: '#ef4444' }}>
                    Print
                  </button>
                  <button type="button" onClick={handleDcPrint} className="btn btn-dark saas-btn flex-grow-1">
                    DC Print
                  </button>
                  <button type="button" onClick={handleGatePassPrint} className="btn btn-secondary saas-btn flex-grow-1">
                    Gate Pass
                  </button>
                </>
              ) : (
                <button type="button" onClick={handleSave} className={`btn btn-success saas-btn w-100 ${layoutDesign === 'compact' ? 'btn-action-save' : ''}`}>
                  Save
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Camera feeds */}
        <div className={layoutDesign === 'compact' ? 'col-lg-3' : 'col-lg-4'}>
          <div className="saas-card overflow-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
            <div className="saas-header">
              <span className="saas-title">Live Feeds</span>
            </div>
            <div className="row g-2">
              {cameras.map((c, index) => (
                <div key={c.id} className="col-12" style={{ cursor: 'pointer' }} onClick={() => setPreviewCamera(c)} title={`Click to view live preview of ${c.name}`}>
                  <div className="camera-tile position-relative overflow-hidden" style={{ borderRadius: '4px', border: '1px solid var(--line)' }}>
                    <CameraPlayer camera={c} />
                    <span className="position-absolute bottom-0 start-0 m-2 px-2 py-0.5 bg-dark bg-opacity-75 text-white fw-semibold d-flex align-items-center gap-1" style={{ fontSize: '0.68rem', borderRadius: '3px' }}>
                      <span>🔍</span> CAM {index + 1}: {c.name.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Full Live Camera Preview Modal */}
      {previewCamera && (
        <CameraPreviewModal camera={previewCamera} onClose={() => setPreviewCamera(null)} />
      )}
    </div>
  );
}
