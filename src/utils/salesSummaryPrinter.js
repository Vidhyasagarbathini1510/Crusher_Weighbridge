// Utility for Sales Summary and Quarry Reports Dot-Matrix / ESC-POS formatting
// Faithful representation matching standard Dot-Matrix continuous stationery (Images 1-5).
import { getPrinterConfig } from './printHelper.js';

export const SALES_SUMMARY_PRINT_MODES = {
  NORMAL: 'NORMAL',         // Standard A4 / Plain paper HTML print window
  DOT_MATRIX: 'DOT_MATRIX'  // Raw ESC/P continuous form dot-matrix printer
};

export const SALES_SUMMARY_PRINT_KEY = 'noris_sales_summary_print_mode';

export function getSalesSummaryPrintMode() {
  return localStorage.getItem(SALES_SUMMARY_PRINT_KEY) || SALES_SUMMARY_PRINT_MODES.NORMAL;
}

export function setSalesSummaryPrintMode(mode) {
  localStorage.setItem(SALES_SUMMARY_PRINT_KEY, mode);
  try {
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('sales-summary-print-mode-changed', { detail: { mode } }));
  } catch (_) {}
}

/**
 * Format date string into 2-digit year format DD-MM-YY (e.g. 08-10-26)
 */
export function formatShortDate(dtStr) {
  if (!dtStr) return '        ';
  const str = String(dtStr).trim();
  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const d = String(dmy[1]).padStart(2, '0');
    const m = String(dmy[2]).padStart(2, '0');
    const y = String(dmy[3]).slice(-2);
    return `${d}-${m}-${y}`;
  }
  // Match YYYY-MM-DD or YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const y = String(ymd[1]).slice(-2);
    const m = String(ymd[2]).padStart(2, '0');
    const d = String(ymd[3]).padStart(2, '0');
    return `${d}-${m}-${y}`;
  }
  return str.slice(0, 8).padEnd(8);
}

/**
 * Format time string into HH:mm format (e.g. 00:18)
 */
export function formatShortTime(timeStr, dtStr) {
  const src = timeStr || dtStr || '';
  if (!src) return '     ';
  const tm = String(src).match(/(\d{1,2}):(\d{2})/);
  if (tm) {
    return `${String(tm[1]).padStart(2, '0')}:${tm[2]}`;
  }
  return '     ';
}

/**
 * Format full date & time for report headers (DD-MM-YYYY HH:mm or DD-MM-YYYY)
 */
export function formatHeaderDate(str) {
  if (!str) return '';
  const s = String(str).trim();
  // If already formatted like DD-MM-YYYY or has HH:mm
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (dmyMatch) {
    const d = String(dmyMatch[1]).padStart(2, '0');
    const m = String(dmyMatch[2]).padStart(2, '0');
    const y = dmyMatch[3];
    const timePart = dmyMatch[4] ? ` ${dmyMatch[4]}` : '';
    return `${d}-${m}-${y}${timePart}`;
  }
  const isoMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2}:\d{2}))?/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = String(isoMatch[2]).padStart(2, '0');
    const d = String(isoMatch[3]).padStart(2, '0');
    const timePart = isoMatch[4] ? ` ${isoMatch[4]}` : '';
    return `${d}-${m}-${y}${timePart}`;
  }
  return s;
}

const padR = (str, len) => String(str || '').slice(0, len).padEnd(len);
const padL = (str, len) => String(str || '').slice(0, len).padStart(len);

/**
 * Generates the screen preview text for Detailed Sales / Quarry Report (Images 1 & 2).
 * Formatted with 2-line header, 2-line records, and aligned totals.
 */
