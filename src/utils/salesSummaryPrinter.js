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
// "DD-MM-YYYY HH:MM[:SS]" / "YYYY-MM-DD[T ]HH:MM" (+ optional separate time) →
// sortable "YYYYMMDDHHMMSS", or '' when there's no date.
function toSortStamp(dateStr, timeStr = '') {
  const s = String(dateStr || '').trim();
  let y, mo, d, rest;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s*(.*)$/);
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[T\s]*(.*)$/);
  if (dmy) {
    [, d, mo, y, rest] = dmy;
    if (y.length === 2) y = '20' + y;
    if (Number(mo) > 12) [d, mo] = [mo, d]; // US "MM/DD/YYYY" from older records
  }
  else if (ymd) { [, y, mo, d, rest] = ymd; }
  else return '';
  const timeSrc = String(timeStr || rest || '');
  const tm = timeSrc.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  let hh = tm ? Number(tm[1]) : 0;
  if (tm && /PM/i.test(timeSrc) && hh < 12) hh += 12;
  if (tm && /AM/i.test(timeSrc) && hh === 12) hh = 0;
  const hms = tm ? String(hh).padStart(2, '0') + tm[2] + (tm[3] || '00') : '000000';
  return y + mo.padStart(2, '0') + d.padStart(2, '0') + hms;
}

// When the weighment was completed (second weight taken), as a Date, or null
export function getCompletionDateTime(r) {
  const k = completionStamp(r);
  if (!k) return null;
  const n = i => Number(k.slice(i[0], i[1]));
  return new Date(n([0, 4]), n([4, 6]) - 1, n([6, 8]), n([8, 10]), n([10, 12]), n([12, 14]));
}

// A weighment is complete when its second weight is taken, i.e. the later of
// the gross and tare times. Falls back to the record's save time.
function completionStamp(r) {
  const gross = toSortStamp(r.date_time || r.dateTime || r.date, r.time);
  const tare = toSortStamp(r.tare_datetime || r.tare_date || r.tareDate, r.tare_time || r.tareTime);
  return [gross, tare].sort().pop() || toSortStamp(r.created_at) || '';
}

// Orders report rows by when each weighment was completed, earliest first.
// Rows without any date go last. Returns a new array.
export function sortRowsByCompletionTime(rows = []) {
  return rows
    .map(r => ({ r, k: completionStamp(r) }))
    .sort((a, b) => (!a.k) - (!b.k) || a.k.localeCompare(b.k))
    .map(x => x.r);
}

