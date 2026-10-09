import React, { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { getNextDcNumber, incrementDcNumber } from '../utils/dcHelper.js';
import { captureCameraSnapshot } from '../utils/cameraSnapshot.js';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { useScale } from '../context/ScaleContext.jsx';

export default function LoadingSlip() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [slips, setSlips] = useState([]);
  const [party, setParty] = useState('');
  const [partiesList, setPartiesList] = useState(['LOCAL SALE']);
  const [allDebitors, setAllDebitors] = useState([]);
  const [localPartyName, setLocalPartyName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [material, setMaterial] = useState('');
  const [allMaterials, setAllMaterials] = useState([]);
  const [availableMaterials, setAvailableMaterials] = useState([]);
  const [destination, setDestination] = useState('');
  const [allDestinations, setAllDestinations] = useState([]);
  const [availableDestinations, setAvailableDestinations] = useState([]);
  const [source, setSource] = useState('');
  const [sourcesList, setSourcesList] = useState([]);
  const [payment, setPayment] = useState('Credit');
  const [phone, setPhone] = useState('');
  const [liveScaleWeight, setLiveScaleWeight] = useState('');
  const [msg, setMsg] = useState('');

  const scale = useScale();

  // Listen to live scale stream
  useEffect(() => {
    if (!window.electronAPI?.onNetronData) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value && !String(data.value).includes('Offline')) {
        const numeric = String(data.value).replace(/[^0-9.-]/g, '');
        if (numeric) setLiveScaleWeight(numeric);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const currentLiveNum = (liveScaleWeight && parseFloat(liveScaleWeight) > 0)
    ? parseFloat(liveScaleWeight)
    : (scale?.gross && parseFloat(scale.gross) > 0 ? parseFloat(scale.gross) : 0);

  // Handle incoming vehicle from Vehicles page navigation
  useEffect(() => {
    const incoming = location.state?.vehicle || searchParams.get('vehicle');
    if (incoming) {
      const cleanVeh = incoming.trim().toUpperCase();
      setVehicle(cleanVeh);
      if (api.getVehicleTares) {
        api.getVehicleTares().then(tares => {
          const matched = (tares || []).find(t => (t.vehicle || t.vehicleNo || '').trim().toUpperCase() === cleanVeh);
          if (matched && matched.material) {
            setMaterial(matched.material);
          }
        }).catch(() => {});
      }
    }
  }, [location.state, searchParams]);

  useEffect(() => {
    const handleSlipChange = (e) => {
      const veh = e?.detail?.vehicle;
      const mode = e?.detail?.mode || (localStorage.getItem('noris_loading_slip_completion_mode') || 'stay');
      if (veh) {
        if (mode === 'delete' || e.type === 'loading-slip-deleted') {
          setSlips(prev => prev.filter(s => (s.vehicle || s.vehicle_no || '').trim().toUpperCase() !== veh.trim().toUpperCase()));
        } else if (e?.detail?.finalWeight) {
          setSlips(prev => prev.map(s => {
            if ((s.vehicle || s.vehicle_no || '').trim().toUpperCase() === veh.trim().toUpperCase()) {
              return { ...s, weight: e.detail.finalWeight };
            }
            return s;
          }));
        }
      }
    };
    window.addEventListener('loading-slip-fulfilled', handleSlipChange);
    window.addEventListener('loading-slip-deleted', handleSlipChange);
    return () => {
      window.removeEventListener('loading-slip-fulfilled', handleSlipChange);
      window.removeEventListener('loading-slip-deleted', handleSlipChange);
    };
  }, []);

  const handleDeleteSlip = async (s) => {
    const slipId = s.uuid || s.dc_num || s.dcNum || s.vehicle_no || s.vehicle;
    if (api.deleteLoadingSlip && slipId) {
      await api.deleteLoadingSlip(slipId).catch(console.error);
    }
    setSlips(prev => prev.filter(item => item !== s && (item.dcNum || item.dc_num) !== (s.dcNum || s.dc_num)));
    window.dispatchEvent(new CustomEvent('loading-slip-deleted', { detail: { slipId, vehicle: s.vehicle } }));
    setMsg('Loading slip deleted.');
    setTimeout(() => setMsg(''), 3000);
  };

  const loadMasterData = () => {
    // Load registered parties from debitors master
    if (api.getDebitors) {
      api.getDebitors()
        .then(debitors => {
          setAllDebitors(debitors || []);
          const names = (debitors || []).map(d => d.party).filter(Boolean);
          const unique = [...new Set(['LOCAL SALE', ...names])];
          setPartiesList(unique);
        })
        .catch(err => {
          console.error('[LoadingSlip] Error loading debitors:', err);
        });
    }

    // Load materials from master data
    if (api.getMaterials) {
      api.getMaterials()
        .then(mats => {
          setAllMaterials(mats || []);
        })
        .catch(err => console.error('[LoadingSlip] Error loading materials:', err));
    }

    // Load sources from master data
    if (api.getSources) {
      api.getSources()
        .then(srcs => {
          const names = (srcs || []).map(s => s.sourceName || s.source).filter(Boolean);
          setSourcesList([...new Set(names)]);
        })
        .catch(err => console.error('[LoadingSlip] Error loading sources:', err));
    }

    // Load destinations from master data
    if (api.getDestinations) {
      api.getDestinations()
        .then(dests => {
          setAllDestinations(dests || []);
        })
        .catch(err => console.error('[LoadingSlip] Error loading destinations:', err));
    }

    // Load active loading slips from database if available
    if (api.getLoadingSlips) {
      api.getLoadingSlips()
        .then(res => {
          if (Array.isArray(res) && res.length > 0) {
            setSlips(res.map(s => ({
              ...s,
              dcNum: s.dc_num || s.dcNum || '',
              vehicle: s.vehicle_no || s.vehicle || ''
            })));
          }
        })
        .catch(err => console.error('[LoadingSlip] Error loading slips:', err));
    }
  };

  useEffect(() => {
    loadMasterData();

    // Listen for live background master data syncs
    if (window.electronAPI?.onMasterDataSynced) {
      const unsub = window.electronAPI.onMasterDataSynced(() => {
        loadMasterData();
      });
      return () => {
        if (unsub) unsub();
      };
    }
  }, []);

  // Auto-fill phone whenever selected Party changes or debitors list updates
  useEffect(() => {
    if (!party) return;
    const isLocal = party.trim().toUpperCase() === 'LOCAL SALE' || party.trim().toUpperCase().startsWith('LOCAL SALE');
    if (isLocal) return;

    const partyUpper = party.trim().toUpperCase();
    const matched = (allDebitors || []).find(
      d => d.party && d.party.trim().toUpperCase() === partyUpper
    );
    if (matched) {
      const partyPhone = matched.phone || matched.phoneNumber || matched.mobile || matched.contact_number || '';
      if (partyPhone) {
        setPhone(String(partyPhone).trim());
      }
    }
  }, [party, allDebitors]);

  const isLocalSale = (party || '').trim().toUpperCase() === 'LOCAL SALE';

  // Dynamically update available materials based on selected Party
  useEffect(() => {
    const allMatNames = [...new Set(allMaterials.map(m => m.material))].filter(Boolean);
    const fallbackList = allMatNames.length > 0
      ? allMatNames
      : ['BOULDERS', 'STONE AGGREGATE', '10MM', '20MM', '40MM', 'GSB', 'WMM', 'STONE DUST'];

    if (!party) {
      setAvailableMaterials(fallbackList);
      return;
    }

    const partyUpper = party.trim().toUpperCase();
    const matched = allMaterials.filter(
      m => m.party && m.party.trim().toUpperCase() === partyUpper
    );

    if (matched.length > 0) {
      const names = [...new Set(matched.map(m => m.material))].filter(Boolean);
      setAvailableMaterials(names);
    } else {
      setAvailableMaterials(fallbackList);
    }
  }, [party, allMaterials]);

  // Dynamically update available destinations based on selected Party
  useEffect(() => {
    const partyUpper = (party || '').trim().toUpperCase();
    const isLocalSale = partyUpper === 'LOCAL SALE' || partyUpper.startsWith('LOCAL SALE');
    const matchedDestinations = allDestinations.filter(
      d => d.party && d.party.trim().toUpperCase() === partyUpper
    );

    let destNames = [];
    if (matchedDestinations.length > 0) {
      destNames = [...new Set(matchedDestinations.map(d => d.destination || d.destinationName))].filter(Boolean);
    } else {
      destNames = [...new Set(allDestinations.map(d => d.destination || d.destinationName))].filter(Boolean);
    }

    const combinedDests = [...new Set(['OUT', ...destNames])];
    setAvailableDestinations(combinedDests);
  }, [party, allDestinations]);

  const handleSave = async (e) => {
    e.preventDefault();
    const cleanVehicle = (vehicle || '').trim().toUpperCase();
    const cleanVehAlpha = cleanVehicle.replace(/[\s\-\.]/g, '');
    if (!cleanVehicle || cleanVehAlpha === 'N/A' || cleanVehAlpha === 'NA' || cleanVehAlpha === 'NONE' || cleanVehAlpha.length === 0) {
      setMsg('Please enter a valid Vehicle Number.');
      setTimeout(() => setMsg(''), 4000);
      return;
    }

    const selectedParty = (party || '').trim();
    if (!selectedParty) {
      setMsg('Please select a Party.');
      setTimeout(() => setMsg(''), 4000);
      return;
    }

    const finalParty = isLocalSale
      ? (localPartyName.trim() ? `LOCAL SALE - ${localPartyName.trim()}` : 'LOCAL SALE')
      : selectedParty;

    const finalWeight = (currentLiveNum > 0 ? String(currentLiveNum) : 'Pending');
    
    const draftSlip = {
      copy_num: '',
      vehicle_no: cleanVehicle,
      vehicle: cleanVehicle,
      party: finalParty,
      material: material || 'BOULDERS',
      destination: destination || '',
      source: source || '',
      transporter: '',
      payment: (payment && payment.trim()) ? payment.trim() : 'Credit',
      phone: phone || '',
      weight: finalWeight
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
      setMsg(`✓ Loading Slip ${officialDc} Saved Successfully!`);
      window.dispatchEvent(new CustomEvent('loading-slip-saved', { detail: newSlip }));
      setTimeout(() => setMsg(''), 4000);
      setVehicle('');
      setParty('');
      setLocalPartyName('');
      setMaterial('');
      setDestination('');
      setSource('');
      setPhone('');
    } catch (err) {
      console.error('[LoadingSlip] Error saving loading slip:', err);
      setMsg('Error saving loading slip into database.');
      setTimeout(() => setMsg(''), 4000);
    }
  };

  return (
    <div className="container-fluid p-0 animate-fade-in" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
      <style>{`
        .saas-card {
          background: #ffffff;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 0.85rem 1.1rem;
          margin-bottom: 0.5rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .saas-header {
          border-bottom: 1.5px solid var(--line-soft);
          padding-bottom: 0.45rem;
          margin-bottom: 0.65rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .saas-title {
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--ink);
          text-transform: uppercase;
        }
        .saas-label {
          font-size: 0.68rem;
          font-weight: 600;
          color: var(--ink-label);
          text-transform: uppercase;
          margin-bottom: 0.15rem;
          display: block;
        }
        .saas-input {
          font-size: 0.78rem !important;
          border-radius: 4px !important;
          border: 1px solid var(--line-strong) !important;
          padding: 0.3rem 0.55rem !important;
          height: 32px !important;
          color: #111827 !important;
          background-color: #ffffff !important;
        }
        .form-select.saas-input {
          padding-right: 2.2rem !important;
          color: #111827 !important;
          background-color: #ffffff !important;
          font-weight: 600 !important;
          font-size: 0.82rem !important;
          line-height: 1.3 !important;
        }
        .form-select.saas-input option {
          color: #111827 !important;
          background-color: #ffffff !important;
          font-weight: 500 !important;
          font-size: 0.82rem !important;
          padding: 4px 6px !important;
        }
        .saas-btn {
          font-size: 0.78rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.35rem 1rem;
          height: 32px;
        }
      `}</style>

      <div className="row g-3">
        {/* Form Column */}
        <div className="col-md-5">
          <div className="saas-card">
            <div className="saas-header">
              <span className="saas-title">Sales Order Generator</span>
            </div>

            {msg && (
              <div 
                className={`alert ${/error/i.test(msg) ? 'alert-danger' : 'alert-success'} py-1.5 px-3 mb-2 shadow-sm animate-fade-in`} 
                role="alert" 
                style={{ fontSize: '0.78rem', borderRadius: '4px' }}
              >
                {msg}
              </div>
            )}

            <form onSubmit={handleSave} className="row g-2">
              <div className={isLocalSale ? "col-6" : "col-12"}>
                <label className="saas-label">Party</label>
                <SearchableSelect
                  className="saas-input"
                  value={party}
                  onChange={(val) => {
                    setParty(val);
                    const isLocal = (val || '').trim().toUpperCase() === 'LOCAL SALE' || (val || '').trim().toUpperCase().startsWith('LOCAL SALE');
                    if (isLocal) {
                      setPayment('Cash');
                    } else {
                      setLocalPartyName('');
                      if (val) {
                        setPayment('Credit');
                      }
                      const matched = (allDebitors || []).find(
                        d => d.party && d.party.trim().toUpperCase() === (val || '').trim().toUpperCase()
                      );
                      if (matched) {
                        const partyPhone = matched.phone || matched.phoneNumber || matched.mobile || matched.contact_number || '';
                        if (partyPhone) {
                          setPhone(String(partyPhone).trim());
                        }
                      }
                    }
                  }}
                  options={partiesList}
                  placeholder="Select Party..."
                  allowCustom={true}
                  required
                />
              </div>

              {isLocalSale && (
                <div className="col-6 animate-fade-in">
                  <label className="saas-label">
                    Customer Name <span className="text-muted fw-normal text-lowercase">(local)</span>
                  </label>
                  <input
                    type="text"
                    className="form-control saas-input"
                    style={{ textTransform: 'uppercase' }}
                    placeholder="Customer Name..."
                    value={localPartyName}
                    onChange={(e) => setLocalPartyName(e.target.value.toUpperCase())}
                    autoFocus
                  />
                </div>
              )}

              <div className="col-6">
                <label className="saas-label">Vehicle</label>
                <input
                  type="text"
                  className="form-control saas-input"
                  style={{ textTransform: 'uppercase' }}
                  placeholder="Vehicle No"
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="col-6">
                <label className="saas-label">Material</label>
                <SearchableSelect
                  className="saas-input"
                  value={material}
                  onChange={(val) => setMaterial(val)}
                  options={availableMaterials}
                  placeholder="Select Material..."
                  allowCustom={true}
                />
              </div>

              <div className="col-6">
                <label className="saas-label">Destination</label>
                <SearchableSelect
                  className="saas-input"
                  value={destination}
                  onChange={(val) => setDestination(val ? val.toUpperCase() : '')}
                  options={availableDestinations}
                  placeholder="Select Destination..."
                  allowCustom={true}
                />
              </div>

              <div className="col-6">
                <label className="saas-label">Source</label>
                <SearchableSelect
                  className="saas-input"
                  value={source}
                  onChange={(val) => setSource(val ? val.toUpperCase() : '')}
                  options={sourcesList}
                  placeholder="Select Source..."
                  allowCustom={true}
                />
              </div>

              <div className="col-6">
                <label className="saas-label">Payment Mode</label>
                <select
                  className="form-select saas-input"
                  style={{
                    color: '#111827',
                    backgroundColor: '#ffffff',
                    fontWeight: '600',
                    fontSize: '0.82rem',
                    lineHeight: '1.3',
                    paddingRight: '2.2rem',
                    cursor: 'pointer'
                  }}
                  value={payment || (isLocalSale ? 'Cash' : 'Credit')}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="Cash" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Cash</option>
                  <option value="Credit" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Credit</option>
                  <option value="UPI" style={{ color: '#111827', backgroundColor: '#ffffff' }}>UPI</option>
                  <option value="Pending" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Pending</option>
                </select>
              </div>

              <div className="col-6">
                <label className="saas-label">Phone</label>
                <input
                  type="text"
                  className="form-control saas-input"
                  placeholder="Phone No"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="col-6">
                <label className="saas-label d-flex justify-content-between align-items-center">
                  <span>WEIGHT (KG)</span>
                  {currentLiveNum > 0 && (
                    <span className="text-success fw-bold" style={{ fontSize: '0.68rem', letterSpacing: '0.02em' }}>
                      • LIVE: {Number(currentLiveNum).toLocaleString()}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  className="form-control saas-input font-monospace fw-bold saas-input-readonly"
                  value={currentLiveNum > 0 ? String(currentLiveNum) : 'Pending'}
                  readOnly
                  tabIndex="-1"
                  style={{ backgroundColor: 'var(--surface-2)', cursor: 'not-allowed' }}
                />
              </div>

              <div className="col-12 d-flex gap-2 mt-2 justify-content-end">
                <button type="button" className="btn btn-outline-secondary saas-btn flex-fill">Re Print</button>
                <button type="submit" className="btn btn-primary saas-btn flex-fill px-3">Save</button>
              </div>
            </form>
          </div>
        </div>

        {/* Table Column */}
        <div className="col-md-7">
          <div className="table-card saas-card" style={{ height: '100%' }}>
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
                  {slips.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center text-muted py-3" style={{ fontSize: '0.78rem' }}>
                        No active orders or slips found.
                      </td>
                    </tr>
                  ) : (
                    slips.map((s, idx) => (
                      <tr key={idx}>
                        <td className="fw-bold">{s.dcNum}</td>
                        <td className="fw-semibold text-primary">{s.vehicle}</td>
                        <td>{s.party}</td>
                        <td>{s.material}</td>
                        <td>{s.destination}</td>
                        <td><span className="badge bg-light border text-dark">{s.payment}</span></td>
                        <td className={`text-end fw-semibold ${s.weight && s.weight !== 'Pending' ? 'text-dark' : 'text-danger'}`}>
                          {s.weight && !isNaN(Number(String(s.weight).replace(/,/g, ''))) && Number(String(s.weight).replace(/,/g, '')) > 0
                            ? Number(String(s.weight).replace(/,/g, '')).toLocaleString()
                            : (s.weight || 'Pending')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
