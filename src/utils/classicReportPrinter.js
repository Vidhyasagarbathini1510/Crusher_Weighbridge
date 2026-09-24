// Plain-paper report layouts matching the format the site already issues:
// centred company masthead, rules instead of shading, and figures dense enough
// that a full day fits on one page. Deliberately separate from reportPrinter.js,
// whose card-and-colour styling suits a screen far better than a filing cabinet.

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COMPANY_STORAGE_KEY = 'noris_company_details';

const COMPANY_FALLBACK = {
  companyName: 'Noris Solutions',
  address1: 'Vinay Residency',
  address2: 'Dammaiguda ,hyderabad',
  pageFormat: 'A5 Landscape Enabled'
};

// The print window is opened synchronously, so the masthead has to come from
// somewhere that can be read without awaiting the database.
export function getCompanyDetails() {
  try {
    const raw = localStorage.getItem(COMPANY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        companyName: parsed.companyName !== undefined && parsed.companyName !== null ? parsed.companyName : '',
        address1: parsed.address1 !== undefined && parsed.address1 !== null ? parsed.address1 : '',
        address2: parsed.address2 !== undefined && parsed.address2 !== null ? parsed.address2 : '',
        pageFormat: parsed.pageFormat !== undefined && parsed.pageFormat !== null ? parsed.pageFormat : ''
      };
    }
  } catch (_) {}
  return { ...COMPANY_FALLBACK };
}

export function saveCompanyDetails(details) {
  try {
    localStorage.setItem(COMPANY_STORAGE_KEY, JSON.stringify(details));
  } catch (_) {}
}

// Records arrive with dates in whatever shape the writing screen produced them:
// '8/10/2026, 1:48:00 AM', an ISO string, or a pre-split date plus time. The
// report needs dd-mm-yyyy and HH:mm out of any of them.
function splitDateTime(value) {
  if (!value) return { date: '', time: '' };
  const str = String(value).trim();

  const pad = (n) => String(n).padStart(2, '0');
  const fromDate = (d) => ({
    date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  });

  const hasAmPm = /[ap]\.?m\.?/i.test(str);
  const looksParseable = hasAmPm || str.includes(',') || str.includes('T');
  if (looksParseable) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return fromDate(d);
  }

  // dd-mm-yyyy / dd/mm/yyyy, optionally followed by a time
  const m = str.replace(/,/g, ' ').match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    const time = m[4] ? `${pad(parseInt(m[4], 10))}:${m[5]}` : '';
    return { date: `${pad(day)}-${pad(month)}-${m[3]}`, time };
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return fromDate(d);
  return { date: str, time: '' };
}

function normaliseTime(value) {
  if (!value) return '';
  const str = String(value).trim();
  const m = str.match(/^(\d{1,2}):(\d{2})/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (/p\.?m\.?/i.test(str) && h < 12) h += 12;
    if (/a\.?m\.?/i.test(str) && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  return splitDateTime(str).time;
}

function num(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

const BASE_STYLES = `
  @page { size: A4 portrait; margin: 10mm 8mm; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    margin: 0; padding: 0;
    color: #000; background: #f1f5f9;
  }
  .preview-toolbar {
    position: sticky; top: 0; z-index: 99;
    background: #0f172a; color: #fff;
    padding: 10px 20px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; font-weight: 700;
  }
  .btn-print, .btn-close {
    border: none; border-radius: 5px; padding: 7px 18px;
    font-weight: 700; font-size: 13px; cursor: pointer; color: #fff;
  }
  .btn-print { background: #0f62fe; }
  .btn-close { background: #334155; margin-left: 8px; }
  .sheet {
    background: #fff; max-width: 210mm; margin: 16px auto; padding: 10mm 8mm;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  }
  .masthead { text-align: center; }
  .company { font-size: 13px; font-weight: 700; letter-spacing: 0.4px; }
  .addr { font-size: 10px; margin-top: 2px; }
  .rule { border-top: 1px solid #000; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { font-size: 9px; padding: 3px 4px; vertical-align: top; }
  th { font-weight: 400; text-align: left; }
  .r { text-align: right; }
  .c { text-align: center; }
  .band-top th { border-top: 1px solid #000; padding-top: 4px; }
  .band-bot { border-bottom: 1px solid #000; }
  .num { font-variant-numeric: tabular-nums; }
  tbody tr { page-break-inside: avoid; }
  .total-row td { border-top: 1px solid #000; font-weight: 700; padding-top: 5px; }
  @media print {
    .no-print { display: none !important; }
    body { background: #fff !important; }
    .sheet { margin: 0 !important; padding: 0 !important; box-shadow: none !important; max-width: 100% !important; }
  }
`;

function openPrintWindow(docTitle, bodyHtml, extraStyles = '') {
  const win = window.open('', '_blank', 'width=1000,height=860');
  if (!win) {
    alert('Please allow popups for this app to preview & print reports.');
    return;
  }
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(docTitle)}</title>
    <style>${BASE_STYLES}${extraStyles}</style></head><body>
    <div class="preview-toolbar no-print">
      <span>📄 ${escapeHtml(docTitle)}</span>
      <span>
        <button class="btn-print" onclick="window.print()">🖨️ Print</button>
        <button class="btn-close" onclick="window.close()">✖ Close</button>
      </span>
    </div>
    ${bodyHtml}
  </body></html>`);
  win.document.close();
}

function mastheadHtml() {
  const c = getCompanyDetails();
  return `<div class="masthead">
    <div class="company">${escapeHtml(c.companyName)}</div>
    <div class="addr">${escapeHtml(c.address1)}</div>
    <div class="addr">${escapeHtml(c.address2)}</div>
  </div>`;
}

export const toReportStamp = (isoDate, endOfRange) => {
  if (!isoDate) return '';
  const str = String(isoDate).trim();
  if (str.includes('T')) {
    const [dPart, tPart] = str.split('T');
    const [y, m, d] = dPart.split('-');
    if (y && m && d) {
      const timeStr = tPart ? tPart.slice(0, 5) : (endOfRange ? '23:59' : '00:00');
      return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y} ${timeStr}`;
    }
  }
  const [y, m, d] = str.split('-');
  if (!y || !m || !d) return isoDate;
  if (!endOfRange) return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y} 00:00`;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y} ${hh}:${mm}`;
};

