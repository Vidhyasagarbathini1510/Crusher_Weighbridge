import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import CameraPreviewModal from '../components/CameraPreviewModal.jsx';
import Loader from '../components/Loader.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { getNextDcNumber, incrementDcNumber } from '../utils/dcHelper.js';
import { printTicket } from '../utils/printHelper.js';
import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import { useScale } from '../context/ScaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getVehicleOptionMode, filterVehiclesBySetting, cleanupVehicleOnWeighmentCompletion } from '../utils/vehicleFilterUtil.js';


export default function Boulders() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [previewCamera, setPreviewCamera] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [vehicleTares, setVehicleTares] = useState([]);
  const [msg, setMsg] = useState('');

  // Form fields
  const [dcNum, setDcNum] = useState('');
  const {
    vehicle: vehicleNo, setVehicle: setVehicleNo,
    gross: grossVal, setGross: setGrossVal,
    tare: tareVal, setTare: setTareVal,
    nett: nettVal, setNett: setNettVal
  } = useScale();

  // Vehicle lives in the shared scale context so the bottom status bar mirrors
  // this field — but it is wiped on unmount, so leaving this page never carries
  // the truck over to Sales or Yard.
  useEffect(() => () => setVehicleNo(''), []);
  const [contractor, setContractor] = useState('');
  const [quarry, setQuarry] = useState('');
  const [material, setMaterial] = useState('');
  const [driver, setDriver] = useState('');
  const [transporter, setTransporter] = useState('');
  const [destination, setDestination] = useState('HOPPER');

  const [savedWeight, setSavedWeight] = useState('');
  const [syncingMaster, setSyncingMaster] = useState(false);

  // The ticket for the weighment that was last written to the database. Holding
  // the printed values rather than reading the form back means a re-print still
  // produces the saved DC, even though saving advances the DC number and leaves
  // the form editable. Null until a save succeeds, which is what keeps the Print
  // button hidden — including after a refresh, when this resets to null.
  const [savedTicket, setSavedTicket] = useState(null);

  // Scale / status states
  const [netronWeight, setNetronWeight] = useState('0');
  const [manualMode, setManualMode] = useState(false);

  // Master data lists
  const [rawContractorMaterials, setRawContractorMaterials] = useState([]);
  const [rawSources, setRawSources] = useState([]);
  const [rawContractors, setRawContractors] = useState([]);
  const [rate, setRate] = useState(0);
  const [amount, setAmount] = useState(0);

  // Auto-complete suggestion lists
  const [suggestions, setSuggestions] = useState({
    vehicleNo: [],
    contractor: [],
    quarry: [],
    material: [],
    driver: [],
    transporter: [],
    destination: ['HOPPER', 'YARD', 'STOCKPILE']
  });

  const loadSourcedData = async () => {
    try {
      const [
        boulderList,
        txList,
        contractorsData,
        contractorMaterialsData,
        sourcesData,
        transportersData,
        vehicleTaresData,
        materialsData
      ] = await Promise.all([
        api.boulders ? api.boulders().catch(() => []) : [],
        api.transactions().catch(() => []),
        api.getContractors ? api.getContractors().catch(() => []) : Promise.resolve([]),
        api.getContractorMaterials ? api.getContractorMaterials().catch(() => []) : Promise.resolve([]),
        api.getSources ? api.getSources().catch(() => []) : Promise.resolve([]),
        api.getTransporters ? api.getTransporters().catch(() => []) : Promise.resolve([]),
        api.getVehicleTares ? api.getVehicleTares().catch(() => []) : Promise.resolve([]),
        api.getMaterials ? api.getMaterials().catch(() => []) : Promise.resolve([])
      ]);

      setRawContractorMaterials(contractorMaterialsData || []);
      setRawSources(sourcesData || []);
      setRawContractors(contractorsData || []);
      setVehicleTares(vehicleTaresData || []);

      const combinedMap = new Map();
      [...(boulderList || []), ...(txList || [])].forEach(r => {
        const key = r.uuid || r.id || `${r.dc_num}-${r.vehicle_no}`;
        if (!combinedMap.has(key)) combinedMap.set(key, r);
      });
      const txs = Array.from(combinedMap.values());
      setTransactions(txs);

      // Extract unique list values for suggestions
      const unique = (arr) => [...new Set(arr.filter(Boolean))];
      
      const cmContractors = (contractorMaterialsData || []).map(cm => cm.contractorName);
      const listContractors = unique([
        ...cmContractors,
        ...(contractorsData || []).map(c => c.contractorName || c.contractor)
      ]).filter(c => c && c.trim().toUpperCase() !== 'OTHERS');

      const cmQuarries = (contractorMaterialsData || []).map(cm => cm.quarryName);
      const sQuarries = (sourcesData || []).map(s => s.sourceName);
      const listQuarries = unique([
        ...cmQuarries,
        ...sQuarries,
        ...(contractorsData || []).map(c => c.quarryName || c.quarry)
      ]);

      const listTransporters = unique(['OWN', ...(transportersData || []).map(t => t.transporterName || t.transporter)]);
      
      const cmMaterials = (contractorMaterialsData || []).map(cm => cm.material);
      const serverMaterials = (materialsData || []).map(m => m.material);
      const txMaterials = txs.map(t => t.material || t.product);
      const listMaterials = unique([
        ...cmMaterials,
        ...serverMaterials,
        ...txMaterials
      ]);

      // Filter Quarry / Own vehicles
      const isQuarryVeh = (t) => {
        const own = (t.ownership || '').toUpperCase();
        return own === 'OWN' || own === 'QUARRY';
      };

      let quarryVehObjs = [
        ...(vehicleTaresData || []).filter(isQuarryVeh)
      ];

      const cached = localStorage.getItem('noris_vehicle_tares');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const cachedObjs = parsed.filter(isQuarryVeh);
          quarryVehObjs = [...quarryVehObjs, ...cachedObjs];
        } catch (e) {}
      }

      getVehicleOptionMode().then(mode => {
        const filteredObjs = filterVehiclesBySetting(quarryVehObjs, txs, mode);
        const quarryVehicles = filteredObjs.map(t => t.vehicle);

        setSuggestions(prev => ({
          ...prev,
          vehicleNo: unique(quarryVehicles),
          contractor: unique([...listContractors, ...txs.map(t => t.contractor || t.party)]).filter(c => c && c.trim().toUpperCase() !== 'OTHERS'),
          quarry: unique([...listQuarries, ...txs.map(t => t.quarry || t.source)]),
          material: unique([...listMaterials, ...txs.map(t => t.material || t.product)]),
          driver: unique(txs.map(t => t.driver)),
          transporter: unique([...listTransporters, ...txs.map(t => t.transporter)]),
          destination: unique([...prev.destination, ...txs.map(t => t.destination)])
        }));
      });

    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // Fetch cameras
    api.cameras().then(setCameras).catch(() => setCameras([]));

    // Load master data
    loadSourcedData();

    // Trigger background sync on mount
    if (api.syncMasterData) {
      api.syncMasterData().then((res) => {
        if (res && res.success) {
          loadSourcedData();
        }
      }).catch(console.error);
    }

    Promise.resolve(getNextDcNumber('NON-GST', 'DC-', 'boulders')).then(val => val && setDcNum(val));

    const onRefresh = () => handleResetForm();
    window.addEventListener('page-refresh', onRefresh);
    return () => window.removeEventListener('page-refresh', onRefresh);
  }, []);

  // Listen to background master data syncs
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onMasterDataSynced) return;
    const unsubscribe = window.electronAPI.onMasterDataSynced(() => {
      loadSourcedData();
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // AI Material Detection Auto-Fill
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onAiMaterialDetected) return;
    const unsubscribe = window.electronAPI.onAiMaterialDetected((data) => {
      if (data && data.material && data.stable) {
        setMaterial(data.material);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // RFID Auto-Mapped Vehicle & Tare listener
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onRfidAutoMapped) return;
    const unsubscribe = window.electronAPI.onRfidAutoMapped((data) => {
      if (data && data.vehicleNo) {
        setVehicleNo(data.vehicleNo);
        if (data.material) setMaterial(data.material);
        if (data.contractor) setContractor(data.contractor);
        if (data.tareWeight) setTareVal(data.tareWeight.toString());
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // RFID Auto-Weigh Success listener (reloads report table on RFID scan)
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onRfidAutoWeighSuccess) return;
    const unsubscribe = window.electronAPI.onRfidAutoWeighSuccess((data) => {
      if (data && data.message) {
        setMsg(`✔ ${data.message}`);
        setTimeout(() => setMsg(''), 5000);
        loadSourcedData();
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Auto-lookup tare weight from vehicle_tares master list when vehicleNo changes
  useEffect(() => {
    if (!vehicleNo) return;
    const cleanVeh = vehicleNo.trim().toUpperCase().replace(/[\s\-\.]/g, '');
    const match = vehicleTares.find(vt => (vt.vehicle || '').trim().toUpperCase().replace(/[\s\-\.]/g, '') === cleanVeh);
    if (match) {
      const tareNum = typeof match.weight === 'number' ? match.weight : parseFloat(String(match.weight).replace(/,/g, '')) || 0;
      if (tareNum > 0) {
        setTareVal(tareNum.toString());
      }
    }
  }, [vehicleNo, vehicleTares]);

  const handleManualSync = async () => {
    setSyncingMaster(true);
    try {
      if (api.syncMasterData) {
        const res = await api.syncMasterData();
        if (res && res.success) {
          alert('Sync Completed! Sourced fresh data from server.');
          await loadSourcedData();
        } else {
          alert(`Sync Result: ${res ? (res.error || 'Server up to date') : 'Done'}`);
        }
      } else {
        alert('Sync is not supported in offline browser mode.');
      }
    } catch (e) {
      console.error(e);
      alert(`Sync Failed: ${e.message}`);
    } finally {
      setSyncingMaster(false);
    }
  };

  // Listen to Netron Weight Scale
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
              const low  = Math.min(liveNum, savedNum).toString();
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

  // Calculate net weight (higher value - lower value = net)
  useEffect(() => {
    const g = parseFloat(grossVal) || 0;
    const t = parseFloat(tareVal) || 0;
    setNettVal(Math.abs(g - t).toString());
  }, [grossVal, tareVal]);

  // Auto-populate gross and tare weights when vehicle is selected
  useEffect(() => {
    if (!vehicleNo) {
      setSavedWeight('');
      setTareVal('');
      return;
    }
    const cleanVehicle = vehicleNo.replace(/\s+/g, '').toUpperCase();

    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try { localTares = JSON.parse(cachedTares); } catch (e) {}
    }
    const combined = [...vehicleTares, ...localTares];

    const matched = combined.find(
      t => t.vehicle && t.vehicle.replace(/\s+/g, '').toUpperCase() === cleanVehicle
    );

    const liveWeightNum = parseFloat(netronWeight) || 0;
    const currentGrossNum = parseFloat(grossVal) || 0;
    const currentScaleWeight = liveWeightNum > 0 ? liveWeightNum : currentGrossNum;

    if (matched && matched.weight) {
      const rawSavedWeight = String(matched.weight).replace(/,/g, '');
      const savedTareNum = parseFloat(rawSavedWeight) || 0;
      setSavedWeight(rawSavedWeight);

      if (currentScaleWeight > 0) {
        const high = Math.max(currentScaleWeight, savedTareNum).toString();
        const low  = Math.min(currentScaleWeight, savedTareNum).toString();
        setGrossVal(high);
        setTareVal(low);
      } else {
        setTareVal(rawSavedWeight);
      }
    } else {
      setSavedWeight('');
      if (currentScaleWeight > 0) {
        setGrossVal(currentScaleWeight.toString());
      }
    }
  }, [vehicleNo, netronWeight, vehicleTares]);

  // Dynamic contractor options
  const uniqueHelper = (arr) => [...new Set(arr.filter(Boolean))];

  const availableContractorOptions = uniqueHelper([
    ...rawContractorMaterials.map(cm => cm.contractorName),
    ...rawContractors.map(c => c.contractorName || c.contractor),
    ...suggestions.contractor
  ]).filter(c => c && c.trim().toUpperCase() !== 'OTHERS');

  // Compute quarries available strictly for the selected contractor
  const availableQuarries = (() => {
    if (!contractor) {
      return [];
    }
    const cleanContractor = contractor.trim().toUpperCase();
    const matchedCM = rawContractorMaterials.filter(cm => (cm.contractorName || '').trim().toUpperCase() === cleanContractor);
    if (matchedCM.length > 0) {
      const qList = uniqueHelper(matchedCM.map(cm => cm.quarryName));
      if (qList.length > 0) return qList;
    }
    const matchedC = rawContractors.filter(c => ((c.contractorName || c.contractor || '')).trim().toUpperCase() === cleanContractor);
    if (matchedC.length > 0) {
      const qList = uniqueHelper(matchedC.map(c => c.quarryName || c.quarry));
      if (qList.length > 0) return qList;
    }
    return [];
  })();

  // Compute materials available strictly for the selected contractor & quarry
  const availableMaterials = (() => {
    if (!contractor) {
      return [];
    }
    const cleanContractor = contractor.trim().toUpperCase();
    const cleanQuarry = (quarry || '').trim().toUpperCase();
    let matchedCM = rawContractorMaterials.filter(cm => (cm.contractorName || '').trim().toUpperCase() === cleanContractor);
    
    // If a quarry is chosen, filter materials strictly for this contractor AND this quarry
    if (cleanQuarry && matchedCM.some(cm => (cm.quarryName || '').trim().toUpperCase() === cleanQuarry)) {
      matchedCM = matchedCM.filter(cm => (cm.quarryName || '').trim().toUpperCase() === cleanQuarry);
    }
    
    if (matchedCM.length > 0) {
      const mList = uniqueHelper(matchedCM.map(cm => cm.material));
      if (mList.length > 0) return mList;
    }
    return [];
  })();

  const handleContractorChange = (selectedVal) => {
    setContractor(selectedVal);
    if (!selectedVal) {
      setQuarry('');
      setMaterial('');
      return;
    }

    const cleanContractor = selectedVal.trim().toUpperCase();
    const matchedCM = rawContractorMaterials.filter(cm => (cm.contractorName || '').trim().toUpperCase() === cleanContractor);
    
    if (matchedCM.length > 0) {
      const quarries = uniqueHelper(matchedCM.map(cm => cm.quarryName));
      let chosenQuarry = '';
      if (quarries.length === 1) {
        chosenQuarry = quarries[0];
        setQuarry(chosenQuarry);
      } else if (quarries.includes(quarry)) {
        chosenQuarry = quarry;
      } else {
        chosenQuarry = quarries[0] || '';
        setQuarry(chosenQuarry);
      }

      // Filter materials for this contractor and the chosen quarry
      let relevantCM = matchedCM;
      if (chosenQuarry) {
        const qMatches = matchedCM.filter(cm => (cm.quarryName || '').trim().toUpperCase() === chosenQuarry.trim().toUpperCase());
        if (qMatches.length > 0) {
          relevantCM = qMatches;
        }
      }
      const materials = uniqueHelper(relevantCM.map(cm => cm.material));
      if (materials.length === 1) {
        setMaterial(materials[0]);
      } else if (materials.includes(material)) {
        // Keep current selected material if valid for this contractor
      } else {
        setMaterial(materials[0] || '');
      }
    } else {
      const match = rawContractors.find(c => (c.contractorName || c.contractor) === selectedVal);
      if (match && (match.quarryName || match.quarry)) {
        setQuarry(match.quarryName || match.quarry);
      } else {
        setQuarry('');
      }
      setMaterial('');
    }
  };

  const handleQuarryChange = (selectedQuarry) => {
    setQuarry(selectedQuarry);
    if (!contractor) return;

    const cleanContractor = contractor.trim().toUpperCase();
    const cleanQuarry = (selectedQuarry || '').trim().toUpperCase();
    const matchedCM = rawContractorMaterials.filter(cm => 
      (cm.contractorName || '').trim().toUpperCase() === cleanContractor &&
      (cm.quarryName || '').trim().toUpperCase() === cleanQuarry
    );

    if (matchedCM.length > 0) {
      const mats = uniqueHelper(matchedCM.map(cm => cm.material));
      if (mats.length === 1) {
        setMaterial(mats[0]);
      } else if (mats.includes(material)) {
        // Keep current valid selection
      } else {
        setMaterial(mats[0] || '');
      }
    } else if (selectedQuarry) {
      setMaterial('');
    }
  };

  // Real-time lookup of rate and dynamic amount calculation
  useEffect(() => {
    if (!contractor) {
      setRate(0);
      setAmount(0);
      return;
    }
    const cleanContractor = contractor.trim().toUpperCase();
    const cleanQuarry = (quarry || '').trim().toUpperCase();
    const cleanMaterial = (material || '').trim().toUpperCase();

    // 1. Try contractor_materials lookup matching Contractor + Quarry + Material
    let matchedCM = rawContractorMaterials.find(cm => {
      const cName = (cm.contractorName || '').trim().toUpperCase();
      const qName = (cm.quarryName || '').trim().toUpperCase();
      const mName = (cm.material || '').trim().toUpperCase();
      return cName === cleanContractor && (!cleanQuarry || qName === cleanQuarry) && mName === cleanMaterial;
    });

    // 2. Try contractor_materials lookup matching Contractor + Material
    if (!matchedCM) {
      matchedCM = rawContractorMaterials.find(cm => {
        const cName = (cm.contractorName || '').trim().toUpperCase();
        const mName = (cm.material || '').trim().toUpperCase();
        return cName === cleanContractor && mName === cleanMaterial;
      });
    }

    // 3. Try contractor_materials lookup matching Contractor + Quarry
    if (!matchedCM && cleanQuarry) {
      matchedCM = rawContractorMaterials.find(cm => {
        const cName = (cm.contractorName || '').trim().toUpperCase();
        const qName = (cm.quarryName || '').trim().toUpperCase();
        return cName === cleanContractor && qName === cleanQuarry;
      });
    }

    // 4. Try contractor_materials matching Contractor
    if (!matchedCM) {
      matchedCM = rawContractorMaterials.find(cm => {
        const cName = (cm.contractorName || '').trim().toUpperCase();
        return cName === cleanContractor;
      });
    }

    let resolvedRate = 0;
    if (matchedCM && matchedCM.rate !== undefined && matchedCM.rate !== null) {
      resolvedRate = parseFloat(matchedCM.rate) || 0;
    } else {
      const matchC = rawContractors.find(c => ((c.contractorName || c.contractor || '')).trim().toUpperCase() === cleanContractor);
      if (matchC) {
        const rVal = matchC.rate !== undefined && matchC.rate !== null ? matchC.rate : matchC.ton;
        resolvedRate = parseFloat(rVal) || 0;
      }
    }

    setRate(resolvedRate);

    const netWeightTons = (parseFloat(nettVal) || 0) / 1000;
    const computedAmount = Math.round(resolvedRate * netWeightTons * 100) / 100;
    setAmount(computedAmount);
  }, [contractor, quarry, material, nettVal, rawContractorMaterials, rawContractors]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    const cleanVehicle = (vehicleNo || '').trim().toUpperCase();
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
    const combined = [...vehicleTares, ...localTares];
    const matched = combined.find(
      vt => vt.vehicle && vt.vehicle.replace(/\s+/g, '').toUpperCase() === vehicleKey
    );

    const nowFormatted = new Date().toLocaleString();
    const nowDateFormatted = new Date().toLocaleDateString('en-IN');
    const nowTimeFormatted = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const liveWeight = parseFloat(netronWeight) || 0;
    const previousWeight = matched ? (parseFloat(String(matched.weight).replace(/,/g, '')) || 0) : 0;
    const previousDate = matched ? (matched.date || matched.tare_date || matched.date_time || '') : '';
    const previousTime = matched ? (matched.time || matched.tare_time || '') : '';
    const previousDateTime = previousDate ? (previousDate + (previousTime ? ' ' + previousTime : '')) : nowFormatted;

    let finalGross = '0';
    let finalTare = '0';
    let grossDateTime = nowFormatted;
    let tareDate = '';
    let tareTime = '';

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
        grossDateTime = previousDateTime;
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
        grossDateTime = previousDateTime;
        tareDate = nowDateFormatted;
        tareTime = nowTimeFormatted;
      }
    }

    // Auto-swap form state to match finalGross and finalTare
    setGrossVal(finalGross);
    setTareVal(finalTare);

    const rateVal = rate;
    const netWeightTons = (parseFloat(nettVal) || 0) / 1000;
    const amountVal = Math.round(rateVal * netWeightTons * 100) / 100;

    const txData = {
      uuid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now(),
      date_time: grossDateTime,
      vehicle_no: cleanVehicle,
      party: contractor || '',
      product: material || '',
      gross: finalGross,
      tare: finalTare,
      net: nettVal,
      operator: user?.username || 'Operator',
      card: 'BOULDERS',
      vehicle_type: 'Truck',
      token: dcNum,

      // Boulder specific fields
      dc_num: dcNum,
      contractor: contractor || '',
      quarry: quarry || '',
      material: material || '',
      driver: driver || '',
      transporter: transporter || '',
      destination: destination || '',
      tare_date: tareDate,
      tare_time: tareTime,
      rate: rateVal,
      amount: amountVal
    };

    try {
      const base64Img = captureCameraSnapshot();
      let savedRecord = null;
      if (api.addBoulder) {
        savedRecord = await api.addBoulder(txData, base64Img);
      } else {
        savedRecord = await api.addTransaction({ ...txData, base64Image: base64Img }, base64Img);
      }
      setMsg('Boulders Weighment Saved Successfully!');
      setTimeout(() => setMsg(''), 4000);

      const confirmedDc = (savedRecord && (savedRecord.dc_num || savedRecord.dcNum)) || dcNum || 'DC-1';

      // Only now, with the write confirmed, does the slip become printable.
      // Captured here rather than at print time to freeze the exact saved snapshot.
      setSavedTicket({
        dcNum: confirmedDc,
        vehicle: cleanVehicle,
        material: material || '',
        party: contractor || '',
        destination: destination || '',
        source: quarry || '',
        gross: finalGross,
        tare: finalTare,
        net: nettVal || '0',
        transporter: transporter || '',
        driver: driver || '',
        date: new Date().toLocaleDateString('en-IN'),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        tareDate: tareDate || nowDateFormatted,
        tareTime: tareTime || nowTimeFormatted,
        tare_date: tareDate || nowDateFormatted,
        tare_time: tareTime || nowTimeFormatted
      });

      await cleanupVehicleOnWeighmentCompletion(cleanVehicle, 'QUARRY');
      await loadSourcedData();

      const txs = api.boulders ? await api.boulders() : await api.transactions();
      setTransactions(txs);
    } catch (err) {
      console.error(err);
      alert('Error saving weighment transaction.');
    }
  };

  const handleResetForm = () => {
    setSavedTicket(null);
    setVehicleNo('');
    setGrossVal('');
    setTareVal('');
    setNettVal('0');
    setContractor('');
    setQuarry('');
    setMaterial('');
    setDriver('');
    setTransporter('');
    setDestination('HOPPER');
    setSavedWeight('');
    setRate(0);
    setAmount(0);
    Promise.resolve(getNextDcNumber('NON-GST', 'DC-', 'boulders')).then(val => val && setDcNum(val));
  };

  // Re-prints the saved slip as many times as asked. It strictly reads savedTicket,
  // making unlimited reprints safe and idempotent with zero SQLite writes.
  const handlePrint = () => {
    if (!savedTicket) return;
    printTicket(savedTicket);
  };

  if (!cameras) return <Loader label="Loading weighbridge cameras..." />;

  return (
    <div className="container-fluid p-0 animate-fade-in" style={{ fontFamily: 'Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif' }}>
      <style>{`
        .saas-card {
          background: #ffffff;
          border: 1px solid var(--line);
          border-radius: 6px;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
          padding: 1.25rem;
          margin-bottom: 1rem;
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
          font-weight: 500;
          border-radius: 4px !important;
          border: 1px solid var(--line-strong) !important;
          padding: 0.4rem 0.6rem !important;
          background-color: #ffffff;
          color: var(--ink);
        }
        .saas-input:focus {
          border-color: var(--primary) !important;
          box-shadow: 0 0 0 2px rgba(169, 124, 30, 0.20) !important;
          outline: none;
        }
        .saas-input-readonly {
          background-color: var(--surface-3) !important;
          color: var(--ink-soft) !important;
        }
        .saas-btn-save {
          background-color: var(--primary);
          border: 1px solid var(--primary);
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .saas-btn-save:hover { background-color: var(--primary-ink); }
        .saas-btn-print {
          background-color: #ef4444;
          border: 1px solid #ef4444;
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.25rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .saas-btn-print:hover { background-color: #dc2626; }
      `}</style>

      {msg && (
        <div className="alert alert-success alert-dismissible fade show py-2 px-3 mb-2 shadow-sm mx-3 mt-2" role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}

      <div className="row g-2">
        {/* Left Column: Input Form */}
        <div className="col-12 col-lg-8">
          <div className="saas-card">
            <div className="saas-header d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center gap-2">
                <span className="saas-title">Boulders Weighment Form</span>
              </div>
              <div className="d-flex align-items-center gap-2">
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
                <span className="badge bg-primary px-2.5 py-1 text-white" style={{ fontSize: '0.7rem', fontWeight: '600', borderRadius: '4px' }}>
                  Boulders Entry Mode
                </span>
              </div>
            </div>

            <form onSubmit={handleSave}>
              {/* Section 1: Logistics Information */}
              <div className="saas-section">
                <div className="saas-section-title">Logistics Details</div>
                <div className="row g-2">
                  <div className="col-md-6">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <label className="saas-label mb-0">DC Num</label>
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none small fw-semibold text-primary"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => Promise.resolve(getNextDcNumber('NON-GST', 'DC-', 'boulders')).then(val => val && setDcNum(val))}
                        title="Refresh Boulder DC Number"
                      >
                        ↻ Refresh
                      </button>
                    </div>
                    <input
                      type="text"
                      className="form-control saas-input saas-input-readonly fw-semibold"
                      value={dcNum}
                      onChange={(e) => setDcNum(e.target.value)}
                      required
                      readOnly
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="saas-label">Vehicle No</label>
                    <SearchableSelect
                      className="saas-input text-uppercase fw-semibold"
                      value={vehicleNo}
                      onChange={setVehicleNo}
                      options={suggestions.vehicleNo}
                      placeholder="TYPE OR SELECT VEHICLE..."
                      required
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="saas-label">Contractor</label>
                    <SearchableSelect
                      className="saas-input"
                      value={contractor}
                      onChange={handleContractorChange}
                      options={availableContractorOptions}
                      placeholder="Type or select contractor..."
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="saas-label">Quarry / Source</label>
                    <SearchableSelect
                      className="saas-input"
                      value={quarry}
                      onChange={handleQuarryChange}
                      options={availableQuarries}
                      placeholder={!contractor ? "-- Select Contractor First --" : (availableQuarries.length > 0 ? "Type or select quarry..." : "-- No Quarry Mapped --")}
                    />
                  </div>

                  <div className="col-md-12">
                    <label className="saas-label">Material</label>
                    <SearchableSelect
                      className="saas-input"
                      value={material}
                      onChange={setMaterial}
                      options={availableMaterials}
                      placeholder={!contractor ? "-- Select Contractor First --" : (availableMaterials.length > 0 ? "Type or select material..." : "-- No Material Mapped --")}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Driver & Transport Details */}
              <div className="saas-section">
                <div className="saas-section-title">Driver & Destination Details</div>
                <div className="row g-2">
                  <div className="col-md-4">
                    <label className="saas-label">Driver</label>
                    <input
                      type="text"
                      className="form-control saas-input"
                      placeholder="Driver name..."
                      value={driver}
                      onChange={(e) => setDriver(e.target.value)}
                    />
                  </div>

                  <div className="col-md-4">
                    <label className="saas-label">Transporter</label>
                    <SearchableSelect
                      className="saas-input"
                      value={transporter}
                      onChange={setTransporter}
                      options={suggestions.transporter}
                      placeholder="Transporter..."
                      allowCustom={true}
                    />
                  </div>

                  <div className="col-md-4">
                    <label className="saas-label">Destination</label>
                    <SearchableSelect
                      className="saas-input"
                      value={destination}
                      onChange={setDestination}
                      options={['HOPPER', 'YARD']}
                      placeholder="Type or select destination..."
                      allowCustom={true}
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Weighment Details */}
              <div className="saas-section" style={{ backgroundColor: 'var(--surface-2)' }}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div className="saas-section-title mb-0" style={{ color: 'var(--ink)' }}>Weighment Values</div>
                </div>

                <div className="row g-2">
                  <div className="col-4">
                    <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Gross (kg)</label>
                    <input
                      type="text"
                      className="form-control saas-input saas-input-readonly text-center fw-bold"
                      style={{ color: 'var(--primary-ink)', fontSize: '0.9rem !important', backgroundColor: '#ffffff !important' }}
                      value={grossVal}
                      readOnly
                    />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#16a34a' }}>Tare (kg)</label>
                    <input
                      type="text"
                      className="form-control saas-input saas-input-readonly text-center fw-bold"
                      style={{ color: '#16a34a', fontSize: '0.9rem !important', backgroundColor: '#ffffff !important' }}
                      value={tareVal}
                      readOnly
                    />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#dc2626' }}>Nett (kg)</label>
                    <input
                      type="text"
                      className="form-control saas-input saas-input-readonly text-center fw-bold"
                      style={{ color: '#dc2626', fontSize: '0.9rem !important', backgroundColor: '#ffffff !important' }}
                      value={nettVal}
                      readOnly
                    />
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="d-flex gap-2 justify-content-end align-items-center">
                {savedTicket ? (
                  <>
                    <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                      Saved as <b>{savedTicket.dcNum}</b>
                    </span>
                    <button type="button" onClick={handlePrint} className="saas-btn-print">
                      Print Ticket
                    </button>
                  </>
                ) : (
                  <button type="submit" className="saas-btn-save">
                    Save Entry
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Camera Views */}
        <div className="col-12 col-lg-4">
          <div className="saas-card overflow-auto" style={{ maxHeight: 'calc(100vh - 130px)' }}>
            <div className="saas-header">
              <span className="saas-title">Live Camera Views</span>
              <div className="d-flex align-items-center gap-1 text-success small fw-semibold" style={{ fontSize: '0.72rem' }}>
                <span className="badge bg-success">Online</span>
              </div>
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
              {cameras.length === 0 && (
                <div className="col-12 d-flex align-items-center justify-content-center text-secondary bg-light rounded-3" style={{ height: '220px' }}>
                  No cameras registered
                </div>
              )}
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
