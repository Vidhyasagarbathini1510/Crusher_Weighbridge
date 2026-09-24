import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import CameraPlayer from '../components/CameraPlayer.jsx';
import Loader from '../components/Loader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import './dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const [cameras, setCameras] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [now, setNow] = useState(new Date());
  const [scaleStatus, setScaleStatus] = useState('online');
  const [dbStatus, setDbStatus] = useState('online');

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchDashboardData = () => {
    api.cameras().then(setCameras).catch(() => setCameras([]));

    Promise.all([
      api.transactions().catch(() => []),
      api.salesUnits ? api.salesUnits().catch(() => []) : Promise.resolve([]),
      api.boulders ? api.boulders().catch(() => []) : (api.getBoulders ? api.getBoulders().catch(() => []) : Promise.resolve([])),
      api.yardWeighments ? api.yardWeighments().catch(() => []) : Promise.resolve([]),
      api.firstWeighments ? api.firstWeighments().catch(() => []) : Promise.resolve([]),
      api.secondWeighments ? api.secondWeighments().catch(() => []) : Promise.resolve([])
    ]).then(([allTx, salesUnits, boulders, yard, firstWeigh, secondWeigh]) => {
      const combinedMap = new Map();

      const addRecords = (records, type) => {
        if (!records || !Array.isArray(records)) return;
        records.forEach(r => {
          const key = r.uuid || `${type}-${r.id || r.dc_num || r.dcNum || r.token}-${r.vehicle_no || r.vehicle}`;
          if (!combinedMap.has(key)) {
            combinedMap.set(key, { ...r, _sourceTable: type });
          } else {
            const existing = combinedMap.get(key);
            const merged = { ...existing, ...r };
            if (!existing.image_base64 && r.image_base64) {
              merged.image_base64 = r.image_base64;
              merged.image_path = r.image_path;
            }
            combinedMap.set(key, merged);
          }
        });
      };

      addRecords(allTx, 'transactions');
      addRecords(salesUnits, 'sales_units');
      addRecords(boulders, 'boulders');
      addRecords(yard, 'yard');
      addRecords(firstWeigh, 'first_weighments');
      addRecords(secondWeigh, 'second_weighments');

      const processed = Array.from(combinedMap.values());

      const parseDt = (str) => {
        if (!str) return 0;
        const s = String(str).trim();
        const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (dmy) {
          let p1 = parseInt(dmy[1], 10);
          let p2 = parseInt(dmy[2], 10);
          const y = parseInt(dmy[3], 10);
          const hh = parseInt(dmy[4] || '0', 10);
          const mm = parseInt(dmy[5] || '0', 10);
          const ss = parseInt(dmy[6] || '0', 10);
          let day, month;
          if (p1 <= 12 && p2 > 12) { month = p1; day = p2; }
          else { day = p1; month = p2; }
          return new Date(y, month - 1, day, hh, mm, ss).getTime();
        }
        const d = new Date(s);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };

      processed.sort((a, b) => parseDt(b.date_time || b.created_at || b.id) - parseDt(a.date_time || a.created_at || a.id));

      setTransactions(processed);
      setDbStatus('online');
    }).catch(err => {
      console.error('[Dashboard] Error fetching transactions:', err);
      setTransactions([]);
      setDbStatus('offline');
    });
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 5000);

    const onRefresh = () => fetchDashboardData();
    window.addEventListener('page-refresh', onRefresh);

    let unsubscribeSync = null;
    if (window.electronAPI && window.electronAPI.onMasterDataSynced) {
      unsubscribeSync = window.electronAPI.onMasterDataSynced(() => {
        fetchDashboardData();
      });
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('page-refresh', onRefresh);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && typeof data.value === 'string' && data.value.includes('Offline')) {
        setScaleStatus('offline');
      } else {
        setScaleStatus('online');
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const toggleTileFullscreen = (el) => {
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };

  const fmtTime = (d) => d.toLocaleTimeString('en-GB', { hour12: false });
  const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const isToday = (dateStr) => {
    if (!dateStr) return false;
    const str = String(dateStr).trim();
    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;
    const todayYear = today.getFullYear();

    // 1. DD-MM-YYYY or DD/MM/YYYY (Indian format)
    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
      let p1 = parseInt(dmy[1], 10);
      let p2 = parseInt(dmy[2], 10);
      const y = parseInt(dmy[3], 10);
      let day, month;
      if (p1 <= 12 && p2 > 12) {
        month = p1;
        day = p2;
      } else {
        day = p1;
        month = p2;
      }
      return day === todayDay && month === todayMonth && y === todayYear;
    }

    // 2. YYYY-MM-DD or YYYY/MM/DD
    const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymd) {
      const year = parseInt(ymd[1], 10);
      const month = parseInt(ymd[2], 10);
      const day = parseInt(ymd[3], 10);
      return day === todayDay && month === todayMonth && year === todayYear;
    }

    // 3. Fallback standard Date
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.getDate() === todayDay &&
             (d.getMonth() + 1) === todayMonth &&
             d.getFullYear() === todayYear;
    }

    return false;
  };

  if (!cameras) return <Loader label="Loading weighbridge workspace…" />;

  const todayTransactions = transactions.filter(t => isToday(t.date_time || t.created_at));

  // Analytics calculations (today's only for cards)
  const totalWeightNet = todayTransactions.reduce((acc, t) => acc + (parseFloat(t.net) || 0), 0);
  const avgNet = todayTransactions.length ? Math.round(totalWeightNet / todayTransactions.length) : 0;
  const recentTxs = transactions.slice(0, 8);
  const totalGross = todayTransactions.reduce((a, t) => a + (parseFloat(t.gross) || 0), 0);
  const totalTare = todayTransactions.reduce((a, t) => a + (parseFloat(t.tare) || 0), 0);

  // Group today's transactions by material
  const materialStats = todayTransactions.reduce((acc, t) => {
    const mat = (t.product || t.material || 'BOULDERS').toUpperCase();
    acc[mat] = (acc[mat] || 0) + (parseFloat(t.net) || 0);
    return acc;
  }, {});

  // Responsive camera column sizing (presentation only)
  const camCols =
    cameras.length <= 1 ? 'col-12'
    : cameras.length <= 4 ? 'col-12 col-md-6'
    : 'col-12 col-md-6 col-xl-4';

  const kpis = [
    {
      key: 'tx', label: 'Total Transactions', tone: 'primary',
      value: todayTransactions.length.toLocaleString(), sub: 'Recorded today',
      icon: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>),
    },
    {
      key: 'net', label: 'Net Dispatched', tone: 'success',
      value: (totalWeightNet || 0).toLocaleString(), unit: 'KG',
      sub: `${(totalWeightNet / 1000).toFixed(2)} Tonnes`,
      icon: (<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />),
    },
    {
      key: 'avg', label: 'Average / Ticket', tone: 'info',
      value: (avgNet || 0).toLocaleString(), unit: 'KG', sub: 'Per weighment',
      icon: (<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>),
    },
    {
      key: 'cam', label: 'Cameras Online', tone: 'warning',
      value: cameras.length.toLocaleString(), sub: 'Live streams',
      icon: (<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
    },
  ];

  return (
    <div className="wb wb-dash">
      <style>{styles}</style>

      {/* ── KPI row ─────────────────────────────────────────────────── */}
      <div className="wb-kpi-row">
        {kpis.map((k) => (
          <div className={`wb-kpi tone-${k.tone}`} key={k.key}>
            <div className="wb-kpi-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{k.icon}</svg>
            </div>
            <div className="wb-kpi-body">
              <div className="wb-kpi-label">{k.label}</div>
              <div className="wb-kpi-val">{k.value}{k.unit && <span className="wb-kpi-unit">{k.unit}</span>}</div>
              <div className="wb-kpi-sub">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main grid: cameras + right rail ─────────────────────────── */}
      <div className="row g-3">
        {/* Live CCTV */}
        <div className="col-12 col-lg-8">
          <div className="wb-card h-100">
            <div className="wb-card-head">
              <h6 className="wb-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Live CCTV Camera Center
              </h6>
              <span className="wb-count-pill">{cameras.length} Online</span>
            </div>

            <div className="p-3">
              <div className="row g-2">
                {cameras.map((c, index) => (
                  <div key={c.id} className={camCols}>
                    <div className="camera-tile">
                      <CameraPlayer camera={c} />
                      <span className="wb-tile-live"><i />LIVE</span>
                      <button
                        type="button"
                        className="wb-tile-fs"
                        title="Toggle fullscreen"
                        onClick={(e) => toggleTileFullscreen(e.currentTarget.closest('.camera-tile'))}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                        </svg>
                      </button>
                      <span className="wb-tile-name">CAM {index + 1}: {c.name.toUpperCase()}</span>
                    </div>
                  </div>
                ))}

                {cameras.length === 0 && (
                  <div className="col-12">
                    <div className="wb-empty">
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      <div>No active camera streams configured.</div>
                      <span>Add cameras from the Manage Cameras screen.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right rail: tonnage + device health */}
        <div className="col-12 col-lg-4 d-flex flex-column gap-3">
          <div className="wb-card">
            <div className="wb-card-head">
              <h6 className="wb-card-title">Tonnage Summary</h6>
              <span className="wb-count-pill soft">Live</span>
            </div>
            <div className="wb-ton">
              <div className="wb-ton-row">
                <span>Total Gross</span>
                <b>{totalGross.toLocaleString()} <i>kg</i></b>
              </div>
              <div className="wb-ton-row">
                <span>Total Tare</span>
                <b className="muted">{totalTare.toLocaleString()} <i>kg</i></b>
              </div>
              <div className="wb-ton-row net">
                <span>Net Dispatched</span>
                <b>{(totalWeightNet || 0).toLocaleString()} <i>kg</i></b>
              </div>
            </div>
          </div>

          <div className="wb-card flex-grow-1">
            <div className="wb-card-head">
              <h6 className="wb-card-title">Device &amp; Network Health</h6>
            </div>
            <div className="wb-health-list">
              <div className="wb-health-row">
                <span>Scale Indicator (Netron)</span>
                <StatusBadge state={scaleStatus} />
              </div>
              <div className="wb-health-row">
                <span>CCTV Camera Feed</span>
                <span className="wb-count-pill success">{cameras.length} Active</span>
              </div>
              <div className="wb-health-row">
                <span>Local SQLite Database</span>
                <StatusBadge state={dbStatus} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent transactions + material breakdown ────────────────── */}
      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div className="wb-card h-100">
            <div className="wb-card-head">
              <h6 className="wb-card-title">Recent Transactions</h6>
              <span className="wb-link" onClick={() => navigate('/reports')}>View all</span>
            </div>
            <div className="wb-tbl-wrap">
              <table className="fluent-table">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Material</th>
                    <th className="text-end">Net Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTxs.map((t, idx) => (
                    <tr key={t.uuid || `${t._sourceTable || 'tx'}-${t.id || idx}`}>
                      <td>
                        <div className="fw-bold font-monospace">{t.vehicle_no || t.vehicle}</div>
                        <div className="wb-tbl-sub">{t.date_time || fmtDate(now)}</div>
                      </td>
                      <td><span className="wb-mat-chip">{t.product || t.material || 'BOULDERS'}</span></td>
                      <td className="text-end fw-bold wb-tbl-net">{(parseFloat(t.net) || 0).toLocaleString()} kg</td>
                    </tr>
                  ))}
                  {recentTxs.length === 0 && (
                    <tr>
                      <td colSpan="3" className="wb-tbl-empty">No recent transactions recorded</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="wb-card h-100">
            <div className="wb-card-head">
              <h6 className="wb-card-title">Material Volume</h6>
            </div>
            <div className="p-3">
              {Object.keys(materialStats).length === 0 ? (
                <div className="wb-tbl-empty">No material data recorded today.</div>
              ) : (
                Object.entries(materialStats).map(([mat, wt]) => (
                  <div className="wb-mat" key={mat}>
                    <div className="wb-mat-top">
                      <span>{mat}</span>
                      <b>{(wt || 0).toLocaleString()} KG</b>
                    </div>
                    <div className="wb-mat-track">
                      <i style={{ width: `${Math.min(100, Math.max(10, totalWeightNet ? (wt / totalWeightNet) * 100 : 50))}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Page-scoped styles (under .wb-dash). Tokens come from the design system.
   ─────────────────────────────────────────────────────────────────────── */
const styles = `
.wb-dash { padding-bottom: 24px; gap: 18px; }

/* Header */
.wb-dash-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.wb-dash-eyebrow { display: inline-block; font-size: .68rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--primary); margin-bottom: 3px; }
.wb-dash-title { margin: 0; font-size: 1.4rem; font-weight: 800; letter-spacing: -.02em; color: var(--ink); }
.wb-time-chip {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 14px; background: var(--surface); border: 1px solid var(--line);
  border-radius: 10px; box-shadow: var(--shadow-xs); color: var(--primary);
}
.wb-time-chip > div { display: flex; flex-direction: column; line-height: 1.15; }
.wb-time-chip b { font-size: .92rem; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.wb-time-chip span { font-size: .66rem; font-weight: 600; color: var(--ink-mute); }

/* KPI row */
.wb-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.wb-kpi {
  display: flex; align-items: center; gap: 14px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow-xs);
  position: relative; overflow: hidden;
}
.wb-kpi::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--primary); }
.wb-kpi.tone-primary::before { background: var(--primary); }
.wb-kpi.tone-success::before { background: var(--success); }
.wb-kpi.tone-info::before    { background: var(--info); }
.wb-kpi.tone-warning::before { background: var(--warning); }
.wb-kpi-ic { width: 46px; height: 46px; flex: 0 0 auto; border-radius: 11px; display: grid; place-items: center; }
.wb-kpi.tone-primary .wb-kpi-ic { color: var(--primary);   background: var(--primary-soft); }
.wb-kpi.tone-success .wb-kpi-ic { color: var(--success-ink); background: var(--success-soft); }
.wb-kpi.tone-info .wb-kpi-ic    { color: #0B7EA8;          background: #E6F6FD; }
.wb-kpi.tone-warning .wb-kpi-ic { color: var(--warning-ink); background: var(--warning-soft); }
.wb-kpi-label { font-size: .66rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-mute); }
.wb-kpi-val { font-size: 1.55rem; font-weight: 800; color: var(--ink); line-height: 1.1; margin-top: 2px; font-variant-numeric: tabular-nums; }
.wb-kpi-unit { font-size: .74rem; font-weight: 700; color: var(--ink-mute); margin-left: 4px; }
.wb-kpi-sub { font-size: .72rem; font-weight: 600; color: var(--ink-soft); margin-top: 2px; }

/* Count pills */
.wb-count-pill { font-size: .68rem; font-weight: 800; letter-spacing: .02em; color: var(--primary-ink); background: var(--primary-soft); border: 1px solid #DCE7FF; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.wb-count-pill.soft { color: var(--ink-soft); background: var(--surface-3); border-color: var(--line); }
.wb-count-pill.success { color: var(--success-ink); background: var(--success-soft); border-color: #BFE6CD; }

/* Camera tiles */
.wb-dash .camera-tile { border-radius: 10px; }
.wb-tile-live { position: absolute; top: 8px; left: 8px; z-index: 4; display: inline-flex; align-items: center; gap: 5px; font-size: .58rem; font-weight: 800; letter-spacing: .08em; padding: 3px 8px; border-radius: 5px; background: rgba(239,68,68,.92); color: #fff; }
.wb-tile-live i { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: wb-blink 1s steps(2) infinite; }
@keyframes wb-blink { 50% { opacity: .25; } }
.wb-tile-name { position: absolute; left: 8px; bottom: 8px; z-index: 4; font-size: .62rem; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.wb-tile-fs { position: absolute; top: 8px; right: 8px; z-index: 5; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; cursor: pointer; color: #fff; background: rgba(10,18,32,.55); border: 1px solid rgba(255,255,255,.25); opacity: 0; transition: opacity .15s ease, background .15s ease; }
.camera-tile:hover .wb-tile-fs { opacity: 1; }
.wb-tile-fs:hover { background: var(--primary); border-color: var(--primary); }

.wb-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 46px 16px; color: var(--ink-mute); background: var(--surface-2); border: 1px dashed var(--line-strong); border-radius: 10px; }
.wb-empty div { font-size: .86rem; font-weight: 700; color: var(--ink-soft); }
.wb-empty span { font-size: .74rem; }

/* Tonnage summary */
.wb-ton { padding: 6px 4px; }
.wb-ton-row { display: flex; align-items: center; justify-content: space-between; padding: 11px 16px; font-size: .82rem; border-bottom: 1px solid var(--line); }
.wb-ton-row:last-child { border-bottom: none; }
.wb-ton-row span { color: var(--ink-soft); font-weight: 600; }
.wb-ton-row b { color: var(--ink); font-weight: 800; font-variant-numeric: tabular-nums; }
.wb-ton-row b i { font-style: normal; font-size: .7rem; color: var(--ink-mute); font-weight: 700; }
.wb-ton-row b.muted { color: var(--ink-soft); }
.wb-ton-row.net { background: var(--success-soft); border-radius: 8px; margin: 4px 8px 0; padding: 12px 12px; }
.wb-ton-row.net span { color: var(--success-ink); font-weight: 800; }
.wb-ton-row.net b { color: var(--success-ink); font-size: 1.02rem; }

/* Device health */
.wb-health-list { padding: 4px 0; }
.wb-health-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; font-size: .82rem; font-weight: 700; color: var(--ink); border-bottom: 1px solid var(--line); }
.wb-health-row:last-child { border-bottom: none; }

/* Transactions table */
.wb-tbl-wrap { padding: 4px 6px 6px; max-height: 340px; overflow-y: auto; }
.wb-tbl-sub { font-size: .68rem; color: var(--ink-mute); font-variant-numeric: tabular-nums; }
.wb-tbl-net { color: var(--primary); font-variant-numeric: tabular-nums; }
.wb-mat-chip { display: inline-block; font-size: .68rem; font-weight: 700; color: var(--ink-soft); background: var(--surface-3); border: 1px solid var(--line); padding: 2px 9px; border-radius: 999px; }
.wb-tbl-empty { text-align: center; padding: 34px 12px; color: var(--ink-mute); font-size: .82rem; }

/* Material volume bars */
.wb-mat { margin-bottom: 14px; }
.wb-mat:last-child { margin-bottom: 0; }
.wb-mat-top { display: flex; justify-content: space-between; font-size: .76rem; font-weight: 800; color: var(--ink); margin-bottom: 6px; }
.wb-mat-top b { color: var(--primary-ink); font-variant-numeric: tabular-nums; }
.wb-mat-track { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.wb-mat-track i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--primary), #4E86F7); }

/* Responsive */
@media (max-width: 1200px) { .wb-kpi-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px)  { .wb-kpi-row { grid-template-columns: 1fr; } }
`;