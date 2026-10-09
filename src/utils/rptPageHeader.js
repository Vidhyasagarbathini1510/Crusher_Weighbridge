// What sits at the top of a printed RPT slip, above the layout itself.
//
// Three cases, because the paper differs from site to site:
//   NONE     nothing at all — the slip starts at the top of the sheet
//   EMPTY    a blank strip, so a pre-printed letterhead is not overprinted
//   COMPANY  the name and address entered under Settings -> Address Setting
//
// NONE is the default, so a machine that has never opened this setting keeps
// printing exactly what it printed before.

export const RPT_HEADER_MODE_KEY = 'noris_rpt_page_header_mode';
export const DC_HEADER_MODE_KEY = 'noris_dc_page_header_mode';
export const GATE_PASS_HEADER_MODE_KEY = 'noris_gate_pass_page_header_mode';
export const RPT_HEADER_GAP_KEY = 'noris_rpt_page_header_gap';

// Paired with the key classicReportPrinter.js writes from the Address Setting
// tab. Read directly rather than imported so the slip layouts do not have to
// pull in the report printer.
const COMPANY_STORAGE_KEY = 'noris_company_details';

export const RPT_HEADER_MODES = [
  { value: 'NONE', label: 'None — slip starts at the top of the page' },
  { value: 'EMPTY', label: 'Empty — leave blank space for pre-printed paper' },
  { value: 'COMPANY', label: 'Company address — from Address Setting' },
  { value: 'AUTO_GST', label: '🌟 Auto (GST Party → Company Header, Non-GST → Blank Space)' }
];

export const DEFAULT_HEADER_GAP_PX = 60;

export function getRptHeaderMode(category = 'PRINT') {
  try {
    const cat = String(category || 'PRINT').trim().toUpperCase();
    if (cat === 'DC') {
      return localStorage.getItem(DC_HEADER_MODE_KEY) || 'NONE';
    }
    if (cat === 'GATE_PASS' || cat === 'GATEPASS') {
      return localStorage.getItem(GATE_PASS_HEADER_MODE_KEY) || 'NONE';
    }
    return localStorage.getItem(RPT_HEADER_MODE_KEY) || 'COMPANY';
  } catch (_) {
    return 'NONE';
  }
}

export function setRptHeaderMode(mode, category = 'PRINT') {
  try {
    const cat = String(category || 'PRINT').trim().toUpperCase();
    if (cat === 'DC') {
      localStorage.setItem(DC_HEADER_MODE_KEY, mode);
    } else if (cat === 'GATE_PASS' || cat === 'GATEPASS') {
      localStorage.setItem(GATE_PASS_HEADER_MODE_KEY, mode);
    } else {
      localStorage.setItem(RPT_HEADER_MODE_KEY, mode);
    }
  } catch (_) {}
}

export function getRptHeaderGap() {
  try {
    const raw = Number(localStorage.getItem(RPT_HEADER_GAP_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HEADER_GAP_PX;
  } catch (_) {
    return DEFAULT_HEADER_GAP_PX;
  }
}

export function setRptHeaderGap(px) {
  try {
    localStorage.setItem(RPT_HEADER_GAP_KEY, String(px));
  } catch (_) {}
}

import { getCompanyDetails } from './classicReportPrinter.js';

// Only the lines actually entered. If unset, uses company fallback masthead.
export function getCompanyHeaderLines() {
  try {
    const raw = localStorage.getItem(COMPANY_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const lines = [saved.companyName, saved.address1, saved.address2]
        .map(line => (line === null || line === undefined ? '' : String(line).trim()))
        .filter(line => line !== '');
      if (lines.length > 0) return lines;
    }
  } catch (_) {}
  const details = getCompanyDetails();
  return [details.companyName, details.address1, details.address2]
    .map(line => (line === null || line === undefined ? '' : String(line).trim()))
    .filter(line => line !== '');
}

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Renders the header block based on selected mode and transaction data (GSTIN / billType / Overrides)
export function renderRptPageHeader(data = {}, mode = null) {
  let activeData = data;
  let activeMode = mode;

  // Backward compatibility: if first parameter is string (mode), treat data as empty
  if (typeof data === 'string') {
    activeMode = data;
    activeData = {};
  }

  // 1. If explicit headerOverride is provided on data, respect it directly!
  if (!activeMode && (activeData.headerOverride || activeData.header_override)) {
    activeMode = String(activeData.headerOverride || activeData.header_override).trim().toUpperCase();
  }

  // 2. If mode is still null, resolve from category (DC, GATE_PASS, or PRINT)
  if (!activeMode) {
    const cat = activeData.category || activeData.printCategory || 'PRINT';
    activeMode = getRptHeaderMode(cat);
  }

  // Resolve AUTO_GST mode based on GSTIN, billType, isGst, Party or explicit override
  if (activeMode === 'AUTO_GST') {
    const override = String(activeData.headerOverride || activeData.header_override || '').trim().toUpperCase();

    const gstin = String(
      activeData.gstin || activeData.gstIn || activeData.gst_no || activeData.gstNo ||
      activeData.partyGstin || activeData.party_gstin || activeData.gst || activeData.gstNumber || ''
    ).trim();

    const billTypeRaw = String(
      activeData.billType || activeData.bill_type || activeData.billtype ||
      activeData.dcType || activeData.dc_type || activeData.gstType || activeData.type ||
      activeData.billingType || activeData.billing_type || ''
    ).trim().toUpperCase();

    const isGstFlag = activeData.isGst === true || activeData.is_gst === true || 
                      activeData.gstSale === true || String(activeData.isGst).toLowerCase() === 'true' || 
                      String(activeData.is_gst).toLowerCase() === 'true' || String(activeData.gstSale).toLowerCase() === 'true' || 
                      activeData.isGst === 1 || activeData.is_gst === 1 || activeData.gstSale === 1;

    const isGstBillType = billTypeRaw.length > 0 && billTypeRaw.includes('GST') && !billTypeRaw.includes('NON');
    const isNonGstBillType = billTypeRaw.includes('NON-GST') || billTypeRaw.includes('NON GST') || billTypeRaw === 'NON' || billTypeRaw === 'NON_GST';
    const hasGstin = gstin !== '' && gstin !== 'null' && gstin !== 'undefined';

    const isExplicitNonGst = isNonGstBillType || activeData.isGst === false || activeData.is_gst === false;
    const isExplicitGst = hasGstin || isGstBillType || isGstFlag;

    if (override === 'COMPANY') {
      activeMode = 'COMPANY';
    } else if (override === 'EMPTY') {
      activeMode = 'EMPTY';
    } else if (override === 'NONE') {
      activeMode = 'NONE';
    } else if (isExplicitNonGst) {
      activeMode = 'EMPTY';
    } else if (isExplicitGst) {
      activeMode = 'COMPANY';
    } else {
      activeMode = 'EMPTY';
    }
  }

  if (activeMode === 'EMPTY') {
    return `<div style="height:${getRptHeaderGap()}px;"></div>`;
  }

  if (activeMode === 'COMPANY') {
    const lines = getCompanyHeaderLines();
    if (lines.length === 0) return '';
    const [name, ...rest] = lines;
    return `
      <div style="text-align:center;line-height:1.35;padding:2px 0 11px;">
        <div style="font-weight:bold;font-size:15px;letter-spacing:.5px;">${esc(name)}</div>
        ${rest.map(line => `<div style="font-size:11.5px;letter-spacing:.2px;">${esc(line)}</div>`).join('')}
      </div>`;
  }

  return '';
}