export function formatShortDate(dtStr) {
  if (!dtStr) return '        ';
  const str = String(dtStr).trim();
  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    // Older records saved US "MM/DD/YYYY": a "month" above 12 means it's swapped
    const [dd, mm] = Number(dmy[2]) > 12 ? [dmy[2], dmy[1]] : [dmy[1], dmy[2]];
    const d = String(dd).padStart(2, '0');
    const m = String(mm).padStart(2, '0');
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

// ---- Continuous-form paper setup ----
// Without an explicit page length the printer falls back to whatever its
// panel says, so every form feed lands somewhere different on the stationery.
// These settings are sent with each job (ESC C) so a form feed always stops
// exactly on the next perforation.
export const SALES_DM_PAPER_LENGTH_KEY = 'noris_sales_dm_paper_length_in';
export const SALES_DM_CPI_KEY = 'noris_sales_dm_cpi';
export const SALES_DM_TOP_LINES_KEY = 'noris_sales_dm_top_lines';
export const SALES_DM_BOTTOM_LINES_KEY = 'noris_sales_dm_bottom_lines';
// After the last page: 'feed' = form feed to the next perforation (default),
// 'stop' = stop when the records end: after the totals only the bottom margin is fed,
// so the totals clear the print head and the report can be torn off there.
export const SALES_DM_END_MODE_KEY = 'noris_sales_dm_end_mode';

const LINES_PER_INCH = 6; // ESC 2 → 1/6" line spacing

const readNum = (key, fallback) => {
  const raw = localStorage.getItem(key);
  const v = Number(raw);
  return raw !== null && raw !== '' && Number.isFinite(v) ? v : fallback;
};

export function getSalesDotMatrixPaperConfig() {
  const cpi = readNum(SALES_DM_CPI_KEY, 10);
  return {
    paperLengthIn: Math.max(3, Math.min(21, readNum(SALES_DM_PAPER_LENGTH_KEY, 12))),
    cpi: [10, 12, 17].includes(cpi) ? cpi : 10,
    topLines: Math.max(0, Math.min(10, readNum(SALES_DM_TOP_LINES_KEY, 3))),
    bottomLines: Math.max(0, Math.min(10, readNum(SALES_DM_BOTTOM_LINES_KEY, 3))),
    endMode: localStorage.getItem(SALES_DM_END_MODE_KEY) === 'stop' ? 'stop' : 'feed'
  };
}

export function setSalesDotMatrixPaperConfig(config = {}) {
  if (config.paperLengthIn !== undefined) localStorage.setItem(SALES_DM_PAPER_LENGTH_KEY, String(config.paperLengthIn));
  if (config.cpi !== undefined) localStorage.setItem(SALES_DM_CPI_KEY, String(config.cpi));
  if (config.topLines !== undefined) localStorage.setItem(SALES_DM_TOP_LINES_KEY, String(config.topLines));
  if (config.bottomLines !== undefined) localStorage.setItem(SALES_DM_BOTTOM_LINES_KEY, String(config.bottomLines));
  if (config.endMode !== undefined) localStorage.setItem(SALES_DM_END_MODE_KEY, config.endMode === 'stop' ? 'stop' : 'feed');
}

const ESC = '\x1b';
const FORM_FEED = '\x0c';
const PAGE_BREAK_MARK = '- - - - - - - - - - - - - - - [ page break / tear here ] - - - - - - - - - - - - -';

function getPageLayout() {
  const paper = getSalesDotMatrixPaperConfig();
  const pageLines = Math.max(12, Math.min(127, Math.round(paper.paperLengthIn * LINES_PER_INCH)));
  const usableLines = Math.max(8, pageLines - paper.topLines - paper.bottomLines);
  return { ...paper, pageLines, usableLines };
}

function buildInitSequence({ pageLines, cpi }) {
  let seq = ESC + '@';                              // reset
  seq += ESC + '2';                                 // 1/6" line spacing
  seq += ESC + 'C' + String.fromCharCode(pageLines); // page length in lines; sets top-of-form here
  seq += ESC + 'x' + '\x00';                        // draft quality
  seq += ESC + 'l' + '\x00';                        // left margin 0
  if (cpi === 12) seq += ESC + 'M';
  else seq += ESC + 'P';
  if (cpi === 17) seq += '\x0f';                    // condensed on top of pica
  return seq;
}

/**
 * Splits body blocks over pages. Every page gets the header; the footer only
 * goes on the last page, and room for it is kept on every page so it never
 * spills onto a page of its own mid-block.
 */
function paginate({ buildHeader, blocks, footer, usableLines }) {
  // Room for rows on a page = usable lines - that page's header - footer.
  // Page 1 carries the filter block; continuation pages only the title + columns.
  const capacity = page => Math.max(2, usableLines - buildHeader(page, 1).length - footer.length);

  const bodies = [[]];
  blocks.forEach(block => {
    const current = bodies[bodies.length - 1];
    if (current.length > 0 && current.length + block.length > capacity(bodies.length)) bodies.push([]);
    const target = bodies[bodies.length - 1];
    // A separator blank line is not needed at the top of a page.
    const lines = target.length === 0 ? block.slice(block.findIndex(l => l !== '')) : block;
    target.push(...lines);
  });

  const total = bodies.length;
  return bodies.map((body, i) => {
    const isLast = i === total - 1;
    return [...buildHeader(i + 1, total), ...body, ...(isLast ? footer : [])].map(l => l.trimEnd());
  });
}

function pagesToPreview(pages) {
  return pages.map(p => p.join('\n')).join('\n\n' + PAGE_BREAK_MARK + '\n\n') + '\n';
}

function pagesToRaw(pages, layout) {
  const CR_LF = '\r\n';
  let out = buildInitSequence(layout);
  pages.forEach((lines, i) => {
    out += CR_LF.repeat(layout.topLines);
    out += lines.join(CR_LF) + CR_LF;
    const isLast = i === pages.length - 1;
    // 'stop': the last page ends just below the totals (bottom margin) instead of feeding the sheet out
    out += isLast && layout.endMode === 'stop' ? CR_LF.repeat(layout.bottomLines) : FORM_FEED;
  });
  if (layout.cpi === 17) out += '\x12';
  return out;
}

const titleLine = (title, page, total, width) => {
  const tag = total > 1 ? `Page ${page} of ${total}` : '';
  return padR(title, width - tag.length) + tag;
};

// ---- Detailed Sales Report (80 columns @ 10 CPI) ----
// Column map, line 1 (all 80 columns used):
// SNo(0-2) Vehicle(4-13) Material(15-26) DC No(28-35) Gross(37-42) Date(44-51)
// Tare(53-58) Date(60-67) Nett(69-74) Dest(76-79)
// Line 2: Customer(4-26) Source(28-42) Time(44-51) Time(60-67) [Amount(68-79)]
const DETAIL_WIDTH = 80;

// Report variants sharing the detail layout:
//   sales  – Sales Summary / Boulders (default, unchanged)
//   cash   – Sales Cash: adds Amount at the end of line 2 (cols 67-78) + total
//   normal – Normal Weighment: Customer / Material / Vehicle filters, no defaults
//   yard   – Yard: Material / Vehicle filters, no Customer / Source defaults
const recordAmount = r => parseFloat(String(r.grand_total ?? r.grandTotal ?? r.amount ?? 0).replace(/[^0-9.-]/g, '')) || 0;

function detailFilterLines(variant, filters) {
  const party = filters.party || filters.contractor || '';
  const material = filters.material || filters.product || '';
  if (variant === 'yard') {
    return ['Material : ' + material, 'Vehicle : ' + (filters.vehicle || '')];
  }
  if (variant === 'normal') {
    return ['Customer : ' + party, 'Material : ' + material, 'Vehicle : ' + (filters.vehicle || '')];
  }
  return [
    'Source : ' + (filters.source || ''),
    'Destination : ' + (filters.destination || ''),
    'Customer : ' + party,
    'Material : ' + material
  ];
}

function buildDetailPages({ title, filters, fromDate, toDate, rows, totals, usableLines, variant = 'sales' }) {
  const Divider = '-'.repeat(DETAIL_WIDTH);
  const isSalesLike = variant === 'sales' || variant === 'cash';
  const withAmount = variant === 'cash';

  const buildHeader = (page, total) => [
    titleLine(title, page, total, DETAIL_WIDTH),
    // Filters / date range print on the first page only
    ...(page === 1 ? [
      ...detailFilterLines(variant, filters),
      'From Date :' + formatHeaderDate(fromDate),
      'To Date   :' + formatHeaderDate(toDate)
    ] : []),
    Divider,
    padR('SNo', 3) + ' ' +
      padR('Vehicle', 10) + ' ' +
      '  ' + padR('Material', 10) + ' ' +
      padR('DC No', 8) + ' ' +
      padL('Gross', 6) + ' ' +
      padR('Date', 8) + ' ' +
      padL('Tare', 6) + ' ' +
      padR('Date', 8) + ' ' +
      padL('Nett', 6) + ' ' +
      padR('Dest', 4),
    padR('DC', 3) + ' ' +
      padR('Customer', 23) + ' ' +
      padR('Source', 15) + ' ' +
      padR('Time', 8) + ' '.repeat(8) +
      padR('Time', 8) +
      (withAmount ? padL('Amount', 12) : ''),
    Divider
  ];

  const blocks = sortRowsByCompletionTime(rows).map((r, idx) => {
    const grossDate = formatShortDate(r.date_time || r.date || r.dateTime);
    const grossTime = formatShortTime(r.time, r.date_time || r.dateTime);
    const tareDate = formatShortDate(r.tare_datetime || r.tare_date || r.date_time || r.date);
    const tareTime = formatShortTime(r.tare_time || r.tareTime, r.tare_datetime);

    const line1 = padL(idx + 1, 3) + ' ' +
      padR((r.vehicle_no || r.vehicle || '').replace(/\s+/g, '').toUpperCase(), 10) + ' ' +
      '  ' + padR((r.product || r.material || '').toUpperCase(), 10) + ' ' +
      padR(r.dc_num || r.dcNum || r.token || (idx + 1), 8) + ' ' +
      padL(r.gross !== undefined && r.gross !== null ? r.gross : '0', 6) + ' ' +
      padR(grossDate, 8) + ' ' +
      padL(r.tare !== undefined && r.tare !== null ? r.tare : '0', 6) + ' ' +
      padR(tareDate, 8) + ' ' +
      padL(r.net ?? r.nettVal ?? (Number(r.gross || 0) - Number(r.tare || 0)), 6) + ' ' +
      padR((r.destination || (isSalesLike ? 'OUT' : '')).toUpperCase(), 4);

    const line2 = ' '.repeat(4) +
      padR((r.party || r.contractor || (isSalesLike ? 'LOCAL SALE' : '')).toUpperCase(), 23) + ' ' +
      padR((r.quarry || r.source || '').trim().toUpperCase(), 15) + ' ' +
      padR(grossTime, 8) + ' '.repeat(8) +
      padR(tareTime, 8) +
      (withAmount ? padL(recordAmount(r).toFixed(2), 12) : '');

    // A blank line separates each record from the one above it.
    return idx === 0 ? [line1, line2] : ['', line1, line2];
  });

  // Totals end under the Gross (col 42), Tare (col 58) and Nett (col 74) columns.
  const val = v => String(v !== undefined && v !== null ? v : '0');
  const footer = [
    Divider,
    padL(val(totals.gross), 43) + padL(val(totals.tare), 16) + padL(val(totals.nett), 16),
    // Amount total ends under the Amount column (col 79)
    ...(withAmount ? [padL('Total Amount : ' + rows.reduce((s, r) => s + recordAmount(r), 0).toFixed(2), 80)] : []),
    Divider
  ];

  return paginate({ buildHeader, blocks, footer, usableLines });
}

/**
 * Generates the screen preview text for Detailed Sales / Quarry Report.
 * Formatted with 2-line header, 2-line records, aligned totals and page breaks
 * exactly where the printer will break.
 */
export function generateDotMatrixDetailReportText({
  title = 'SALES Report / Summary',
  filters = {},
  fromDate = '',
  toDate = '',
  rows = [],
  totals = {},
  variant = 'sales'
}) {
  const { usableLines } = getPageLayout();
  return pagesToPreview(buildDetailPages({ title, filters, fromDate, toDate, rows, totals, usableLines, variant }));
}

/**
 * Generates raw ESC/P byte output for Detailed Sales / Quarry Report.
 */
export function generateDotMatrixDetailReportRaw({
  title = 'SALES Report / Summary',
  filters = {},
  fromDate = '',
  toDate = '',
  rows = [],
  totals = {},
  variant = 'sales'
}) {
  const layout = getPageLayout();
  const pages = buildDetailPages({ title, filters, fromDate, toDate, rows, totals, usableLines: layout.usableLines, variant });
  return pagesToRaw(pages, layout);
}

// Backward-compatible alias
export const generateDotMatrixPreviewText = generateDotMatrixDetailReportText;
export const generateDotMatrixQuarryReportText = generateDotMatrixDetailReportRaw;

// ---- Grouped Summary Reports (Material / Party / Vehicle wise ...) ----
const SUMMARY_WIDTH = 61;

function buildSummaryPages({ reportTitle, summaryName, columnName, filters, fromDate, toDate, groups, totalTrips, totalNett, usableLines }) {
  const Divider = '-'.repeat(SUMMARY_WIDTH);
  const effColName = columnName || summaryName;

  const buildHeader = (page, total) => [
    titleLine(`${reportTitle} :${summaryName}`, page, total, SUMMARY_WIDTH),
    // Filters / date range print on the first page only
    ...(page === 1 ? [
      'Contractor :' + (filters.party || filters.contractor || ''),
      'Quarry     :' + (filters.quarry || filters.material || filters.source || ''),
      'Vehicle    :' + (filters.vehicle || ''),
      reportTitle.toUpperCase().includes('QUARRY')
        ? 'Transporter:' + (filters.transporter || '')
        : 'Source     :' + (filters.source || filters.transporter || ''),
      'Destination:' + (filters.destination || ''),
      'From Date :' + formatHeaderDate(fromDate),
      'To Date   :' + formatHeaderDate(toDate)
    ] : []),
    Divider,
    padL('SNo', 3) + '   ' +
      padR(effColName, 18) + ' ' +
      padL('Trips', 6) + '            ' +
      padL('Nett', 8),
    Divider
  ];

  const blocks = groups.map((g, idx) => [
    padL(idx + 1, 2) + '   ' + ' ' +
      padR(String(g.name || g.party || g.material || g.vehicle || '').toUpperCase(), 18) + ' ' +
      padL(String(g.trips || '0'), 6) + '            ' +
      padL(String(Math.round(Number(g.nett || 0))), 8)
  ]);

  const footer = [
    Divider,
    ' '.repeat(25) +
      padL(String(totalTrips || '0'), 6) +
      '            ' +
      padL(String(Math.round(Number(totalNett || 0))), 8),
    Divider
  ];

  return paginate({ buildHeader, blocks, footer, usableLines });
}

/**
 * Generates visually aligned monospace text for Summary Reports.
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
  const { usableLines } = getPageLayout();
  return pagesToPreview(buildSummaryPages({
    reportTitle, summaryName, columnName, filters, fromDate, toDate, groups, totalTrips, totalNett, usableLines
  }));
}

/**
 * Generates raw ESC/P byte output for Summary Reports.
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
  const layout = getPageLayout();
  const pages = buildSummaryPages({
    reportTitle, summaryName, columnName, filters, fromDate, toDate, groups, totalTrips, totalNett,
    usableLines: layout.usableLines
  });
  return pagesToRaw(pages, layout);
}

/**
 * Props for <DotMatrixPreviewModal> for a detail (row by row) report.
 * Rows are ordered by completion time.
 */
export function buildDotMatrixDetailPreview(payload) {
  const full = { ...payload, rows: sortRowsByCompletionTime(payload.rows || []) };
  return {
    title: `🖨️ Dot Matrix Print Preview — ${full.title}`,
    badge: `${full.rows.length} Rows`,
    previewText: generateDotMatrixDetailReportText(full),
    rawText: generateDotMatrixDetailReportRaw(full)
  };
}

/**
 * Props for <DotMatrixPreviewModal> for a grouped summary (Material / Party / Vehicle wise).
 */
export function buildDotMatrixSummaryPreview(payload) {
  const groups = payload.groups || [];
  const full = {
    ...payload,
    groups,
    totalTrips: groups.reduce((acc, g) => acc + Number(g.trips || 0), 0),
    totalNett: groups.reduce((acc, g) => acc + Number(g.nett || 0), 0)
  };
  return {
    title: `🖨️ Dot Matrix Print Preview — ${full.reportTitle} :${full.summaryName}`,
    badge: `${groups.length} Groups`,
    previewText: generateSummarySalesMPreviewText(full),
    rawText: generateSummarySalesMReportText(full)
  };
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
