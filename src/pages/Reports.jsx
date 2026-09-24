// Simple reports/logs view. In a fuller build this would page through
// camera_logs; here it summarizes status and lists recent statuses.
import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Loader from '../components/Loader.jsx';

export default function Reports() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.cameras().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <Loader />;
  return (
    <div className="card bg-dark text-light p-3">
      <h6>Camera status report</h6>
      <table className="table table-dark table-sm">
        <thead><tr><th>Camera</th><th>Group</th><th>Status</th><th>Last checked</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td><td>{c.group_name || '-'}</td>
              <td><StatusBadge state={c.status} /></td>
              <td>{c.last_checked || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