export function generateDotMatrixDetailReportText({
  title = 'SALES Report / Summary',
  filters = {},
  fromDate = '',
  toDate = '',
  rows = [],
  totals = {}
}) {
  const CR_LF = '\n';
  const Divider = '-'.repeat(88);

  let out = '';
  out += title + CR_LF;
  out += 'Source : ' + (filters.source || '') + CR_LF;
  out += 'Destination : ' + (filters.destination || '') + CR_LF;
  out += 'Customer : ' + (filters.party || filters.contractor || '') + CR_LF;
  out += 'Material : ' + (filters.material || filters.product || '') + CR_LF;
  out += 'From Date :' + formatHeaderDate(fromDate) + CR_LF;
  out += 'To Date   :' + formatHeaderDate(toDate) + CR_LF;
  out += Divider + CR_LF;

  // 2-Line Header matching Images 1 & 2
  // Line 1: SNo(3) Vehicle(12) Material(10) DC No(6) Gross(6) Date(8) Tare(6) Date(8) Nett(6) Dest(4)
  out += padL('SNo', 3) + ' ' +
         padR('Vehicle', 12) + '  ' +
         padR('Material', 10) + ' ' +
         padL('DC No', 6) + '  ' +
         padL('Gross', 6) + ' ' +
         padR('Date', 8) + '   ' +
         padL('Tare', 6) + ' ' +
         padR('Date', 8) + '   ' +
         padL('Nett', 6) + '    ' +
         padR('Dest', 4) + CR_LF;

  // Line 2: DC Customer Source Time Time
  out += 'DC  ' +
         padR('Customer', 23) + ' ' +
         padR('Source', 8) + '       ' +
         padR('Time', 8) + '      ' +
         padR('Time', 8) + CR_LF;

  out += Divider + CR_LF;

  // 2-Line Data Rows
  rows.forEach((r, idx) => {
    const sno = padL(idx + 1, 3);
    const vehicle = padR((r.vehicle_no || r.vehicle || '').toUpperCase(), 12);
    const material = padR((r.product || r.material || '').toUpperCase(), 10);
    const dcNo = padL(r.dc_num || r.dcNum || r.token || (idx + 1), 6);
    const gross = padL(r.gross !== undefined && r.gross !== null ? r.gross : '0', 6);
    const tare = padL(r.tare !== undefined && r.tare !== null ? r.tare : '0', 6);
    const nett = padL(r.net ?? r.nettVal ?? (Number(r.gross || 0) - Number(r.tare || 0)), 6);
    const dest = padR((r.destination || 'OUT').toUpperCase(), 4);

    const grossDate = formatShortDate(r.date_time || r.date || r.dateTime);
    const grossTime = formatShortTime(r.time, r.date_time || r.dateTime);

    const tareDate = formatShortDate(r.tare_datetime || r.tare_date || r.date_time || r.date);
    const tareTime = formatShortTime(r.tare_time || r.tareTime, r.tare_datetime);

    const customer = padR((r.party || r.contractor || 'LOCAL SALE').toUpperCase(), 23);
    const source = padR((r.quarry || r.source || 'CRUSHER').toUpperCase(), 8);

    // Row Line 1
    out += sno + ' ' +
           vehicle + '  ' +
           material + ' ' +
           dcNo + '  ' +
           gross + ' ' +
           grossDate + '   ' +
           tare + ' ' +
           tareDate + '   ' +
           nett + '    ' +
           dest + CR_LF;

    // Row Line 2
    out += '    ' +
           customer + ' ' +
           source + '       ' +
           grossTime + '      ' +
           tareTime + CR_LF;
  });

  out += Divider + CR_LF;

  // Footer Totals aligned under Gross, Tare, Nett columns (Image 2)
  const totalGross = String(totals.gross !== undefined && totals.gross !== null ? totals.gross : '0');
  const totalTare = String(totals.tare !== undefined && totals.tare !== null ? totals.tare : '0');
  const totalNett = String(totals.nett !== undefined && totals.nett !== null ? totals.nett : '0');

  out += ' '.repeat(33) +
         padL(totalGross, 8) +
         ' '.repeat(12) +
         padL(totalTare, 8) +
         ' '.repeat(11) +
         padL(totalNett, 8) + CR_LF;

  out += Divider + CR_LF;

  return out;
}

/**
 * Generates raw ESC/P byte output for Detailed Sales / Quarry Report (Images 1 & 2).
 */
export function generateDotMatrixDetailReportRaw({
  title = 'SALES Report / Summary',
  filters = {},
  fromDate = '',
  toDate = '',
  rows = [],
  totals = {}
}) {
  const CR_LF = '\r\n';
  const Reset = '\x1b@';
  const CondensedOn = '\x0f';
  const CondensedOff = '\x12';
  const FormFeed = '\x0c';

  const previewText = generateDotMatrixDetailReportText({
    title,
    filters,
    fromDate,
    toDate,
    rows,
    totals
  });

  // Wrap in ESC/P reset, condensed mode for crisp alignment across 88-columns, then reset and form feed
  const rawEscP = Reset + CondensedOn + previewText.replace(/\n/g, CR_LF) + CondensedOff + FormFeed;
  return rawEscP;
}

// Backward-compatible alias
export const generateDotMatrixPreviewText = generateDotMatrixDetailReportText;
export const generateDotMatrixQuarryReportText = generateDotMatrixDetailReportRaw;

/**
 * Generates visually aligned monospace text for Summary Reports (Images 3, 4, 5).
 * Matches Material Wise, Party Wise, Vehicle Wise, Quarry Wise, etc.
 */
