// Saves the Settings > Workflow / Vehicle options in the local SQLite database.
//
// Those options (loading-slip menu mode, completion mode, module mode, layout
// design, royalty rates, GST highlight, DC display mode, ...) used to live only
// in localStorage, so they were lost if the app's site data was cleared or the
// app was reinstalled. Same approach as printHelper.js:
//   * every write to one of these localStorage keys is also saved to the
//     `settings` table as a single JSON value (key: workflow_settings);
//   * restoreWorkflowSettings() puts it back into localStorage at start-up.
// All existing getters/handlers keep reading localStorage and need no change.

export const WORKFLOW_SETTINGS_DB_KEY = 'workflow_settings';

export const WORKFLOW_SETTING_KEYS = [
  // Loading slip / vehicles workflow
  'noris_enable_loading_slip',
  'noris_loading_slip_menu_mode',
  'noris_loading_slip_completion_mode',
  'noris_vehicle_empty_completion_mode',
  'noris_module_mode',
  // Bills / printing behaviour
  'noris_duplicate_bills_mode',
  'noris_print_once_hide_mode',
  'noris_report_gst_shortcuts',
  'noris_report_gst_mode',
  'noris_dot_matrix_preview_theme',
  // Sales / boulders screens
  'noris_sales_layout_design',
  'noris_boulders_layout_design',
  'noris_boulders_manual_entry',
  'noris_boulders_report_lock',
  'noris_enable_cash_parties',
  'noris_rate_checkbox',
  'noris_gst_party_highlight',
  'noris_show_sales_cash_report',
  'noris_auto_royalty_by_stationary',
  'noris_sales_dc_display_mode',
  'noris_sales_show_weigh_times',
  'noris_royalty_gov_rate',
  'noris_royalty_gen_rate',
  // DC numbering / card scan
  'noris_dc_cycle_limit_enabled',
  'noris_dc_cycle_limit_max',
  'noris_card_cooldown_enabled',
  'noris_card_cooldown_minutes',
  // Sales summary dot-matrix paper
  'noris_sales_summary_print_mode',
  'noris_sales_dm_paper_length_in',
  'noris_sales_dm_cpi',
  'noris_sales_dm_top_lines',
  'noris_sales_dm_bottom_lines',
  'noris_sales_dm_end_mode'
];

const KEY_SET = new Set(WORKFLOW_SETTING_KEYS);
const hasBridge = () =>
  typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveSetting;

function collect() {
  const out = {};
  WORKFLOW_SETTING_KEYS.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    } catch (_) {}
  });
  return out;
}

let timer = null;
export function persistWorkflowSettings() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      if (hasBridge()) {
        window.electronAPI.saveSetting({ key: WORKFLOW_SETTINGS_DB_KEY, value: JSON.stringify(collect()) });
      }
    } catch (err) {
      console.warn('[workflowSettings] Could not save to the database:', err);
    }
  }, 150);
}

let hooked = false;
// Make every localStorage.setItem/removeItem on a workflow key save to the DB.
function hookLocalStorage() {
  if (hooked || typeof Storage === 'undefined') return;
  hooked = true;
  const origSet = Storage.prototype.setItem;
  const origRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === window.localStorage && KEY_SET.has(k)) persistWorkflowSettings();
  };
  Storage.prototype.removeItem = function (k) {
    origRemove.call(this, k);
    if (this === window.localStorage && KEY_SET.has(k)) persistWorkflowSettings();
  };
}

export async function restoreWorkflowSettings() {
  try {
    if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.getSettings) return;
    const settings = await window.electronAPI.getSettings();
    const raw = settings && settings[WORKFLOW_SETTINGS_DB_KEY];
    if (raw) {
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      WORKFLOW_SETTING_KEYS.forEach(k => {
        if (saved[k] !== undefined && saved[k] !== null) localStorage.setItem(k, String(saved[k]));
      });
    } else if (Object.keys(collect()).length) {
      // First run after this update: keep what the operator already chose.
      persistWorkflowSettings();
    }
  } catch (err) {
    console.warn('[workflowSettings] Could not restore from the database:', err);
  } finally {
    hookLocalStorage();
  }
}
