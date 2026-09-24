// Top-level component: sets up routing and the auth guard.
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Sidebar from './components/Sidebar.jsx';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CameraGrid from './pages/CameraGrid.jsx';
import SingleCamera from './pages/SingleCamera.jsx';
import CameraManagement from './pages/CameraManagement.jsx';
import Settings from './pages/Settings.jsx';
import Reports from './pages/Reports.jsx';
import Vehicles from './pages/Vehicles.jsx';
import Boulders from './pages/Boulders.jsx';
import BouldersDuplicate from './pages/BouldersDuplicate.jsx';
import QuarryEnable from './pages/QuarryEnable.jsx';
import LoadingSlip from './pages/LoadingSlip.jsx';
import SalesWeighmentUnits from './pages/SalesWeighmentUnits.jsx';
import SalesWeighment from './pages/SalesWeighment.jsx';
import DuplicateBill from './pages/DuplicateBill.jsx';
import Yard from './pages/Yard.jsx';
import YardDuplicate from './pages/YardDuplicate.jsx';
import FirstWeighment from './pages/FirstWeighment.jsx';
import SecondWeighment from './pages/SecondWeighment.jsx';
import DuplicateWeighmentBill from './pages/DuplicateWeighmentBill.jsx';
import SalesSummaryReport from './pages/SalesSummaryReport.jsx';
import SalesCashReport from './pages/SalesCashReport.jsx';
import YardReport from './pages/YardReport.jsx';
import BouldersReport from './pages/BouldersReport.jsx';
import NormalReport from './pages/NormalReport.jsx';

import { ScaleProvider } from './context/ScaleContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Footer from './components/Footer.jsx';
import WeighbridgeGuard from './components/WeighbridgeGuard.jsx';
import AdminGuard from './components/AdminGuard.jsx';

// Wraps protected pages in the app shell (sidebar + navbar) and redirects to
// /login when there is no token.
function Protected({ children }) {
  const { token } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleRefresh = () => {
      setRefreshKey(prev => prev + 1);
    };
    window.addEventListener('page-refresh', handleRefresh);
    return () => {
      window.removeEventListener('page-refresh', handleRefresh);
    };
  }, []);

  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="content">
        <Navbar />
        <div className="page-body" key={refreshKey}>
          {children}
        </div>
        <Footer />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ScaleProvider>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/boulders" element={<Protected><WeighbridgeGuard><Boulders /></WeighbridgeGuard></Protected>} />
            <Route path="/boulders/weighment" element={<Protected><WeighbridgeGuard><Boulders /></WeighbridgeGuard></Protected>} />
            <Route path="/boulders/duplicate" element={<Protected><BouldersDuplicate /></Protected>} />
            <Route path="/boulders/quarry" element={<Protected><QuarryEnable /></Protected>} />
            <Route path="/sales/loading-slip" element={<Protected><LoadingSlip /></Protected>} />
            <Route path="/sales/weighment-units" element={<Protected><WeighbridgeGuard><SalesWeighmentUnits /></WeighbridgeGuard></Protected>} />
            <Route path="/sales/weighment" element={<Protected><WeighbridgeGuard><SalesWeighment /></WeighbridgeGuard></Protected>} />
            <Route path="/sales/duplicate-bill" element={<Protected><DuplicateBill /></Protected>} />
            <Route path="/sales/yard" element={<Protected><WeighbridgeGuard><Yard /></WeighbridgeGuard></Protected>} />
            <Route path="/yard/weighment" element={<Protected><WeighbridgeGuard><Yard /></WeighbridgeGuard></Protected>} />
            <Route path="/yard/duplicate" element={<Protected><YardDuplicate /></Protected>} />
            <Route path="/weighment/first" element={<Protected><WeighbridgeGuard><FirstWeighment /></WeighbridgeGuard></Protected>} />
            <Route path="/weighment/second" element={<Protected><WeighbridgeGuard><SecondWeighment /></WeighbridgeGuard></Protected>} />
            <Route path="/weighment/duplicate-bill" element={<Protected><DuplicateWeighmentBill /></Protected>} />
            <Route path="/vehicles" element={<Protected><Vehicles /></Protected>} />
            <Route path="/grid" element={<Protected><CameraGrid /></Protected>} />
            <Route path="/camera/:id" element={<Protected><SingleCamera /></Protected>} />
            <Route path="/manage" element={<Protected><AdminGuard><Navigate to="/settings" replace /></AdminGuard></Protected>} />
            <Route path="/settings" element={<Protected><AdminGuard><Settings /></AdminGuard></Protected>} />
            <Route path="/reports" element={<Protected><SalesSummaryReport /></Protected>} />
            <Route path="/reports/sales-summary" element={<Protected><SalesSummaryReport /></Protected>} />
            <Route path="/reports/sales-cash" element={<Protected><SalesCashReport /></Protected>} />
            <Route path="/reports/yard" element={<Protected><YardReport /></Protected>} />
            <Route path="/reports/boulders" element={<Protected><BouldersReport /></Protected>} />
            <Route path="/reports/normal" element={<Protected><NormalReport /></Protected>} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </ScaleProvider>
  );
}