export function generateSummarySalesMPreviewText({
  reportTitle = 'Sales Summary',
  summaryName = 'Material',
  columnName = '',
  filters = {},
  fromDate = '',
  toDate = '',
  groups = [],
  totalTrips = 0,
  totalNett = 0
}) {
  const CR_LF = '\n';
  const Divider = '-'.repeat(61);

  const effColName = columnName || summaryName;

  let out = '';
  out += `${reportTitle} :${summaryName}` + CR_LF;
  out += 'Contractor :' + (filters.party || filters.contractor || '') + CR_LF;
  out += 'Quarry     :' + (filters.quarry || filters.material || filters.source || '') + CR_LF;
  out += 'Vehicle    :' + (filters.vehicle || '') + CR_LF;
  if (reportTitle.toUpperCase().includes('QUARRY')) {
    out += 'Transporter:' + (filters.transporter || '') + CR_LF;
  } else {
    out += 'Source     :' + (filters.source || filters.transporter || '') + CR_LF;
  }
  out += 'Destination:' + (filters.destination || '') + CR_LF;
  out += 'From Date :' + formatHeaderDate(fromDate) + CR_LF;
  out += 'To Date   :' + formatHeaderDate(toDate) + CR_LF;
  out += Divider + CR_LF;

  // Header row matching Images 3, 4, 5
  // SNo(5) ColumnName(19) Trips(6) Nett(12)
  out += padL('SNo', 3) + '   ' +
         padR(effColName, 18) + ' ' +
         padL('Trips', 6) + '            ' +
         padL('Nett', 8) + CR_LF;

  out += Divider + CR_LF;

  groups.forEach((g, idx) => {
    const sno = padL(idx + 1, 2) + '   ';
    const name = padR(String(g.name || g.party || g.material || g.vehicle || '').toUpperCase(), 18);
    const trips = padL(String(g.trips || '0'), 6);
    const nettVal = String(Math.round(Number(g.nett || 0)));
    const nett = padL(nettVal, 8);

    out += sno + ' ' +
           name + ' ' +
           trips + '            ' +
           nett + CR_LF;
  });

  out += Divider + CR_LF;

  // Totals line matching Images 3, 4, 5
  const formattedTrips = padL(String(totalTrips || '0'), 6);
  const formattedTotalNett = padL(String(Math.round(Number(totalNett || 0))), 8);

  out += ' '.repeat(24) +
         formattedTrips +
         '            ' +
         formattedTotalNett + CR_LF;

  out += Divider + CR_LF;

  return out;
}

/**
 * Generates raw ESC/P byte output for Summary Reports (Images 3, 4, 5).
 */
export function generateSummarySalesMReportText({
  reportTitle = 'Sales Summary',
  summaryName = 'Material',
  columnName = '',
  filters = {},
  fromDate = '',
  toDate = '',
  groups = [],
  totalTrips = 0,
  totalNett = 0
}) {
  const CR_LF = '\r\n';
  const Reset = '\x1b@';
  const CondensedOn = '\x0f';
  const CondensedOff = '\x12';
  const FormFeed = '\x0c';

  const preview = generateSummarySalesMPreviewText({
    reportTitle,
    summaryName,
    columnName,
    filters,
    fromDate,
    toDate,
    groups,
    totalTrips,
    totalNett
  });

  return Reset + CondensedOn + preview.replace(/\n/g, CR_LF) + CondensedOff + FormFeed;
}

/**
 * Transmits the raw ESC/P byte string directly to the Dot-Matrix printer.
 */
export async function sendRawToPrinter(rawText) {
  const config = getPrinterConfig();
  const printerName = config.printerName || '';

  if (window.electronAPI && window.electronAPI.printRaw) {
    return await window.electronAPI.printRaw({
      printerName,
      rawText
    });
  } else {
    // Browser fallback
    console.log('[SalesSummaryPrinter] Native raw print not available. Output:\n', rawText);
    const win = window.open('', '_blank', 'width=900,height=650');
    if (win) {
      win.document.write(`<!DOCTYPE html><html><head><title>Dot Matrix Print</title>
        <style>body { font-family: monospace; white-space: pre; padding: 20px; }</style>
      </head><body>${rawText.replace(/[\x00-\x1f\x7f]/g, c => c === '\t' ? '\t' : c === '\n' || c === '\r' ? c : ' ')}<script>window.print();<\/script></body></html>`);
      win.document.close();
    }
    return { success: true, previewOnly: true };
  }
}

/**
 * Transmits the Sales Summary Report directly to the Dot-Matrix printer via Electron
 * or presents a preview modal in browser mode.
 */
export async function printSalesSummaryDotMatrix({
  title = 'SALES Report / Summary',
  filters = {},
  fromDate = '',
  toDate = '',
  rows = [],
  totals = {}
}) {
  const rawText = generateDotMatrixDetailReportRaw({
    title,
    filters,
    fromDate,
    toDate,
    rows,
    totals
  });

  return await sendRawToPrinter(rawText);
}
