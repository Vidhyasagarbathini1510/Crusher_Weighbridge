// Slip layouts carried over from the site's Crystal Reports designs so the
// desktop app prints exactly what the old QCS Visual Studio project printed.
//
// One builder per .rpt:
//   RPT-SALESBILL1   SalesBill1.rpt    boxed WEIGHMENT SLIP, operator/driver
//   RPT-SALESBILLSR  SalesBillSR.rpt   ruled WEIGHMENT, operator/receiver
//   RPT-SALESBILL2   SalesBill2.rpt    three slips per page, supervisor sign
//   RPT-SALESBILL9   SalesBill9.rpt    DELIVERY CHALLAN SLIP with GSTIN
//   RPT-SLIPPRINT    SlipPrint.rpt     two-up Loading Slip / Loading DC
//   RPT-SLIPPRINT2   SlipPrint2.rpt    two-up Delivery Challan with RST
//   RPT-CHALLAN-A4   full-page DELIVERY CHALLAN + weighment slip footer
//   RPT-SALESRECEIPT two-up SALES RECEIPT with OUT/IN times
//   RPT-WEIGHSLIP2   two-up weighment slip with transporter line
//
// Crystal leaves a field blank when it has no value, and these do the same —
// an empty slip is the correct rendering of an empty record, not a bug.

export const RPT_TEMPLATE_CATALOGUE = [
  { id: 'RPT-SALESBILL1', name: 'Weighment Slip (Boxed)', detail: 'SalesBill1.rpt — boxed, amount + driver', paper: 'A5 L' },
  { id: 'RPT-SALESBILLSR', name: 'Weighment (Ruled)', detail: 'SalesBillSR.rpt — operator + receiver sign', paper: 'A5 L' },
  { id: 'RPT-SALESBILL2', name: 'Weighment 4-Up', detail: 'SalesBill2.rpt — four slips per page', paper: 'A4' },
  { id: 'RPT-SALESBILL2-NOGATEPASS', name: 'Weighment 4-Up (No Gate Pass)', detail: 'SalesBill2.rpt — four slips per page without Gate Pass box', paper: 'A4' },
  { id: 'RPT-SALESBILL9', name: 'Delivery Challan Slip', detail: 'SalesBill9.rpt — customer + GSTIN', paper: 'A5 L' },
  { id: 'RPT-SLIPPRINT', name: 'Loading Slip 2-Up', detail: 'SlipPrint.rpt — slip + loading DC', paper: 'A5 L' },
  { id: 'RPT-SLIPPRINT2', name: 'Delivery Challan 2-Up', detail: 'SlipPrint2.rpt — with RST number', paper: 'A5 L' },
  { id: 'RPT-CHALLAN-A4', name: 'Delivery Challan (Full)', detail: 'HSN table + weighment slip', paper: 'A4' },
  { id: 'RPT-SALESRECEIPT', name: 'Sales Receipt 2-Up', detail: 'Sl. Num, OUT / IN times', paper: 'A5 L' },
  { id: 'RPT-WEIGHSLIP2', name: 'Weighment Slip 2-Up', detail: 'Two slips, transporter + driver', paper: 'A4' },
  { id: 'RPT-CCTV-A4', name: 'Weighment CCTV 2-Up (AMR)', detail: 'SlipPrintCCTV.rpt — A4 2-Up dual slip with CCTV camera images', paper: 'A4' }
];

// The paper above is the sheet the site actually feeds for each form, not the
// sheet the Crystal original was set up for. The slip is scaled to whatever it
// says — a form drawn for a half sheet grows into an A4 page rather than sitting
// as a small block in the middle of it — so this line is what decides how large
// each layout prints.

export const RPT_TEMPLATE_IDS = RPT_TEMPLATE_CATALOGUE.map(t => t.id);

import { renderRptPageHeader, getCompanyHeaderLines } from './rptPageHeader.js';

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Crystal prints these captions with a space between every letter and a wide
// gap between words. The gap has to be non-breaking spaces — HTML would
// collapse a run of ordinary ones and the words would read as a single caption.
function spaced(text) {
  return String(text)
    .split(/\s+/)
    .map(word => word.split('').join(' '))
    .join('     ');
}

// Weights print as the weighbridge reads them — 59260, not 59,260. The printed
// slips the site files have never carried a thousands separator, and a comma in
// the middle of a figure is what makes two slips look like different documents.
const wt = v => (v === 0 || v ? String(v).replace(/,/g, '').trim() : '');

