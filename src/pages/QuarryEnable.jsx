import React, { useState } from 'react';

export default function QuarryEnable() {
  const [quarries, setQuarries] = useState([]);
  const [quarryId, setQuarryId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [msg, setMsg] = useState('');

  const handleToggleActive = (e) => {
    e.preventDefault();
    if (!quarryId) {
      setMsg('Please enter Quarry ID');
      setTimeout(() => setMsg(''), 4000);
      return;
    }
    
    // Toggle active status for matches
    const updated = quarries.map(q => {
      if (q.id.toLowerCase() === quarryId.toLowerCase()) {
        return { ...q, status: isActive ? 'Active' : 'Inactive' };
      }
      return q;
    });

    setQuarries(updated);
    setMsg(`Quarry ${quarryId.toUpperCase()} status updated!`);
    setTimeout(() => setMsg(''), 4000);
    setQuarryId('');
  };

  return (
    <div className="container-fluid p-0 animate-fade-in" style={{ fontFamily: 'Segoe UI, sans-serif' }}>
      {msg && (
        <div className="alert alert-success alert-dismissible fade show py-2 px-3 mb-3 shadow-sm" role="alert" style={{ fontSize: '0.85rem' }}>
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}
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
        .saas-input {
          font-size: 0.8rem !important;
          border-radius: 4px !important;
          border: 1px solid var(--line-strong) !important;
          padding: 0.4rem 0.6rem !important;
        }
        .saas-btn-toggle {
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 4px;
          padding: 0.45rem 1.75rem;
        }
      `}</style>

      {/* Top Card - Action Panel */}
      <div className="saas-card">
        <div className="saas-header">
          <span className="saas-title">Quarry Enable/Disable Controller</span>
        </div>

        <form onSubmit={handleToggleActive} className="row g-2 align-items-end">
          <div className="col-md-4">
            <label className="saas-label">Quarry ID</label>
            <input type="text" className="form-control saas-input" placeholder="e.g. Q-01" value={quarryId} onChange={(e) => setQuarryId(e.target.value)} required />
          </div>
          <div className="col-md-3">
            <div className="form-check form-switch mb-2">
              <input className="form-check-input" type="checkbox" role="switch" id="activeSwitch" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <label className="form-check-label small fw-semibold" htmlFor="activeSwitch">Mark Active</label>
            </div>
          </div>
          <div className="col-md-3">
            <button type="submit" className={`btn w-100 saas-btn-toggle ${isActive ? 'btn-success' : 'btn-danger'}`}>
              Set Status
            </button>
          </div>
        </form>
      </div>

      {/* Bottom Card - Table List */}
      <div className="saas-card">
        <div className="saas-header">
          <span className="saas-title">Quarries List</span>
        </div>
        
        <div className="table-responsive">
          <table className="table table-hover align-middle" style={{ fontSize: '0.82rem' }}>
            <thead className="table-light text-uppercase" style={{ fontSize: '0.72rem' }}>
              <tr>
                <th>ID</th>
                <th>Quarry Name</th>
                <th>Extractor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {quarries.map((q, idx) => (
                <tr key={idx}>
                  <td className="fw-bold">{q.id}</td>
                  <td>{q.name}</td>
                  <td>{q.extractor}</td>
                  <td>
                    <span className={`badge ${q.status === 'Active' ? 'bg-success' : 'bg-danger'}`}>
                      {q.status}
                    </span>
                  </td>
                </tr>
              ))}
              {quarries.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center text-muted py-3">No quarries configured</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
