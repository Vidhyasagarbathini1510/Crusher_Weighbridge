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

export default function Yard() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState(null);
  const [previewCamera, setPreviewCamera] = useState(null);
  const [msg, setMsg] = useState('');

  // The ticket for the weighment that was last written to the database, held
  // exactly as Boulders and Sales hold theirs. Saving advances the DC number
  // and clears the vehicle/weights for the next truck, so a re-print has to
  // read these frozen values rather than the live form.
  const [savedTicket, setSavedTicket] = useState(null);

  // Form states
  const [dcNum, setDcNum] = useState('');
  const { vehicle, setVehicle, gross, setGross, tare, setTare, nett, setNett } = useScale();

  // Vehicle lives in the shared scale context so the bottom status bar mirrors
  // this field — but it is wiped on unmount, so leaving this page never carries
  // the truck over to Boulders or Sales.
  useEffect(() => () => setVehicle(''), []);
  const [material, setMaterial] = useState('BOULDERS');

  // Scale status states (bottom bar)
  const [bottomCard, setBottomCard] = useState('C-102');
  const [bottomVehicle, setBottomVehicle] = useState('AP 39 AB 1234');
  const [bottomGross, setBottomGross] = useState('12560');
  const [bottomTare, setBottomTare] = useState('6670');
  const [bottomNett, setBottomNett] = useState('5890');

  // Signal lights
  const [signalGo, setSignalGo] = useState(false);
  const [signalStop, setSignalStop] = useState(true);
  const [signalAlert, setSignalAlert] = useState(false);

  // Suggestions/lists
  const [vehiclesList, setVehiclesList] = useState([]);
  const [vehicleDetails, setVehicleDetails] = useState([]);
  const [materialOptions, setMaterialOptions] = useState([]);
  const [selectedMaterialIndex, setSelectedMaterialIndex] = useState(0);

  // Scale state
  const [netronWeight, setNetronWeight] = useState('0');
  const [savedWeight, setSavedWeight] = useState('');
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    // Fetch cameras
    api.cameras().then(setCameras).catch(() => setCameras([]));

    // Get next available DC number
    Promise.resolve(getNextDcNumber('NON-GST', 'DC-', 'yard')).then(val => val && setDcNum(val));

    const onRefresh = () => handleResetForm();
    window.addEventListener('page-refresh', onRefresh);

    // Load available vehicles and materials
    Promise.all([
      api.getVehicles ? api.getVehicles().catch(() => []) : Promise.resolve([]),
      api.getMaterials ? api.getMaterials().catch(() => []) : Promise.resolve([]),
      api.getVehicleTares ? api.getVehicleTares().catch(() => []) : Promise.resolve([])
    ]).then(([vehiclesData, materialsData, vehicleTaresData]) => {
      // Compile unique vehicle list with ownership
      if (vehiclesData && vehiclesData.length > 0) {
        const uniqueVehicles = [...new Set(vehiclesData.map(v => v.vehicleNo || v.vehicle))].filter(Boolean);
        setVehiclesList(uniqueVehicles);
        setVehicleDetails(vehiclesData);
      } else if (vehicleTaresData && vehicleTaresData.length > 0) {
        const uniqueVehicles = [...new Set(vehicleTaresData.map(v => v.vehicle))].filter(Boolean);
        setVehiclesList(uniqueVehicles);
        setVehicleDetails(vehicleTaresData);
      }

      // Compile unique material list with party context
      if (materialsData && materialsData.length > 0) {
        const distinctMats = [...new Set(materialsData.map(m => m.material))].filter(Boolean).sort();
        const opts = distinctMats.map(mat => ({ material: mat, party: '' }));
        setMaterialOptions(opts);
        setMaterial(distinctMats[0]);
        setSelectedMaterialIndex(0);
      }
    }).catch(console.error);

    return () => {
      window.removeEventListener('page-refresh', onRefresh);
    };
  }, []);

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
              setGross(high);
              setTare(low);
            } else {
              setGross(numeric);
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

  // Auto calculate Nett weight (higher value - lower value = net)
  useEffect(() => {
    const g = parseFloat(gross) || 0;
    const t = parseFloat(tare) || 0;
    setNett(Math.abs(g - t).toString());
  }, [gross, tare]);

  // Auto-populate gross and tare weights when vehicle is selected
  useEffect(() => {
    if (!vehicle) {
      setSavedWeight('');
      setTare('');
      return;
    }
    const cleanVehicle = vehicle.replace(/\s+/g, '').toUpperCase();

    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try { localTares = JSON.parse(cachedTares); } catch (e) {}
    }
    const combined = [...vehicleDetails, ...localTares];

    const matched = combined.find(
      t => t.vehicle && t.vehicle.replace(/\s+/g, '').toUpperCase() === cleanVehicle
    );

    const liveWeightNum = parseFloat(netronWeight) || 0;
    const currentGrossNum = parseFloat(gross) || 0;
    const currentScaleWeight = liveWeightNum > 0 ? liveWeightNum : currentGrossNum;

    if (matched && matched.weight) {
      const rawSavedWeight = String(matched.weight).replace(/,/g, '');
      const savedTareNum = parseFloat(rawSavedWeight) || 0;
      setSavedWeight(rawSavedWeight);

      if (currentScaleWeight > 0) {
        const high = Math.max(currentScaleWeight, savedTareNum).toString();
        const low  = Math.min(currentScaleWeight, savedTareNum).toString();
        setGross(high);
        setTare(low);
      } else {
        setTare(rawSavedWeight);
      }
    } else {
      setSavedWeight('');
      if (currentScaleWeight > 0) {
        setGross(currentScaleWeight.toString());
      }
    }
  }, [vehicle, netronWeight, vehicleDetails]);

  const handleVehicleChange = (selectedVal) => {
    setVehicle(selectedVal);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const cleanVehAlpha = cleanVehicle.replace(/[\s\-\.]/g, '');
    if (!cleanVehicle || cleanVehAlpha === 'N/A' || cleanVehAlpha === 'NA' || cleanVehAlpha === 'NONE' || cleanVehAlpha.length === 0) {
      setMsg('Please enter a valid Vehicle Number.');
      return;
    }

    const nextDc = dcNum || `DC-${Math.floor(100000 + Math.random() * 900000)}`;

    // Look up matching vehicle tare details to extract tare date and time
    const vehicleKey = cleanVehicle.replace(/\s+/g, '');
    const cachedTares = localStorage.getItem('noris_vehicle_tares');
    let localTares = [];
    if (cachedTares) {
      try { localTares = JSON.parse(cachedTares); } catch (e) {}
    }
    const combined = [...vehicleDetails, ...localTares];
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
      const g = parseFloat(gross) || liveWeight || 0;
      const t = parseFloat(tare) || 0;
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

    // Auto-swap on save to ensure high is gross and less is tare
    setGross(finalGross);
    setTare(finalTare);

    const txData = {
      uuid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now(),
      date_time: grossDateTime,
      tare_date: tareDate,
      tare_time: tareTime,
      vehicle_no: cleanVehicle,
      vehicle: cleanVehicle,
      party: 'YARD',
      product: material || 'BOULDERS',
      gross: finalGross,
      tare: finalTare,
      net: nett,
      operator: user?.username || 'Operator',
      card: bottomCard,
      vehicle_type: 'Truck',
      token: bottomCard,
      dc_num: nextDc,
      material: material || 'BOULDERS',
      driver: '',
      transporter: '',
      destination: 'Yard'
    };

    try {
      const base64Img = captureCameraSnapshot();
      let savedRecord = null;
      if (api.addYardWeighment) {
        savedRecord = await api.addYardWeighment(txData, base64Img);
      } else {
        savedRecord = await api.addTransaction({ ...txData, base64Image: base64Img }, base64Img);
      }
      
      const confirmedDc = (savedRecord && (savedRecord.dc_num || savedRecord.dcNum)) || dcNum || 'DC-1';

      // The duplicate-bill search reads this cache: yard weighments live in
      // yard_weighments, which that search does not query, so this is the only
      // record it can find. Settings → Clearing removes the key when the Yard
      // table is cleared, so it cannot outlive the rows it mirrors.
      const storageKey = 'noris_yard_transactions';
      const cached = localStorage.getItem(storageKey);
      const list = cached ? JSON.parse(cached) : [];
      list.unshift({ ...txData, dc_num: confirmedDc, dcNum: confirmedDc });
      localStorage.setItem(storageKey, JSON.stringify(list));

      // Only now, with the write confirmed, does the slip become printable.
      setSavedTicket({
        dcNum: confirmedDc,
        vehicle: vehicle.toUpperCase(),
        material: material || 'BOULDERS',
        party: 'YARD',
        destination: 'Yard',
        source: 'N/A',
        gross: finalGross,
        tare: finalTare,
        net: nett || '0',
        transporter: 'N/A',
        date: new Date().toLocaleDateString('en-IN'),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        tareDate: tareDate || nowDateFormatted,
        tareTime: tareTime || nowTimeFormatted,
        tare_date: tareDate || nowDateFormatted,
        tare_time: tareTime || nowTimeFormatted
      });

      // No alert() on success: a native modal blocks the renderer while the
      // main process is still finishing the database write, which makes the app
      // look frozen. Boulders and Sales both use this Notice banner instead.
      setMsg('Yard Weighment Saved Successfully!');
      setTimeout(() => setMsg(''), 4000);

      // Update bottom bar
      setBottomCard(`C-${Math.floor(100 + Math.random() * 900)}`);
      setBottomVehicle(vehicle);
      setBottomGross(finalGross);
      setBottomTare(finalTare);
      setBottomNett(nett);
    } catch (err) {
      console.error('[Yard] Error saving yard weighment:', err);
      setMsg('Error saving yard transaction.');
    }
  };

  const handleResetForm = () => {
    setSavedTicket(null);
    setVehicle('');
    setGross('');
    setTare('');
    setNett('');
    setSavedWeight('');
    Promise.resolve(getNextDcNumber('NON-GST', 'DC-', 'yard')).then(val => val && setDcNum(val));
  };

  // Strictly prints the saved slip once a weighment has been written.
  const handlePrint = () => {
    if (!savedTicket) return;
    printTicket(savedTicket);
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
        .saas-label {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--ink-label);
          text-transform: uppercase;
          margin-bottom: 0.25rem;
          display: block;
        }
        .saas-input, .saas-select {
          font-size: 0.8rem !important;
          border-radius: 4px !important;
          border: 1px solid var(--line-strong) !important;
          padding: 0.4rem 0.6rem !important;
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
          transition: background-color 0.15s ease;
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
          transition: background-color 0.15s ease;
        }
        .saas-btn-print:hover { background-color: #dc2626; }
      `}</style>

      {msg && (
        <div className="alert alert-success alert-dismissible fade show py-2 px-3 mb-2 shadow-sm mx-3 mt-2" role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}

      <div className="row g-2 mb-4">
        {/* Left Column: Form */}
        <div className="col-lg-8">
          <div className="saas-card">
            <div className="saas-header d-flex justify-content-between align-items-center">
              <span className="saas-title">Yard Weighment</span>
              <div className="d-flex align-items-center gap-2">
                {savedTicket && (
                  <>
                    <button
                      type="button"
                      onClick={handleResetForm}
                      className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                      style={{ fontSize: '0.72rem', fontWeight: '600', padding: '0.25rem 0.65rem', borderRadius: '4px' }}
                      title="Clear form and load next DC"
                    >
                      ↻ New Entry
                    </button>
                    <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                      Saved as <b>{savedTicket.dcNum}</b>
                    </span>
                  </>
                )}
              </div>
            </div>

            <form onSubmit={handleSave} className="row g-2">
              <div className="col-md-6">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <label className="saas-label mb-0">DC Num</label>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-decoration-none small fw-semibold text-primary"
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => Promise.resolve(getNextDcNumber('NON-GST', 'DC-', 'yard')).then(val => val && setDcNum(val))}
                    title="Refresh Yard DC Number"
                  >
                    ↻ Refresh
                  </button>
                </div>
                <input 
                  type="text" 
                  className="form-control saas-input saas-input-readonly fw-semibold" 
                  placeholder="e.g. DC-1002"
                  value={dcNum} 
                  readOnly 
                />
              </div>

              <div className="col-md-6">
                <label className="saas-label">Vehicle</label>
                <SearchableSelect
                  className="saas-select"
                  value={vehicle}
                  onChange={handleVehicleChange}
                  options={vehiclesList}
                  placeholder="Select Vehicle..."
                  required
                />
              </div>

              <div className="col-md-12">
                <label className="saas-label">Material</label>
                <SearchableSelect
                  className="saas-select"
                  value={selectedMaterialIndex}
                  onChange={(val) => {
                    const idx = parseInt(val);
                    setSelectedMaterialIndex(idx);
                    setMaterial(materialOptions[idx].material);
                  }}
                  options={materialOptions.map((m, idx) => ({
                    value: idx,
                    label: `${m.material}${m.party ? ` (${m.party})` : ''}`
                  }))}
                  placeholder="Search material..."
                />
              </div>

              {/* Weight Grid */}
              <div className="col-md-12 p-3 my-3 bg-light border rounded">
                <div className="row g-2">
                  <div className="col-4">
                    <label className="saas-label" style={{ color: 'var(--primary-ink)' }}>Gross (kg)</label>
                    <input 
                      type="text" 
                      inputMode="decimal"
                      className="form-control saas-input saas-input-readonly text-center fw-bold" 
                      style={{ color: 'var(--primary-ink)' }} 
                      value={gross} 
                      placeholder="0"
                      readOnly
                    />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#16a34a' }}>Tare (kg)</label>
                    <input 
                      type="text" 
                      inputMode="decimal"
                      className="form-control saas-input saas-input-readonly text-center fw-bold" 
                      style={{ color: '#16a34a' }} 
                      value={tare} 
                      placeholder="0"
                      readOnly
                    />
                  </div>
                  <div className="col-4">
                    <label className="saas-label" style={{ color: '#dc2626' }}>Nett (kg)</label>
                    <input 
                      type="text" 
                      inputMode="decimal"
                      className="form-control saas-input saas-input-readonly text-center fw-bold" 
                      style={{ color: '#dc2626', backgroundColor: '#ffffff' }} 
                      value={nett} 
                      readOnly 
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="col-12 d-flex gap-2 mt-2 justify-content-end align-items-center">
                {savedTicket ? (
                  <button type="button" onClick={handlePrint} className="saas-btn-print">
                    PRINT
                  </button>
                ) : (
                  <button type="submit" className="saas-btn-save">
                    SAVE
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Camera Views */}
        <div className="col-lg-4">
          <div className="saas-card overflow-auto" style={{ maxHeight: 'calc(100vh - 130px)' }}>
            <div className="saas-header">
              <span className="saas-title">Live Camera Views</span>
              <div className="d-flex align-items-center gap-1.5 text-success small fw-semibold" style={{ fontSize: '0.72rem' }}>
                <span className="indicator-light light-green active"></span> Stream Online
              </div>
            </div>

            <div className="row g-2">
              {cameras.slice(0, 2).map((c, index) => (
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
