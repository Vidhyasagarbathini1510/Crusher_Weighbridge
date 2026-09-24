// utils/AppContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { ROSystem, Job, ServiceHistory, AppSettings, Payment, DEMO_SYSTEMS, DEMO_JOBS, DEMO_PAYMENTS, FILTER_SPECS } from '../constants/data';
import { useStorage } from '../hooks/useStorage';
import { useAuth } from './AuthContext';

interface AppContextValue {
  systems: ROSystem[];
  addSystem: (s: ROSystem) => void;
  editSystem: (s: ROSystem) => void;
  deleteSystem: (id: string) => void;
  markFilterReplaced: (systemId: string, filterId: string) => void;
  markServiced: (systemId: string) => void;

  jobs: Job[];
  assignJob: (job: Job) => void;
  updateJobStatus: (jobId: string, status: string, techNotes?: string) => void;

  history: ServiceHistory[];
  addHistory: (entry: ServiceHistory) => void;

  settings: AppSettings;
  saveSettings: (s: AppSettings) => void;

  payments: Payment[];
  addPayment: (p: Payment) => void;
  updatePayment: (p: Payment) => void;
  deletePayment: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const DEFAULT_SETTINGS: AppSettings = {
  defaultCountryCode: '91',
  alertDays: 14,
  serviceIntervalMonths: 6,
  businessName: '',
  businessPhone: '',
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { companyId, currentUser } = useAuth();
  const [systems, setSystems] = useState<ROSystem[]>([]);
  const [jobs, setJobs] = useStorage<Job[]>('roPurifierJobs_v2', DEMO_JOBS);
  const [history, setHistory] = useStorage<ServiceHistory[]>('roPurifierHistory_v2', []);
  const [settings, setSettings] = useStorage<AppSettings>('roPurifierSettings_v2', DEFAULT_SETTINGS);
  const [payments, setPayments] = useStorage<Payment[]>('roPurifierPayments_v2', DEMO_PAYMENTS);

  const API_BASE_URL = 'https://aquaguard.kokartsolutions.in/water-purifier-backend/public/api';
  const today = new Date().toISOString().split('T')[0];

  const fetchSystems = async (cid: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/systems?company_id=${cid}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        const mapped: ROSystem[] = data.map((sys: any) => ({
          id: String(sys.id),
          name: sys.name || '',
          ownerName: sys.owner_name || '',
          ownerPhone: sys.owner_phone || '',
          technicianName: sys.technician?.name || sys.technician_name || '',
          technicianPhone: sys.technician?.phone || sys.technician_phone || '',
          location: sys.location || '',
          installDate: sys.install_date || today,
          lastServiceDate: sys.last_service_date || today,
          brand: sys.brand || '',
          modelNo: sys.model_number || '',
          systemType: sys.system_type || 'RO',
          warrantyExpiry: sys.warranty_expiry || '',
          notes: sys.notes || '',
          filters: Array.isArray(sys.filters)
            ? sys.filters.map((f: any) => ({
                filterId: f.spec?.slug || '',
                lastChanged: f.last_changed || f.last_replaced_date || today,
              }))
            : [],
          createdAt: sys.created_at || new Date().toISOString(),
        }));
        setSystems(mapped);
      }
    } catch (e) {
      console.error('Failed to fetch systems:', e);
    }
  };

  useEffect(() => {
    if (companyId) {
      fetchSystems(companyId);
    } else {
      setSystems([]);
    }
  }, [companyId]);

  const addSystem = async (s: ROSystem) => {
    if (!companyId) return;
    try {
      const body = {
        name: s.name,
        brand: s.brand,
        model_number: s.modelNo,
        system_type: s.systemType,
        location: s.location,
        owner_name: s.ownerName,
        owner_phone: s.ownerPhone,
        technician_name: s.technicianName,
        technician_phone: s.technicianPhone,
        install_date: s.installDate,
        last_service_date: s.lastServiceDate,
        warranty_expiry: s.warrantyExpiry,
        notes: s.notes,
        company_id: Number(companyId),
        user_id: currentUser ? Number(currentUser.id) : null,
        filter_specs: s.filters.map(f => f.filterId),
      };

      const response = await fetch(`${API_BASE_URL}/systems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        fetchSystems(companyId);
      }
    } catch (e) {
      console.error('Failed to add system:', e);
    }
  };

  const editSystem = async (s: ROSystem) => {
    if (!companyId) return;
    try {
      const body = {
        name: s.name,
        brand: s.brand,
        model_number: s.modelNo,
        system_type: s.systemType,
        location: s.location,
        owner_name: s.ownerName,
        owner_phone: s.ownerPhone,
        technician_name: s.technicianName,
        technician_phone: s.technicianPhone,
        install_date: s.installDate,
        last_service_date: s.lastServiceDate,
        warranty_expiry: s.warrantyExpiry,
        notes: s.notes,
        company_id: Number(companyId),
        filter_specs: s.filters.map(f => f.filterId),
      };

      const response = await fetch(`${API_BASE_URL}/systems/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        fetchSystems(companyId);
      }
    } catch (e) {
      console.error('Failed to edit system:', e);
    }
  };

  const deleteSystem = async (id: string) => {
    if (!companyId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/systems/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchSystems(companyId);
      }
    } catch (e) {
      console.error('Failed to delete system:', e);
    }
  };

  const markFilterReplaced = async (systemId: string, filterId: string) => {
    if (!companyId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/systems/${systemId}/filters/${filterId}/mark-replaced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser ? Number(currentUser.id) : null
        })
      });

      if (response.ok) {
        fetchSystems(companyId);
      }
    } catch (e) {
      console.error('Failed to mark filter replaced:', e);
    }
  };

  const markServiced = async (systemId: string) => {
    if (!companyId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/systems/${systemId}/mark-serviced`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser ? Number(currentUser.id) : null
        })
      });

      if (response.ok) {
        fetchSystems(companyId);
      }
    } catch (e) {
      console.error('Failed to mark serviced:', e);
    }
  };

  const assignJob = (job: Job) => setJobs((p) => [...p, job]);

  const updateJobStatus = (jobId: string, status: string, techNotes?: string) => {
    setJobs((p) =>
      p.map((j) =>
        j.id !== jobId
          ? j
          : {
              ...j,
              status,
              techNotes: techNotes || j.techNotes,
              completedAt: status === 'done' ? new Date().toISOString() : j.completedAt,
            }
      )
    );
    if (status === 'done') {
      const job = jobs.find((j) => j.id === jobId);
      if (job?.systemId) {
        if (job.type === 'service') markServiced(job.systemId);
        if (job.type === 'filter_change' && job.filterIds?.length) {
          job.filterIds.forEach((fid) => markFilterReplaced(job.systemId, fid));
        }
      }
    }
  };

  const addHistory = (entry: ServiceHistory) => setHistory((p) => [...p, entry]);
  const saveSettings = (s: AppSettings) => setSettings(s);

  const addPayment = (p: Payment) => setPayments((prev) => [p, ...prev]);
  const updatePayment = (p: Payment) => setPayments((prev) => prev.map((x) => (x.id === p.id ? p : x)));
  const deletePayment = (id: string) => setPayments((prev) => prev.filter((x) => x.id !== id));

  return (
    <AppContext.Provider
      value={{
        systems,
        addSystem,
        editSystem,
        deleteSystem,
        markFilterReplaced,
        markServiced,
        jobs,
        assignJob,
        updateJobStatus,
        history,
        addHistory,
        settings,
        saveSettings,
        payments,
        addPayment,
        updatePayment,
        deletePayment,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