/**
 * Grouped totals sheet - "Sales Summary / Material".
 * Nett prints in tonnes, which is how the summary is read at the gate.
 */
export function printClassicSummaryReport({
  summaryTitle = 'Sales Summary',
  groupBy = 'Material',
  fromDate = '',
  toDate = '',
  filters = {},
  groups = []
}) {
  const totalNett = groups.reduce((a, g) => a + num(g.nett), 0);
  const totalTrips = groups.reduce((a, g) => a + num(g.trips), 0);

  const isPartyAndMaterial = (groupBy || '').toLowerCase().includes('party') && (groupBy || '').toLowerCase().includes('material');

  const rowsHtml = groups.map((g, i) => {
    if (isPartyAndMaterial) {
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(g.party || g.name)}</td>
          <td>${escapeHtml(g.material || '')}</td>
          <td class="c num">${escapeHtml(g.trips)}</td>
          <td class="r num">${(num(g.nett) / 1000).toFixed(2)}</td>
        </tr>`;
    }
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(g.name)}</td>
        <td class="c num">${escapeHtml(g.trips)}</td>
        <td class="r num">${(num(g.nett) / 1000).toFixed(2)}</td>
      </tr>`;
  }).join('');

  const body = `<div class="sheet">
    ${mastheadHtml()}
    <div class="rule"></div>

    <table style="margin-top:6px">
      <tr>
        <td style="width:100%" colSpan="6"><b>${escapeHtml(summaryTitle)} : ${escapeHtml(isPartyAndMaterial ? 'Party and Material Wise' : groupBy)}</b></td>
      </tr>
    </table>
    <div class="rule"></div>

    <table style="margin-top:6px">
      <tr>
        <td style="width:12%">Party</td>
        <td style="width:26%">${escapeHtml(filters.party || '')}</td>
        <td style="width:12%">Material</td>
        <td style="width:22%">${escapeHtml(filters.material || '')}</td>
        <td style="width:12%">Source</td>
        <td>${escapeHtml(filters.source || '')}</td>
      </tr>
      <tr>
        <td>From Date</td>
        <td>${escapeHtml(fromDate)}</td>
        <td>To Date</td>
        <td>${escapeHtml(toDate)}</td>
        <td>Destination</td>
        <td>${escapeHtml(filters.destination || '')}</td>
      </tr>
    </table>
    <div class="rule"></div>

    <table style="margin-top:4px">
      <thead>
        <tr class="band-bot">
          ${isPartyAndMaterial ? `
            <th style="width:6%">S.No</th>
            <th style="width:36%">Party</th>
            <th style="width:30%">Material</th>
            <th class="c" style="width:13%">Trips</th>
            <th class="r" style="width:15%">Nett</th>
          ` : `
            <th style="width:8%">S.No</th>
            <th style="width:47%">${escapeHtml(groupBy)}</th>
            <th class="c" style="width:20%">Trips</th>
            <th class="r" style="width:25%">Nett</th>
          `}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${isPartyAndMaterial ? 5 : 4}" class="c" style="padding:18px 0">No records found.</td></tr>`}
        <tr class="total-row">
          <td colspan="${isPartyAndMaterial ? 3 : 2}" class="r" style="border-top:1px solid #000; border-bottom:1px solid #000; padding:4px 0; font-weight:700;">Total:</td>
          <td class="c num" style="border-top:1px solid #000; border-bottom:1px solid #000; padding:4px 0; font-weight:700;">${totalTrips}</td>
          <td class="r num" style="border-top:1px solid #000; border-bottom:1px solid #000; padding:4px 0; font-weight:700;">${(totalNett / 1000).toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  </div>`;

  const windowTitle = isPartyAndMaterial ? `${summaryTitle} : Party and Material Wise` : `${summaryTitle} - ${groupBy}`;
  openPrintWindow(windowTitle, body);
}

/**
 * Transaction-level sheet - "Sales Report". Each record occupies two lines so
 * that party, transporter and both weighment stamps fit across A4 portrait.
 *
 * Note on the column headings: on the sheets this was modelled from, the
 * "Source" and first "Date" headings sit one column to the left of the values
 * they describe, so transporter reads as Source and source reads as Date. The
 * headings here sit above their own data instead. Everything else - ordering,
 * spacing, the two-line record - is unchanged.
 */
export function printClassicSalesReport({
  reportTitle = 'Sales Report',
  fromDate = '',
  toDate = '',
  rows = []
}) {
  const totalNett = rows.reduce((a, r) => a + num(r.net ?? r.nettVal), 0);

  const bodyRows = rows.map((r) => {
    const gross = splitDateTime(r.date_time || r.created_at || r.dateTime);
    const tareDate = r.tare_date || r.tareDate;
    const tareTime = normaliseTime(r.tare_time || r.tareTime);
    const tare = tareDate
      ? { date: splitDateTime(tareDate).date, time: tareTime }
      : { date: gross.date, time: tareTime };

    return `
      <tr>
        <td>${escapeHtml(r.dc_num || r.dcNum || r.token || '')}</td>
        <td>${escapeHtml(r.vehicle_no || r.vehicle || '')}</td>
        <td>${escapeHtml(r.party || '')}</td>
        <td>${escapeHtml(r.product || r.material || '')}</td>
        <td>${escapeHtml(r.transporter || '')}</td>
        <td class="r num gross-col">${num(r.gross).toLocaleString('en-IN')}</td>
        <td class="source-col">${escapeHtml(r.quarry || r.source || '')}</td>
        <td class="r num">${num(r.tare).toLocaleString('en-IN')}</td>
        <td class="c num">${escapeHtml(tare.time)}</td>
        <td class="r num">${num(r.net ?? r.nettVal).toLocaleString('en-IN')}</td>
      </tr>
      <tr class="second-line">
        <td>${escapeHtml(r.your_dc || r.yourDc || '')}</td>
        <td></td>
        <td>${escapeHtml(gross.date)}</td>
        <td></td>
        <td>${escapeHtml(r.destination || '')}</td>
        <td class="gross-col"></td>
        <td class="c num source-col">${escapeHtml(gross.time)}</td>
        <td></td>
        <td class="c num">${escapeHtml(tare.date)}</td>
        <td></td>
      </tr>`;
  }).join('');

  const styles = `
    .second-line td { border-bottom: 1px solid #000; padding-bottom: 4px; }
    tbody tr:first-child td { padding-top: 4px; }
    th.sub { font-size: 8.5px; }
    .gross-col { text-align: right; padding-right: 16px !important; }
    .source-col { padding-left: 10px !important; }
  `;

  const body = `<div class="sheet">
    ${mastheadHtml()}
    <div class="rule"></div>

    <table style="margin-top:6px">
      <tr>
        <td style="width:14%">From Date</td>
        <td style="width:26%">${escapeHtml(fromDate)}</td>
        <td class="c" style="width:30%"><b>${escapeHtml(reportTitle)}</b></td>
        <td></td>
      </tr>
      <tr>
        <td>To Date</td>
        <td>${escapeHtml(toDate)}</td>
        <td></td>
        <td></td>
      </tr>
    </table>
    <div class="rule"></div>

    <table style="margin-top:2px">
      <thead>
        <tr>
          <th style="width:7%">DC Num</th>
          <th style="width:9%">Vehicle</th>
          <th style="width:16%">Party</th>
          <th style="width:9%">Material</th>
          <th style="width:13%">Transporter</th>
          <th class="r gross-col" style="width:9%">Gross</th>
          <th class="source-col" style="width:13%">Source</th>
          <th class="r" style="width:8%">Tare</th>
          <th class="c" style="width:8%">Time</th>
          <th class="r" style="width:8%">Nett</th>
        </tr>
        <tr class="band-bot">
          <th class="sub">My DC</th>
          <th class="sub"></th>
          <th class="sub">Date</th>
          <th class="sub"></th>
          <th class="sub">Destination</th>
          <th class="sub gross-col"></th>
          <th class="sub c source-col">Time</th>
          <th class="sub"></th>
          <th class="sub c">Date</th>
          <th class="sub"></th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || '<tr><td colspan="10" class="c" style="padding:18px 0">No records found.</td></tr>'}
        <tr class="total-row">
          <td colspan="9" class="r">Total Nett</td>
          <td class="r num">${totalNett.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
    </table>
  </div>`;

  openPrintWindow(reportTitle, body, styles);
}
