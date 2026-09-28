// Utility for Printer Templates & Ticket Printing
import { generateRptSlipHtml, RPT_TEMPLATE_IDS, RPT_TEMPLATE_CATALOGUE } from './rptSlipTemplates.js';
import { getCompanyDetails } from './classicReportPrinter.js';
import { renderRptPageHeader } from './rptPageHeader.js';

export const PRINTER_TEMPLATES = [
  ...RPT_TEMPLATE_IDS,
  'TEMPLATE 1 - CLASSIC BLUE',
  'TEMPLATE 2 - MODERN MINIMAL',
  'TEMPLATE 3 - INDUSTRIAL STYLE',
  'TEMPLATE 4 - PROFESSIONAL CORPORATE',
  'TEMPLATE 5 - COMPACT RECEIPT STYLE',
  'TEMPLATE 7 - AMR INFRA',
  'IMAGE-4',
  'IMAGE-1',
  'IMAGE-2',
  'IMAGE-3',
  'IMAGE-5',
  'IMAGE-6',
  'IMAGE-7',
  'RAW',
  'RAW_LARGE'
];

export const TEMPLATE_STORAGE_KEY = 'noris_selected_printer_template';
export const DC_PRINT_TEMPLATE_KEY = 'noris_dc_print_template';
export const GATE_PASS_TEMPLATE_KEY = 'noris_gate_pass_template';
export const PRINTER_NAME_KEY = 'noris_printer_name';
export const DC_PRINTER_NAME_KEY = 'noris_dc_printer_name';
export const GATE_PASS_PRINTER_NAME_KEY = 'noris_gate_pass_printer_name';
// 'RAW_TEXT'    — ESC/P straight to the port, fastest, dot-matrix only
// 'HTML_DRIVER' — rendered layout printed silently through the Windows driver
// 'DIALOG'      — rendered layout handed to the printer's own dialog, so the
//                 operator chooses printer, paper and orientation each time
export const PRINTER_MODE_KEY = 'noris_printer_mode';
export const DC_PRINTER_MODE_KEY = 'noris_dc_printer_mode';
export const GATE_PASS_PRINTER_MODE_KEY = 'noris_gate_pass_printer_mode';
export const PRINTER_COPIES_KEY = 'noris_printer_copies';
export const PRINTER_AUTO_FEED_KEY = 'noris_printer_auto_feed';
export const PRINTER_FORM_LINES_KEY = 'noris_printer_form_lines';
export const PRINTER_FEED_MODE_KEY = 'noris_printer_feed_mode';
export const PRINTER_A5_FEED_KEY = 'noris_printer_a5_feed';

export function getSelectedTemplate() {
  return localStorage.getItem(TEMPLATE_STORAGE_KEY) || 'TEMPLATE 1 - CLASSIC BLUE';
}

export function setSelectedTemplate(templateName) {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, templateName);
}

export function getDcPrintTemplate() {
  return localStorage.getItem(DC_PRINT_TEMPLATE_KEY) || 'RPT-SALESBILL9';
}

export function setDcPrintTemplate(templateName) {
  localStorage.setItem(DC_PRINT_TEMPLATE_KEY, templateName);
}

export function getGatePassTemplate() {
  return localStorage.getItem(GATE_PASS_TEMPLATE_KEY) || 'TEMPLATE 5 - COMPACT RECEIPT STYLE';
}

export function setGatePassTemplate(templateName) {
  localStorage.setItem(GATE_PASS_TEMPLATE_KEY, templateName);
}

export function getPrinterConfig() {
  return {
    printerName: localStorage.getItem(PRINTER_NAME_KEY) || '',
    dcPrinterName: localStorage.getItem(DC_PRINTER_NAME_KEY) || localStorage.getItem(PRINTER_NAME_KEY) || '',
    gatePassPrinterName: localStorage.getItem(GATE_PASS_PRINTER_NAME_KEY) || localStorage.getItem(PRINTER_NAME_KEY) || '',
    mode: localStorage.getItem(PRINTER_MODE_KEY) || 'HTML_DRIVER',
    dcMode: localStorage.getItem(DC_PRINTER_MODE_KEY) || 'HTML_DRIVER',
    gatePassMode: localStorage.getItem(GATE_PASS_PRINTER_MODE_KEY) || 'HTML_DRIVER',
    copies: Number(localStorage.getItem(PRINTER_COPIES_KEY)) || 1,
    autoFeed: localStorage.getItem(PRINTER_AUTO_FEED_KEY) !== 'false',
    formLines: Number(localStorage.getItem(PRINTER_FORM_LINES_KEY)) || 24, // 24 lines = 4 inches (standard 8-hole continuous form)
    feedMode: localStorage.getItem(PRINTER_FEED_MODE_KEY) || 'EXACT_LINES', // 'EXACT_LINES' (stops at tear-off), 'FORM_FEED', 'NONE'
    a5FeedMode: localStorage.getItem(PRINTER_A5_FEED_KEY) || 'IMAGE_1_WIDE' // 'IMAGE_1_WIDE' (Horizontal/Wide Feed tray), 'IMAGE_2_NARROW' (Vertical/Narrow Feed)
  };
}

export function setPrinterConfig(config = {}) {
  if (config.printerName !== undefined) localStorage.setItem(PRINTER_NAME_KEY, config.printerName);
  if (config.dcPrinterName !== undefined) localStorage.setItem(DC_PRINTER_NAME_KEY, config.dcPrinterName);
  if (config.gatePassPrinterName !== undefined) localStorage.setItem(GATE_PASS_PRINTER_NAME_KEY, config.gatePassPrinterName);
  if (config.mode !== undefined) localStorage.setItem(PRINTER_MODE_KEY, config.mode);
  if (config.dcMode !== undefined) localStorage.setItem(DC_PRINTER_MODE_KEY, config.dcMode);
  if (config.gatePassMode !== undefined) localStorage.setItem(GATE_PASS_PRINTER_MODE_KEY, config.gatePassMode);
  if (config.copies !== undefined) localStorage.setItem(PRINTER_COPIES_KEY, String(config.copies));
  if (config.autoFeed !== undefined) localStorage.setItem(PRINTER_AUTO_FEED_KEY, String(config.autoFeed));
  if (config.formLines !== undefined) localStorage.setItem(PRINTER_FORM_LINES_KEY, String(config.formLines));
  if (config.feedMode !== undefined) localStorage.setItem(PRINTER_FEED_MODE_KEY, String(config.feedMode));
  if (config.a5FeedMode !== undefined) localStorage.setItem(PRINTER_A5_FEED_KEY, String(config.a5FeedMode));
}

