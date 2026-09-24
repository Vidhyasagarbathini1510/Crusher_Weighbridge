// Small colored pill showing online/offline/unknown.
import React from 'react';
export default function StatusBadge({ state }) {
  const map = { online: 'success', offline: 'danger', unknown: 'secondary' };
  return <span className={`badge bg-${map[state] || 'secondary'}`}>{state || 'unknown'}</span>;
}
