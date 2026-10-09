import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import CameraPreviewModal from '../components/CameraPreviewModal.jsx';
import Loader from '../components/Loader.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import { printTicket, getSelectedTemplate, getDcPrintTemplate, getGatePassTemplate } from '../utils/printHelper.js';
import { getNextDcNumber, incrementDcNumber, syncDcCounterFromTransactions } from '../utils/dcHelper.js';
import { useScale } from '../context/ScaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getVehicleOptionMode, filterVehiclesBySetting, fetchAllTransactions, cleanupVehicleOnWeighmentCompletion } from '../utils/vehicleFilterUtil.js';



// `YYYY-MM-DD` for <input type="date">, built from LOCAL parts. toISOString()
// would be a day behind on every shift that starts before 05:30 IST, because
// it converts to UTC first.
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

export default function SalesWeighment() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [previewCamera, setPreviewCamera] = useState(null);
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [msg, setMsg] = useState('');
  const [savedTicket, setSavedTicket] = useState(null);
  
  // Form fields
  const [dcNum, setDcNum] = useState('');
  const [yourDc, setYourDc] = useState('');
  const {
    vehicle, setVehicle,
    gross: grossVal, setGross: setGrossVal,
    tare: tareVal, setTare: setTareVal,
    nett: nettVal, setNett: setNettVal
  } = useScale();

  // Vehicle lives in the shared scale context so the bottom status bar mirrors
  // this field — but it is wiped on unmount, so leaving this page never carries
  // the truck over to Boulders or Yard.
  useEffect(() => () => setVehicle(''), []);
  const [party, setParty] = useState('');
  const [material, setMaterial] = useState('');
  const [destination, setDestination] = useState('');
  const [source, setSource] = useState('');
  const [transporter, setTransporter] = useState('');
  const [phone, setPhone] = useState('');
  const [driver, setDriver] = useState('');
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

    const qty = (parseFloat(nettVal) || 0) / 1000; // Nett weight in tonnes

    if (activeRate > 0 && qty > 0) {
      const calcRoyalty = (activeRate * qty).toFixed(2);
      setRoyaltyAmount(calcRoyalty);
    } else {
      setRoyaltyAmount('0');
    }
  }, [royaltyType, nettVal]);
  const [poNumber, setPoNumber] = useState('');
  // Defaults to today; the operator can still pick any other date.
  const [poDate, setPoDate] = useState(todayForDateInput);
  const [payment, setPayment] = useState('Credit');

  // Weights
  const [savedWeight, setSavedWeight] = useState('');
  
  // Payment
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('0');
  
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

  // Scale state
  const [netronWeight, setNetronWeight] = useState('0');
  const [manualMode, setManualMode] = useState(false);

  const [vehiclesList, setVehiclesList] = useState([]);
  const [partiesList, setPartiesList] = useState(['LOCAL SALE']);
  const [allDebitors, setAllDebitors] = useState([]);
  const [billType, setBillType] = useState('NON-GST');
  const [partyGstin, setPartyGstin] = useState('');
  const [allMaterials, setAllMaterials] = useState([]);
  const [availableMaterials, setAvailableMaterials] = useState([]);
  const [allDestinations, setAllDestinations] = useState([]);
  const [availableDestinations, setAvailableDestinations] = useState([]);
  const [allTransporters, setAllTransporters] = useState([]);
  const [transportersList, setTransportersList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);

  const loadDropdownData = () => {
    Promise.all([
      fetchAllTransactions(),
      api.getDebitors ? api.getDebitors().catch(() => []) : Promise.resolve([]),
      api.getMaterials ? api.getMaterials().catch(() => []) : Promise.resolve([]),
      api.getDestinations ? api.getDestinations().catch(() => []) : Promise.resolve([]),
      api.getSources ? api.getSources().catch(() => []) : Promise.resolve([]),
      api.getTransporters ? api.getTransporters().catch(() => []) : Promise.resolve([]),
      api.getVehicleTares ? api.getVehicleTares().catch(() => []) : Promise.resolve([])
    ]).then(([txs, debitorsData, materialsData, destinationsData, sourcesData, transportersData, vehicleTaresData]) => {
      syncDcCounterFromTransactions(txs, 'sales');
      setAllDebitors(debitorsData || []);

      if (api.getTransporterVehicles) {
        api.getTransporterVehicles().then(tv => {
          if (Array.isArray(tv) && tv.length > 0) {
            localStorage.setItem('noris_transporter_vehicles', JSON.stringify(tv));
          }
        }).catch(() => {});
      }

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
        const vehNos = filteredObjs.map(t => t.vehicle || t.vehicleNo);
        setVehiclesList([...new Set(vehNos)].filter(Boolean));
      });


      // Parties strictly from debitors master data (synced from server endpoint)
      const debitorsParties = (debitorsData || []).map(d => d.party).filter(Boolean);
      const uniqueParties = [...new Set(debitorsParties)];
      setPartiesList(uniqueParties.length > 0 ? uniqueParties : ['LOCAL SALE']);

      // Materials
      setAllMaterials(materialsData || []);

      // Destinations
      setAllDestinations(destinationsData || []);

      // Transporters (flatten nested destination rates if present)
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

      // Sources
      const sNames = (sourcesData || []).map(s => s.sourceName).filter(Boolean);
      const txSources = (txs || []).map(t => t.source).filter(Boolean);
      const uniqueSources = [...new Set([...sNames, ...txSources])];
      setSourcesList(uniqueSources);
    }).catch(console.error);
  };

  useEffect(() => {
    api.cameras().then(setCameras).catch(() => setCameras([]));
    Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val));
    loadDropdownData();

    // Trigger an immediate background sync on mount to fetch the latest from server
    if (api.syncMasterData) {
      api.syncMasterData().then((res) => {
        if (res && res.success) {
          loadDropdownData();
        }
      }).catch(console.error);
    }

    const onRefresh = () => handleResetForm();
    window.addEventListener('page-refresh', onRefresh);

    let unsubscribeSync = null;
    if (window.electronAPI && window.electronAPI.onMasterDataSynced) {
      unsubscribeSync = window.electronAPI.onMasterDataSynced(() => {
        console.log('[React SalesWeighment] Master data updated on disk, refreshing dropdowns...');
        loadDropdownData();
      });
    }

    return () => {
      window.removeEventListener('page-refresh', onRefresh);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, []);

  // Update DC Number whenever the billing type (GST vs NON-GST) changes
  useEffect(() => {
    Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val));
  }, [billType]);

  // Auto-detect GST vs Non-GST based on selected Party
  useEffect(() => {
    if (party && party.trim().toUpperCase() === 'LOCAL SALE') {
      setBillType('NON-GST');
      setPartyGstin('');
    } else if (party) {
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
  }, [party, allDebitors]);

  // Dynamically update materials list strictly based on selected Party
  useEffect(() => {
    if (!party) {
      const allMatNames = [...new Set(allMaterials.map(m => m.material))].filter(Boolean);
      setAvailableMaterials(allMatNames);
      return;
    }

    const partyUpper = party.trim().toUpperCase();
    const isLocalSale = partyUpper === 'LOCAL SALE';
    const matchedMaterials = allMaterials.filter(
      m => m.party && m.party.trim().toUpperCase() === partyUpper
    );

    let matNames = [];
    if (matchedMaterials.length > 0) {
      matNames = [...new Set(matchedMaterials.map(m => m.material))].filter(Boolean);
    } else if (isLocalSale) {
      matNames = [...new Set(allMaterials.map(m => m.material))].filter(Boolean);
    } else {
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
  }, [party, allMaterials, transactions]);

  // Dynamically update destinations list based on selected Party while keeping 'OUT' option
  useEffect(() => {
    const partyUpper = (party || '').trim().toUpperCase();
    const isLocalSale = partyUpper === 'LOCAL SALE';
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
      const calculated = calculateTransportAmount(0, partyTransportRate, partyTransportMeasurement, parseFloat(nettVal) || 0);
      setPartyTransportAmount(calculated > 0 ? calculated.toFixed(2) : '0.00');
    } else {
      setPartyTransportAmount('0.00');
    }
  }, [partyTransportRate, partyTransportMeasurement, nettVal]);

  // 4. Auto-calculate Transporter Freight Amount
  useEffect(() => {
    if (transporterRate) {
      const calculated = calculateTransportAmount(0, transporterRate, transporterMeasurement, parseFloat(nettVal) || 0);
      setTransporterAmount(calculated > 0 ? calculated.toFixed(2) : '0.00');
    } else {
      setTransporterAmount('0.00');
    }
  }, [transporterRate, transporterMeasurement, nettVal]);

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

  // Auto-fill tare and material when vehicle is selected & perform order validation
  useEffect(() => {
    if (!vehicle) {
      setSavedWeight('');
      setTareVal('');
      return;
    }
    const cleanVehicle = vehicle.replace(/\s+/g, '').toUpperCase();

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
            setTransporter(mappedTransporter);
            setTransportersList(prev => {
              const exists = prev.some(t => t.toUpperCase() === mappedTransporter.toUpperCase());
              return exists ? prev : [...prev, mappedTransporter];
            });
          }
        }
      } catch (err) {
        console.error('Error auto-filling transporter for vehicle in SalesWeighment:', err);
      }
    }

    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try {
        localTares = JSON.parse(cachedTares);
      } catch (e) {
        console.error(e);
      }
    }
    const combined = [...vehicleTares, ...localTares];
    const matched = combined.find(
      t => t.vehicle && t.vehicle.replace(/\s+/g, '').toUpperCase() === cleanVehicle
    );

    if (matched) {
      // Auto-fill material from vehicle tare record
      if (matched.material && matched.material.trim()) {
        const vehMat = matched.material.trim();
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

      if (matched.weight) {
        const rawWeight = String(matched.weight).replace(/,/g, '');
        setSavedWeight(rawWeight);

        // Instantly perform order validation when vehicle is selected
        const currentGross = parseFloat(grossVal) || 0;
        const fetchedWeight = parseFloat(rawWeight) || 0;

        if (currentGross > 0) {
          if (currentGross >= fetchedWeight) {
            setGrossVal(currentGross.toString());
            setTareVal(fetchedWeight.toString());
          } else {
            setGrossVal(fetchedWeight.toString());
            setTareVal(currentGross.toString());
          }
        } else {
          setTareVal(rawWeight);
        }
      }
    } else {
      setSavedWeight('');
    }
  }, [vehicle, vehicleTares, allMaterials, party]);

  // Listen to scale
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const numeric = data.value.replace(/[^0-9.-]/g, '');
        if (numeric) {
          setNetronWeight(numeric);
          if (!manualMode) {
            if (savedWeight) {
              const numVal = parseFloat(numeric) || 0;
              const savedVal = parseFloat(savedWeight) || 0;
              if (numVal >= savedVal) {
                setGrossVal(numeric);
                setTareVal(savedWeight);
              } else {
                setTareVal(numeric);
                setGrossVal(savedWeight);
              }
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

  // Calculate Payment Details
  useEffect(() => {
    const r = parseFloat(rate) || 0;
    const n = parseFloat(nettVal) || 0;
    const amt = (n / 1000) * r;
    setAmount(amt.toFixed(2));

    const trans = parseFloat(transport) || 0;
    const disc = parseFloat(discount) || 0;
    const royalty = parseFloat(royaltyAmount) || 0;
    setGrandTotal((amt + trans - disc + royalty).toFixed(2));
  }, [rate, nettVal, transport, discount, royaltyAmount]);



  const handlePrintTicket = () => {
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
    setVehicle('');
    setGrossVal('');
    setTareVal('');
    setNettVal('0');
    setYourDc('');
    setParty('');
    setMaterial('');
    setDestination('');
    setTransporter('');
    setPartyTransportRate('');
    setPartyTransportMeasurement('Tonnes');
    setPartyTransportAmount('0');
    setTransporterRate('');
    setTransporterMeasurement('Units');
    setTransporterAmount('0');
    setPhone('');
    setDriver('');
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
    Promise.resolve(getNextDcNumber(billType, 'DC-', 'sales')).then(val => val && setDcNum(val));
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();

    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const cleanVehAlpha = cleanVehicle.replace(/[\s\-\.]/g, '');
    if (!cleanVehicle || cleanVehAlpha === 'N/A' || cleanVehAlpha === 'NA' || cleanVehAlpha === 'NONE' || cleanVehAlpha.length === 0) {
      alert('Please enter a valid Vehicle Number.');
      return;
    }

    // Look up matching vehicle tare details to extract tare date and time
    const vehicleKey = cleanVehicle.replace(/\s+/g, '');
    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try { localTares = JSON.parse(cachedTares); } catch (e) {}
    }
    const combined = [...(vehicleTares || []), ...localTares];
    const matched = combined.find(
      vt => vt.vehicle && vt.vehicle.replace(/\s+/g, '').toUpperCase() === vehicleKey
    );

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowFormatted = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const nowDateFormatted = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
    const nowTimeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const liveWeight = parseFloat(netronWeight) || 0;
    const previousWeight = matched ? (parseFloat(String(matched.weight).replace(/,/g, '')) || 0) : 0;
    const previousDate = matched ? (matched.date || matched.tare_date || matched.date_time || '') : '';
    const previousTime = matched ? (matched.time || matched.tare_time || '') : '';

    let finalGross = '0';
    let finalTare = '0';
    let tareDate = '';
    let tareTime = '';
    let grossDateTime = nowFormatted;

    if (matched && previousWeight > 0 && liveWeight > 0) {
      if (liveWeight >= previousWeight) {
        // Case 1: Live scale is higher (Gross was weighed NOW, Tare was from Master/Previous)
        finalGross = liveWeight.toString();
        finalTare = previousWeight.toString();
        grossDateTime = nowFormatted;
        tareDate = previousDate || nowDateFormatted;
        tareTime = previousTime || nowTimeFormatted;
      } else {
        // Case 2: Live scale is lower (Tare is weighed NOW, Gross was from Master/Previous)
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

    setGrossVal(finalGross);
    setTareVal(finalTare);

    const effectiveYourDc = (yourDc && yourDc.trim()) ? yourDc.trim() : (dcNum || '');

    const txData = {
      uuid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now(),
      dc_num: dcNum,
      dcNum: dcNum,
      your_dc: effectiveYourDc,
      yourDc: effectiveYourDc,
      date_time: grossDateTime,
      vehicle_no: cleanVehicle,
      vehicleNo: cleanVehicle,
      party: party || '',
      material: material || '',
      unit_type: 'units',
      units_val: 0,
      destination: destination ? destination.trim() : 'OUT',
      source: source || '',
      transporter: transporter || '',
      driver: driver || '',
      phone: phone || '',
      royalty_type: royaltyType || 'None',
      royaltyType: royaltyType || 'None',
      royalty_amount: Number(royaltyAmount || 0),
      royaltyAmount: Number(royaltyAmount || 0),
      stationary: stationary || '',
      po_number: poNumber || '',
      po_date: poDate || '',
      payment: (payment && payment.trim()) ? payment.trim() : 'Credit',
      gross: finalGross,
      tare: finalTare,
      net: nettVal,
      rate: rate || 0,
      amount: amount || 0,
      bill_type: billType,
      billType: billType,
      transport: transport || 0,
      party_transport_rate: partyTransportRate || 0,
      party_transport_measurement: partyTransportMeasurement || 'Tonnes',
      party_transport_amount: partyTransportAmount || 0,
      transporter_rate: transporterRate || 0,
      transporter_measurement: transporterMeasurement || 'Units',
      transporter_amount: transporterAmount || 0,
      destination_rate: partyTransportRate || 0,
      destination_amount: partyTransportAmount || 0,
      trate: transporterRate || 0,
      tamount: transporterAmount || 0,
      discount: discount || 0,
      grand_total: grandTotal || 0,
      grandTotal: grandTotal || 0,
      gstin: partyGstin,
      partyGstin: partyGstin,
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

      setSavedTicket({
        dcNum: confirmedDc,
        yourDc: effectiveYourDc,
        vehicle: cleanVehicle,
        material: material || '',
        party: party || '',
        destination: destination ? destination.trim() : 'OUT',
        source: source || '',
        gross: finalGross,
        tare: finalTare,
        net: nettVal || '0',
        transporter: transporter || '',
        driver: driver || '',
        phone: phone || '',
        rate: rate || '0',
        amount: amount || '0',
        transport: transport || '0',
        discount: discount || '0',
        grandTotal: grandTotal || '0',
        payment: (payment && payment.trim()) ? payment.trim() : 'Credit',
        billType: billType,
        bill_type: billType,
        gstin: partyGstin,
        partyGstin: partyGstin,
        date: new Date().toLocaleDateString('en-IN'),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        tareDate: tareDate || nowDateFormatted,
        tareTime: tareTime || nowTimeFormatted,
        tare_date: tareDate || nowDateFormatted,
        tare_time: tareTime || nowTimeFormatted
      });

      setMsg('Sales Transaction Saved Successfully!');
      await cleanupVehicleOnWeighmentCompletion(cleanVehicle, 'OTHERS');
      loadDropdownData();
      setTimeout(() => setMsg(''), 4000);

    } catch (err) {
      console.error(err);
      alert('Error saving sales weighment transaction.');
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
      `}</style>

      {msg && (
        <div className="alert alert-success alert-dismissible fade show py-2 px-3 mb-2 shadow-sm mx-3 mt-2" role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}

      <div className="row g-3">
        {/* Left Column: Form */}
        <div className="col-lg-4">
          <div className="saas-card">
            <div className="saas-header d-flex justify-content-between align-items-center">
              <span className="saas-title">Sales Weighment Form</span>
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

            <form onSubmit={handleSave} className="row g-2">
              <div className="col-6">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <label className="saas-label mb-0">DC Num</label>
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
                  onChange={setVehicle}
                  options={vehiclesList}
                  placeholder="Select Vehicle..."
                  required
                />
              </div>
              <div className="col-12">
                <label className="saas-label">Party</label>
                <SearchableSelect
                  className="saas-input"
                  value={party}
                  onChange={setParty}
                  options={partiesList}
                  placeholder="Select Party..."
                />
              </div>
              <div className="col-12">
                <label className="saas-label">Material</label>
                <SearchableSelect
                  className="saas-input mb-2"
                  value={material}
                  options={availableMaterials}
                  placeholder="Select Material..."
                  onChange={(newMat) => {
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
              </div>
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
              </div>
              <div className="col-6">
                <label className="saas-label">Phone</label>
                <input type="text" className="form-control saas-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="saas-label">Driver</label>
                <input type="text" className="form-control saas-input" value={driver} onChange={(e) => setDriver(e.target.value)} />
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
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="Credit">Credit</option>
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
            </form>
          </div>
        </div>

        {/* Middle Column: Weighment & Payment Details */}
        <div className="col-lg-4">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Weighment Details</span>
            </div>

            <div className="saas-section" style={{ backgroundColor: 'var(--surface-2)' }}>
              <div className="row g-2 align-items-center mb-2">
                <div className="col-4"><span className="saas-label" style={{ color: 'var(--primary-ink)' }}>Gross</span></div>
                <div className="col-8">
                  <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: 'var(--primary-ink)' }} value={grossVal} readOnly />
                </div>
              </div>
              <div className="row g-2 align-items-center mb-2">
                <div className="col-4"><span className="saas-label" style={{ color: '#16a34a' }}>Tare</span></div>
                <div className="col-8">
                  <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#16a34a' }} value={tareVal} readOnly />
                </div>
              </div>
              <div className="row g-2 align-items-center">
                <div className="col-4"><span className="saas-label" style={{ color: '#dc2626' }}>Nett</span></div>
                <div className="col-8">
                  <input type="number" className="form-control saas-input saas-input-readonly text-center fw-bold" style={{ color: '#dc2626', backgroundColor: '#ffffff' }} value={nettVal} readOnly />
                </div>
              </div>
            </div>

            <div className="saas-section mt-3">
              <div className="saas-section-title">Payment Calculation</div>
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
              </div>
            </div>

            <div className="d-flex flex-wrap gap-2 mt-4 justify-content-end align-items-center">
              {savedTicket ? (
                <>
                  <span className="text-secondary w-100 text-end mb-1" style={{ fontSize: '0.75rem' }}>
                    Saved as <b>{savedTicket.dcNum}</b>
                  </span>
                  <button type="button" onClick={handlePrintTicket} className="btn btn-danger saas-btn flex-grow-1" style={{ backgroundColor: '#ef4444' }}>
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
                <button type="button" onClick={handleSave} className="btn btn-success saas-btn w-100">
                  Save
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Camera feeds */}
        <div className="col-lg-4">
          <div className="saas-card overflow-auto" style={{ maxHeight: 'calc(100vh - 130px)' }}>
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
