import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useScale } from '../context/ScaleContext.jsx';

import SevenSegmentDisplay from './SevenSegmentDisplay.jsx';

export default function Navbar() {
  const location = useLocation();
  const { user, logout, role } = useAuth();
  const currentUser = user || { username: 'Admin', full_name: 'Administrator', role: 'admin' };
  const handleLogout = logout || (() => {});

  const { isConnected } = useScale();
  const [time, setTime] = useState(new Date());
  const [liveWeight, setLiveWeight] = useState('0');

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        if (String(data.value).includes('Offline')) {
          setLiveWeight('Offline');
        } else {
          setLiveWeight(data.value);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const formatDate = (date) => {
    const options = { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' };
    return date.toLocaleDateString('en-GB', options);
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  };

  // Get active title and subtitle based on route
  const getHeaderInfo = () => {
    const path = location.pathname;
    switch (path) {
      case '/':
        return { title: 'Dashboard', subtitle: 'Overview of weighbridge operations' };
      case '/boulders':
      case '/boulders/weighment':
        return { title: 'Boulders Weighment', subtitle: 'Manage boulder scales & records' };
      case '/boulders/duplicate':
        return { title: 'Boulders Duplicate', subtitle: 'Reprint boulder weight ticket' };
      case '/boulders/quarry':
        return { title: 'Quarry Enable', subtitle: 'Manage active quarries list' };
      case '/sales/loading-slip':
        return { title: 'Loading Slip', subtitle: 'Sales Order Generator' };
      case '/sales/weighment-units':
        return { title: 'Weighment - Units', subtitle: 'Sales Weighment with Unit support' };
      case '/sales/weighment':
        return { title: 'Weighment', subtitle: 'Standard Sales Weighment' };
      case '/sales/duplicate-bill':
        return { title: 'Duplicate Bill', subtitle: 'Reprint sales ticket' };
      case '/sales/yard':
        return { title: 'Yard Status', subtitle: 'Track vehicles inside the yard' };
      case '/weighment/first':
        return { title: 'First Weighment', subtitle: 'Capture first weight logs' };
      case '/weighment/second':
        return { title: 'Second Weighment', subtitle: 'Capture second weight logs' };
      case '/weighment/duplicate-bill':
        return { title: 'Duplicate Bill', subtitle: 'Search & reprint weighment bill' };
      case '/vehicles':
        return { title: 'Vehicles', subtitle: 'Manage transport vehicles' };
      case '/grid':
        return { title: 'Camera Grid', subtitle: 'Live security feeds' };
      case '/manage':
        return { title: 'Camera Management', subtitle: 'Configure IP cameras' };
      case '/settings':
        return { title: 'Settings', subtitle: 'System configurations' };
      case '/reports/sales-summary':
        return { title: 'Sales Summary Report', subtitle: 'General sales analytics' };
      case '/reports/sales-cash':
        return { title: 'Sales Cash Report', subtitle: 'Cash statement analysis' };
      case '/reports/yard':
        return { title: 'Yard Report', subtitle: 'Yard activity statements' };
      case '/reports/boulders':
        return { title: 'Boulders View', subtitle: 'Boulder weighment database' };
      case '/reports/normal':
        return { title: 'Normal Report', subtitle: 'Standard weighment records' };
      default:
        return { title: 'Weighbridge System', subtitle: 'Operations portal' };
    }
  };

  const header = getHeaderInfo();

  return (
    <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 pb-3 border-bottom border-secondary-subtle">
      {/* Page Title & Subtitle */}
      <div>
        <h4 className="m-0 fw-bold text-dark">{header.title}</h4>
        <p className="text-secondary small m-0">{header.subtitle}</p>
      </div>

      {/* Stats and Tools */}
      <div className="d-flex align-items-center flex-wrap gap-3 mt-2 mt-md-0">
        {/* Weighbridge Status */}
        <div className="d-flex align-items-center gap-2 bg-white px-3 py-1.5 rounded-3 border border-secondary-subtle">
          <span className={`indicator-light ${isConnected ? 'light-green' : 'light-red'} active`}></span>
          <div style={{ lineHeight: 1.1 }}>
            <div className="small fw-bold text-dark" style={{ fontSize: '0.75rem' }}>Weighbridge</div>
            <div className={isConnected ? "text-success" : "text-danger"} style={{ fontSize: '0.65rem', fontWeight: 600 }}>
              {isConnected ? "Connected" : "Disconnected"}
            </div>
          </div>
        </div>

        {/* Netron Live Indicator Badge */}
        <div className="d-flex align-items-center gap-2 bg-dark rounded-3 border" style={{ backgroundColor: 'var(--side-bg)', borderColor: 'rgba(201, 162, 39, 0.35)', padding: '0.35rem 1.25rem', minWidth: '200px' }}>
          <span className={`indicator-light ${isConnected ? 'light-green' : 'light-red'} active`} style={{ flexShrink: 0 }}></span>
          <div className="w-100" style={{ lineHeight: 1.15 }}>
            <div className="text-uppercase fw-bold text-center" style={{ fontSize: '0.62rem', letterSpacing: '0.14em', color: 'var(--gold-bright)', marginBottom: '2px' }}>LIVE SCALE WEIGHT</div>
            <div className="d-flex align-items-center justify-content-center gap-1.5">
              {isConnected ? (
                <SevenSegmentDisplay value={liveWeight} color="#E8C25A" offColor="rgba(232, 194, 90, 0.06)" height={28} digits={5} />
              ) : (
                <div className="font-monospace fw-bold" style={{ fontSize: '1.2rem', color: '#E27A72' }}>
                  OFFLINE
                </div>
              )}
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#A8B7CE', lineHeight: 1, marginLeft: '3px' }}>KG</span>
            </div>
          </div>
        </div>

        {/* Live Clock / Calendar */}
        <div className="d-flex align-items-center gap-2 bg-white px-3 py-1.5 rounded-3 border border-secondary-subtle text-dark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <div style={{ lineHeight: 1.1 }}>
            <div className="fw-bold" style={{ fontSize: '0.75rem' }}>{formatTime(time)}</div>
            <div className="text-secondary" style={{ fontSize: '0.65rem', fontWeight: 500 }}>{formatDate(time)}</div>
          </div>
        </div>

        {/* Notification Bell */}
        <div className="position-relative bg-white p-2 rounded-3 border border-secondary-subtle cursor-pointer d-flex align-items-center justify-content-center" style={{ width: '38px', height: '38px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style={{ fontSize: '0.6rem' }}>
            5
          </span>
        </div>

        {/* Refresh Icon */}
        <div className="bg-white p-2 rounded-3 border border-secondary-subtle cursor-pointer d-flex align-items-center justify-content-center" style={{ width: '38px', height: '38px' }} onClick={() => window.dispatchEvent(new CustomEvent('page-refresh'))} title="Refresh Page">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </div>

        {/* Fullscreen Icon */}
        <div className="bg-white p-2 rounded-3 border border-secondary-subtle cursor-pointer d-flex align-items-center justify-content-center" style={{ width: '38px', height: '38px' }} onClick={() => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </div>

        {/* User Role Badge */}
        <div className="d-flex align-items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-3 border border-secondary-subtle">
          <span className="small text-muted" style={{ fontSize: '0.7rem' }}>Role:</span>
          <span className={`badge ${currentUser.role === 'admin' ? 'bg-primary' : 'bg-secondary'} text-uppercase`} style={{ fontSize: '0.65rem', letterSpacing: '0.04em' }}>
            {currentUser.role || 'operator'}
          </span>
        </div>

        {/* Logout button */}
        <button className="btn btn-sm btn-outline-danger px-3 py-1.5 rounded-3 d-flex align-items-center gap-1 font-semibold" onClick={handleLogout}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
          Logout
        </button>
      </div>
    </div>
  );
}
