import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { getVehicleOptionMode, filterVehiclesBySetting, fetchAllTransactions } from '../utils/vehicleFilterUtil.js';



export default function Vehicles() {
  const STORAGE_KEY = 'noris_vehicle_tares';
  const [tares, setTares] = useState([]);

  const loadVehicleTares = async () => {
    try {
      if (api.getVehicleTares) {
        const sqliteRecords = await api.getVehicleTares();
        if (sqliteRecords) {
          const formatted = sqliteRecords.map(r => ({
            id: r.id,
            vehicle: r.vehicle,
            vehicleType: r.vehicleType || '6-Wheel Truck',
            material: r.material || '',
            weight: typeof r.weight === 'number' ? r.weight.toLocaleString() : (r.weight || '0'),
            date: r.date || '',
            time: r.time || '',
            token: r.token || `TK-${Math.floor(1000 + Math.random() * 9000)}`,
            ownership: r.ownership || 'OTHERS'
          }));
          setTares(formatted);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(formatted));
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        setTares(JSON.parse(cached));
      } catch(e) {
        setTares([]);
      }
    } else {
      setTares([]);
    }
  };
  
  // Form states
  const [ownership, setOwnership] = useState('OTHERS');
  const [vehicleNo, setVehicleNo] = useState('');
  const [material, setMaterial] = useState('');
  const [weight, setWeight] = useState('');
  const [allMaterials, setAllMaterials] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [vehicleOptionMode, setVehicleOptionMode] = useState('STAY_ALL');

  const displayTares = useMemo(() => {
    return filterVehiclesBySetting(tares, transactions, vehicleOptionMode);
  }, [tares, transactions, vehicleOptionMode]);

  const materialsList = allMaterials;
  const vehicleOptions = useMemo(() => {
    return [...new Set((displayTares || []).map(t => t.vehicle).filter(Boolean))];
  }, [displayTares]);
  
  // Scale status states (bottom bar)
  const [bottomCard, setBottomCard] = useState('C-101');
  const [bottomVehicle, setBottomVehicle] = useState('AP 39 AB 1234');
  const [bottomGross, setBottomGross] = useState('12560');
  const [bottomTare, setBottomTare] = useState('6670');
  const [bottomNett, setBottomNett] = useState('5890');
  
  // Signal lights
  const [signalGo, setSignalGo] = useState(false);
  const [signalStop, setSignalStop] = useState(true);
  const [signalAlert, setSignalAlert] = useState(false);

  const loadMasterData = async () => {
    loadVehicleTares();
    try {
      if (api.getMaterials) {
        const matsData = await api.getMaterials();
        const distinctMats = [...new Set(matsData.map(m => m.material))].filter(Boolean).sort();
        setAllMaterials(distinctMats);
      }
      const txs = await fetchAllTransactions();
      setTransactions(txs || []);
      const mode = await getVehicleOptionMode();
      setVehicleOptionMode(mode);
    } catch (e) {
      console.error('[Vehicles] Error loading master data:', e);
    }
  };



  useEffect(() => {
    loadMasterData();
  }, []);

  // Listen to Netron Weight Scale
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const numeric = data.value.replace(/[^0-9.-]/g, '');
        if (numeric) {
          setWeight(numeric);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleSave = (e) => {
    e.preventDefault();
    if (!vehicleNo || !weight) return;

    const cleanedVehicleNo = vehicleNo.trim();
    if (!cleanedVehicleNo) {
      alert('Please enter a valid Vehicle Number.');
      return;
    }

    // Check for duplicate vehicle numbers (ignoring spaces)
    const vehicleUpper = cleanedVehicleNo.toUpperCase();
    const cleanInput = vehicleUpper.replace(/\s+/g, '');
    const existingIndex = tares.findIndex(t => t.vehicle.replace(/\s+/g, '').toUpperCase() === cleanInput);

    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    const formattedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    let updatedRecord = null;
    let updatedTares = [];
    let activeToken = '';

    if (existingIndex !== -1) {
      // Update existing record
      const existingRecord = tares[existingIndex];
      updatedRecord = {
        ...existingRecord,
        vehicle: vehicleUpper,
        vehicleType: ownership === 'OTHERS' ? '6-Wheel Truck' : '10-Wheel Truck',
        material: material,
        weight: parseFloat(weight).toLocaleString(),
        date: formattedDate,
        time: formattedTime,
        ownership: ownership
      };
      
      // Remove from old position and put at the top
      const filtered = tares.filter((_, idx) => idx !== existingIndex);
      updatedTares = [updatedRecord, ...filtered];
      activeToken = updatedRecord.token;
    } else {
      // Create new record
      updatedRecord = {
        id: Date.now(),
        vehicle: vehicleUpper,
        vehicleType: ownership === 'OTHERS' ? '6-Wheel Truck' : '10-Wheel Truck',
        material: material,
        weight: parseFloat(weight).toLocaleString(),
        date: formattedDate,
        time: formattedTime,
        token: `TK-${Math.floor(1000 + Math.random() * 9000)}`,
        ownership: ownership
      };
      updatedTares = [updatedRecord, ...tares];
      activeToken = updatedRecord.token;
    }

    // Persist to SQLite
    if (api.saveVehicleTare) {
      api.saveVehicleTare({
        vehicle: vehicleUpper,
        vehicleType: updatedRecord.vehicleType,
        material: updatedRecord.material,
        ownership: updatedRecord.ownership,
        weight: weight,
        date: formattedDate,
        time: formattedTime,
        token: activeToken
      }).catch(console.error);
    }

    setTares(updatedTares);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedTares));

    // Update scale status inputs
    setBottomCard(activeToken);
    setBottomVehicle(vehicleUpper);
    setBottomGross(weight);
    const t = parseFloat(bottomTare) || 0;
    const w = parseFloat(weight) || 0;
    setBottomNett(Math.abs(w - t).toString());

    // Reset fields
    setVehicleNo('');
    setWeight('');
    setMaterial('');
  };

  return (
    <div className="container-fluid p-0">
      
      <div className="row g-4">
        {/* Left Side: Form entry card */}
        <div className="col-12 col-lg-4">
          <div className="saas-card h-100">
            <div className="border-bottom pb-2 mb-3">
              <h5 className="fw-bold m-0 text-dark">Weight Record Entry</h5>
              <p className="text-muted small m-0">Input vehicle weight information</p>
            </div>
            
            <form onSubmit={handleSave} className="d-flex flex-column gap-3">
              <div>
                <label className="form-label text-secondary small fw-bold mb-1">Ownership</label>
                <SearchableSelect
                  className="border-secondary-subtle"
                  value={ownership}
                  onChange={setOwnership}
                  options={[
                    { value: 'OTHERS', label: 'OTHERS' },
                    { value: 'OWN', label: 'QUARRY' }
                  ]}
                  placeholder="Type to search ownership..."
                />
              </div>

              <div>
                <label className="form-label text-secondary small fw-bold mb-1">Vehicle No</label>
                <SearchableSelect
                  className="border-secondary-subtle font-monospace fw-bold text-uppercase"
                  style={{ letterSpacing: '0.5px' }}
                  value={vehicleNo}
                  onChange={(val) => setVehicleNo(val.toUpperCase())}
                  options={vehicleOptions}
                  placeholder="E.G. AP 39 AB 1234"
                  allowCustom={true}
                  openOnFocus={false}
                  required
                />
              </div>

              <div>
                <label className="form-label text-secondary small fw-bold mb-1">Material</label>
                <SearchableSelect
                  className="border-secondary-subtle"
                  value={material}
                  onChange={setMaterial}
                  options={materialsList}
                  placeholder="Type to search material..."
                />
              </div>
               
              <div>
                <label className="form-label text-secondary small fw-bold mb-1">Weight (kg)</label>
                <div className="input-group">
                  <input 
                    type="number" 
                    className="form-control border-secondary-subtle fw-bold bg-light text-secondary" 
                    value={weight} 
                    readOnly 
                    placeholder="Reading from scale..." 
                    required 
                  />
                  <span className="input-group-text bg-light text-muted small fw-semibold">kg</span>
                </div>
              </div>

              <button type="submit" className="btn btn-success py-2.5 mt-2 fw-semibold d-flex align-items-center justify-content-center gap-2 shadow-sm transition-all" style={{ backgroundColor: '#198754', border: 'none' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                Save Weight
              </button>
            </form>
          </div>
        </div>

        {/* Right Side: Data Grid Table */}
        <div className="col-12 col-lg-8">
          <div className="table-card h-100 d-flex flex-column justify-content-between">
            <div>
              <div className="border-bottom pb-2 mb-3 d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="fw-bold m-0 text-dark">Weighment Log</h5>
                  <p className="text-muted small m-0">Recent vehicle weight history records</p>
                </div>
                <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 px-2.5 py-1.5 fw-bold">
                  {displayTares.length} Total Logs
                </span>
              </div>

              <div className="table-responsive" style={{ maxHeight: '310px', overflowY: 'auto' }}>
                <table className="fluent-table">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Vehicle Type</th>
                      <th>Material</th>
                      <th>Ownership</th>
                      <th className="text-end">Weight (kg)</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayTares.map((item) => (
                      <tr key={item.id}>
                        <td className="fw-bold text-dark font-monospace">{item.vehicle}</td>
                        <td><span className="text-secondary small">{item.vehicleType}</span></td>
                        <td><span className="badge bg-light text-secondary border">{item.material || 'BOULDERS'}</span></td>
                        <td>
                          {(item.ownership || '').toUpperCase() === 'OWN' || (item.ownership || '').toUpperCase() === 'QUARRY' ? (
                            <Link to="/boulders" style={{ textDecoration: 'none' }}>
                              <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25" style={{ cursor: 'pointer' }}>
                                Quarry
                              </span>
                            </Link>
                          ) : (
                            <Link to="/sales/weighment-units" style={{ textDecoration: 'none' }}>
                              <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25" style={{ cursor: 'pointer' }}>
                                Others
                              </span>
                            </Link>
                          )}
                        </td>
                        <td className="text-end text-success fw-bold">{item.weight}</td>
                        <td style={{ fontSize: '0.8rem' }} className="text-secondary">{item.date}</td>
                        <td style={{ fontSize: '0.8rem' }} className="text-secondary">{item.time}</td>
                        <td><span className="badge bg-light text-secondary border font-monospace">{item.token}</span></td>
                      </tr>
                    ))}
                    {displayTares.length === 0 && (
                      <tr>
                        <td colSpan="8" className="text-center py-5 text-muted">No vehicle weight records found</td>
                      </tr>
                    )}

                  </tbody>
                </table>
              </div>
            </div>



          </div>
        </div>
      </div>

    </div>
  );
}