export function generateSlipHtml(data = {}, template = getSelectedTemplate()) {
  // The Crystal Reports layouts render their fields exactly as the .rpt files
  // did, so they are matched before any of the app's own sample-filled designs.
  const rptHtml = generateRptSlipHtml(data, template);
  if (rptHtml) return rptHtml;

  const dcNum = data.dcNum || data.dc_num || 'WB2505170001';
  const vehicle = (data.vehicle || data.vehicle_no || 'TS 09 AB 1234').toUpperCase();
  const vehicleType = (data.vehicleType || '10 Wheeler').toUpperCase();
  const material = (data.material || data.product || 'Stone Chips 20mm').toUpperCase();
  const materialType = (data.materialType || 'Construction').toUpperCase();
  const party = (data.party || data.customer || 'ABC Traders').toUpperCase();
  const driverName = (data.driverName || 'Ramesh').toUpperCase();
  const mobileNo = data.mobileNo || '9876543210';
  const orderNo = data.orderNo || 'PO/2505/001';
  const remarks = data.remarks || '-';
  const destination = (data.destination || 'OUT').toUpperCase();
  const source = (data.source || data.quarry || 'BMW Quarry').toUpperCase();
  const gross = (data.gross || '28560').toLocaleString();
  const tare = (data.tare || '12560').toLocaleString();
  const nett = (data.net || data.nett || '16000').toLocaleString();
  const operator = (data.operator || 'Admin').toUpperCase();
  const weighbridge = (data.weighbridge || 'WB-01').toUpperCase();
  const transporter = (data.transporter || data.transporterName || 'Express Logistics').toUpperCase();
  const amount = data.amount || '₹ 0.00';

  const now = new Date();
  const dd = n => String(n).padStart(2, '0');
  const fallbackDate = `${dd(now.getDate())}-${dd(now.getMonth() + 1)}-${now.getFullYear()}`;
  const fallbackTime = `${dd(now.getHours())}:${dd(now.getMinutes())}`;

  let date = data.date || data.grossDate || data.gross_date;
  let time = data.time || data.grossTime || data.gross_time;
  if (!date && data.date_time) {
    const parts = String(data.date_time).split(/[,\s]+/);
    if (parts[0]) date = parts[0];
    if (!time && parts.length > 1) time = parts.slice(1).join(' ');
  }
  if (!date) date = fallbackDate;
  if (!time) time = fallbackTime;

  let tareDate = data.tareDate || data.tare_date;
  let tareTime = data.tareTime || data.tare_time;
  if (!tareDate && tare) tareDate = date;
  if (!tareTime && tare) tareTime = time;

  // -------------------------------------------------------------
  // TEMPLATE 1 - CLASSIC BLUE (Exact Photo Match 1)
  // -------------------------------------------------------------
  if (template === 'TEMPLATE 1 - CLASSIC BLUE' || template === 'TEMPLATE-1') {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 16px; background: #fff; border: 1px solid #cbd5e1; box-sizing: border-box;">
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 32px; color: #1e3a8a;">🚛</div>
            <div>
              <div style="font-size: 20px; font-weight: 900; color: #1e3a8a; letter-spacing: 0.5px;">NORIS INDUSTRIES PVT. LTD.</div>
              <div style="font-size: 13px; font-weight: 700; color: #1e3a8a; letter-spacing: 1px;">WEIGHBRIDGE SLIP</div>
              <div style="font-size: 11px; color: #475569;">Address : 123, Industrial Area, Hyderabad - 500070</div>
              <div style="font-size: 11px; color: #475569;">Phone : +91 9876543210 | Email : info@noris.com</div>
            </div>
          </div>
        </div>

        <!-- Meta Ticket Info Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="background: #1e3a8a; color: #fff; padding: 4px 12px; font-size: 11px; font-weight: 700; border-radius: 4px;">
            TICKET NO. <span style="margin-left: 8px; font-weight: 900; font-size: 13px; background: #fff; color: #1e3a8a; padding: 2px 6px; border-radius: 2px;">${dcNum}</span>
          </div>
          <div style="font-size: 12px; font-weight: 600; color: #334155;">
            Date : <b>${date}</b> &nbsp;&nbsp;&nbsp; Time : <b>${time}</b>
          </div>
        </div>

        <!-- 2 Column Details Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
          <!-- Vehicle Details -->
          <div style="border: 1px solid #93c5fd; border-radius: 4px; overflow: hidden;">
            <div style="background: #1e3a8a; color: #fff; font-size: 11px; font-weight: 800; padding: 4px 8px; text-transform: uppercase;">VEHICLE DETAILS</div>
            <div style="padding: 6px 8px; font-size: 12px; line-height: 1.6;">
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Vehicle No.</span>: <b>${vehicle}</b></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Vehicle Type</span>: <span>${vehicleType}</span></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Party Name</span>: <b>${party}</b></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Driver Name</span>: <span>${driverName}</span></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Mobile No.</span>: <span>${mobileNo}</span></div>
            </div>
          </div>

          <!-- Product Details -->
          <div style="border: 1px solid #93c5fd; border-radius: 4px; overflow: hidden;">
            <div style="background: #1e3a8a; color: #fff; font-size: 11px; font-weight: 800; padding: 4px 8px; text-transform: uppercase;">PRODUCT DETAILS</div>
            <div style="padding: 6px 8px; font-size: 12px; line-height: 1.6;">
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Product</span>: <b>${material}</b></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Material Type</span>: <span>${materialType}</span></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Order No.</span>: <span>${orderNo}</span></div>
              <div style="display: flex;"><span style="width: 90px; color: #475569;">Remarks</span>: <span>${remarks}</span></div>
            </div>
          </div>
        </div>

        <!-- 4 Column Weight Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">
          <thead>
            <tr style="background: #1e3a8a; color: #fff;">
              <th style="padding: 6px 8px; text-align: left; font-size: 11px;">TYPE</th>
              <th style="padding: 6px 8px; text-align: right; font-size: 11px;">WEIGHT</th>
              <th style="padding: 6px 8px; text-align: center; font-size: 11px;">DATE</th>
              <th style="padding: 6px 8px; text-align: center; font-size: 11px;">TIME</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #cbd5e1;">
              <td style="padding: 6px 8px; font-weight: 700;">GROSS WEIGHT</td>
              <td style="padding: 6px 8px; text-align: right; font-weight: 800; color: #1e3a8a;">${gross} kg</td>
              <td style="padding: 6px 8px; text-align: center;">${date}</td>
              <td style="padding: 6px 8px; text-align: center;">${time}</td>
            </tr>
            <tr style="border-bottom: 1px solid #cbd5e1;">
              <td style="padding: 6px 8px; font-weight: 700;">TARE WEIGHT</td>
              <td style="padding: 6px 8px; text-align: right; font-weight: 800; color: #1e3a8a;">${tare} kg</td>
              <td style="padding: 6px 8px; text-align: center;">${tareDate}</td>
              <td style="padding: 6px 8px; text-align: center;">${tareTime}</td>
            </tr>
            <tr style="background: #1e3a8a; color: #fff; font-weight: 800;">
              <td style="padding: 8px; font-size: 13px;">NET WEIGHT</td>
              <td style="padding: 8px; text-align: right; font-size: 15px; letter-spacing: 0.5px;">${nett} kg</td>
              <td style="padding: 8px;" colSpan="2"></td>
            </tr>
          </tbody>
        </table>

        <!-- Signatures & Footer Banner -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #334155; margin-bottom: 12px;">
          <div>
            <div>Operator &nbsp;&nbsp;&nbsp;&nbsp;: <b>${operator}</b></div>
            <div>Weighbridge : <b>${weighbridge}</b></div>
          </div>
          <div style="text-align: center;">
            <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 20px; color: #1e3a8a; margin-bottom: -4px;">Jan</div>
            <div style="border-top: 1px solid #94a3b8; width: 100px; padding-top: 2px; font-weight: 600;">Signature</div>
          </div>
        </div>

        <div style="background: #1e3a8a; color: #fff; text-align: center; font-weight: 700; font-size: 12px; padding: 6px; border-radius: 4px; letter-spacing: 0.5px;">
          Thank You! Visit Again !!
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TEMPLATE 2 - MODERN MINIMAL (Exact Photo Match 2)
  // -------------------------------------------------------------
  if (template === 'TEMPLATE 2 - MODERN MINIMAL' || template === 'TEMPLATE-2') {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 16px; background: #fff; border: 1px solid #cbd5e1; box-sizing: border-box;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669; padding-bottom: 8px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="background: #059669; color: #fff; font-size: 26px; font-weight: 900; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">A</div>
            <div>
              <div style="font-size: 18px; font-weight: 900; color: #0f172a;">GREENWAY INFRA SOLUTIONS</div>
              <div style="font-size: 12px; font-weight: 700; color: #059669;">WEIGHBRIDGE TICKET</div>
            </div>
          </div>
          <!-- QR Code Mock -->
          <div style="border: 1px solid #cbd5e1; padding: 4px; border-radius: 4px; text-align: center;">
            <div style="width: 44px; height: 44px; background: repeating-linear-gradient(45deg, #000 0, #000 4px, #fff 4px, #fff 8px);"></div>
          </div>
        </div>

        <!-- Meta Line -->
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #334155; margin-bottom: 12px; background: #f0fdf4; padding: 6px 10px; border-radius: 4px;">
          <div>Ticket No. <b style="color: #059669; font-size: 13px;">${dcNum}</b></div>
          <div>Date : <b>${date}</b> &nbsp;&nbsp; Time : <b>${time}</b></div>
        </div>

        <!-- 2 Column Details Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; font-size: 12px; line-height: 1.6;">
          <div>
            <div style="font-weight: 800; color: #059669; border-bottom: 1px solid #a7f3d0; padding-bottom: 2px; margin-bottom: 6px; font-size: 11px;">VEHICLE & PARTY DETAILS</div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Vehicle No.</span>: <b>${vehicle}</b></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Vehicle Type</span>: <span>${vehicleType}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Party Name</span>: <b>${party}</b></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Driver Name</span>: <span>${driverName}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Mobile No.</span>: <span>${mobileNo}</span></div>
          </div>

          <div>
            <div style="font-weight: 800; color: #059669; border-bottom: 1px solid #a7f3d0; padding-bottom: 2px; margin-bottom: 6px; font-size: 11px;">PRODUCT DETAILS</div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Product</span>: <b>${material}</b></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Material Type</span>: <span>${materialType}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Order No.</span>: <span>${orderNo}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #64748b;">Remarks</span>: <span>${remarks}</span></div>
          </div>
        </div>

        <!-- Weight Rows with Icons -->
        <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; background: #fafafa;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #334155; font-size: 12px;">
              <span>⚖️</span> GROSS WEIGHT
            </div>
            <div style="font-size: 16px; font-weight: 900; color: #0f172a;">${gross} kg <span style="font-size: 11px; font-weight: 400; color: #64748b; margin-left: 10px;">${date} ${time}</span></div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #334155; font-size: 12px;">
              <span>⚖️</span> TARE WEIGHT
            </div>
            <div style="font-size: 16px; font-weight: 900; color: #0f172a;">${tare} kg <span style="font-size: 11px; font-weight: 400; color: #64748b; margin-left: 10px;">${tareDate} ${tareTime}</span></div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 2px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; color: #059669; font-size: 13px;">
              <span>🚛</span> NET WEIGHT
            </div>
            <div style="font-size: 20px; font-weight: 900; color: #059669;">${nett} kg</div>
          </div>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #475569; margin-bottom: 12px;">
          <div>
            <div>Operator &nbsp;&nbsp;&nbsp;&nbsp;: <b>${operator}</b></div>
            <div>Weighbridge : <b>${weighbridge}</b></div>
          </div>
          <div style="text-align: center;">
            <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 18px; color: #059669; margin-bottom: -4px;">Jan</div>
            <div style="border-top: 1px solid #94a3b8; width: 120px; padding-top: 2px; font-weight: 600;">Authorised Signature</div>
          </div>
        </div>

        <div style="background: #059669; color: #fff; text-align: center; font-weight: 700; font-size: 12px; padding: 6px; border-radius: 4px;">
          Thank You! Visit Again !!
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TEMPLATE 3 - INDUSTRIAL STYLE (Exact Photo Match 3)
  // -------------------------------------------------------------
  if (template === 'TEMPLATE 3 - INDUSTRIAL STYLE' || template === 'TEMPLATE-3') {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #fff; border: 3px solid #000; box-sizing: border-box;">
        <!-- Top Hazard Warning Stripes -->
        <div style="height: 12px; background: repeating-linear-gradient(45deg, #eab308, #eab308 12px, #000 12px, #000 24px);"></div>
        
        <div style="padding: 16px;">
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="font-size: 32px; color: #000;">⚙️</div>
              <div>
                <div style="font-size: 20px; font-weight: 900; color: #000; letter-spacing: 0.5px;">ROCK SOLID CONSTRUCTION</div>
                <div style="font-size: 14px; font-weight: 800; color: #000;">WEIGHBRIDGE SLIP</div>
                <div style="font-size: 11px; color: #475569;">Site : 45, Rock Solid Yard, Medchal, Hyderabad - 501401</div>
                <div style="font-size: 11px; color: #475569;">Phone : +91 9123456789 | Email : info@rocksolid.com</div>
              </div>
            </div>
            <div style="border: 1px solid #000; padding: 6px 12px; text-align: right; background: #f8fafc; border-radius: 4px;">
              <div style="font-size: 10px; font-weight: 700; color: #475569;">TICKET NO.</div>
              <div style="font-size: 14px; font-weight: 900; color: #dc2626;">${dcNum}</div>
              <div style="font-size: 10px; color: #334155; margin-top: 2px;">DATE : <b>${date}</b></div>
              <div style="font-size: 10px; color: #334155;">TIME : <b>${time}</b></div>
            </div>
          </div>

          <!-- 2 Column Details Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden;">
              <div style="background: #e2e8f0; color: #000; font-size: 11px; font-weight: 800; padding: 4px 8px;">VEHICLE DETAILS</div>
              <div style="padding: 6px 8px; font-size: 12px; line-height: 1.6;">
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Vehicle No.</span>: <b>${vehicle}</b></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Vehicle Type</span>: <span>${vehicleType}</span></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Driver Name</span>: <span>${driverName}</span></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Mobile No.</span>: <span>${mobileNo}</span></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Party Name</span>: <b>${party}</b></div>
              </div>
            </div>

            <div style="border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden;">
              <div style="background: #e2e8f0; color: #000; font-size: 11px; font-weight: 800; padding: 4px 8px;">PRODUCT DETAILS</div>
              <div style="padding: 6px 8px; font-size: 12px; line-height: 1.6;">
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Product</span>: <b>${material}</b></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Material Type</span>: <span>${materialType}</span></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Order No.</span>: <span>${orderNo}</span></div>
                <div style="display: flex;"><span style="width: 85px; color: #475569;">Remarks</span>: <span>${remarks}</span></div>
              </div>
            </div>
          </div>

          <!-- 3 Solid Black Weight Cards -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 8px; margin-bottom: 16px; text-align: center;">
            <div style="background: #0f172a; color: #fff; padding: 10px; border-radius: 4px;">
              <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #94a3b8;">GROSS WEIGHT</div>
              <div style="font-size: 18px; font-weight: 900; color: #facc15; margin: 4px 0;">${gross} kg</div>
              <div style="font-size: 10px; color: #cbd5e1;">${date} ${time}</div>
            </div>

            <div style="background: #0f172a; color: #fff; padding: 10px; border-radius: 4px;">
              <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #94a3b8;">TARE WEIGHT</div>
              <div style="font-size: 18px; font-weight: 900; color: #facc15; margin: 4px 0;">${tare} kg</div>
              <div style="font-size: 10px; color: #cbd5e1;">${tareDate} ${tareTime}</div>
            </div>

            <div style="background: #000; color: #fff; padding: 10px; border-radius: 4px; border: 1.5px solid #facc15;">
              <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.5px; color: #fff;">NET WEIGHT</div>
              <div style="font-size: 22px; font-weight: 900; color: #facc15; margin: 2px 0;">${nett} kg</div>
            </div>
          </div>

          <!-- Footer Info -->
          <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #334155; margin-bottom: 10px;">
            <div>
              <div>Operator &nbsp;&nbsp;&nbsp;&nbsp;: <b>${operator}</b></div>
              <div>Weighbridge : <b>${weighbridge}</b></div>
            </div>
            <div style="text-align: center;">
              <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 18px; color: #000; margin-bottom: -4px;">Jan</div>
              <div style="border-top: 1px solid #000; width: 110px; padding-top: 2px; font-weight: 600;">Signature</div>
            </div>
          </div>
        </div>

        <!-- Bottom Hazard Bar -->
        <div style="background: #000; color: #facc15; text-align: center; font-weight: 900; font-size: 11px; padding: 6px; letter-spacing: 2px; border-top: 2px solid #eab308;">
          SAFETY | ACCURACY | RELIABILITY
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TEMPLATE 4 - PROFESSIONAL CORPORATE (Exact Photo Match 4)
  // -------------------------------------------------------------
  if (template === 'TEMPLATE 4 - PROFESSIONAL CORPORATE' || template === 'TEMPLATE-4') {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 16px; background: #fff; border: 1px solid #cbd5e1; box-sizing: border-box;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="font-size: 30px; color: #1d4ed8;">⬢</div>
            <div>
              <div style="font-size: 18px; font-weight: 900; color: #1d4ed8;">BUILDWELL MATERIALS PVT. LTD.</div>
              <div style="font-size: 13px; font-weight: 800; color: #0f172a;">WEIGHBRIDGE TICKET</div>
              <div style="font-size: 11px; color: #475569;">Address : Sy.No. 99, Bachupally, Hyderabad - 500090</div>
              <div style="font-size: 11px; color: #475569;">Phone : +91 9988776655 | Email : info@buildwell.com</div>
            </div>
          </div>
          <div style="border: 1px solid #bfdbfe; background: #eff6ff; padding: 6px 12px; border-radius: 6px; text-align: right;">
            <div style="font-size: 10px; font-weight: 700; color: #1d4ed8;">Ticket No.</div>
            <div style="font-size: 13px; font-weight: 900; color: #1d4ed8;">${dcNum}</div>
            <div style="font-size: 10px; color: #475569; margin-top: 2px;">Date &nbsp;: <b>${date}</b></div>
            <div style="font-size: 10px; color: #475569;">Time &nbsp;: <b>${time}</b></div>
          </div>
        </div>

        <!-- 3 Column Container (Left Details 2/3, Right Weight Stack 1/3) -->
        <div style="display: grid; grid-template-columns: 1.8fr 1fr; gap: 12px; margin-bottom: 16px;">
          <!-- Left Details -->
          <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 11px;">
              <div>
                <div style="font-weight: 800; color: #1d4ed8; margin-bottom: 4px;">VEHICLE DETAILS</div>
                <div style="line-height: 1.6;">
                  <div>Vehicle No. &nbsp;&nbsp;: <b>${vehicle}</b></div>
                  <div>Vehicle Type : <span>${vehicleType}</span></div>
                  <div>Driver Name : <span>${driverName}</span></div>
                  <div>Mobile No. &nbsp;&nbsp;: <span>${mobileNo}</span></div>
                  <div>Party Name &nbsp;&nbsp;: <b>${party}</b></div>
                </div>
              </div>

              <div>
                <div style="font-weight: 800; color: #1d4ed8; margin-bottom: 4px;">PRODUCT DETAILS</div>
                <div style="line-height: 1.6;">
                  <div>Product &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <b>${material}</b></div>
                  <div>Material Type : <span>${materialType}</span></div>
                  <div>Order No. &nbsp;&nbsp;&nbsp;&nbsp;: <span>${orderNo}</span></div>
                  <div>Remarks &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span>${remarks}</span></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Weight Stack Card -->
          <div style="border: 1px solid #bfdbfe; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column;">
            <div style="padding: 8px; font-size: 11px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <div style="font-size: 10px; font-weight: 700; color: #475569;">GROSS WEIGHT</div>
              <div style="font-size: 14px; font-weight: 900; color: #0f172a;">${gross} kg</div>
              <div style="font-size: 9px; color: #64748b;">${date} ${time}</div>
            </div>

            <div style="padding: 8px; font-size: 11px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <div style="font-size: 10px; font-weight: 700; color: #475569;">TARE WEIGHT</div>
              <div style="font-size: 14px; font-weight: 900; color: #0f172a;">${tare} kg</div>
              <div style="font-size: 9px; color: #64748b;">${tareDate} ${tareTime}</div>
            </div>

            <div style="background: #1d4ed8; color: #fff; padding: 10px 8px; text-align: center; margin-top: auto;">
              <div style="font-size: 10px; font-weight: 800; letter-spacing: 0.5px;">NET WEIGHT</div>
              <div style="font-size: 18px; font-weight: 900; margin-top: 2px;">${nett} kg</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #334155; margin-bottom: 12px;">
          <div>
            <div>Operator &nbsp;&nbsp;&nbsp;&nbsp;: <b>${operator}</b></div>
            <div>Weighbridge : <b>${weighbridge}</b></div>
          </div>
          <div style="text-align: center;">
            <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 18px; color: #1d4ed8; margin-bottom: -4px;">Jan</div>
            <div style="border-top: 1px solid #94a3b8; width: 120px; padding-top: 2px; font-weight: 600;">Authorised Signature</div>
          </div>
        </div>

        <div style="background: #1d4ed8; color: #fff; text-align: center; font-weight: 700; font-size: 12px; padding: 6px; border-radius: 4px;">
          Thank You! Visit Again !!
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TEMPLATE 5 - COMPACT RECEIPT STYLE (Exact Photo Match 5)
  // -------------------------------------------------------------
  if (template === 'TEMPLATE 5 - COMPACT RECEIPT STYLE' || template === 'TEMPLATE-5') {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 16px; background: #fff; border: 2px dashed #94a3b8; border-radius: 6px; box-sizing: border-box;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div style="text-align: center; flex-grow: 1;">
            <div style="font-size: 18px; font-weight: 900; color: #0f172a; letter-spacing: 0.5px;">SUNRISE AGGREGATES</div>
            <div style="font-size: 12px; font-weight: 800; color: #475569;">WEIGHBRIDGE RECEIPT</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Address : 67, Sunrise Yard, Shadnagar, Hyderabad - 509216</div>
            <div style="font-size: 11px; color: #64748b;">Ph: +91 8099991111</div>
          </div>
          <div style="border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; text-align: right; background: #f8fafc;">
            <div style="font-size: 10px; font-weight: 700; color: #475569;">TICKET NO.</div>
            <div style="font-size: 12px; font-weight: 900; color: #0f172a;">${dcNum}</div>
            <div style="font-size: 9px; color: #64748b; margin-top: 2px;">DATE : ${date}</div>
            <div style="font-size: 9px; color: #64748b;">TIME : ${time}</div>
          </div>
        </div>

        <div style="border-top: 1px solid #cbd5e1; margin-bottom: 12px;"></div>

        <!-- Details Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px; line-height: 1.6; margin-bottom: 14px;">
          <div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Vehicle No.</span>: <b>${vehicle}</b></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Vehicle Type</span>: <span>${vehicleType}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Driver Name</span>: <span>${driverName}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Mobile No.</span>: <span>${mobileNo}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Party Name</span>: <b>${party}</b></div>
          </div>

          <div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Product</span>: <b>${material}</b></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Material Type</span>: <span>${materialType}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Order No.</span>: <span>${orderNo}</span></div>
            <div style="display: flex;"><span style="width: 90px; color: #475569;">Remarks</span>: <span>${remarks}</span></div>
          </div>
        </div>

        <!-- Weight Rows -->
        <div style="border-top: 1px solid #cbd5e1; padding-top: 10px; margin-bottom: 16px; font-size: 13px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-weight: 700; width: 140px;">GROSS WEIGHT</span>
            <span style="font-weight: 800; font-size: 15px;">: &nbsp; ${gross} kg</span>
            <span style="font-size: 11px; color: #64748b;">(${date} &nbsp; ${time})</span>
          </div>

          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-weight: 700; width: 140px;">TARE WEIGHT</span>
            <span style="font-weight: 800; font-size: 15px;">: &nbsp; ${tare} kg</span>
            <span style="font-size: 11px; color: #64748b;">(${tareDate} &nbsp; ${tareTime})</span>
          </div>

          <div style="background: #000; color: #fff; padding: 6px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-weight: 900;">
            <span style="font-size: 13px; letter-spacing: 0.5px;">NET WEIGHT</span>
            <span style="font-size: 18px;">: &nbsp; ${nett} kg</span>
            <span></span>
          </div>
        </div>

        <!-- Footer -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #334155; margin-bottom: 12px;">
          <div>
            <div>Operator &nbsp;&nbsp;: <b>${operator}</b></div>
            <div>Weighbridge : <b>${weighbridge}</b></div>
          </div>
          <div style="text-align: center;">
            <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 18px; color: #000; margin-bottom: -4px;">Jan</div>
            <div style="border-top: 1px solid #94a3b8; width: 100px; padding-top: 2px; font-weight: 600;">Signature</div>
          </div>
        </div>

        <div style="text-align: center; font-size: 11px; color: #475569; font-weight: 700; letter-spacing: 0.5px;">
          --- Thank You! Visit Again !! ---
        </div>
      </div>
    `;
  }

  // 1. IMAGE-4 (Standard Slip - Photo Match Layout)
  if (template === 'IMAGE-4' || template === 'IMAGE') {
    const company = getCompanyDetails();
    const cName = company.companyName || 'NORIS WEIGHBRIDGE';
    const cAddr1 = company.address1 || '';
    const cAddr2 = company.address2 || '';
    return `
      <div style="font-family: 'Segoe UI', Tahoma, monospace, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; background: #fff; color: #000; border: 1px solid #ddd; border-radius: 6px; position: relative;">
        <div style="position: absolute; top: 16px; right: 16px; border: 1.5px solid #000; padding: 4px 12px; text-align: center; min-width: 130px;">
          <div style="font-weight: 800; font-size: 11px; letter-spacing: 1px; text-transform: uppercase;">GATE PASS</div>
          <div style="font-size: 10px; font-weight: 700; margin-top: 2px; color: #000;">DATE: ${date}</div>
          <div style="font-size: 10px; font-weight: 700; margin-top: 3px; color: #000;">SIGN: ____________</div>
        </div>
        <div style="text-align: center; font-weight: 800; font-size: 20px; letter-spacing: 1.5px; margin-bottom: 2px;">${esc(cName)}</div>
        ${cAddr1 ? `<div style="text-align: center; font-size: 12px; color: #333; margin-bottom: 2px;">${esc(cAddr1)}</div>` : ''}
        ${cAddr2 ? `<div style="text-align: center; font-size: 12px; color: #333; margin-bottom: 12px;">${esc(cAddr2)}</div>` : ''}
        
        <div style="text-align: center; font-weight: 800; letter-spacing: 5px; font-size: 13px; margin-bottom: 12px; text-decoration: underline;">W E I G H M E N T &nbsp;&nbsp; S L I P</div>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 6px;">
          <tr style="border-top: 1.5px solid #000; border-bottom: 1px solid #000;">
            <td style="padding: 6px 0; font-weight: bold; width: 20%;">DC NUMBER</td>
            <td style="padding: 6px 0; width: 30%;">: ${dcNum}</td>
            <td style="padding: 6px 0; font-weight: bold; width: 20%;">VEHICLE</td>
            <td style="padding: 6px 0; font-weight: bold; width: 30%;">: ${vehicle}</td>
          </tr>
          <tr style="border-bottom: 1px solid #000;">
            <td style="padding: 6px 0; font-weight: bold;">MATERIAL</td>
            <td style="padding: 6px 0;">: ${material}</td>
            <td style="padding: 6px 0; font-weight: bold;">PARTY</td>
            <td style="padding: 6px 0;">: ${party}</td>
          </tr>
          <tr style="border-bottom: 1px solid #000;">
            <td style="padding: 6px 0; font-weight: bold;">DESTINATION</td>
            <td style="padding: 6px 0;">: ${destination}</td>
            <td style="padding: 6px 0; font-weight: bold;">SOURCE</td>
            <td style="padding: 6px 0;">: ${source}</td>
          </tr>
        </table>

        <div style="text-align: center; font-weight: 800; letter-spacing: 5px; font-size: 12px; margin: 12px 0 6px 0;">W E I G H T</div>

        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 25px;">
          <tr>
            <td style="padding: 5px 0; font-weight: bold; width: 16%;">GROSS</td>
            <td style="padding: 5px 0; font-weight: bold; width: 24%;">: ${gross} kg</td>
            <td style="padding: 5px 0; font-weight: bold; width: 12%;">DATE</td>
            <td style="padding: 5px 0; width: 24%;">: ${date}</td>
            <td style="padding: 5px 0; font-weight: bold; width: 10%;">TIME</td>
            <td style="padding: 5px 0; width: 14%;">: ${time}</td>
          </tr>
          <tr>
            <td style="padding: 5px 0; font-weight: bold;">TARE</td>
            <td style="padding: 5px 0; font-weight: bold;">: ${tare} kg</td>
            <td style="padding: 5px 0; font-weight: bold;">DATE</td>
            <td style="padding: 5px 0;">: ${tareDate}</td>
            <td style="padding: 5px 0; font-weight: bold;">TIME</td>
            <td style="padding: 5px 0;">: ${tareTime}</td>
          </tr>
          <tr style="border-bottom: 1.5px solid #000;">
            <td style="padding: 6px 0; font-weight: bold; color: #000;">NETT</td>
            <td style="padding: 6px 0; font-weight: bold; font-size: 14px;">: ${nett} kg</td>
            <td style="padding: 6px 0; font-weight: bold;">TRANSPORTER</td>
            <td style="padding: 6px 0;" colSpan="2">: ${transporter}</td>
            <td style="padding: 6px 0; font-weight: bold;">AMOUNT : ${amount}</td>
          </tr>
        </table>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 35px; font-weight: bold; font-size: 12px;">
          <span>Sign Of Supervisor</span>
          <span>Authorised Signature</span>
        </div>
      </div>
    `;
  }

  // 2. IMAGE-1 (Modern Corporate Minimalist Layout)
  if (template === 'IMAGE-1') {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 2px solid #1a365d; border-radius: 8px;">
        <div style="background: #1a365d; color: #fff; padding: 12px; text-align: center; border-radius: 4px; margin-bottom: 16px;">
          <h2 style="margin:0; font-size: 18px; letter-spacing: 2px;">NORIS INDUSTRIAL WEIGHBRIDGE</h2>
          <div style="font-size: 11px; opacity: 0.85;">Certified Automated Dispatch Ticket</div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 13px;">
          <div><b>SLIP NO:</b> ${dcNum}</div>
          <div><b>DATE:</b> ${date} ${time}</div>
        </div>
        <table style="width: 100%; border: 1px solid #cbd5e1; border-collapse: collapse; font-size: 13px; margin-bottom: 16px;">
          <tr style="background: #f8fafc;"><th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left;">Vehicle No</th><td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold;">${vehicle}</td></tr>
          <tr><th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left;">Customer / Party</th><td style="padding: 6px; border: 1px solid #cbd5e1;">${party}</td></tr>
          <tr style="background: #f8fafc;"><th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left;">Material</th><td style="padding: 6px; border: 1px solid #cbd5e1;">${material}</td></tr>
          <tr><th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left;">Source → Destination</th><td style="padding: 6px; border: 1px solid #cbd5e1;">${source} → ${destination}</td></tr>
        </table>
        <div style="background: #f1f5f9; padding: 12px; border-radius: 6px; display: flex; justify-content: space-around; text-align: center; font-size: 13px; margin-bottom: 16px;">
          <div><span style="color:#64748b; font-size:11px;">GROSS</span><br/><b>${gross} kg</b></div>
          <div><span style="color:#64748b; font-size:11px;">TARE</span><br/><b>${tare} kg</b></div>
          <div><span style="color:#2563eb; font-size:11px;">NET WEIGHT</span><br/><b style="font-size:16px; color:#1e40af;">${nett} kg</b></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #475569; margin-top: 20px;">
          <div>Transporter: <b>${transporter}</b></div>
          <div>Auth. Operator</div>
        </div>
      </div>
    `;
  }

  // 3. IMAGE-2 (Full Industrial Delivery Challan - A5 Landscape)
  if (template === 'IMAGE-2' || template === 'DELIVERY CHALLAN') {
    return `
      <div style="font-family: Arial, Helvetica, sans-serif; width: 100%; max-width: 760px; margin: 0 auto; padding: 14px 18px; border: 2px solid #000; border-radius: 4px; box-sizing: border-box; background: #fff; color: #000;">
        <!-- Header -->
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
          <div style="font-size: 18px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase;">DISPATCH DELIVERY CHALLAN</div>
          <div style="font-size: 13px; font-weight: 800; color: #111; margin-top: 2px;">NORIS WEIGHBRIDGE OPERATIONS — HYDERABAD</div>
          <div style="font-size: 9.5px; font-weight: 600; color: #475569; letter-spacing: 0.5px;">Government Approved Computerized Electronic Weighbridge</div>
        </div>

        <!-- Meta Info Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 3px; padding: 5px 12px; font-size: 11.5px; font-weight: 700; margin-bottom: 8px;">
          <div>CHALLAN NO : <span style="font-size: 14px; font-weight: 900; color: #000; margin-left: 4px;">${dcNum}</span></div>
          <div>DATE : <span>${date}</span> &nbsp;&nbsp;|&nbsp;&nbsp; TIME : <span>${time}</span></div>
        </div>

        <!-- 2 Column Details Grid -->
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px;">
          <tr>
            <td style="width: 50%; vertical-align: top; padding-right: 5px;">
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #94a3b8;">
                <tr style="background: #e2e8f0; font-weight: 800; font-size: 10px; color: #0f172a;"><td colspan="2" style="padding: 3px 6px;">DISPATCH DETAILS</td></tr>
                <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 3px 6px; color: #475569; width: 36%;">Vehicle No</td><td style="padding: 3px 6px; font-weight: 800;">${vehicle}</td></tr>
                <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 3px 6px; color: #475569;">Party / Customer</td><td style="padding: 3px 6px; font-weight: 800;">${party}</td></tr>
                <tr><td style="padding: 3px 6px; color: #475569;">Destination</td><td style="padding: 3px 6px; font-weight: 600;">${destination}</td></tr>
              </table>
            </td>
            <td style="width: 50%; vertical-align: top; padding-left: 5px;">
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #94a3b8;">
                <tr style="background: #e2e8f0; font-weight: 800; font-size: 10px; color: #0f172a;"><td colspan="2" style="padding: 3px 6px;">PRODUCT & TRANSPORT</td></tr>
                <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 3px 6px; color: #475569; width: 36%;">Material</td><td style="padding: 3px 6px; font-weight: 800;">${material}</td></tr>
                <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 3px 6px; color: #475569;">Source / Quarry</td><td style="padding: 3px 6px; font-weight: 600;">${source}</td></tr>
                <tr><td style="padding: 3px 6px; color: #475569;">Transporter</td><td style="padding: 3px 6px; font-weight: 600;">${transporter}</td></tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Weight Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; border: 1.5px solid #000; margin-bottom: 10px;">
          <thead>
            <tr style="background: #0f172a; color: #fff; text-align: center;">
              <th style="padding: 5px; font-size: 10.5px; width: 30%;">WEIGHT TYPE</th>
              <th style="padding: 5px; font-size: 10.5px; width: 25%;">WEIGHT (KG)</th>
              <th style="padding: 5px; font-size: 10.5px; width: 25%;">DATE</th>
              <th style="padding: 5px; font-size: 10.5px; width: 20%;">TIME</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #cbd5e1; text-align: center;">
              <td style="padding: 4px 6px; text-align: left; font-weight: 700;">GROSS WEIGHT</td>
              <td style="padding: 4px 6px; font-weight: 800; font-size: 13px;">${gross} kg</td>
              <td style="padding: 4px 6px;">${date}</td>
              <td style="padding: 4px 6px;">${time}</td>
            </tr>
            <tr style="border-bottom: 1px solid #cbd5e1; text-align: center;">
              <td style="padding: 4px 6px; text-align: left; font-weight: 700;">TARE WEIGHT</td>
              <td style="padding: 4px 6px; font-weight: 800; font-size: 13px;">${tare} kg</td>
              <td style="padding: 4px 6px;">${tareDate}</td>
              <td style="padding: 4px 6px;">${tareTime}</td>
            </tr>
            <tr style="background: #f8fafc; font-weight: 900; text-align: center;">
              <td style="padding: 6px; text-align: left; font-size: 12px; color: #000;">NET WEIGHT (DISPATCHED)</td>
              <td style="padding: 6px; font-size: 15px; color: #000; letter-spacing: 0.5px;">${nett} kg</td>
              <td colspan="2" style="padding: 6px; font-size: 10.5px; color: #334155; text-align: right;">DRIVER : <b>${driverName || 'ASHOK'}</b></td>
            </tr>
          </tbody>
        </table>

        <!-- Signatures -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 10.5px; margin-top: 14px; padding-top: 4px;">
          <div style="text-align: center; width: 140px;">
            <div style="border-top: 1px solid #000; padding-top: 4px; font-weight: 700;">Receiver's Signature</div>
          </div>
          <div style="text-align: center; width: 140px;">
            <div style="border-top: 1px solid #000; padding-top: 4px; font-weight: 700;">Driver's Signature</div>
          </div>
          <div style="text-align: center; width: 140px;">
            <div style="border-top: 1px solid #000; padding-top: 4px; font-weight: 700;">Authorized Signatory</div>
          </div>
        </div>
      </div>
    `;
  }

  // 4. IMAGE-3 (Dual Weight Certificate)
  if (template === 'IMAGE-3') {
    return `
      <div style="font-family: Georgia, serif; max-width: 620px; margin: auto; padding: 20px; border: 3px double #334155; background: #fff;">
        <div style="text-align: center; font-size: 20px; font-weight: bold; color: #1e293b; margin-bottom: 4px;">WEIGHBRIDGE WEIGHT CERTIFICATE</div>
        <div style="text-align: center; font-size: 11px; color: #64748b; font-style: italic; margin-bottom: 16px;">Noris Automated Weighing Systems • Official Inspection Slip</div>
        <div style="border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; padding: 8px 0; margin-bottom: 14px; font-size: 12px; display: flex; justify-content: space-between;">
          <span>Ticket #: <b>${dcNum}</b></span>
          <span>Vehicle #: <b>${vehicle}</b></span>
          <span>Date: <b>${date}</b></span>
        </div>
        <div style="font-size: 13px; line-height: 1.8; margin-bottom: 16px;">
          <div><b>Customer / Party:</b> ${party}</div>
          <div><b>Material Description:</b> ${material}</div>
          <div><b>Route:</b> ${source} to ${destination}</div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; font-size: 13px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>1st Weight (Gross):</span><b>${gross} kg</b></div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>2nd Weight (Tare):</span><b>${tare} kg</b></div>
          <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 15px; color: #0f172a;"><b>Net Quantity:</b><b style="color:#0284c7;">${nett} kg</b></div>
        </div>
        <div style="margin-top: 30px; display: flex; justify-content: space-between; font-size: 12px; font-family: sans-serif;">
          <div>Verified By Operator</div>
          <div>Authorized Stamp / Signature</div>
        </div>
      </div>
    `;
  }

  // 5. IMAGE-5 (80mm Thermal Receipt Layout)
  if (template === 'IMAGE-5') {
    return `
      <div style="font-family: monospace; width: 280px; margin: auto; padding: 10px; border: 1px solid #ccc; font-size: 11px; background: #fff;">
        <div style="text-align: center; font-weight: bold; font-size: 14px;">NORIS WEIGHBRIDGE</div>
        <div style="text-align: center; font-size: 10px; margin-bottom: 8px;">Dammaiguda, Hyderabad</div>
        <div>--------------------------------</div>
        <div>DC NO   : ${dcNum}</div>
        <div>DATE    : ${date} ${time}</div>
        <div>VEHICLE : ${vehicle}</div>
        <div>PARTY   : ${party}</div>
        <div>MAT     : ${material}</div>
        <div>--------------------------------</div>
        <div>GROSS   : ${gross} kg</div>
        <div>TARE    : ${tare} kg</div>
        <div style="font-weight: bold; font-size: 12px;">NET W T : ${nett} kg</div>
        <div>--------------------------------</div>
        <div style="text-align: center; margin-top: 10px; font-size: 10px;">THANK YOU! DRIVE SAFELY</div>
      </div>
    `;
  }

  // 6. IMAGE-6 (Quarry Dispatch Dokket / Gate Pass - A5 Landscape)
  if (template === 'IMAGE-6' || template === 'GATE PASS' || template === 'PASS') {
    return `
      <div style="font-family: Arial, Helvetica, sans-serif; width: 100%; max-width: 760px; margin: 0 auto; padding: 14px 18px; border: 2px solid #047857; border-radius: 4px; box-sizing: border-box; background: #fff; color: #000;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #047857; padding-bottom: 6px; margin-bottom: 8px;">
          <div>
            <div style="font-size: 18px; font-weight: 900; color: #047857; letter-spacing: 0.5px; text-transform: uppercase;">QUARRY DISPATCH DOKKET</div>
            <div style="font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.3px;">Government Permitted Mining Unit / Official Gate Pass</div>
          </div>
          <div style="border: 1.5px solid #047857; background: #ecfdf5; padding: 4px 12px; border-radius: 4px; text-align: right; font-size: 11px;">
            <div>PASS NO : <b style="color: #047857; font-size: 14px;">${dcNum}</b></div>
            <div style="font-size: 9.5px; color: #334155; margin-top: 1px;">DATE : <b>${date}</b> &nbsp;|&nbsp; TIME : <b>${time}</b></div>
          </div>
        </div>

        <!-- 2 Column Details Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; margin-bottom: 8px;">
          <div style="border: 1px solid #a7f3d0; border-radius: 3px; padding: 6px; line-height: 1.6; background: #f0fdf4;">
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Quarry / Source</span>: <b>${source}</b></div>
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Lease Holder</span>: <b>NORIS MINES</b></div>
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Vehicle No</span>: <b style="font-size: 12px; color: #047857;">${vehicle}</b></div>
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Destination</span>: <b>${destination}</b></div>
          </div>

          <div style="border: 1px solid #a7f3d0; border-radius: 3px; padding: 6px; line-height: 1.6; background: #f0fdf4;">
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Material</span>: <b>${material}</b></div>
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Party / Customer</span>: <b>${party}</b></div>
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Transporter</span>: <span>${transporter}</span></div>
            <div style="display: flex;"><span style="width: 110px; color: #065f46;">Driver Name</span>: <span>${driverName || 'ASHOK'}</span></div>
          </div>
        </div>

        <!-- Weight Table -->
        <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; border: 1.5px solid #047857; margin-bottom: 10px;">
          <thead>
            <tr style="background: #047857; color: #fff; text-align: center;">
              <th style="padding: 5px; font-size: 10.5px; width: 33%;">GROSS WEIGHT</th>
              <th style="padding: 5px; font-size: 10.5px; width: 33%;">TARE WEIGHT</th>
              <th style="padding: 5px; font-size: 11px; width: 34%; letter-spacing: 0.5px;">DISPATCHED VOLUME (NETT)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #a7f3d0; text-align: center; background: #fff;">
              <td style="padding: 6px; font-weight: 800; font-size: 13px;">
                ${gross} kg
                <div style="font-size: 9.5px; font-weight: 400; color: #64748b; margin-top: 2px;">${date} ${time}</div>
              </td>
              <td style="padding: 6px; font-weight: 800; font-size: 13px;">
                ${tare} kg
                <div style="font-size: 9.5px; font-weight: 400; color: #64748b; margin-top: 2px;">${tareDate} ${tareTime}</div>
              </td>
              <td style="padding: 6px; font-weight: 900; font-size: 16px; color: #047857; background: #ecfdf5;">
                ${nett} KG
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Signatures -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 10.5px; margin-top: 14px; padding-top: 2px;">
          <div style="text-align: center; width: 140px;">
            <div style="border-top: 1px solid #047857; padding-top: 4px; font-weight: 700; color: #334155;">Driver Signature</div>
          </div>
          <div style="text-align: center; width: 160px;">
            <div style="border-top: 1px solid #047857; padding-top: 4px; font-weight: 700; color: #334155;">Mining Checkpost Officer</div>
          </div>
          <div style="text-align: center; width: 140px;">
            <div style="border-top: 1px solid #047857; padding-top: 4px; font-weight: 700; color: #334155;">Weighbridge Incharge</div>
          </div>
        </div>
      </div>
    `;
  }

  // 7. IMAGE-7 (Executive Tax Invoice Ticket)
  if (template === 'IMAGE-7') {
    return `
      <div style="font-family: sans-serif; max-width: 640px; margin: auto; padding: 20px; border: 1px solid #94a3b8; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 12px;">
          <div>
            <h2 style="margin:0; font-size:18px; color:#0f172a;">TAX INVOICE & WEIGHMENT TICKET</h2>
            <div style="font-size:11px; color:#64748b;">GSTIN: 37AAAAA0000A1Z5 | HSN Code: 2517</div>
          </div>
          <div style="text-align:right; font-size:12px;">
            <b>INV #: ${dcNum}</b><br/>
            <span>Date: ${date}</span>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 14px;">
          <div>Billed To: <b>${party}</b></div>
          <div>Transporter: <b>${transporter}</b></div>
        </div>
        <table style="width: 100%; border: 1px solid #000; border-collapse: collapse; font-size: 12px; margin-bottom: 14px;">
          <thead>
            <tr style="background:#f1f5f9; border-bottom:1px solid #000;">
              <th style="padding:6px; text-align:left;">Item Description</th>
              <th style="padding:6px; text-align:left;">Vehicle</th>
              <th style="padding:6px; text-align:right;">Net Weight</th>
              <th style="padding:6px; text-align:right;">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:6px;">${material}</td>
              <td style="padding:6px;">${vehicle}</td>
              <td style="padding:6px; text-align:right; font-weight:bold;">${nett} kg</td>
              <td style="padding:6px; text-align:right; font-weight:bold;">${amount}</td>
            </tr>
          </tbody>
        </table>
        <div style="display: flex; justify-content: space-between; margin-top: 30px; font-size: 11px;">
          <span>Receiver Sign</span>
          <span>Authorized Signatory</span>
        </div>
      </div>
    `;
  }

  // 9. TEMPLATE 7 - AMR INFRA (Exact Photo Match 5 - A4 Dual Slip with CCTV Images)
  if (template === 'TEMPLATE 7 - AMR INFRA' || template === 'TEMPLATE-7' || template === 'IMAGE-9' || template === 'AMR INFRA') {
    const esc = text => String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const company = getCompanyDetails();
    const companyName = company.companyName || '';
    const address1 = company.address1 || '';
    const address2 = company.address2 || '';
    const companyPhone = data.companyPhone || company.phone || data.mobileNo || '8464931495';
    const companyPhone2 = data.companyPhone2 || '7893551155';

    const contact = data.phone || data.mobileNo || data.contact || '';
    const inTimeStr = data.inTime || (data.tareDate ? `${data.tareDate} & ${data.tareTime || ''}` : `${date} & ${tareTime || time}`);
    const outTimeStr = data.outTime || (data.grossDate ? `${data.grossDate} & ${data.grossTime || ''}` : `${date} & ${time}`);
    const quantity = data.quantity || data.units_val || data.units || '0';

    const img1 = data.image_base64 || data.image_path || data.imageBase64 || data.imagePath || data.image1 || null;
    const img2 = data.image_base64_2 || data.image_path_2 || data.imageBase64_2 || data.imagePath_2 || data.image2 || null;

    const renderImageBox = (imgSrc) => {
      if (imgSrc && String(imgSrc).trim().length > 20) {
        return `
          <div style="width: 205px; height: 155px; border: 1.5px solid #000; border-radius: 2px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
            <img src="${imgSrc}" alt="CCTV" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
          </div>
        `;
      }
      return `
        <div style="width: 205px; height: 155px; border: 1.5px solid #000; border-radius: 2px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #ffffff; padding: 4px; box-sizing: border-box;">
          <svg width="76" height="58" viewBox="0 0 68 52" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="64" height="48" rx="2" fill="none" stroke="#000" />
            <circle cx="22" cy="18" r="5.5" stroke="#000" />
            <path d="M4 44 L25 24 L39 36 L49 26 L64 40" stroke="#000" />
          </svg>
          <div style="font-size: 15px; font-weight: 900; color: #1e293b; text-align: center; line-height: 1.15; margin-top: 4px; font-family: Arial, sans-serif; letter-spacing: -0.2px;">
            No image<br/>available
          </div>
        </div>
      `;
    };

    const renderSlip = () => `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #000; box-sizing: border-box; width: 100%;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #000; padding-bottom: 4px; margin-bottom: 6px;">
          <!-- Left Logo -->
          <div style="display: flex; align-items: center; gap: 8px; width: 160px;">
            <div style="font-size: 26px; line-height: 1; color: #000;">🏗️</div>
            <div style="font-size: 14px; font-weight: 900; line-height: 1.1; letter-spacing: -0.3px; text-transform: uppercase;">
              ${esc(companyName)}
            </div>
          </div>

          <!-- Center Address -->
          <div style="text-align: center; flex: 1; padding: 0 10px;">
            <div style="font-size: 18px; font-weight: 900; letter-spacing: 0.5px; margin-bottom: 2px; text-transform: uppercase;">
              ${esc(companyName)}
            </div>
            <div style="font-size: 9.5px; font-weight: 600; color: #111; line-height: 1.3;">
              ${esc(address1)}
            </div>
            ${address2 ? `<div style="font-size: 9.5px; font-weight: 600; color: #111; line-height: 1.3;">${esc(address2)}</div>` : ''}
          </div>

          <!-- Right Contact -->
          <div style="text-align: right; font-size: 10px; font-weight: 700; width: 160px; line-height: 1.35;">
            <div>Phone : ${esc(companyPhone)}</div>
            ${companyPhone2 ? `<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${esc(companyPhone2)}</div>` : ''}
          </div>
        </div>

        <!-- Body Grid -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; margin-top: 4px;">
          <!-- Left Data Column -->
          <div style="flex: 1; font-size: 12px; line-height: 1.6; color: #000;">
            <div style="display: flex; margin-bottom: 1.5px;">
              <span style="width: 85px; color: #333;">Serial No</span>
              <span style="font-weight: 700;">${esc(dcNum)}</span>
            </div>
            <div style="display: flex; margin-bottom: 1.5px;">
              <span style="width: 85px; color: #333;">Customer</span>
              <span style="font-weight: 700;">${esc(party)}</span>
            </div>
            <div style="display: flex; margin-bottom: 1.5px;">
              <span style="width: 85px; color: #333;">Contact</span>
              <span style="font-weight: 700;">${esc(contact)}</span>
            </div>
            <div style="display: flex; margin-bottom: 1.5px;">
              <span style="width: 85px; color: #333;">Material</span>
              <span style="font-weight: 700;">${esc(material)}</span>
            </div>
            <div style="display: flex; margin-bottom: 1.5px;">
              <span style="width: 85px; color: #333;">Transporte</span>
              <span style="font-weight: 700;">${esc(transporter)}</span>
            </div>
            <div style="display: flex; margin-bottom: 1.5px;">
              <span style="width: 85px; color: #333;">In Time</span>
              <span style="font-weight: 500;">${esc(inTimeStr)}</span>
            </div>
            <div style="display: flex; margin-bottom: 6px;">
              <span style="width: 85px; color: #333;">Out Time</span>
              <span style="font-weight: 500;">${esc(outTimeStr)}</span>
            </div>

            <!-- Weights -->
            <div style="display: flex; margin-bottom: 2px;">
              <span style="width: 85px; color: #333;">Gross</span>
              <span style="font-size: 15px; font-weight: 900; letter-spacing: 0.5px;">${esc(gross)} Kgs</span>
            </div>
            <div style="display: flex; margin-bottom: 2px;">
              <span style="width: 85px; color: #333;">Tare</span>
              <span style="font-size: 15px; font-weight: 900; letter-spacing: 0.5px;">${esc(tare)} Kgs</span>
            </div>
            <div style="display: flex; margin-bottom: 2px;">
              <span style="width: 85px; color: #333;">Net.</span>
              <span style="font-size: 15px; font-weight: 900; letter-spacing: 0.5px;">${esc(nett)} Kgs</span>
            </div>
          </div>

          <!-- Right Column (Vehicle, Quantity, Images) -->
          <div style="width: 430px; display: flex; flex-direction: column; align-items: flex-end;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px;">
              <div>
                <span style="color: #333; margin-right: 8px;">Vehicle</span>
                <span style="font-size: 15px; font-weight: 900; letter-spacing: 0.5px;">${esc(vehicle)}</span>
              </div>
              <div>
                <span style="color: #333; margin-right: 8px;">Quantity</span>
                <span style="font-weight: 900; font-size: 14px;">${esc(quantity)}</span>
                <span style="font-size: 11px; font-weight: 700; margin-left: 4px;">CUM</span>
              </div>
            </div>

            <!-- Dual CCTV Images -->
            <div style="display: flex; gap: 12px; justify-content: flex-end; width: 100%;">
              ${renderImageBox(img1)}
              ${renderImageBox(img2)}
            </div>
          </div>
        </div>

        <!-- Footer Signatures -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; padding-top: 4px; font-size: 11px; color: #222;">
          <div>Receiver.</div>
          <div>Operator</div>
        </div>
      </div>
    `;

    return `
      <div style="width: 100%; max-width: 780px; margin: 0 auto; background: #ffffff; padding: 12px 18px; box-sizing: border-box;">
        <!-- Top Slip -->
        <div style="padding-bottom: 14px;">
          ${renderSlip()}
        </div>

        <!-- Middle Divider Line -->
        <div style="border-top: 1.5px dashed #475569; margin: 12px 0 16px 0; position: relative;"></div>

        <!-- Bottom Slip (Duplicate Copy) -->
        <div style="padding-top: 4px;">
          ${renderSlip()}
        </div>
      </div>
    `;
  }

  // 10. RAW (Dot-Matrix High-Speed Slip Format - Photo Match)
  if (template === 'RAW') {
    const esc = text => String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const RIGHT_COL = 36;
    const divider = '-'.repeat(68);

    const activeDriver = data.driver || data.driverName || driverName || 'ASHOK';

    const line0 = divider;
    const line1Left = `SERIAL NO   :    ${esc(dcNum)}`;
    const line1Right = `VEHICLE     : ${esc(vehicle)}`;
    const line1 = `${line1Left.padEnd(RIGHT_COL)}${line1Right}`;

    const line2Left = `PARTY       : ${esc(party)}`;
    const line2Right = `MATERIAL    : ${esc(material)}`;
    const line2 = `${line2Left.padEnd(RIGHT_COL)}${line2Right}`;

    const line3Left = `SOURCE      : ${esc(source)}`;
    const line3Right = `DESTINATION : ${esc(destination)}`;
    const line3 = `${line3Left.padEnd(RIGHT_COL)}${line3Right}`;

    const line3Mid = divider;

    const grossRight = `DATE:${esc(date)}   TIME:${esc(time)}`;
    const grossGap = Math.max(1, RIGHT_COL - 16 - gross.length);
    const line4 = `GROSS       :   <b><span style="font-size: 14px; letter-spacing: 1.5px;">${esc(gross)}</span></b>${' '.repeat(grossGap)}${grossRight}`;

    const tareRight = tareDate || date ? `DATE:${esc(tareDate || date)}   TIME:${esc(tareTime || time)}` : '';
    const tareGap = Math.max(1, RIGHT_COL - 16 - tare.length);
    const line5 = `TARE        :   <b><span style="font-size: 14px; letter-spacing: 1.5px;">${esc(tare)}</span></b>${' '.repeat(tareGap)}${tareRight}`;

    const nettRight = `DRIVER      : ${esc(activeDriver)}`;
    const nettGap = Math.max(1, RIGHT_COL - 16 - nett.length);
    const line6 = `NETT        :   <b><span style="font-size: 14px; letter-spacing: 1.5px;">${esc(nett)}</span></b>${' '.repeat(nettGap)}${nettRight}`;

    const line7 = divider;
    const line8 = `${esc(activeDriver).padEnd(RIGHT_COL)}${esc(party)}`;

    const previewLines = [
      line0,
      line1,
      line2,
      line3,
      line3Mid,
      line4,
      line5,
      line6,
      line7,
      '',
      line8
    ];

    return `
      <div style="font-family: 'Courier New', Courier, monospace; font-size: 13px; line-height: 1.6; max-width: 680px; margin: 0 auto; padding: 20px; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); color: #000; box-sizing: border-box;">
        <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 12px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px; display: flex; justify-content: space-between;">
          <span>⚡ Dot-Matrix ESC/P Slip Preview</span>
          <span>80 Columns • Continuous Form</span>
        </div>
        <pre style="font-family: inherit; font-size: 13px; line-height: 1.6; margin: 0; white-space: pre; color: #111827; font-weight: 500;">${previewLines.join('\n')}</pre>
      </div>
    `;
  }

  // 11. RAW_LARGE (Dot-Matrix High-Speed Slip Format - Large Text Format)
  if (template === 'RAW_LARGE' || template === 'RAW - LARGE TEXT') {
    const esc = text => String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const RIGHT_COL = 36;
    const divider = '-'.repeat(68);

    const activeDriver = data.driver || data.driverName || driverName || 'ASHOK';

    const line0 = divider;
    const line1Left = `SERIAL NO   :    ${esc(dcNum)}`;
    const line1Right = `VEHICLE     : ${esc(vehicle)}`;
    const line1 = `${line1Left.padEnd(RIGHT_COL)}${line1Right}`;

    const line2Left = `PARTY       : ${esc(party)}`;
    const line2Right = `MATERIAL    : ${esc(material)}`;
    const line2 = `${line2Left.padEnd(RIGHT_COL)}${line2Right}`;

    const line3Left = `SOURCE      : ${esc(source)}`;
    const line3Right = `DESTINATION : ${esc(destination)}`;
    const line3 = `${line3Left.padEnd(RIGHT_COL)}${line3Right}`;

    const line3Mid = divider;

    const grossRight = `DATE:${esc(date)}   TIME:${esc(time)}`;
    const grossGap = Math.max(1, RIGHT_COL - 16 - gross.length);
    const line4 = `GROSS       :   <b><span style="font-size: 18px; letter-spacing: 2px;">${esc(gross)}</span></b>${' '.repeat(grossGap)}${grossRight}`;

    const tareRight = tareDate || date ? `DATE:${esc(tareDate || date)}   TIME:${esc(tareTime || time)}` : '';
    const tareGap = Math.max(1, RIGHT_COL - 16 - tare.length);
    const line5 = `TARE        :   <b><span style="font-size: 18px; letter-spacing: 2px;">${esc(tare)}</span></b>${' '.repeat(tareGap)}${tareRight}`;

    const nettRight = `DRIVER      : ${esc(activeDriver)}`;
    const nettGap = Math.max(1, RIGHT_COL - 16 - nett.length);
    const line6 = `NETT        :   <b><span style="font-size: 18px; letter-spacing: 2px;">${esc(nett)}</span></b>${' '.repeat(nettGap)}${nettRight}`;

    const line7 = divider;
    const line8 = `${esc(activeDriver).padEnd(RIGHT_COL)}${esc(party)}`;

    const previewLines = [
      line0,
      line1,
      line2,
      line3,
      line3Mid,
      line4,
      line5,
      line6,
      line7,
      '',
      line8
    ];

    return `
      <div style="font-family: 'Courier New', Courier, monospace; font-size: 16px; line-height: 1.8; max-width: 740px; margin: 0 auto; padding: 22px; background: #fff; border: 2px solid #000; border-radius: 6px; color: #000; box-sizing: border-box;">
        <div style="font-size: 12px; font-weight: 800; color: #000; margin-bottom: 12px; border-bottom: 1.5px dashed #000; padding-bottom: 6px; display: flex; justify-content: space-between;">
          <span>⚡ Dot-Matrix ESC/P Slip Preview (LARGE TEXT)</span>
          <span>80 Columns • Continuous Form</span>
        </div>
        <pre style="font-family: inherit; font-size: 16px; line-height: 1.8; margin: 0; white-space: pre; color: #000; font-weight: 800;">${previewLines.join('\n')}</pre>
      </div>
    `;
  }

  return '';
}

// ---- Dot-Matrix Continuous Form Slip (ESC/P) --------------------------------
//
// Form Dimensions & Precise Feed Control:
// Standard weighbridge continuous pre-printed slips are 4 inches (8 sprocket holes) = 24 lines @ 6 LPI.
// To prevent the printer from advancing extra paper:
// 1. By default ('EXACT_LINES'), we pad with exact CRLF lines up to form height so the printer
//    stops squarely at the tear-off perforation.
// 2. We also set hardware line length (ESC C n) so any Form Feed respects the 4-inch boundary.
export const ESCP_LINE_WIDTH = 80;

export function generateEscpSlipText(data = {}, template = '') {
  const config = getPrinterConfig();
  const formLines = Math.max(12, Math.min(100, Number(config.formLines) || 24));
  const feedMode = config.feedMode || 'EXACT_LINES';
  const isLarge = template === 'RAW_LARGE' || template === 'RAW - LARGE TEXT';

  const pick = (...keys) => {
    for (const k of keys) {
      const v = data[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const up = (...keys) => pick(...keys).toUpperCase();
  const wt = (...keys) => pick(...keys).replace(/,/g, '');

  const now = new Date();
  const dd = n => String(n).padStart(2, '0');

  const dcNum = pick('dcNum', 'dc_num', 'serial_no', 'serialNo', 'token') || '1';
  const party = up('party', 'customer', 'customerName', 'supplier');
  const source = up('source', 'quarry');
  const destination = up('destination') || 'OUT';
  const vehicle = up('vehicle', 'vehicle_no', 'vehicleNo');
  const material = up('material', 'product');
  const gross = wt('gross');
  const tare = wt('tare');
  const nett = wt('net', 'nett');
  const grossDate = pick('date', 'grossDate', 'gross_date') || `${dd(now.getDate())}-${dd(now.getMonth() + 1)}-${now.getFullYear()}`;
  const grossTime = pick('time', 'grossTime', 'gross_time') || `${dd(now.getHours())}:${dd(now.getMinutes())}`;
  const tareDate = pick('tareDate', 'tare_date') || (tare ? grossDate : '');
  const tareTime = pick('tareTime', 'tare_time') || (tare ? grossTime : '');
  const driver = up('driver', 'driverName', 'driver_name') || 'ASHOK';

  const ESC = '\x1B';
  const INIT = `${ESC}@`;                                                   // Reset printer
  const LINE_SPACING_6_LPI = isLarge ? `${ESC}3\x24` : `${ESC}2`;           // Line spacing
  const PICA_10_CPI = isLarge ? `${ESC}!\x10` : `${ESC}P`;                  // Double height for large text
  const PAGE_LENGTH_LINES = `${ESC}C${String.fromCharCode(formLines)}`;     // Page length in lines
  const formInches = Math.max(1, Math.round(formLines / 6));
  const PAGE_LENGTH_INCHES = `${ESC}C\x00${String.fromCharCode(formInches)}`; // Page length in inches
  const ESC_DBL_ON = `${ESC}W\x01`;                                         // Double-width on
  const ESC_DBL_OFF = `${ESC}W\x00`;                                        // Double-width off
  const ESC_BOLD_ON = `${ESC}E`;                                            // Emphasized (bold) on
  const ESC_BOLD_OFF = `${ESC}F`;                                           // Emphasized off
  const FF = '\x0C';                                                        // Form feed

  const RIGHT_COL = 36;
  const divider = '-'.repeat(68);

  // Line 0: Top Dashed Line
  const line0 = divider;

  // Line 1: SERIAL NO & VEHICLE
  const line1Left = `SERIAL NO   :    ${dcNum}`;
  const line1Right = `VEHICLE     : ${vehicle}`;
  const line1 = `${line1Left.padEnd(RIGHT_COL)}${line1Right}`;

  // Line 2: PARTY & MATERIAL
  const line2Left = `PARTY       : ${party}`;
  const line2Right = `MATERIAL    : ${material}`;
  const line2 = `${line2Left.padEnd(RIGHT_COL)}${line2Right}`;

  // Line 3: SOURCE & DESTINATION
  const line3Left = `SOURCE      : ${source}`;
  const line3Right = `DESTINATION : ${destination}`;
  const line3 = `${line3Left.padEnd(RIGHT_COL)}${line3Right}`;

  // Line 3.5: Middle Dashed Line (Source below / Gross above)
  const line3Mid = divider;

  // Line 4: GROSS
  const grossDblWidth = gross.length * 2;
  const grossLeftPrintCols = 16 + grossDblWidth;
  const grossGap = Math.max(1, RIGHT_COL - grossLeftPrintCols);
  const grossRight = `DATE:${grossDate}   TIME:${grossTime}`;
  const line4 = `GROSS       :   ${ESC_DBL_ON}${ESC_BOLD_ON}${gross}${ESC_BOLD_OFF}${ESC_DBL_OFF}${' '.repeat(grossGap)}${grossRight}`;

  // Line 5: TARE
  const tareDblWidth = tare.length * 2;
  const tareLeftPrintCols = 16 + tareDblWidth;
  const tareGap = Math.max(1, RIGHT_COL - tareLeftPrintCols);
  const tareRight = tareDate ? `DATE:${tareDate}   TIME:${tareTime}` : '';
  const line5 = `TARE        :   ${ESC_DBL_ON}${ESC_BOLD_ON}${tare}${ESC_BOLD_OFF}${ESC_DBL_OFF}${' '.repeat(tareGap)}${tareRight}`;

  // Line 6: NETT
  const nettDblWidth = nett.length * 2;
  const nettLeftPrintCols = 16 + nettDblWidth;
  const nettGap = Math.max(1, RIGHT_COL - nettLeftPrintCols);
  const nettRight = `DRIVER      : ${driver}`;
  const line6 = `NETT        :   ${ESC_DBL_ON}${ESC_BOLD_ON}${nett}${ESC_BOLD_OFF}${ESC_DBL_OFF}${' '.repeat(nettGap)}${nettRight}`;

  // Line 7: Bottom Dashed Line
  const line7 = divider;

  // Line 8: Signatures
  const line8 = `${driver.padEnd(RIGHT_COL)}${party}`;

  const printedLines = [
    line0,
    line1,
    line2,
    line3,
    line3Mid,
    line4,
    line5,
    line6,
    line7,
    '',
    line8
  ];

  let outputText = '';
  if (feedMode === 'EXACT_LINES') {
    // Pad lines exactly so the paper stops right at the tear-off perforation!
    const paddingCount = Math.max(0, formLines - printedLines.length);
    const allLines = [...printedLines];
    for (let i = 0; i < paddingCount; i++) {
      allLines.push('');
    }
    outputText = `${INIT}${LINE_SPACING_6_LPI}${PICA_10_CPI}${PAGE_LENGTH_LINES}${allLines.join('\r\n')}\r\n`;
  } else if (feedMode === 'FORM_FEED') {
    outputText = `${INIT}${LINE_SPACING_6_LPI}${PICA_10_CPI}${PAGE_LENGTH_LINES}${PAGE_LENGTH_INCHES}${printedLines.join('\r\n')}\r\n${FF}`;
  } else {
    // NONE
    outputText = `${INIT}${LINE_SPACING_6_LPI}${PICA_10_CPI}${printedLines.join('\r\n')}\r\n`;
  }

  return outputText;
}

// Paper each layout was drawn for. Anything not listed prints A4 portrait,
// which is the safe default for a sheet-fed printer.
//
// The Crystal layouts take their paper from the catalogue rather than repeating
// it here, so the size shown against a template in Settings is the size that
// actually goes to the driver. A slip marked "A5 L" is the half sheet the site
// tears off — 210mm across, 148mm down.
//
// The margins are 10mm and up because a laser printer cannot mark the outermost
// few millimetres of a sheet however the page is set up. The A5 forms used to
// ask for 8mm, which left the challan's outer captions sitting in that dead
// strip: "Customer Name" and "Operator's Signature" came off the printer with
// their first letters shaved off. The slip is scaled to whatever room these
// margins leave, so a wider margin now costs a slightly smaller slip rather than
// a form that runs off the paper.
const PAPER_SETUP = {
  'A4': { pageSize: 'A4', landscape: false, marginMm: 10 },
  'A4 L': { pageSize: 'A4', landscape: true, marginMm: 10 },
  'A5': { pageSize: 'A5', landscape: true, marginMm: 8 },
  'A5 P': { pageSize: 'A5', landscape: false, marginMm: 8 },
  'A5 L': { pageSize: 'A5', landscape: true, marginMm: 8 }
};

const TEMPLATE_PAGE_SETUP = {
  ...Object.fromEntries(
    RPT_TEMPLATE_CATALOGUE
      .filter(t => PAPER_SETUP[t.paper])
      .map(t => [t.id, PAPER_SETUP[t.paper]])
  ),
  'IMAGE-2': PAPER_SETUP['A5 L'],
  'IMAGE-6': PAPER_SETUP['A5 L'],
  'IMAGE-1': PAPER_SETUP['A5 L'],
  'IMAGE-3': PAPER_SETUP['A5 L'],
  'IMAGE-4': PAPER_SETUP['A5 L'],
  'IMAGE-5': { pageSize: 'A5', landscape: false, marginMm: 4 },
  'IMAGE-7': PAPER_SETUP['A4'],
  'TEMPLATE 1 - CLASSIC BLUE': PAPER_SETUP['A5 L'],
  'TEMPLATE 2 - MODERN MINIMAL': PAPER_SETUP['A5 L'],
  'TEMPLATE 3 - INDUSTRIAL STYLE': PAPER_SETUP['A5 L'],
  'TEMPLATE 4 - PROFESSIONAL CORPORATE': PAPER_SETUP['A5 L'],
  'TEMPLATE 5 - COMPACT RECEIPT STYLE': { pageSize: 'A5', landscape: false, marginMm: 6 },
  'TEMPLATE 7 - AMR INFRA': PAPER_SETUP['A4']
};

export function getPageSetupForTemplate(template) {
  const base = { pageSize: 'A4', landscape: false, marginMm: 12, ...(TEMPLATE_PAGE_SETUP[template] || {}) };
  if (base.pageSize === 'A5') {
    return {
      ...base,
      pageSize: 'A5',
      landscape: true,
      marginMm: 4
    };
  }
  return base;
}

/**
 * The paper a template prints on, in the words an operator uses for it —
 * "A5 Landscape", "210 × 148 mm". Read from the same setup that goes to the
 * driver, so what Settings shows against a template is what Windows is asked
 * for; there is nothing to pick by hand and nothing that can drift out of step.
 */
export function describePageSetup(setup = {}) {
  const pageSize = setup.pageSize || 'A4';
  const landscape = !!setup.landscape;
  const isWideFeed = setup.isWideFeed || (pageSize === 'A5' && setup.a5FeedMode === 'IMAGE_1_WIDE');
  const sheet = PAGE_SIZE_MM[pageSize] || PAGE_SIZE_MM.A4;
  const [widthMm, heightMm] = (landscape || isWideFeed) ? [sheet[1], sheet[0]] : [sheet[0], sheet[1]];
  const round = mm => (Number.isInteger(mm) ? mm : Math.round(mm));
  return {
    ...setup,
    pageSize,
    landscape,
    orientation: isWideFeed ? 'Horizontal Tray Feed (Image 1)' : (landscape ? 'Landscape' : 'Portrait'),
    label: isWideFeed ? `${pageSize} Wide Feed (Image 1)` : `${pageSize} ${landscape ? 'Landscape' : 'Portrait'}`,
    // The half sheet the site tears off reads as "210 × 148 mm", which is how
    // the operator recognises it in the printer's own paper list.
    dimensions: `${round(widthMm)} × ${round(heightMm)} mm`
  };
}

export function getPaperForTemplate(template = getSelectedTemplate()) {
  return describePageSetup(getPageSetupForTemplate(template));
}

// Sheet sizes in millimetres, portrait. The slip is centred inside a box of
// exactly the printable size, so the page has to know the paper in figures and
// not only by name.
const PAGE_SIZE_MM = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8]
};

// The printable box in millimetres: the sheet less the margin on all four
// sides. Stated in mm rather than as a percentage because the preview window is
// 900px wide and nothing like the paper — a box given in mm is the same box on
// screen and on the sheet, so what the operator sees is what prints.
export function getPrintableAreaMm({ pageSize = 'A4', landscape = false, marginMm = 12, isWideFeed = false, a5FeedMode = 'IMAGE_1_WIDE' } = {}) {
  const sheet = PAGE_SIZE_MM[pageSize] || PAGE_SIZE_MM.A4;
  const margin = Number(marginMm) || 0;
  const useWide = landscape || (pageSize === 'A5' && (isWideFeed || a5FeedMode === 'IMAGE_1_WIDE'));
  const [pageWidthMm, pageHeightMm] = useWide ? [sheet[1], sheet[0]] : [sheet[0], sheet[1]];
  return {
    widthMm: Math.max(20, pageWidthMm - margin * 2),
    heightMm: Math.max(20, pageHeightMm - margin * 2)
  };
}

// Opens the slip in its own window and hands it to the printer's own dialog,
// so the operator picks the printer, the paper and the orientation before
// anything is committed to paper. The @page rule below still states the size
// the layout was drawn for, which is what the dialog opens preselected — the
// operator only has to touch it when the tray holds something else.
function openPrintDialog(html, pageSetup, data) {
  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) {
    alert('The print window was blocked. Allow popups for this app and print again.');
    return;
  }

  const area = getPrintableAreaMm(pageSetup);

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Weighment Ticket - ${data.dcNum || data.dc_num || 'Slip'}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: ${pageSetup.marginMm || 4}mm;
          }
          body { margin: 0; padding: 0; background: #ffffff; }
          /* One sheet, exactly the size of the printable area, top-aligned to fill A5 paper cleanly. */
          .noris-sheet {
            width: ${area.widthMm}mm;
            height: ${area.heightMm}mm;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            box-sizing: border-box;
            overflow: hidden;
          }
          /* Full width of printable area */
          .noris-slip { flex: 1 1 auto; width: 100%; box-sizing: border-box; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="noris-sheet"><div class="noris-slip">${html}</div></div>
        <script>
          function fitSlipToSheet() {
            try {
              var sheet = document.querySelector('.noris-sheet');
              var slip = document.querySelector('.noris-slip');
              if (!sheet || !slip) return;
              var form = slip.firstElementChild || slip;

              if (form) {
                form.style.maxWidth = '100%';
                form.style.width = '100%';
                form.style.boxSizing = 'border-box';
              }
              slip.style.width = '100%';

              var sheetW = sheet.clientWidth;
              var sheetH = sheet.clientHeight;
              var slipW = slip.scrollWidth;
              var slipH = slip.scrollHeight;

              if (!sheetW || !sheetH || !slipW || !slipH) return;

              var scale = 1;
              if (slipH > sheetH) {
                scale = Math.max(0.5, sheetH / slipH);
              }

              if (scale < 0.98) {
                slip.style.transformOrigin = 'top center';
                slip.style.transform = 'scale(' + scale + ')';
              } else {
                slip.style.transform = 'none';
              }
            } catch (e) {}
          }
          fitSlipToSheet();
        <\/script>
        <script>
          // Closed on afterprint rather than on a timer: the old 600ms close
          // pulled the window out from under the dialog, so a job the operator
          // was still setting up was cancelled before it could spool.
          var done = false;
          function finish() {
            if (done) return;
            done = true;
            window.close();
          }
          window.onafterprint = finish;
          window.onload = function () {
            // Measured once more here: a logo or a font that arrived late moves
            // the form, and the dialog must open on the size that will print.
            fitSlipToSheet();
            window.focus();
            window.print();
            // Some drivers never fire afterprint. Leave the window up rather
            // than guess — but do not leave it behind for the whole shift.
            setTimeout(finish, 300000);
          };
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

export async function printTicket(data = {}, template = getSelectedTemplate(), category = null) {
  const config = getPrinterConfig();
  const dcTpl = getDcPrintTemplate();
  const gpTpl = getGatePassTemplate();

  let targetPrinter = config.printerName || config.dcPrinterName || config.gatePassPrinterName;
  let targetMode = config.mode || 'HTML_DRIVER';

  if (category === 'DC' || template === dcTpl || template === 'RPT-CHALLAN-A4' || template === 'RPT-SALESBILL9' || template === 'IMAGE-2') {
    targetPrinter = config.dcPrinterName || config.printerName || config.gatePassPrinterName;
    targetMode = config.dcMode || 'HTML_DRIVER';
  } else if (category === 'GATE_PASS' || template === gpTpl || template === 'IMAGE-6') {
    targetPrinter = config.gatePassPrinterName || config.printerName || config.dcPrinterName;
    targetMode = config.gatePassMode || 'HTML_DRIVER';
  }

  const pageSetup = getPageSetupForTemplate(template);
  const html = generateSlipHtml(data, template);

  // A Crystal design only exists as a rendered layout — sending it down the
  // ESC/P plain-text path would silently print the generic dot-matrix slip
  // instead, so those templates always print through the HTML driver.
  const isRptTemplate = RPT_TEMPLATE_IDS.includes(template);

  // The dot-matrix design is ESC/P by definition: it is the slip the printer
  // strikes on continuous stationery, form length and all. Choosing it is how an
  // operator asks for the dot matrix, so it goes down the raw path whatever the
  // output mode says — printing it through the driver would render the text as
  // graphics and lose the form feed that lands the next slip on its own form.
  const isDotMatrixTemplate = template === 'RAW' || template === 'RAW_LARGE' || template === 'RAW - LARGE TEXT';

  // DIALOG mode never reaches the silent path: the whole point is that nothing
  // is sent to the printer until the operator has confirmed the settings.
  if (targetMode !== 'DIALOG' && window.electronAPI && (window.electronAPI.printHtml || window.electronAPI.printRaw)) {
    try {
      // If template is NOT 'RAW' (dot matrix), or mode is HTML_DRIVER, or is an RPT template,
      // route silently via printHtml directly to the target printer.
      if (!isDotMatrixTemplate || targetMode === 'HTML_DRIVER' || isRptTemplate) {
        await window.electronAPI.printHtml({
          printerName: targetPrinter,
          htmlContent: html,
          // The job name is what the operator sees in the Windows queue, so it
          // carries the DC number — that is how a jammed job gets identified.
          options: {
            copies: config.copies,
            jobName: `Weighment Slip ${data.dcNum || data.dc_num || ''}`.trim(),
            ...pageSetup
          }
        });
      } else {
        // Default: ESC/P High Speed Plain Text for RAW dot-matrix template
        const rawText = generateEscpSlipText(data, template);
        for (let i = 0; i < (config.copies || 1); i++) {
          await window.electronAPI.printRaw({
            printerName: targetPrinter,
            rawText: rawText
          });
        }
      }
      return;
    } catch (err) {
      console.error('[Print Helper] Native print failed, falling back to the print dialog:', err);
    }
  }

  openPrintDialog(html, pageSetup, data);
}
