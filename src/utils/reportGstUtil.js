import { api } from '../api/client.js';

export const REPORT_GST_MODES = {
  ALL: 'ALL',        // Show both GST & Non-GST
  GST: 'GST',        // Show GST only
  NON_GST: 'NON-GST' // Show Non-GST only
};

/**
 * Reports always open showing both GST & Non-GST. The old Settings default
 * (noris_report_gst_mode) was removed, so any value saved earlier is ignored;
 * operators narrow it down with the report filter or F1 / F2.
 */
export function getReportGstModeSync() {
  return REPORT_GST_MODES.ALL;
}

/**
 * F1/F2 keyboard shortcuts for GST / Non-GST in reports.
 * OFF (default) = normal filter buttons in the report; ON = buttons hidden, F1 = GST, F2 = Non-GST.
 */
export function getReportGstShortcutsSync() {
  return localStorage.getItem('noris_report_gst_shortcuts') === 'true';
}

export async function getReportGstShortcuts() {
  try {
    if (api && api.getSettings) {
      const settings = await api.getSettings();
      if (settings && settings.report_gst_shortcuts !== undefined && settings.report_gst_shortcuts !== null) {
        return String(settings.report_gst_shortcuts) === 'true';
      }
    }
  } catch (err) {
    console.warn('[reportGstUtil] Error reading report_gst_shortcuts:', err);
  }
  return getReportGstShortcutsSync();
}

export async function setReportGstShortcuts(enabled) {
  try {
    localStorage.setItem('noris_report_gst_shortcuts', enabled ? 'true' : 'false');
    if (api && api.saveSetting) {
      await api.saveSetting('report_gst_shortcuts', enabled ? 'true' : 'false');
    }
    window.dispatchEvent(new CustomEvent('report-gst-shortcuts-changed', { detail: { enabled } }));
  } catch (err) {
    console.error('[reportGstUtil] Error saving report_gst_shortcuts:', err);
  }
}

/**
 * Determine if a record is GST or NON-GST
 */
export function getRecordBillType(t) {
  if (!t) return 'NON-GST';
  const raw = String(
    t.bill_type || t.billType || t.billtype ||
    t.dcType || t.dc_type || t.gstType || t.type || ''
  ).toUpperCase().trim();

  if (raw.includes('NON-GST') || raw.includes('NON GST') || raw === 'NON' || raw === 'NON_GST') {
    return 'NON-GST';
  }
  if (raw.includes('GST')) {
    return 'GST';
  }

  const gstin = String(
    t.gstin || t.gstIn || t.gst_no || t.gstNo ||
    t.partyGstin || t.party_gstin || t.gst || ''
  ).trim();
  if (gstin && gstin !== 'null' && gstin !== 'undefined' && gstin !== '-' && gstin !== 'N/A') {
    return 'GST';
  }

  if (t.isGst === true || t.is_gst === true || t.gstSale === 1 || t.gstSale === true || String(t.gstSale).toLowerCase() === 'true' || String(t.isGst).toLowerCase() === 'true') {
    return 'GST';
  }

  return 'NON-GST';
}

/**
 * Filter an array of records by GST Mode
 */
export function filterRecordsByGstMode(records, mode) {
  if (!mode || mode === REPORT_GST_MODES.ALL) return records;
  const target = mode === REPORT_GST_MODES.GST ? 'GST' : 'NON-GST';
  return (records || []).filter(r => getRecordBillType(r) === target);
}
