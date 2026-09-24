import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import norisLogo from '../assets/logo.jpg';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // LAN Settings Modal state on Login Page
  const [showNetModal, setShowNetModal] = useState(false);
  const [netForm, setNetForm] = useState({ mode: 'HOST', hostIp: '127.0.0.1', hostPort: 5000 });
  const [netTest, setNetTest] = useState(null);

  const openNetModal = async () => {
    if (window.electronAPI && window.electronAPI.getNetworkConfig) {
      try {
        const cfg = await window.electronAPI.getNetworkConfig();
        if (cfg) setNetForm({ mode: cfg.mode || 'HOST', hostIp: cfg.hostIp || '127.0.0.1', hostPort: cfg.hostPort || 5000 });
      } catch (e) {
        console.error('Error fetching network config on login:', e);
      }
    }
    setNetTest(null);
    setShowNetModal(true);
  };

  const handleTestConnection = async () => {
    setNetTest({ testing: true, success: false, msg: 'Testing connection to Host PC...' });
    try {
      if (window.electronAPI && window.electronAPI.testHostConnection) {
        const res = await window.electronAPI.testHostConnection({ hostIp: netForm.hostIp, hostPort: netForm.hostPort });
        if (res.success) {
          setNetTest({ testing: false, success: true, msg: `Connected successfully to Host PC (${netForm.hostIp}:${netForm.hostPort})!` });
        } else {
          setNetTest({ testing: false, success: false, msg: `Connection Failed: ${res.error}` });
        }
      }
    } catch (e) {
      setNetTest({ testing: false, success: false, msg: `Error testing connection: ${e.message}` });
    }
  };

  const handleSaveNetwork = async () => {
    try {
      if (window.electronAPI && window.electronAPI.saveNetworkConfig) {
        await window.electronAPI.saveNetworkConfig(netForm);
      }
      setShowNetModal(false);
    } catch (e) {
      console.error('Error saving network config:', e);
    }
  };

  async function submit() {
    setErr(null); setBusy(true);
    try { await login(username, password); navigate('/'); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="noris-login">
      {/* Brand / marketing panel — hidden below 992px */}
      <aside className="noris-login__aside">
        <div className="noris-login__brand">
          <div className="noris-login__mark">
            <img src={norisLogo} alt="Noris" />
          </div>
          <div>
            <b>NORIS</b>
            <span>Weighbridge System</span>
          </div>
        </div>

        <div className="noris-login__pitch">
          <h1>Command your weighbridge<br />and site cameras in one place.</h1>
          <p>Live weight capture, RTSP camera monitoring, and complete
             weighment records — built for the plant floor.</p>
        </div>

        <div className="noris-login__stats">
          <div className="noris-login__stat">
            <b>Live</b>
            <span>Weight Feed</span>
          </div>
          <div className="noris-login__stat">
            <b>RTSP</b>
            <span>Camera Grid</span>
          </div>
          <div className="noris-login__stat">
            <b>24×7</b>
            <span>Operations</span>
          </div>
        </div>
      </aside>

      {/* Sign-in panel */}
      <main className="noris-login__panel">
        <div className="noris-login__card">
          <h2>Sign in</h2>
          <p className="sub">Enter your credentials to continue.</p>

          {err && <div className="alert alert-danger py-2">{err}</div>}

          <div className="noris-login__field">
            <label htmlFor="noris-user">Username</label>
            <input
              id="noris-user"
              className="form-control"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="noris-login__field">
            <label htmlFor="noris-pass">Password</label>
            <div className="position-relative d-flex align-items-center">
              <input
                id="noris-pass"
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                style={{ paddingRight: '40px' }}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="btn position-absolute end-0 p-0 border-0 bg-transparent text-secondary d-flex align-items-center justify-content-center"
                style={{ width: '38px', height: '100%', cursor: 'pointer', zIndex: 5 }}
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button className="btn btn-primary w-100 btn-lg mt-2" onClick={submit} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>

          <div className="text-center mt-3">
            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none text-secondary fw-semibold"
              onClick={openNetModal}
            >
              🌐 LAN Multi-PC Settings
            </button>
          </div>

          <div className="noris-login__foot">
            NORIS CCTV · Weighbridge Operations Console
          </div>
        </div>
      </main>

      {/* LAN Network Settings Modal on Login Screen */}
      {showNetModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg border-0" style={{ borderRadius: '12px' }}>
              <div className="modal-header border-0 bg-light py-3 px-4">
                <h5 className="modal-title fw-bold text-dark fs-6 mb-0">🌐 LAN Multi-PC Network Settings</h5>
                <button type="button" className="btn-close" onClick={() => setShowNetModal(false)}></button>
              </div>
              <div className="modal-body p-4 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-bold text-dark mb-1" style={{ fontSize: '0.82rem' }}>PC Role:</label>
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className={`btn btn-sm flex-fill fw-semibold ${netForm.mode === 'HOST' ? 'btn-success' : 'btn-outline-secondary'}`}
                      onClick={() => setNetForm({ ...netForm, mode: 'HOST' })}
                    >
                      🖥️ HOST PC
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm flex-fill fw-semibold ${netForm.mode === 'CLIENT' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setNetForm({ ...netForm, mode: 'CLIENT' })}
                    >
                      💻 CLIENT PC
                    </button>
                  </div>
                </div>

                {netForm.mode === 'CLIENT' && (
                  <div>
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.82rem' }}>Host PC IP Address</label>
                    <input
                      type="text"
                      className="form-control form-control-sm fw-bold border-secondary-subtle"
                      value={netForm.hostIp}
                      onChange={(e) => setNetForm({ ...netForm, hostIp: e.target.value })}
                      placeholder="e.g. 10.56.175.46 or 192.168.0.206"
                    />
                  </div>
                )}

                <div className="d-flex gap-2 align-items-center">
                  {netForm.mode === 'CLIENT' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary fw-semibold px-3"
                      onClick={handleTestConnection}
                      disabled={netTest?.testing}
                    >
                      {netTest?.testing ? 'Testing...' : '⚡ Test Connection'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-success fw-bold ms-auto px-4"
                    onClick={handleSaveNetwork}
                  >
                    💾 Save & Close
                  </button>
                </div>

                {netTest && (
                  <div className={`alert ${netTest.success ? 'alert-success' : 'alert-danger'} py-2 px-3 mb-0 fs-7`}>
                    {netTest.msg}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