// The slips are filled from whatever the calling screen passes; each caption
// keeps its place on the form whether or not a value arrived with it.
function fields(d = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = d[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const now = new Date();
  const dd = n => String(n).padStart(2, '0');
  const fallbackDate = `${dd(now.getDate())}-${dd(now.getMonth() + 1)}-${now.getFullYear()}`;
  const fallbackTime = `${dd(now.getHours())}:${dd(now.getMinutes())}`;

  let grossDate = pick('date', 'grossDate', 'gross_date');
  let grossTime = pick('time', 'grossTime', 'gross_time');
  const dt = pick('date_time', 'dateTime', 'created_at');
  if (dt && (!grossDate || !grossTime)) {
    const parts = dt.split(/[,\s]+/);
    if (!grossDate && parts[0]) grossDate = parts[0];
    if (!grossTime && parts.length > 1) grossTime = parts.slice(1).join(' ');
  }
  if (!grossDate) grossDate = fallbackDate;
  if (!grossTime) grossTime = fallbackTime;

  const tareVal = wt(pick('tare'));
  let tareDate = pick('tareDate', 'tare_date');
  let tareTime = pick('tareTime', 'tare_time');
  if (!tareDate && tareVal) tareDate = grossDate;
  if (!tareTime && tareVal) tareTime = grossTime;

  return {
    ...d,
    dcNum: pick('dcNum', 'dc_num', 'token', 'serial_no'),
    rstNum: pick('rstNum', 'rst_num', 'rst', 'dcNum', 'dc_num'),
    slNum: pick('slNum', 'sl_num', 'dcNum', 'dc_num'),
    vehicle: pick('vehicle', 'vehicle_no', 'vehicleNo').toUpperCase(),
    material: pick('material', 'product'),
    party: pick('party', 'customer', 'customerName'),
    destination: pick('destination') || 'OUT',
    source: pick('source', 'quarry'),
    transporter: pick('transporter', 'transporterName'),
    driver: pick('driver', 'driverName'),
    phone: pick('phone', 'mobileNo', 'mobile'),
    gross: wt(pick('gross')),
    tare: tareVal,
    nett: wt(pick('net', 'nett')),
    // The same three figures with no thousands separator. The challan slip
    // prints them plain — 59260, not 59,260 — the way the weighbridge reads.
    grossRaw: pick('gross').replace(/,/g, ''),
    tareRaw: tareVal.replace(/,/g, ''),
    nettRaw: pick('net', 'nett').replace(/,/g, ''),
    amount: pick('amount', 'grand_total', 'grandTotal'),
    grossDate: grossDate,
    grossTime: grossTime,
    tareDate: tareDate,
    tareTime: tareTime,
    outTime: pick('outTime', 'time', 'grossTime') || grossTime,
    inTime: pick('inTime', 'tareTime', 'tare_time') || tareTime || grossTime,
    gstin: pick('gstin', 'gstIn'),
    address1: pick('address1', 'companyName'),
    address2: pick('address2'),
    address3: pick('address3'),
    siteAddress: pick('siteAddress', 'site_address'),
    // The customer's own address, kept apart from address1 — that one is the
    // company header and must never print on the customer line.
    customerAddress: pick('customerAddress', 'customer_address', 'partyAddress', 'party_address'),
    remarks: pick('remarks'),
    consignee: pick('consignee', 'party', 'customer'),
    customerPO: pick('customerPO', 'po_number', 'poNumber'),
    stationary: pick('stationary'),
    item: pick('item', 'material', 'product'),
    hsn: pick('hsn') || '2517',
    units: pick('units', 'unit_type', 'unitType') || 'Tonnes',
    qty: pick('qty', 'units_val', 'unitsVal'),
    quantity: pick('quantity', 'qty', 'units_val', 'unitsVal') || '0',
    contact: pick('phone', 'mobileNo', 'mobile', 'contact'),
    img1: pick('image_base64', 'image_path', 'imageBase64', 'imagePath', 'image1'),
    img2: pick('image_base64_2', 'image_path_2', 'imageBase64_2', 'imagePath_2', 'image2'),
    date1: grossDate,
    time1: grossTime
  };
}

// ---- shared building blocks -------------------------------------------------

const SANS = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const BAND = '#d9d9d9';

// Print drivers drop background fill unless the page asks for it by name, which
// is what turned the grey caption bands into plain white strips on paper.
const INK = 'print-color-adjust:exact;-webkit-print-color-adjust:exact;';

// The page header is whatever Settings says it should be — nothing by default,
// so an unconfigured machine keeps printing the slip exactly as it did before.
// 13px rather than 11px: these forms were drawn for a half sheet, so at their
// original size the lettering reads small once it lands on A4. Every size below
// is raised by roughly the same fifth so the slips stay in proportion.
const wrap = (inner, { width = '100%', font = '13.5px', data = {} } = {}) => `
  <div style="font-family:${SANS};font-size:${font};color:#000;background:#fff;max-width:100%;width:100%;margin:0 auto;padding:4px 6px;box-sizing:border-box;">
    ${renderRptPageHeader(data)}
    ${inner}
  </div>`;

// A caption sitting on the grey band Crystal uses for section headings. The band
// runs the full width of the frame it sits in — a band that starts part way
// across reads as a printing fault rather than as a heading.
const band = (text, colspan) => `
  <tr><td colspan="${colspan}" style="background:${BAND};${INK}border-bottom:1px solid #000;text-align:center;font-weight:bold;letter-spacing:1px;padding:5px 0;font-size:13px;">
    ${esc(spaced(text))}
  </td></tr>`;

// label : value, with the value on the ruled line the original draws for it.
const cell = (label, value, { bold = false, rule = 'none', width = '' } = {}) => `
  <td style="padding:4px 5px;${width ? `width:${width};` : ''}white-space:nowrap;">
    <span style="letter-spacing:.8px;">${esc(label)}</span>
  </td>
  <td style="padding:4px 3px;">:</td>
  <td style="padding:4px 5px;${bold ? 'font-weight:bold;' : ''}border-bottom:${rule};">
    ${esc(value)}
  </td>`;

const signRow = (left, right, extra = '') => `
  <div style="display:flex;justify-content:space-between;margin-top:34px;padding:0 7px;font-size:12.5px;letter-spacing:.5px;">
    <span>${esc(left)}</span>${extra ? `<span>${esc(extra)}</span>` : ''}<span>${esc(right)}</span>
  </div>`;

// ---- SalesBill1.rpt : boxed WEIGHMENT SLIP ---------------------------------

// One set of column stops for every row of the SalesBill1 / SalesBill2 family.
// Both forms carry two captions on their identity rows and three on their weight
// rows, so the grid is nine columns wide — caption, colon and value, three times
// over. Sizing every stop here is what puts VEHICLE, DATE and TRANSPORTER in one
// column instead of wherever the widest value happened to push them; the browser
// used to size these columns from their contents, which is why the gap after
// DATE swallowed a third of the slip.
const BILL_COLS = `
  <colgroup>
    <col style="width:18%"><col style="width:2%"><col style="width:16%">
    <col style="width:21%"><col style="width:2%"><col style="width:15%">
    <col style="width:12%"><col style="width:2%"><col style="width:12%">
  </colgroup>`;

const BILL_LBL = 'padding:5px 4px 5px 6px;white-space:nowrap;';
const BILL_SEP = 'padding:5px 0;';
const BILL_VAL = 'padding:5px 5px;white-space:nowrap;';

// Caption : value, twice across the row. The second value runs to the right edge
// of the frame so a long vehicle number has the room it needs.
const billIdRow = (l1, v1, l2, v2, o = {}, edge = '') => `
  <tr>
    <td style="${BILL_LBL}${edge}${o.b1 ? 'font-weight:bold;' : ''}">${esc(l1)}</td>
    <td style="${BILL_SEP}${edge}">:</td>
    <td style="${BILL_VAL}${edge}${o.v1 ? 'font-weight:bold;' : ''}">${esc(v1)}</td>
    <td style="${BILL_LBL}${edge}${o.b2 ? 'font-weight:bold;' : ''}">${esc(l2)}</td>
    <td style="${BILL_SEP}${edge}">:</td>
    <td colspan="4" style="${BILL_VAL}${edge}${o.v2 ? 'font-weight:bold;' : ''}">${esc(v2)}</td>
  </tr>`;

// A weight row: the figure, then the stamp that goes with it. The third caption
// is dropped when it has nothing to print — an AMOUNT with no amount after it is
// a caption the operator has to read past.
const billWeightRow = (l1, v1, l2, v2, l3, v3, edge = '') => `
  <tr>
    <td style="${BILL_LBL}${edge}">${esc(l1)}</td>
    <td style="${BILL_SEP}${edge}">:</td>
    <td style="${BILL_VAL}${edge}font-weight:bold;">${esc(v1)}</td>
    <td style="${BILL_LBL}${edge}">${esc(l2)}</td>
    <td style="${BILL_SEP}${edge}">${l2 ? ':' : ''}</td>
    <td style="${BILL_VAL}${edge}">${esc(v2)}</td>
    <td style="${BILL_LBL}${edge}">${esc(l3)}</td>
    <td style="${BILL_SEP}${edge}">${l3 ? ':' : ''}</td>
    <td style="${BILL_VAL}${edge}">${esc(v3)}</td>
  </tr>`;

function salesBill1(f) {
  const rule = 'border-bottom:1px solid #000;';
  const dots = 'border-bottom:1px dotted #555;';

  return wrap(`
    <table style="width:100%;border-collapse:collapse;border:1px solid #000;table-layout:fixed;">
      ${BILL_COLS}
      ${band('WEIGHMENT SLIP', 9)}
      ${billIdRow('DC NUMBER', f.dcNum, 'VEHICLE', f.vehicle, { v1: true }, rule)}
      ${billIdRow('MATERIAL', f.material, 'PARTY', f.party, { b2: true }, rule)}
      ${billIdRow('DESTINATION', f.destination, 'SOURCE', f.source, { b1: true }, rule)}
      ${band('WEIGHT', 9)}
      ${billWeightRow('GROSS', f.gross, 'DATE', f.grossDate, 'TIME', f.grossTime, dots)}
      ${billWeightRow('TARE', f.tare, 'DATE', f.tareDate, 'TIME', f.tareTime, dots)}
      ${billWeightRow('NETT', f.nett, 'TRANSPORTER', f.transporter, f.amount ? 'AMOUNT' : '', f.amount)}
    </table>
    ${signRow('OPERATOR SIGNATURE', `DRIVER NAME${f.driver ? `    ${f.driver}` : ''}`)}
  `, { data: f });
}

// ---- SalesBillSR.rpt : ruled WEIGHMENT, operator + receiver ----------------

function salesBillSR(f) {
  return wrap(`
    <div style="border-top:1px solid #000;border-bottom:1px solid #000;text-align:center;font-weight:bold;letter-spacing:2px;padding:4px 0;margin-bottom:14px;">
      ${esc(spaced('WEIGHMENT'))}
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>${cell('DC NUMBER', f.dcNum, { bold: true })}${cell('VEHICLE', f.vehicle)}</tr>
      <tr>${cell('MATERIAL', f.material)}${cell('PARTY', f.party)}</tr>
      <tr>${cell('DESTINATION', f.destination)}<td colspan="3"></td></tr>
      <tr><td colspan="6" style="height:14px;"></td></tr>
      <tr>${cell('GROSS', f.gross)}${cell('DATE', f.grossDate)}${cell('TIME', f.grossTime)}</tr>
      <tr>${cell('TARE', f.tare)}${cell('DATE', f.tareDate)}${cell('TIME', f.tareTime)}</tr>
      <tr>${cell('NETT', f.nett, { bold: true })}<td colspan="6"></td></tr>
    </table>
    ${signRow('OPERATOR SIGNATURE', 'RECEIVER SIGNATURE')}
    <div style="border-bottom:1px solid #000;margin-top:8px;"></div>
  `, { data: f });
}

// ---- SalesBill2.rpt : three slips per page ---------------------------------

// The same nine stops as SalesBill1, minus the frame — this is the same form
// printed several times down a sheet so the supervisor can tear one off per
// load, and the two forms have to read as the same document.
function salesBill2Block(f, showGatePass = true) {
  return `
    <div style="padding:2px 0 30px; position:relative;">
      ${showGatePass ? `
      <div style="display:flex; justify-content:flex-end; margin-bottom:4px; padding-right:4px;">
        <div style="border:1.5px solid #000; padding:4px 12px; text-align:center; display:inline-block; min-width:130px;">
          <div style="font-weight:800; font-size:11px; letter-spacing:1px; text-transform:uppercase;">GATE PASS</div>
          <div style="font-size:10px; font-weight:700; margin-top:2px; color:#000;">DATE: ${f.grossDate || f.date || ''}</div>
          <div style="font-size:10px; font-weight:700; margin-top:3px; color:#000;">SIGN: ____________</div>
        </div>
      </div>
      ` : ''}
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        ${BILL_COLS}
        ${billIdRow('DC NUMBER', f.dcNum, 'VEHICLE', f.vehicle, { v1: true })}
        ${billIdRow('MATERIAL', f.material, 'PARTY', f.party, { b2: true })}
        ${billIdRow('DESTINATION', f.destination, 'SOURCE', f.source, { b1: true })}
        ${billWeightRow('GROSS', f.gross, 'DATE', f.grossDate, 'TIME', f.grossTime)}
        ${billWeightRow('TARE', f.tare, 'DATE', f.tareDate, 'TIME', f.tareTime)}
        ${billWeightRow('NETT', f.nett, '', '', '', '')}
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-top:14px;padding:0 7px;font-weight:600;">
        <span>Sign Of Supervisor</span>
        <span>Authorised Signature</span>
      </div>
      <div style="border-bottom:1px solid #000;margin-top:5px;"></div>
    </div>`;
}

function salesBill2(f) {
  return wrap(salesBill2Block(f, true).repeat(4), { data: f });
}

function salesBill2NoGatePass(f) {
  return wrap(salesBill2Block(f, false).repeat(4), { data: f });
}

// ---- SalesBill9.rpt : DELIVERY CHALLAN SLIP --------------------------------

// One set of column stops for every row inside the box. The first three carry
// the customer captions and their values; the next four are the weight block,
// which the form sets one step in from the left so the figures line up under
// the middle of the WEIGHT band. Driver and Vehicle share the last two stops,
// which is what puts one above the other on the right of the frame.
//
// The customer value column used to be 15.7% — narrow enough that a party name
// of any length broke across two lines and pushed the whole box out of square.
const DC_COLS = `
  <colgroup>
    <col style="width:22%"><col style="width:2%"><col style="width:22%">
    <col style="width:11%"><col style="width:9%">
    <col style="width:14%"><col style="width:20%">
  </colgroup>`;

function salesBill9(f) {
  const pad = 'padding:5px 5px;';
  const nw = `${pad}white-space:nowrap;`;

  const dcBand = text => `
    <tr>
      <td colspan="7" style="background:${BAND};${INK}text-align:center;font-weight:bold;letter-spacing:1px;padding:5px 0;">
        ${esc(spaced(text))}
      </td>
    </tr>`;

  // Material / Gross / Tare / Nett. Gross and Tare carry the weighment stamp;
  // Material and Nett leave those two columns empty, as the form does. Only the
  // figures are set bold — the material name prints in the ordinary weight.
  const weightRow = (label, value, { bold = false, date = '', time = '', span = 1 } = {}) => `
    <tr>
      <td colspan="3"></td>
      <td style="${nw}">${esc(label)}</td>
      <td colspan="${span}" style="${nw}${bold ? 'font-weight:bold;' : ''}">${esc(value)}</td>
      ${span > 1 ? '' : `<td style="${nw}">${esc(date)}</td><td style="${nw}">${esc(time)}</td>`}
    </tr>`;

  // Caption, value, then a second caption and value out on the right-hand stops.
  const pairRow = (label, value, label2, value2, top = '') => `
    <tr>
      <td style="${nw}${top}">${esc(label)}</td>
      <td style="${top}"></td>
      <td colspan="3" style="${pad}${top}">${esc(value)}</td>
      <td style="${nw}${top}">${esc(label2)}</td>
      <td style="${nw}${top}">${esc(value2)}</td>
    </tr>`;

  const sign = caption => `
    <td style="width:33.33%;padding:0 12px;">
      <div style="border-top:1px solid #000;padding-top:6px;text-align:center;">${esc(caption)}</div>
    </td>`;

  return wrap(`
    <div style="text-align:center;font-family:'Times New Roman',Times,serif;font-weight:bold;letter-spacing:1.2px;font-size:17px;margin-bottom:10px;">
      DELIVERY CHALLAN SLIP
    </div>

    <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:5px;">
      <tr>
        <td style="width:55%;text-align:right;white-space:nowrap;padding:0 12px 0 0;">WB Slip Number :</td>
        <td style="font-weight:bold;">${esc(f.dcNum)}</td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;border:1px solid #000;table-layout:fixed;">
      ${DC_COLS}
      ${dcBand('CUSTOMER DETAILS')}
      <tr>
        <td style="${nw}">Customer Name</td>
        <td></td>
        <td style="${pad}">${esc(f.party)}</td>
        <td colspan="2" style="${nw}">Address</td>
        <td colspan="2" style="${pad}">${esc(f.customerAddress)}</td>
      </tr>
      <tr>
        <td style="${nw}">GSTIN No</td>
        <td></td>
        <td colspan="5" style="${pad}">${esc(f.gstin)}</td>
      </tr>
      ${dcBand('WEIGHT')}
      ${weightRow('Material', f.material, { span: 3 })}
      ${weightRow('Gross', f.grossRaw, { bold: true, date: f.grossDate, time: f.grossTime })}
      ${weightRow('Tare', f.tareRaw, { bold: true, date: f.tareDate, time: f.tareTime })}
      ${weightRow('Nett', f.nettRaw, { bold: true })}
      ${pairRow('', '', 'Driver', f.driver)}
      ${pairRow('Transporter Name', f.transporter, 'Vehicle', f.vehicle, 'border-top:1px solid #000;')}
      ${pairRow('Site Address', f.siteAddress, '', '')}
    </table>

    <div style="margin-top:10px;">Remarks :&nbsp;&nbsp;${esc(f.remarks)}</div>

    <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:34px;">
      <tr>
        ${sign("Operator's Signature")}
        ${sign('Driver Signature')}
        ${sign('Receiving Signature')}
      </tr>
    </table>
  `, { data: f });
}

// ---- SlipPrint.rpt / SlipPrint2.rpt : two-up panels -------------------------

function slipPanel(f, { heading, headingRight = '', showRst = false, addresses = 1, signature, footerParty = false }) {
  const addrLines = [f.address1, addresses > 1 ? f.address2 : '', addresses > 2 ? f.address3 : '']
    .filter(Boolean)
    .map(a => `<div style="text-align:center;font-weight:bold;">${esc(a)}</div>`)
    .join('');
  return `
    <td style="vertical-align:top;padding:6px 10px;border-right:1px dashed #666;width:50%;">
      <div style="min-height:34px;">${addrLines}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        <tr>
          <td style="font-weight:bold;padding:2px 0;">${esc(heading)}</td>
          ${showRst ? `<td style="padding:2px 0;text-align:center;">${esc(f.rstNum)}</td>` : ''}
          <td style="padding:2px 0;text-align:right;">${esc(f.date1)}</td>
        </tr>
      </table>
      <table style="width:100%;border-collapse:collapse;">
        <tr>${cell('DC.No', f.dcNum)}<td style="padding:3px 4px;text-align:right;">${esc(f.time1)}</td></tr>
        <tr>${cell('PARTY', f.party, { bold: true })}<td></td></tr>
        <tr>${cell('DESTINATION', f.destination)}<td></td></tr>
        <tr>${cell('VEHICLE', f.vehicle)}<td></td></tr>
        <tr>${cell('MATERIAL', f.material)}<td></td></tr>
        <tr>${cell('GROSS', `${f.gross} Kgs`)}<td></td></tr>
        <tr>${cell('TARE', `${f.tare} Kgs`)}<td></td></tr>
        <tr>${cell('NETT', `${f.nett} Kgs`)}<td></td></tr>
        <tr>${cell('AMOUNT', f.amount, { bold: true })}<td style="padding:3px 4px;text-align:right;">${esc(f.phone)}</td></tr>
      </table>
      <div style="margin-top:12px;">${esc(footerParty ? f.party : f.address1)}</div>
      <div style="margin-top:2px;">${esc(f.phone)}</div>
      <div style="margin-top:14px;text-align:${footerParty ? 'right' : 'center'};">${esc(signature)}</div>
    </td>`;
}

// SlipPrint.rpt proper. The two halves are the same form with different
// captions: the operator keeps the Loading Slip, the driver takes the Loading
// DC. "Loadind DC" is spelt that way on the original report and is left alone —
// the printed slip has to look like the one the site already files.
//
// Section by section, as the designer draws it:
//   Report Header   ?Address1, centred over the panel
//   Page Header     caption on the left, ?Date1 on the right
//   Details         identity rows, rule, weight rows, rule, address, signature
// The ?Time1 and ?Phone fields hang off the right edge on the DC.No and AMOUNT
// rows respectively, which is why the form needs a fourth column.
function loadingSlipPanel(f, { heading, signature, first }) {
  const lbl = 'padding:3px 0 3px 4px;white-space:nowrap;letter-spacing:.4px;';
  const col = 'padding:3px 2px;';
  const val = 'padding:3px 4px;';
  const end = 'padding:3px 4px;text-align:right;white-space:nowrap;';

  // One set of stops for both halves of the form, so GROSS lines up under
  // MATERIAL instead of only appearing to. DESTINATION is the widest caption on
  // the panel and sets the first stop; the last column is only ever the time or
  // the phone number hanging off the right edge, so it needs no more than that.
  const cols = `
    <colgroup>
      <col style="width:30%"><col style="width:3%"><col style="width:45%"><col style="width:22%">
    </colgroup>`;

  const row = (label, value, { bold = false, tail = '' } = {}) => `
    <tr>
      <td style="${lbl}">${esc(label)}</td>
      <td style="${col}">:</td>
      <td style="${val}${bold ? 'font-weight:bold;' : ''}">${esc(value)}</td>
      <td style="${end}">${esc(tail)}</td>
    </tr>`;

  // Kgs is a static caption on the report — it prints beside the figure whether
  // or not a weight came through, exactly as Crystal renders it.
  const weight = (label, value) => `
    <tr>
      <td style="${lbl}">${esc(label)}</td>
      <td style="${col}">:</td>
      <td style="${val}">${esc(value)}<span style="padding-left:6px;">Kgs</span></td>
      <td style="${end}"></td>
    </tr>`;

  const rule = '<div style="border-bottom:1px solid #000;margin:4px 0;"></div>';

  return `
    <td style="vertical-align:top;padding:6px 12px;width:50%;${first ? 'border-right:1px solid #000;' : ''}">
      <div style="text-align:center;font-weight:bold;min-height:18px;">${esc(f.address1)}</div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:6px 0 4px;">
        <tr>
          <td style="background:${BAND};${INK}padding:4px 6px;font-weight:bold;letter-spacing:.3px;">${esc(heading)}</td>
          <td style="background:${BAND};${INK}padding:4px 6px;text-align:right;white-space:nowrap;">${esc(f.date1)}</td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        ${cols}
        ${row('DC.No', f.dcNum, { tail: f.time1 })}
        ${row('PARTY', f.party, { bold: true })}
        ${row('DESTINATION', f.destination)}
        ${row('VEHICLE', f.vehicle)}
        ${row('MATERIAL', f.material)}
      </table>

      ${rule}

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        ${cols}
        ${weight('GROSS', f.gross)}
        ${weight('TARE', f.tare)}
        ${weight('NETT', f.nett)}
        ${row('AMOUNT', f.amount, { bold: true, tail: f.phone })}
      </table>

      ${rule}

      <div style="padding:4px 4px 0;text-align:${first ? 'left' : 'center'};">${esc(f.address1)}</div>
      <div style="margin-top:20px;text-align:${first ? 'center' : 'right'};">${esc(signature)}</div>
    </td>`;
}

function slipPrint(f) {
  return wrap(`
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>
        ${loadingSlipPanel(f, { heading: 'Loading Slip', signature: 'Operator Signature', first: true })}
        ${loadingSlipPanel(f, { heading: 'Loadind DC', signature: 'Loading Operator Signature', first: false })}
      </tr>
    </table>
  `, { width: '1040px', font: '12.5px', data: f });
}

function slipPrint2(f) {
  return wrap(`
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>
        ${slipPanel(f, { heading: 'Delivery Challan', showRst: true, addresses: 3, signature: 'Operator Signature', footerParty: true })}
        ${slipPanel(f, { heading: 'Delivery Challan', showRst: true, addresses: 3, signature: 'Operator Signature', footerParty: true })}
      </tr>
    </table>
  `, { width: '900px', font: '12.5px', data: f });
}

// ---- Full-page DELIVERY CHALLAN with HSN table ------------------------------

function challanA4(f) {
  const td = 'border:1px solid #000;padding:6px 8px;font-size:14px;';
  return wrap(`
    <div style="display:flex;flex-direction:column;justify-content:space-between;min-height:250mm;box-sizing:border-box;padding:6px 4px;">
      <div>
        <div style="text-align:right;font-size:24px;font-weight:bold;letter-spacing:1px;margin-bottom:4px;">DELIVERY CHALLAN</div>
        <div style="border-bottom:2px solid #000;margin-bottom:12px;"></div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:14px;line-height:1.6;">
          <tr>
            <td style="padding:3px 0;width:16%;font-weight:bold;">Consignee :</td>
            <td style="padding:3px 0;width:44%;font-weight:bold;font-size:15px;">${esc(f.consignee)}</td>
            <td style="padding:3px 0;width:15%;font-weight:bold;">DC Num :</td>
            <td style="padding:3px 0;width:25%;font-weight:bold;font-size:16px;">${esc(f.dcNum)}</td>
          </tr>
          <tr>
            <td style="padding:3px 0;font-weight:bold;">Destination</td>
            <td style="padding:3px 0;">${esc(f.destination)}</td>
            <td style="padding:3px 0;font-weight:bold;">Date</td>
            <td style="padding:3px 0;">${esc(f.date1)}</td>
          </tr>
          <tr>
            <td style="padding:3px 0;font-weight:bold;">Phone</td>
            <td style="padding:3px 0;">${esc(f.phone || '-')}</td>
            <td style="padding:3px 0;font-weight:bold;">Customer P.O :</td>
            <td style="padding:3px 0;">${esc(f.customerPO || '0')}</td>
          </tr>
        </table>

        <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="${td}width:8%;text-align:center;font-weight:bold;">S.No</th>
              <th style="${td}width:32%;font-weight:bold;">Item</th>
              <th style="${td}width:15%;text-align:center;font-weight:bold;">HSN</th>
              <th style="${td}width:18%;text-align:center;font-weight:bold;">Units</th>
              <th style="${td}width:12%;"></th>
              <th style="${td}width:15%;text-align:right;font-weight:bold;">QTY</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="${td}text-align:center;">1</td>
              <td style="${td}font-weight:bold;font-size:15px;">${esc(f.item)}</td>
              <td style="${td}text-align:center;">${esc(f.hsn)}</td>
              <td style="${td}text-align:center;">${esc(f.units)}</td>
              <td style="${td}"></td>
              <td style="${td}text-align:right;font-weight:bold;font-size:16px;">${esc(f.qty)}</td>
            </tr>
            <tr>
              <td colspan="4" style="border:1px solid #000;border-top:0;padding:10px;vertical-align:top;height:120px;font-size:14px;line-height:1.9;">
                <div><strong>STATIONARY:</strong> &nbsp;${esc(f.stationary)}</div>
                <div><strong>VEHICLE No:</strong> &nbsp;${esc(f.vehicle)}</div>
                <div><strong>Driver:</strong> &nbsp;${esc(f.driver)}</div>
                <div><strong>Transporter:</strong> &nbsp;${esc(f.transporter)}</div>
              </td>
              <td style="${td}border-top:0;"></td>
              <td style="${td}border-top:0;"></td>
            </tr>
            <tr>
              <td colspan="6" style="${td}height:80px;vertical-align:bottom;padding:10px 12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;width:100%;font-size:13px;font-weight:bold;">
                  <div>${esc(f.consignee || f.party)}</div>
                  <div>${esc(f.address1 || 'KALKI BHAGAVAN METAL INDUSTRIES')}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div style="text-align:center;font-weight:bold;font-size:15px;margin:14px 0 16px;">
          Note : Invoice Against Approval of Quantity
        </div>

        <div style="border:1.5px solid #000;text-align:center;font-weight:bold;letter-spacing:2px;padding:6px 0;margin-bottom:12px;font-size:16px;background:#f8fafc;">
          ${esc(spaced('WEIGHMENT SLIP'))}
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.9;">
          <tr>
            <td style="padding:4px 0;width:16%;font-weight:bold;">RST Num</td>
            <td style="padding:4px 0;width:34%;font-weight:bold;font-size:16px;">${esc(f.rstNum)}</td>
            <td style="padding:4px 0;width:18%;font-weight:bold;">Vehicle No</td>
            <td style="padding:4px 0;width:32%;font-weight:bold;font-size:16px;">${esc(f.vehicle)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-weight:bold;">Party</td>
            <td style="padding:4px 0;font-weight:bold;font-size:15px;">${esc(f.party)}</td>
            <td style="padding:4px 0;font-weight:bold;">Material</td>
            <td style="padding:4px 0;font-weight:bold;font-size:15px;">${esc(f.material)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-weight:bold;">Destination</td>
            <td style="padding:4px 0;" colspan="3">${esc(f.destination)}</td>
          </tr>
          <tr><td colspan="4" style="height:10px;"></td></tr>
          <tr>
            <td style="padding:4px 0;font-weight:bold;">Gross</td>
            <td style="padding:4px 0;font-weight:bold;font-size:16px;">${esc(f.gross)} &nbsp;Kgs.</td>
            <td style="padding:4px 0;font-weight:bold;">OUT</td>
            <td style="padding:4px 0;">${esc(f.outTime)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-weight:bold;">Tare</td>
            <td style="padding:4px 0;font-weight:bold;font-size:16px;">${esc(f.tare)} &nbsp;Kgs.</td>
            <td style="padding:4px 0;font-weight:bold;">IN</td>
            <td style="padding:4px 0;">${esc(f.inTime)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-weight:bold;">Nett</td>
            <td style="padding:4px 0;font-weight:bold;font-size:18px;">${esc(f.nett)} &nbsp;Kgs.</td>
            <td style="padding:4px 0;" colspan="2"></td>
          </tr>
        </table>
      </div>

      <div style="margin-top:20px;padding-top:12px;border-top:1px dashed #000;">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:24px 10px 4px 10px;font-weight:bold;font-size:13px;">
          <div>${esc(f.consignee || f.party)}</div>
          <div style="text-align:right;">Stamp &amp; Authorized Signature</div>
        </div>
      </div>
    </div>
  `, { width: '100%', font: '14px', data: f });
}

// ---- SALES RECEIPT, two per page -------------------------------------------

// The identity rows and the weight rows are two separate tables on purpose. On
// the original the second caption column does not line up between them — Vehicle
// No / Material sit around the middle of the slip while OUT / IN sit noticeably
// further right. One shared table would force both to the same stop.
function salesReceiptBlock(f) {
  const lbl = 'padding:2px 0 2px 6px;white-space:nowrap;';
  const val = 'padding:2px 4px 2px 0;';
  return `
    <div style="padding-bottom:56px;">
      <div style="border:1px solid #000;font-weight:bold;padding:4px 8px;letter-spacing:.2px;">SALES RECEIPT -</div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:7px;">
        <tr>
          <td style="${lbl}width:26%;">Sl. Num</td><td style="${val}width:28%;">${esc(f.slNum)}</td>
          <td style="${lbl}width:20%;">Vehicle No</td><td style="${val}">${esc(f.vehicle)}</td>
        </tr>
        <tr>
          <td style="${lbl}">Party</td><td style="${val}">${esc(f.party)}</td>
          <td style="${lbl}">Material</td><td style="${val}">${esc(f.material)}</td>
        </tr>
        <tr>
          <td style="${lbl}">Destination</td><td style="${val}" colspan="3">${esc(f.destination)}</td>
        </tr>
      </table>

      <div style="height:14px;"></div>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr>
          <td style="${lbl}width:26%;">Gross</td><td style="${val}width:42%;">${esc(f.gross)}</td>
          <td style="${lbl}width:10%;">OUT</td><td style="${val}">${esc(f.outTime)}</td>
        </tr>
        <tr>
          <td style="${lbl}">Tare</td><td style="${val}">${esc(f.tare)}</td>
          <td style="${lbl}">IN</td><td style="${val}">${esc(f.inTime)}</td>
        </tr>
        <tr>
          <td style="${lbl}">Nett</td><td style="${val}">${esc(f.nett)}</td>
          <td colspan="2"></td>
        </tr>
      </table>

      <div style="border-bottom:1px dashed #000;margin-top:9px;"></div>
    </div>`;
}

function salesReceipt(f) {
  return wrap(salesReceiptBlock(f).repeat(2), { width: '640px', data: f });
}

// ---- Weighment slip, two per page ------------------------------------------

// The half-sheet form: no heading, no colon column, and the driver's name
// standing opposite the operator's signature line. Dropping the colons is not
// a shortening for its own sake — this slip prints on a 148mm sheet, and the
// column those colons occupied is the room "Transporter" and "13-08-2026" need.
//
// The identity rows and the weight rows sit on different stops on purpose. On
// the form the right-hand caption of the identity block (Vehicle / Source /
// Destination) sits noticeably further across than Date / Transporter does in
// the weight block, and one shared set of stops would drag them together.
function weighSlip2Block(f) {
  const lbl = 'padding:4px 3px 4px 2px;white-space:nowrap;';
  const val = 'padding:4px 3px;white-space:nowrap;';

  const idCols = `
    <colgroup>
      <col style="width:19%"><col style="width:40%">
      <col style="width:18%"><col style="width:23%">
    </colgroup>`;

  // The figure is right-aligned into its own column so Kgs stands in a line
  // down the form instead of stepping in and out with the number's length.
  const wtCols = `
    <colgroup>
      <col style="width:19%"><col style="width:16%"><col style="width:9%">
      <col style="width:20%"><col style="width:20%"><col style="width:16%">
    </colgroup>`;

  const idRow = (l1, v1, l2, v2) => `
    <tr>
      <td style="${lbl}">${esc(l1)}</td><td style="${val}">${esc(v1)}</td>
      <td style="${lbl}">${esc(l2)}</td><td style="${val}">${esc(v2)}</td>
    </tr>`;

  const wtRow = (label, figure, l2, v2, tail = '') => `
    <tr>
      <td style="${lbl}">${esc(label)}</td>
      <td style="${val}text-align:right;font-weight:bold;">${esc(figure)}</td>
      <td style="${val}">Kgs</td>
      <td style="${lbl}">${esc(l2)}</td>
      <td style="${val}">${esc(v2)}</td>
      <td style="${val}">${esc(tail)}</td>
    </tr>`;

  const rule = margin => `<div style="border-bottom:1px solid #000;margin:${margin};"></div>`;

  return `
    <div style="padding-bottom:70px;">
      ${rule('0 0 3px')}

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        ${idCols}
        ${idRow('DC Number', f.dcNum, 'Vehicle', f.vehicle)}
        ${idRow('Material', f.material, 'Source', f.source)}
        ${idRow('Party', f.party, 'Destination', f.destination)}
      </table>

      ${rule('3px 0')}

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        ${wtCols}
        ${wtRow('Gross', f.gross, 'Date', f.grossDate, f.grossTime)}
        ${wtRow('Tare', f.tare, 'Date', f.tareDate, f.tareTime)}
        ${wtRow('Nett', f.nett, 'Transporter', f.transporter)}
      </table>

      <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:18px;">
        <tr>
          <td style="padding:0 3px;">Operator Signature</td>
          <td style="padding:0 4px;width:30%;">${esc(f.driver)}</td>
        </tr>
      </table>

      ${rule('6px 0 0')}
    </div>`;
}

function weighSlip2(f) {
  return wrap(weighSlip2Block(f).repeat(2), { width: '500px', font: '11px', data: f });
}

// ---- Weighment Slip CCTV 2-Up (AMR INFRA Photo Match with CCTV Snapshots) ---

function renderCctvBox(imgSrc) {
  if (imgSrc && String(imgSrc).trim().length > 20) {
    return `
      <div style="width:205px;height:155px;border:1.5px solid #000;border-radius:2px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
        <img src="${imgSrc}" alt="CCTV" style="width:100%;height:100%;object-fit:cover;display:block;" />
      </div>
    `;
  }
  return `
    <div style="width:205px;height:155px;border:1.5px solid #000;border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;padding:4px;box-sizing:border-box;">
      <svg width="76" height="58" viewBox="0 0 68 52" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="64" height="48" rx="2" fill="none" stroke="#000" />
        <circle cx="22" cy="18" r="5.5" stroke="#000" />
        <path d="M4 44 L25 24 L39 36 L49 26 L64 40" stroke="#000" />
      </svg>
      <div style="font-size:14px;font-weight:bold;color:#1e293b;text-align:center;line-height:1.15;margin-top:4px;font-family:Arial,sans-serif;">
        No image<br/>available
      </div>
    </div>
  `;
}

function weighSlipCctvA4Block(f) {
  const companyLines = getCompanyHeaderLines();
  const companyName = companyLines.length > 0 ? companyLines[0] : (f.address1 || 'AMR INFRA');
  const address1 = companyLines.length > 1 ? companyLines[1] : (f.address2 || 'Registered Office :- Survey No :- 195 AA1 & 195AA2 ,Chandanvelly (v)');
  const address2 = companyLines.length > 2 ? companyLines[2] : (f.address3 || 'Shahbad (M) , RangaReddy (D) ,Telangana 501503');
  const phone1 = f.phone || '8464931495';
  const phone2 = '7893551155';

  const inTimeStr = f.inTime ? (f.tareDate ? `${f.tareDate} & ${f.inTime}` : `${f.date1} & ${f.inTime}`) : `${f.date1} & ${f.time1}`;
  const outTimeStr = f.outTime ? (f.grossDate ? `${f.grossDate} & ${f.outTime}` : `${f.date1} & ${f.outTime}`) : `${f.date1} & ${f.time1}`;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#000;box-sizing:border-box;width:100%;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #000;padding-bottom:4px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;width:160px;">
          <div style="font-size:24px;line-height:1;color:#000;">🏗️</div>
          <div style="font-size:14px;font-weight:900;line-height:1.1;letter-spacing:-0.3px;text-transform:uppercase;">
            ${esc(companyName)}
          </div>
        </div>
        <div style="text-align:center;flex:1;padding:0 8px;">
          <div style="font-size:18px;font-weight:bold;letter-spacing:.5px;margin-bottom:2px;text-transform:uppercase;">
            ${esc(companyName)}
          </div>
          <div style="font-size:9.5px;font-weight:600;color:#111;line-height:1.3;">
            ${esc(address1)}
          </div>
          ${address2 ? `<div style="font-size:9.5px;font-weight:600;color:#111;line-height:1.3;">${esc(address2)}</div>` : ''}
        </div>
        <div style="text-align:right;font-size:10px;font-weight:bold;width:160px;line-height:1.35;">
          <div>Phone : ${esc(phone1)}</div>
          ${phone2 ? `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${esc(phone2)}</div>` : ''}
        </div>
      </div>

      <!-- Body -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:4px;">
        <!-- Left Column -->
        <div style="flex:1;font-size:12px;line-height:1.6;color:#000;">
          <div style="display:flex;margin-bottom:1.5px;">
            <span style="width:85px;color:#333;">Serial No</span>
            <span style="font-weight:bold;">${esc(f.dcNum || f.slNum || '1')}</span>
          </div>
          <div style="display:flex;margin-bottom:1.5px;">
            <span style="width:85px;color:#333;">Customer</span>
            <span style="font-weight:bold;">${esc(f.party)}</span>
          </div>
          <div style="display:flex;margin-bottom:1.5px;">
            <span style="width:85px;color:#333;">Contact</span>
            <span style="font-weight:bold;">${esc(f.contact || f.phone)}</span>
          </div>
          <div style="display:flex;margin-bottom:1.5px;">
            <span style="width:85px;color:#333;">Material</span>
            <span style="font-weight:bold;">${esc(f.material)}</span>
          </div>
          <div style="display:flex;margin-bottom:1.5px;">
            <span style="width:85px;color:#333;">Transporte</span>
            <span style="font-weight:bold;">${esc(f.transporter)}</span>
          </div>
          <div style="display:flex;margin-bottom:1.5px;">
            <span style="width:85px;color:#333;">In Time</span>
            <span style="font-weight:500;">${esc(inTimeStr)}</span>
          </div>
          <div style="display:flex;margin-bottom:6px;">
            <span style="width:85px;color:#333;">Out Time</span>
            <span style="font-weight:500;">${esc(outTimeStr)}</span>
          </div>
          <div style="display:flex;margin-bottom:2px;">
            <span style="width:85px;color:#333;">Gross</span>
            <span style="font-size:15px;font-weight:bold;letter-spacing:.5px;">${esc(f.gross || '0')} Kgs</span>
          </div>
          <div style="display:flex;margin-bottom:2px;">
            <span style="width:85px;color:#333;">Tare</span>
            <span style="font-size:15px;font-weight:bold;letter-spacing:.5px;">${esc(f.tare || '0')} Kgs</span>
          </div>
          <div style="display:flex;margin-bottom:2px;">
            <span style="width:85px;color:#333;">Net.</span>
            <span style="font-size:15px;font-weight:bold;letter-spacing:.5px;">${esc(f.nett || '0')} Kgs</span>
          </div>
        </div>

        <!-- Right Column -->
        <div style="width:430px;display:flex;flex-direction:column;align-items:flex-end;">
          <div style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px;">
            <div>
              <span style="color:#333;margin-right:8px;">Vehicle</span>
              <span style="font-size:15px;font-weight:bold;letter-spacing:.5px;">${esc(f.vehicle)}</span>
            </div>
            <div>
              <span style="color:#333;margin-right:8px;">Quantity</span>
              <span style="font-weight:bold;font-size:14px;">${esc(f.quantity || f.qty || '0')}</span>
              <span style="font-size:11px;font-weight:bold;margin-left:4px;">CUM</span>
            </div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;width:100%;">
            ${renderCctvBox(f.img1)}
            ${renderCctvBox(f.img2)}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px;padding-top:4px;font-size:11px;color:#222;">
        <div>Receiver.</div>
        <div>Operator</div>
      </div>
    </div>
  `;
}

function weighSlipCctvA4(f) {
  return wrap(`
    <div style="padding-bottom:12px;">
      ${weighSlipCctvA4Block(f)}
    </div>
    <div style="border-top:1.5px dashed #475569;margin:10px 0 14px 0;position:relative;text-align:center;">
      <span style="position:absolute;top:-9px;background:#fff;padding:0 8px;font-size:9.5px;color:#64748b;font-weight:600;">✂ CUT HERE</span>
    </div>
    <div style="padding-top:2px;">
      ${weighSlipCctvA4Block(f)}
    </div>
  `, { width: '780px', font: '13px', data: f });
}

// ---- dispatch ---------------------------------------------------------------

const BUILDERS = {
  'RPT-SALESBILL1': salesBill1,
  'RPT-SALESBILLSR': salesBillSR,
  'RPT-SALESBILL2': salesBill2,
  'RPT-SALESBILL2-NOGATEPASS': salesBill2NoGatePass,
  'RPT-SALESBILL9': salesBill9,
  'RPT-SLIPPRINT': slipPrint,
  'RPT-SLIPPRINT2': slipPrint2,
  'RPT-CHALLAN-A4': challanA4,
  'RPT-SALESRECEIPT': salesReceipt,
  'RPT-WEIGHSLIP2': weighSlip2,
  'RPT-CCTV-A4': weighSlipCctvA4
};

// Returns null when the id belongs to one of the app's own templates, so the
// caller can fall through to its existing designs.
export function generateRptSlipHtml(data = {}, template = '') {
  const build = BUILDERS[template];
  return build ? build(fields(data)) : null;
}
