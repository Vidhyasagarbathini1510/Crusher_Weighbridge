import { api } from '../api/client.js';

export const VEHICLE_OPTION_MODES = {
  STAY_ALL: 'STAY_ALL',                             // Show all vehicles (Default stay option)
  HIDE_COMPLETED_EMPTY: 'HIDE_COMPLETED_EMPTY',     // Hide completed empty vehicles
  QUARRY_STAY_OTHERS_HIDE: 'QUARRY_STAY_OTHERS_HIDE'// Quarry/Own vehicles stay, Other vehicles hide when empty completed
};

/**
 * Fetch active vehicle option mode from DB settings or localStorage fallback
 */
export async function getVehicleOptionMode() {
  try {
    if (api && api.getSettings) {
      const settings = await api.getSettings();
      if (settings && settings.vehicle_empty_completion_mode) {
        return settings.vehicle_empty_completion_mode;
      }
    }
  } catch (err) {
    console.warn('[vehicleFilterUtil] Error reading settings:', err);
  }
  return localStorage.getItem('noris_vehicle_empty_completion_mode') || VEHICLE_OPTION_MODES.STAY_ALL;
}

/**
 * Save vehicle option mode to DB settings and localStorage
 */
export async function setVehicleOptionMode(mode) {
  try {
    localStorage.setItem('noris_vehicle_empty_completion_mode', mode);
    if (api && api.saveSetting) {
      await api.saveSetting('vehicle_empty_completion_mode', mode);
    }
  } catch (err) {
    console.error('[vehicleFilterUtil] Error saving vehicle option setting:', err);
  }
}

/**
 * Helper to fetch combined transactions from all modules (Sales, Boulders, Yard, etc.)
 */
export async function fetchAllTransactions() {
  const allTxs = [];
  try {
    if (api && api.transactions) {
      const txs = await api.transactions().catch(() => []);
      if (Array.isArray(txs)) allTxs.push(...txs);
    }
    if (window.electronAPI) {
      if (window.electronAPI.getBoulders) {
        const b = await window.electronAPI.getBoulders().catch(() => []);
        if (Array.isArray(b)) allTxs.push(...b);
      }
      if (window.electronAPI.getSalesUnits) {
        const s = await window.electronAPI.getSalesUnits().catch(() => []);
        if (Array.isArray(s)) allTxs.push(...s);
      }
      if (window.electronAPI.getYardWeighments) {
        const y = await window.electronAPI.getYardWeighments().catch(() => []);
        if (Array.isArray(y)) allTxs.push(...y);
      }
    }
  } catch (err) {
    console.warn('[vehicleFilterUtil] Error fetching all transactions:', err);
  }

  // Fallbacks from localStorage
  const keys = ['noris_transactions', 'noris_boulders_transactions', 'noris_sales_transactions', 'noris_yard_transactions'];
  keys.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allTxs.push(...parsed);
      } catch (e) {}
    }
  });

  return allTxs;
}

/**
 * Filter vehicle list based on configured vehicle option mode, completed empty transactions, and ownership type.
 * 
 * @param {Array} vehicles - List of vehicle strings or vehicle objects
 * @param {Array} transactions - List of weighment transactions
 * @param {String} mode - VEHICLE_OPTION_MODES value
 * @returns {Array} Filtered list of vehicles
 */
export function filterVehiclesBySetting(vehicles = [], transactions = [], mode = VEHICLE_OPTION_MODES.STAY_ALL) {
  if (mode === VEHICLE_OPTION_MODES.STAY_ALL || !mode) {
    return vehicles;
  }

  // Collect vehicle numbers of completed empty weighments/trips (normalized without spaces)
  const completedEmptyVehicles = new Set();
  (transactions || []).forEach(tx => {
    const isCompleted = tx.status === 'COMPLETED' || 
                        Number(tx.netWeight || tx.net_weight || 0) > 0 || 
                        (tx.secondWeight !== undefined && tx.secondWeight !== null && tx.secondWeight !== '') || 
                        (tx.second_weight !== undefined && tx.second_weight !== null && tx.second_weight !== '');
    const vehNo = (tx.vehicleNo || tx.vehicle_no || tx.vehicle || '').toString().trim().toUpperCase().replace(/\s+/g, '');
    if (vehNo && isCompleted) {
      completedEmptyVehicles.add(vehNo);
    }
  });

  return vehicles.filter(item => {
    const rawVehNo = (typeof item === 'string' ? item : (item.vehicle || item.vehicleNo || item.vehicle_no || '')).toString().trim().toUpperCase();
    const cleanVehNo = rawVehNo.replace(/\s+/g, '');
    if (!cleanVehNo) return false;

    const ownership = (typeof item === 'object' && item.ownership ? item.ownership : '').toString().toUpperCase();
    const isQuarryOrOwn = ownership === 'OWN' || ownership === 'QUARRY';

    if (mode === VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY) {
      return !completedEmptyVehicles.has(cleanVehNo);
    }

    if (mode === VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE) {
      if (isQuarryOrOwn) {
        return true; // Quarry/Own vehicles stay in option list
      }
      return !completedEmptyVehicles.has(cleanVehNo); // Hide completed empty other vehicles
    }

    return true;
  });
}

/**
 * Automatically deletes / cleans up vehicle tare record from database and cache upon weighment completion
 * if the active vehicle option setting in Settings is configured to do so.
 * 
 * @param {string} vehicleNo - Vehicle number
 * @param {string} ownership - 'OWN', 'QUARRY', or 'OTHERS'
 * @returns {Promise<boolean>} True if deleted, false if retained
 */
export async function cleanupVehicleOnWeighmentCompletion(vehicleNo, ownership = 'OTHERS') {
  if (!vehicleNo) return false;
  try {
    const mode = await getVehicleOptionMode();
    if (mode === VEHICLE_OPTION_MODES.STAY_ALL || !mode) {
      return false; // Show All: keep vehicle in database
    }

    const cleanVeh = vehicleNo.toString().trim().toUpperCase().replace(/\s+/g, '');
    const isQuarryOrOwn = ['OWN', 'QUARRY'].includes((ownership || '').toString().trim().toUpperCase());

    let shouldDelete = false;
    if (mode === VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY) {
      shouldDelete = true;
    } else if (mode === VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE) {
      if (!isQuarryOrOwn) {
        shouldDelete = true; // Delete third-party/others, keep quarry
      }
    }

    if (!shouldDelete) return false;

    // 1. Delete from SQLite database
    if (api && api.deleteVehicleTareByNumber) {
      await api.deleteVehicleTareByNumber(cleanVeh);
    }

    // 2. Remove from localStorage vehicle tares cache
    const STORAGE_KEY = 'noris_vehicle_tares';
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const updated = parsed.filter(t => {
            const v = (t.vehicle || t.vehicleNo || '').toString().trim().toUpperCase().replace(/\s+/g, '');
            return v !== cleanVeh;
          });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
      } catch (e) {
        console.warn('[vehicleFilterUtil] Error updating localStorage tares:', e);
      }
    }
    return true;
  } catch (err) {
    console.error('[vehicleFilterUtil] Error in cleanupVehicleOnWeighmentCompletion:', err);
    return false;
  }
}

