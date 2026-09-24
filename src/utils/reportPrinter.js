import { getCompanyDetails } from './classicReportPrinter.js';

// Report cells come straight from database fields, so a value containing < or &
// would otherwise break the page layout.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function printReport({
  title,
  subtitle = '',
  dateRange = '',
  metrics = [],
  headers = [],
  rows = [],
  footerText = 'NORIS Weighbridge Management System'
}) {
  const printWindow = window.open('', '_blank', 'width=1150,height=850');
  if (!printWindow) {
    alert('Please allow popups for this app to preview & print reports.');
    return;
  }

  const currentDate = new Date().toLocaleString();

  const metricsHtml = metrics.length > 0 ? `
    <section class="summary" aria-label="Report totals">
      ${metrics.map(m => `
        <div class="summary-card">
          <div class="summary-label">${escapeHtml(m.label)}</div>
          <div class="summary-value">${escapeHtml(m.value)}</div>
        </div>
      `).join('')}
    </section>
  ` : '';

  // A leading serial-number column makes a long statement easy to read aloud
  // and to cross-check against the screen.
  const tableHeadersHtml = `
    <th class="col-serial">#</th>
    ${headers.map(h => `
      <th class="align-${h.align || 'left'}">${escapeHtml(h.label)}</th>
    `).join('')}
  `;

  const tableRowsHtml = rows.map((row, idx) => `
    <tr>
      <td class="col-serial">${idx + 1}</td>
      ${row.map((cell, colIdx) => {
        const align = headers[colIdx]?.align || 'left';
        const classes = ['align-' + align];
        if (align === 'right') classes.push('numeric');
        if (colIdx === 0) classes.push('key-cell');
        return `<td class="${classes.join(' ')}">${escapeHtml(cell)}</td>`;
      }).join('')}
    </tr>
  `).join('');

  const content = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Preview & Print - ${title}</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 12mm;
          }
          body {
            font-family: 'Segoe UI', Roboto, -apple-system, sans-serif;
            margin: 0;
            padding: 0;
            color: #0f172a;
            background: #f1f5f9;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .preview-toolbar {
            position: sticky;
            top: 0;
            background: #0f172a;
            color: #ffffff;
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 9999;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.15);
            border-bottom: 3px solid #0f62fe;
          }
          .toolbar-title {
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .btn-print {
            background: #0f62fe;
            color: #ffffff;
            border: none;
            border-radius: 6px;
            padding: 8px 20px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            box-shadow: 0 2px 4px rgba(15,98,254,0.3);
          }
          .btn-print:hover {
            background: #0353e9;
          }
          .btn-close {
            background: #334155;
            color: #ffffff;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            margin-left: 10px;
          }
          .btn-close:hover {
            background: #475569;
          }
          .document-wrapper {
            max-width: 1100px;
            margin: 20px auto;
            background: #ffffff;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            border: 1px solid #cbd5e1;
          }
          /* ---- Document masthead ---- */
          .report-header {
            border-bottom: 2.5px solid #0f172a;
            padding-bottom: 14px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 24px;
          }
          .company-name {
            font-size: 21px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: 1.2px;
            text-transform: uppercase;
          }
          .report-title {
            font-size: 13px;
            font-weight: 700;
            color: #0f62fe;
            text-transform: uppercase;
            margin-top: 5px;
            letter-spacing: 0.6px;
          }
          .report-scope {
            font-size: 11px;
            color: #64748b;
            margin-top: 3px;
          }
          /* Label / value pairs so the reader's eye can scan straight down */
          .meta-info {
            font-size: 10.5px;
            color: #334155;
            text-align: right;
            line-height: 1.7;
            white-space: nowrap;
          }
          .meta-info .meta-label {
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            font-size: 9.5px;
            font-weight: 700;
            margin-right: 6px;
          }

          /* ---- Totals band ---- */
          .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
          }
          .summary-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-left: 3px solid #0f62fe;
            border-radius: 4px;
            padding: 8px 12px;
          }
          .summary-label {
            font-size: 9px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.6px;
          }
          .summary-value {
            font-size: 14px;
            font-weight: 800;
            color: #0f172a;
            margin-top: 3px;
            font-variant-numeric: tabular-nums;
          }

          /* ---- Data table ---- */
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 4px;
          }
          /* Repeats the column titles at the top of every printed page. */
          thead { display: table-header-group; }
          th {
            padding: 9px 10px;
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
            background-color: #eef2f7;
            border-top: 1.5px solid #0f172a;
            border-bottom: 1.5px solid #0f172a;
          }
          td {
            padding: 7px 10px;
            font-size: 10.5px;
            color: #1e293b;
            border-bottom: 1px solid #e8edf3;
          }
          /* Never cut a record in half across a page break. */
          tbody tr { page-break-inside: avoid; }
          tbody tr:nth-child(even) { background-color: #fafbfc; }
          .align-left   { text-align: left; }
          .align-right  { text-align: right; }
          .align-center { text-align: center; }
          /* Equal-width digits so weight columns line up on the decimal. */
          .numeric { font-variant-numeric: tabular-nums; font-weight: 600; }
          .key-cell { font-weight: 700; color: #0f172a; }
          .col-serial {
            width: 34px;
            text-align: center;
            color: #94a3b8;
            font-size: 9.5px;
          }
          th.col-serial { color: #0f172a; }
          .empty-row td {
            text-align: center;
            padding: 28px;
            color: #94a3b8;
            font-size: 11px;
          }

          /* ---- Sign-off + footer ---- */
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 42px;
            page-break-inside: avoid;
          }
          .sign-line {
            width: 170px;
            border-top: 1px solid #94a3b8;
            padding-top: 5px;
            text-align: center;
            font-size: 10px;
            color: #334155;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }
          .footer {
            margin-top: 22px;
            padding-top: 10px;
            border-top: 1px solid #cbd5e1;
            display: flex;
            justify-content: space-between;
            font-size: 9.5px;
            color: #64748b;
          }
          @media print {
            .no-print {
              display: none !important;
            }
            body {
              background: #ffffff !important;
              padding: 0 !important;
            }
            .document-wrapper {
              margin: 0 !important;
              padding: 0 !important;
              box-shadow: none !important;
              border: none !important;
              border-radius: 0 !important;
              max-width: 100% !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="preview-toolbar no-print">
          <div class="toolbar-title">
            📄 Print Preview — ${escapeHtml(title)}
          </div>
          <div>
            <button class="btn-print" onclick="window.print()">
              🖨️ Print Document
            </button>
            <button class="btn-close" onclick="window.close()">
              ✖ Close
            </button>
          </div>
        </div>

        <div class="document-wrapper">
          <div class="report-header">
            <div>
              <div class="company-name">NORIS WEIGHBRIDGE</div>
              <div class="report-title">${escapeHtml(title)}</div>
              ${subtitle ? `<div class="report-scope">${escapeHtml(subtitle.toUpperCase())} view</div>` : ''}
            </div>
            <div class="meta-info">
              ${dateRange ? `<div><span class="meta-label">Period</span>${escapeHtml(dateRange)}</div>` : ''}
              <div><span class="meta-label">Records</span>${rows.length}</div>
              <div><span class="meta-label">Printed</span>${escapeHtml(currentDate)}</div>
            </div>
          </div>

          ${metricsHtml}

          <table>
            <thead>
              <tr>${tableHeadersHtml}</tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
              ${rows.length === 0 ? `<tr class="empty-row"><td colspan="${headers.length + 1}">No records found for the selected filters.</td></tr>` : ''}
            </tbody>
          </table>

          <div class="signatures">
            <div class="sign-line">Prepared By</div>
            <div class="sign-line">Checked By</div>
            <div class="sign-line">Authorized Signatory</div>
          </div>

          <div class="footer">
            <div>${escapeHtml(footerText)}</div>
            <div>NORIS Weighbridge Desktop</div>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(content);
  printWindow.document.close();
}

export function printSingleTicketSlip(data = {}) {
  const printWindow = window.open('', '_blank', 'width=950,height=800');
  if (!printWindow) {
    alert('Please allow popups for this app to preview & print tickets.');
    return;
  }

  const dcNo = data.dc_num || data.dcNum || data.token || `TK-${data.id || '001'}`;
  const dateTime = data.date_time || data.created_at || new Date().toLocaleString();
  const vehicle = data.vehicle_no || data.vehicle || 'N/A';
  const party = data.party || data.contractor || 'LOCAL SALE';
  const material = data.product || data.material || 'AGGREGATE / BOULDERS';
  const source = data.quarry || data.source || 'CRUSHER';
  const destination = data.destination || 'OUT';
  const payment = data.payment || 'Credit';
  
  const gross = Number(data.gross || 0);
  const tare = Number(data.tare || 0);
  const nett = Number(data.net || data.nettVal || 0);
  const rate = Number(data.rate || 0);
  const transport = Number(data.transport || 0);
  const discount = Number(data.discount || 0);
  const royaltyAmount = Number(data.royalty_amount || data.royaltyAmount || 0);

  let tareDate = data.tareDate || data.tare_date || '';
  let tareTime = data.tareTime || data.tare_time || '';
  let tareDateTime = tareDate ? (tareTime ? `${tareDate} ${tareTime}` : tareDate) : dateTime;

  const amtStr = String(data.grand_total || data.grandTotal || data.amount || 0).replace(/[^0-9.-]/g, '');
  const amtParsed = parseFloat(amtStr);
  const totalAmt = !isNaN(amtParsed) && amtParsed > 0 ? amtParsed : (nett > 0 && rate > 0 ? (nett / 1000) * rate + transport - discount + royaltyAmount : 0);

  const company = getCompanyDetails();

  const content = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Preview & Print Pass - ${dcNo}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            font-family: 'Segoe UI', Roboto, -apple-system, sans-serif;
            margin: 0;
            padding: 0;
            color: #0f172a;
            background: #f1f5f9;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .preview-toolbar {
            position: sticky;
            top: 0;
            background: #002b5c;
            color: #ffffff;
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 9999;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.15);
            border-bottom: 3px solid #00438c;
          }
          .toolbar-title {
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .btn-print {
            background: #00438c;
            color: #ffffff;
            border: none;
            border-radius: 6px;
            padding: 8px 20px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 4px rgba(0,67,140,0.3);
          }
          .btn-print:hover {
            background: #003366;
          }
          .btn-close {
            background: #334155;
            color: #ffffff;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            margin-left: 10px;
          }
          .btn-close:hover {
            background: #475569;
          }
          .slip-wrapper {
            max-width: 860px;
            margin: 20px auto;
            background: #ffffff;
            padding: 24px;
            border-radius: 18px;
            box-shadow: 0 8px 20px rgba(0,0,0,0.06);
          }
          .slip-container {
            border: 2px solid #00438c;
            border-radius: 16px;
            padding: 22px 26px;
            background: #ffffff;
          }
          .slip-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .brand-left {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .brand-title {
            font-size: 24px;
            font-weight: 900;
            color: #0a2540;
            letter-spacing: 0.5px;
            line-height: 1.1;
          }
          .brand-subtitle {
            font-size: 11px;
            color: #64748b;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-top: 3px;
          }
          .dc-badge {
            background: #00438c;
            color: #ffffff;
            font-size: 16px;
            font-weight: 800;
            padding: 7px 22px;
            border-radius: 10px;
            letter-spacing: 0.5px;
          }
          .divider {
            border: none;
            border-top: 1px solid #e2e8f0;
            margin: 14px 0 18px 0;
          }
          .grid-meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 36px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 20px;
            margin-bottom: 18px;
            font-size: 11px;
          }
          .meta-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 5px;
          }
          .meta-label {
            color: #475569;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.3px;
          }
          .meta-val {
            color: #0f172a;
            font-weight: 800;
            font-size: 12px;
          }
          .weight-cards {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 14px;
            margin-bottom: 18px;
          }
          .weight-box {
            border-radius: 12px;
            padding: 14px;
            text-align: center;
            border: 1.5px solid #cbd5e1;
          }
          .weight-box.gross { background: #eff6ff; border-color: #bfdbfe; }
          .weight-box.tare { background: #f0fdf4; border-color: #bbf7d0; }
          .weight-box.nett { background: #fef2f2; border-color: #fecaca; }
          .w-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
          .w-title.gross { color: #1e40af; }
          .w-title.tare { color: #166534; }
          .w-title.nett { color: #991b1b; }

          .w-num { font-size: 24px; font-weight: 900; margin-top: 4px; }
          .w-num.gross { color: #1d4ed8; }
          .w-num.tare { color: #15803d; }
          .w-num.nett { color: #b91c1c; }

          .amount-banner {
            background: #002b5c;
            color: #ffffff;
            border-radius: 10px;
            padding: 12px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 22px;
          }
          .amt-txt { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
          .amt-val { font-size: 22px; font-weight: 900; color: #10b981; }

          .signatures {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 6px;
          }
          .sig-col {
            flex: 1;
            text-align: center;
            border-right: 1px solid #cbd5e1;
            padding: 0 10px;
          }
          .sig-col:last-child {
            border-right: none;
          }
          .sig-icon {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 32px;
          }
          .sig-line {
            border-bottom: 1.5px solid #475569;
            width: 75%;
            margin: 8px auto 6px auto;
          }
          .sig-label {
            font-size: 11px;
            color: #334155;
            font-weight: 700;
          }

          @media print {
            .no-print {
              display: none !important;
            }
            body {
              background: #ffffff !important;
              padding: 0 !important;
            }
            .slip-wrapper {
              margin: 0 !important;
              padding: 0 !important;
              box-shadow: none !important;
              border: none !important;
              max-width: 100% !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="preview-toolbar no-print">
          <div class="toolbar-title">
            📄 Weighment Pass Print Preview - ${dcNo}
          </div>
          <div>
            <button class="btn-print" onclick="window.print()">
              🖨️ Print Ticket Pass Now
            </button>
            <button class="btn-close" onclick="window.close()">
              ✖ Close Preview
            </button>
          </div>
        </div>

        <div class="slip-wrapper">
          <div class="slip-container">
            <div class="slip-header">
              <div class="brand-left">
                <!-- Truck Logo -->
                <svg width="46" height="46" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4" y="44" width="56" height="6" rx="3" fill="#00438C"/>
                  <path d="M12 36C12 33.7909 13.7909 32 16 32H38V44H12V36Z" fill="#00438C"/>
                  <path d="M38 32H48L54 37V44H38V32Z" fill="#0066CC"/>
                  <circle cx="20" cy="44" r="5" fill="#0A2540" stroke="#FFFFFF" stroke-width="2"/>
                  <circle cx="44" cy="44" r="5" fill="#0A2540" stroke="#FFFFFF" stroke-width="2"/>
                </svg>
                <div>
                  <div class="brand-title">${escapeHtml(company.companyName || 'NORIS WEIGHBRIDGE')}</div>
                  <div class="brand-subtitle">${escapeHtml([company.address1, company.address2].filter(Boolean).join(', ') || 'Official Weighment Pass / Delivery Slip')}</div>
                </div>
              </div>
              <div class="dc-badge">${dcNo}</div>
            </div>

            <hr class="divider" />

            <div class="grid-meta">
              <div class="meta-item"><span class="meta-label">Gross Date & Time</span><span class="meta-val">${dateTime}</span></div>
              <div class="meta-item"><span class="meta-label">Tare Date & Time</span><span class="meta-val">${tareDateTime}</span></div>
              <div class="meta-item"><span class="meta-label">Vehicle No</span><span class="meta-val">${vehicle}</span></div>
              <div class="meta-item"><span class="meta-label">Party / Customer</span><span class="meta-val">${party}</span></div>
              <div class="meta-item"><span class="meta-label">Material</span><span class="meta-val">${material}</span></div>
              <div class="meta-item"><span class="meta-label">Source / Quarry</span><span class="meta-val">${source}</span></div>
              <div class="meta-item"><span class="meta-label">Payment Mode</span><span class="meta-val">${payment}</span></div>
              ${destination && destination !== 'N/A' ? `<div class="meta-item"><span class="meta-label">Destination</span><span class="meta-val">${destination}</span></div>` : ''}
            </div>

            <div class="weight-cards">
              <div class="weight-box gross">
                <div class="w-title gross">Gross Weight</div>
                <div class="w-num gross">${gross.toLocaleString()} <span style="font-size:12px; font-weight:700">kg</span></div>
                <div style="font-size:10px; font-weight:700; color:#1e40af; margin-top:4px;">${dateTime}</div>
              </div>
              <div class="weight-box tare">
                <div class="w-title tare">Tare Weight</div>
                <div class="w-num tare">${tare.toLocaleString()} <span style="font-size:12px; font-weight:700">kg</span></div>
                <div style="font-size:10px; font-weight:700; color:#166534; margin-top:4px;">${tareDateTime}</div>
              </div>
              <div class="weight-box nett">
                <div class="w-title nett">Nett Weight</div>
                <div class="w-num nett">${nett.toLocaleString()} <span style="font-size:12px; font-weight:700">kg</span></div>
              </div>
            </div>

            ${totalAmt > 0 ? `
              <div class="amount-banner">
                <div class="amt-txt">Total Amount Paid / Payable</div>
                <div class="amt-val">₹ ${totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            ` : ''}

            <div class="signatures">
              <div class="sig-col">
                <div class="sig-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00438C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                    <path d="M2 2l7.586 7.586"/>
                    <circle cx="11" cy="11" r="2"/>
                  </svg>
                </div>
                <div class="sig-line"></div>
                <div class="sig-label">Operator Signature</div>
              </div>

              <div class="sig-col">
                <div class="sig-icon">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00438C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="1" y="3" width="15" height="13"/>
                    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
                    <circle cx="5.5" cy="18.5" r="2.5"/>
                    <circle cx="18.5" cy="18.5" r="2.5"/>
                  </svg>
                </div>
                <div class="sig-line"></div>
                <div class="sig-label">Driver Signature</div>
              </div>

              <div class="sig-col">
                <div class="sig-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00438C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2l2.4 1.8 3-.4.8 2.9 2.8 1.2-.8 2.9 1.8 2.4-1.8 2.4.8 2.9-2.8 1.2-.8 2.9-3-.4L12 22l-2.4-1.8-3 .4-.8-2.9-2.8-1.2.8-2.9-1.8-2.4 1.8-2.4-.8-2.9 2.8-1.2.8-2.9 3 .4L12 2z"/>
                    <path d="M9 12l2 2 4-4"/>
                  </svg>
                </div>
                <div class="sig-line"></div>
                <div class="sig-label">Authorized Seal</div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(content);
  printWindow.document.close();
}
