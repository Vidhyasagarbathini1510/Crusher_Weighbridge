import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useScale } from '../context/ScaleContext.jsx';
import logoImg from '../assets/logo.jpg';

export default function Sidebar() {
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const { logout, user, isAdmin } = useAuth();
  const { isConnected } = useScale();

  const scaleRoutes = [
    '/boulders/weighment',
    '/sales/weighment',
    '/sales/weighment-units',
    '/yard/weighment',
    '/sales/yard',
    '/weighment/first',
    '/weighment/second'
  ];

  const linkClass = ({ isActive }) =>
    `d-flex align-items-center gap-2 px-3 py-1.5 rounded-3 text-decoration-none transition-all sidebar-link text-nowrap ${
      isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'
    }`;

  const subLinkClass = ({ isActive }) =>
    `d-flex align-items-center gap-2 px-3 py-2 rounded-2 text-decoration-none transition-all sidebar-link text-nowrap ${
      isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'
    }`;

  const renderDropdown = (title, items, icon, id) => {
    const isOpen = activeDropdown === id;
    return (
      <div 
        className="position-relative py-2"
        onMouseEnter={() => setActiveDropdown(id)}
        onMouseLeave={() => setActiveDropdown(null)}
      >
        <div 
          className="d-flex align-items-center gap-2 px-3 py-1.5 rounded-3 sidebar-link sidebar-link-inactive text-nowrap"
          style={{ cursor: 'pointer', color: 'var(--side-text)' }}
        >
          {icon}
          <span>{title}</span>
          <svg 
            width="12" 
            height="12" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2.5" 
            style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        
        {isOpen && (
          <div 
            className="position-absolute start-0 p-2 rounded-3 shadow-lg border d-flex flex-column gap-1"
            style={{ 
              backgroundColor: 'var(--side-bg-2)', 
              borderColor: 'rgba(201, 162, 39, 0.28)',
              minWidth: '180px',
              zIndex: 10000,
              top: '100%',
              maxHeight: '320px',
              overflowY: 'auto'
            }}
          >
            {items.map((item, idx) => {
              const isDisabled = !isConnected && scaleRoutes.includes(item.to);
              return (
                <NavLink 
                  key={idx}
                  to={item.to} 
                  className={subLinkClass}
                  style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'auto' } : {}}
                  onClick={(e) => {
                    if (isDisabled) {
                      e.preventDefault();
                      return;
                    }
                    setActiveDropdown(null);
                  }}
                  title={isDisabled ? "Weighbridge is disconnected" : ""}
                >
                  <span>{item.label}</span>
                  {isDisabled && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--danger, #B3261E)" strokeWidth="2.5" className="ms-auto" style={{ verticalAlign: 'middle' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  )}
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="sidebar-container px-3 py-0 d-flex align-items-center justify-content-between">
      {/* Brand Header */}
      <div className="d-flex align-items-center gap-2" style={{ height: '100%' }}>
        <img src={logoImg} alt="Noris Logo" style={{ width: '22px', height: '22px', borderRadius: '4px', objectFit: 'contain' }} />
        <div className="brand-text d-flex align-items-baseline gap-1">
          <span className="fw-bold tracking-wide" style={{ fontSize: '1rem', letterSpacing: '0.16em', color: 'var(--side-text-hi)' }}>NORIS</span>
          {/* <span className="text-muted fw-semibold" style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}>WEIGHBRIDGE</span> */}
        </div>
      </div>

      {/* Horizontal Navigation Links */}
      <div className="d-flex align-items-center gap-2 my-0 py-0" style={{ height: '100%' }}>
        <NavLink to="/" end className={linkClass}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          <span>Dashboard</span>
        </NavLink>

        <NavLink to="/vehicles" className={linkClass}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="3" width="15" height="13" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <span>Vehicles</span>
        </NavLink>

        {renderDropdown(
          'Boulders',
          [
            { to: '/boulders/weighment', label: 'Weighment' },
            { to: '/boulders/duplicate', label: 'Duplicate' },
            { to: '/boulders/quarry', label: 'Quarry Enable' }
          ],
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>,
          'boulders'
        )}

        {renderDropdown(
          'Sales',
          [
            { to: '/sales/weighment-units', label: 'Weighment - Units' },
            { to: '/sales/duplicate-bill', label: 'Duplicate Bill' }
          ],
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>,
          'sales'
        )}

        {renderDropdown(
          'Yard',
          [
            { to: '/yard/weighment', label: 'Yard Weighment' },
            { to: '/yard/duplicate', label: 'Duplicate Yard' }
          ],
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>,
          'yard'
        )}

        {renderDropdown(
          'Weighments',
          [
            { to: '/weighment/first', label: 'First Weighment' },
            { to: '/weighment/second', label: 'Second Weighment' },
            { to: '/weighment/duplicate-bill', label: 'Duplicate Bill' }
          ],
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1"></path>
            <path d="M18 8h4a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-4"></path>
            <rect x="2" y="2" width="20" height="8" rx="2"></rect>
          </svg>,
          'weighments'
        )}
        {renderDropdown(
          'Reports',
          [
            { to: '/reports/sales-summary', label: 'Sales Summary' },
            { to: '/reports/sales-cash', label: 'Sales Cash' },
            { to: '/reports/yard', label: 'Yard Report' },
            { to: '/reports/boulders', label: 'Boulders View' },
            { to: '/reports/normal', label: 'Normal Report' }
          ],
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
          </svg>,
          'reports'
        )}

        {/* <NavLink to="/grid" className={linkClass}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span>Camera Grid</span>
        </NavLink> */}

        {isAdmin && (
          <NavLink to="/settings" className={linkClass}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span>Settings</span>
          </NavLink>
        )}
      </div>

      {/* Operator Profile Dropdown */}
      <div 
        className="position-relative py-2"
        onMouseEnter={() => setProfileDropdownOpen(true)}
        onMouseLeave={() => setProfileDropdownOpen(false)}
        style={{ height: '100%', display: 'flex', alignItems: 'center' }}
      >
        <div className="d-flex align-items-center gap-2 py-1" style={{ cursor: 'pointer' }}>
          <div className="avatar-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {user?.username ? user.username.slice(0, 2).toUpperCase() : (isAdmin ? 'AD' : 'OP')}
          </div>
          <div className="avatar-info d-none d-md-block">
            <div className="fw-semibold" style={{ fontSize: '0.8rem', lineHeight: '1.2', color: 'var(--side-text-hi)' }}>
              {user?.username || (isAdmin ? 'Admin' : 'Operator')}
            </div>
            <div className="text-uppercase" style={{ fontSize: '0.62rem', color: 'var(--gold-bright, #E8C25A)', letterSpacing: '0.05em', lineHeight: '1' }}>
              {user?.role || (isAdmin ? 'admin' : 'operator')}
            </div>
          </div>
          <svg 
            width="10" 
            height="10" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2.5" 
            className="text-secondary"
            style={{ transform: profileDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>

        {profileDropdownOpen && (
          <div 
            className="position-absolute end-0 p-2 rounded-3 shadow-lg border d-flex flex-column gap-1"
            style={{ 
              backgroundColor: 'var(--side-bg-2)', 
              borderColor: 'rgba(201, 162, 39, 0.28)',
              minWidth: '135px',
              zIndex: 10000,
              top: '100%'
            }}
          >
            {isAdmin && (
              <NavLink 
                to="/settings" 
                className={subLinkClass}
                onClick={() => setProfileDropdownOpen(false)}
              >
                <span>Settings</span>
              </NavLink>
            )}
            <button 
              onClick={() => {
                setProfileDropdownOpen(false);
                logout();
              }}
              className="d-flex align-items-center gap-2 px-3 py-2 rounded-2 text-decoration-none transition-all sidebar-link text-nowrap w-100 border-0 bg-transparent text-start"
              style={{ color: 'var(--side-text)', fontSize: '0.8rem', fontWeight: 500 }}
            >
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
