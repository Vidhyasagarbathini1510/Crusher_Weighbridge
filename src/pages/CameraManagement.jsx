// CRUD for cameras: add, edit, delete. Calls the PHP endpoints.
import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Loader from '../components/Loader.jsx';
import { RTSP_BRANDS, STREAM_TYPES, buildStreamPath, buildRtspUrl, detectBrandFromPath, isCustomBrand } from '../utils/rtspBrands.js';

const EMPTY = { name: '', ip_address: '', rtsp_port: 554, stream_path: '/stream1', username: 'admin', password: '' };
const EMPTY_TEST = { status: 'idle', message: '' };

export default function CameraManagement() {
  const [cameras, setCameras] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState(null);

  // RTSP configuration is derived from these two choices instead of a typed path.
  const [brand, setBrand] = useState('hikvision');
  const [streamType, setStreamType] = useState('main');
  const [test, setTest] = useState(EMPTY_TEST);

  const load = () => api.cameras().then(setCameras).catch(() => setCameras([]));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // The path the brand dictates; for the custom brand the operator still types it.
  const generatedPath = isCustomBrand(brand) ? (form.stream_path || '') : buildStreamPath(brand, streamType);
  const effectiveForm = { ...form, stream_path: generatedPath };
  const previewUrl = buildRtspUrl(effectiveForm, { maskPassword: true });
  const canTest = Boolean(form.ip_address && generatedPath);

  const runTest = async () => {
    if (!canTest) {
      const result = { ok: false, message: 'Enter the IP address and choose a brand first.' };
      setTest({ status: 'failed', message: result.message });
      return result;
    }
    setTest({ status: 'testing', message: 'Testing RTSP connection...' });
    const result = await api.testCamera(buildRtspUrl(effectiveForm));
    setTest({ status: result.ok ? 'connected' : 'failed', message: result.message });
    return result;
  };

  // Re-test automatically whenever the generated URL changes, debounced so we
  // are not probing the camera on every keystroke.
  useEffect(() => {
    if (!canTest) { setTest(EMPTY_TEST); return; }
    let cancelled = false;
    setTest({ status: 'testing', message: 'Testing RTSP connection...' });
    const timer = setTimeout(async () => {
      const result = await api.testCamera(buildRtspUrl(effectiveForm));
      if (!cancelled) setTest({ status: result.ok ? 'connected' : 'failed', message: result.message });
    }, 900);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, streamType, generatedPath, form.ip_address, form.rtsp_port, form.username, form.password]);

  async function save() {
    // A new camera is only stored once its stream has actually answered.
    if (!editId) {
      const result = test.status === 'connected' ? { ok: true } : await runTest();
      if (!result.ok) {
        setMsg('Camera not saved — the RTSP stream did not connect. Fix the details and try again.');
        return;
      }
    }
    try {
      const payload = { ...form, stream_path: generatedPath };
      if (editId) await api.updateCamera({ id: editId, ...payload });
      else await api.addCamera(payload);
      setForm(EMPTY); setEditId(null); setBrand('hikvision'); setStreamType('main'); setTest(EMPTY_TEST);
      setMsg('Saved.'); load();
    } catch (e) { setMsg(e.message); }
  }
  async function remove(id) {
    setMsg('Deleting camera...');
    try {
      await api.deleteCamera(id);
      setMsg('Camera deleted.');
      load();
    } catch (e) {
      setMsg('Could not delete camera: ' + e.message);
    }
  }
  function edit(c) {
    const detected = detectBrandFromPath(c.stream_path);
    setBrand(detected.brand);
    setStreamType(detected.streamType);
    setTest(EMPTY_TEST);
    setEditId(c.id); setForm({ ...c, password: '' });
  }

  if (!cameras) return <Loader />;

  return (
    <div className="row g-3">
      <div className="col-lg-5">
        <div className="card p-3">
          <h6 className="fw-bold mb-3">{editId ? 'Edit Camera' : 'Add Camera'}</h6>
          {msg && <div className="alert alert-info py-1 mb-3">{msg}</div>}
          
          <div className="mb-2">
            <label className="form-label">Camera Name</label>
            <input className="form-control" placeholder="e.g. Front Gate" value={form.name} onChange={set('name')} />
          </div>

          <div className="mb-2">
            <label className="form-label">IP Address</label>
            <input className="form-control" placeholder="e.g. 192.168.1.100" value={form.ip_address} onChange={set('ip_address')} />
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="form-label">RTSP Port</label>
              <input className="form-control" placeholder="554" value={form.rtsp_port} onChange={set('rtsp_port')} />
            </div>
            <div className="col-6">
              <label className="form-label">Camera Brand</label>
              <select className="form-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
                {RTSP_BRANDS.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-2">
            <label className="form-label">Stream</label>
            <select className="form-select" value={streamType} onChange={(e) => setStreamType(e.target.value)} disabled={isCustomBrand(brand)}>
              {STREAM_TYPES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* The stream path is derived from the brand. Only the "Other" brand
              still needs it typed by hand. */}
          {isCustomBrand(brand) && (
            <div className="mb-2">
              <label className="form-label">Stream Path</label>
              <input className="form-control" placeholder="/stream1" value={form.stream_path} onChange={set('stream_path')} />
            </div>
          )}

          <div className="mb-2">
            <label className="form-label">Username</label>
            <input className="form-control" placeholder="admin" value={form.username} onChange={set('username')} />
          </div>

          <div className="mb-2">
            <label className="form-label">Password</label>
            <input type="password" className="form-control" placeholder="••••••••" value={form.password} onChange={set('password')} />
          </div>

          <div className="mb-3">
            <label className="form-label d-flex justify-content-between align-items-center">
              <span>RTSP URL (generated)</span>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary py-0"
                onClick={runTest}
                disabled={!canTest || test.status === 'testing'}
              >
                {test.status === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>
            </label>
            <input
              className="form-control bg-light"
              value={previewUrl || 'Enter the IP address to generate the URL'}
              readOnly
            />
            {test.status !== 'idle' && (
              <div
                className={`small mt-2 fw-semibold ${
                  test.status === 'connected' ? 'text-success' : test.status === 'testing' ? 'text-secondary' : 'text-danger'
                }`}
              >
                {test.status === 'connected' && '● Connected — '}
                {test.status === 'failed' && '● Failed — '}
                {test.message}
              </div>
            )}
          </div>

          <div className="d-flex gap-2">
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={test.status === 'testing' || (!editId && test.status !== 'connected')}
            >
              {editId ? 'Update Camera' : 'Add Camera'}
            </button>
            {editId && (
              <button className="btn btn-outline-secondary" onClick={() => { setEditId(null); setForm(EMPTY); setBrand('hikvision'); setStreamType('main'); setTest(EMPTY_TEST); }}>Cancel</button>
            )}
          </div>
        </div>
      </div>
      <div className="col-lg-7">
        <div className="card p-3">
          <h6 className="fw-bold mb-3">Configured Cameras</h6>
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th>Name</th>
                <th>IP Address</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cameras.length === 0 ? (
                <tr>
                  <td colSpan="4" className="text-center text-muted py-3">No cameras configured</td>
                </tr>
              ) : (
                cameras.map((c) => (
                  <tr key={c.id}>
                    <td className="fw-bold">{c.name}</td>
                    <td>{c.ip_address}</td>
                    <td><StatusBadge state={c.status} /></td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-outline-primary me-1" onClick={() => edit(c)}>Edit</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => remove(c.id)}>Del</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
