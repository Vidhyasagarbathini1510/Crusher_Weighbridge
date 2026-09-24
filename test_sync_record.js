const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const urlModule = require('url');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

const formatTo24Hr = (dtStr) => {
  if (!dtStr || typeof dtStr !== 'string') return '';
  const str = dtStr.trim();

  const hasAmPm = /[ap]\.?m\.?/i.test(str);
  const hasComma = str.includes(',');
  const isIso = str.includes('T') || str.includes('Z');

  if (hasComma || hasAmPm || isIso) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      const secs = String(d.getSeconds()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${mins}:${secs}`;
    }
  }

  const cleanStr = str.replace(/,/g, '').replace(/\s+/g, ' ');
  const dmyMatch = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*([ap]\.?m\.?))?)?/i);
  if (dmyMatch) {
    let dayVal = parseInt(dmyMatch[1], 10);
    let monthVal = parseInt(dmyMatch[2], 10);
    const year = dmyMatch[3];
    let hoursVal = parseInt(dmyMatch[4] || '0', 10);
    const mins = String(dmyMatch[5] || '00').padStart(2, '0');
    const secs = String(dmyMatch[6] || '00').padStart(2, '0');
    const ampm = dmyMatch[7];

    if (ampm) {
      const isPm = ampm.toLowerCase().startsWith('p');
      if (isPm && hoursVal < 12) hoursVal += 12;
      if (!isPm && hoursVal === 12) hoursVal = 0;
    }

    if (monthVal > 12 && dayVal <= 12) {
      const temp = dayVal;
      dayVal = monthVal;
      monthVal = temp;
    }

    const day = String(dayVal).padStart(2, '0');
    const month = String(monthVal).padStart(2, '0');
    const hours = String(hoursVal).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${mins}:${secs}`;
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${mins}:${secs}`;
};

const toSqlDateTime = (ddMMyyyyStr) => {
  if (!ddMMyyyyStr) return '';
  const match = ddMMyyyyStr.match(/^(\d{2})\-(\d{2})\-(\d{4})\s+(.+)$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]} ${match[4]}`;
  }
  return ddMMyyyyStr;
};

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  // Get record 14
  const stmt = db.prepare("SELECT * FROM boulders WHERE id = 15");
  if (stmt.step()) {
    const record = stmt.getAsObject();
    console.log("RECORD TO SYNC:", record);
    
    const formattedDateTime = formatTo24Hr(record.date_time) || formatTo24Hr(new Date().toISOString());
    const rawTareDate = (record.tare_date || record.tareDate || '').trim();
    const rawTareTime = (record.tare_time || record.tareTime || '').trim();
    const rawTareDateTime = rawTareDate ? (rawTareDate + (rawTareTime ? ' ' + rawTareTime : '')) : '';
    
    const formattedTareDateTimeStr = formatTo24Hr(rawTareDateTime) || formattedDateTime;
    const formattedTareDateTime = toSqlDateTime(formattedTareDateTimeStr);

    let vehicleNo = (record.vehicle_no || record.vehicle || '').trim().toUpperCase();
    const cleanVeh = vehicleNo.replace(/[\s\-\.]/g, '');
    if (!vehicleNo || cleanVeh === 'N/A' || cleanVeh === 'NA' || cleanVeh === 'NONE' || cleanVeh.length < 4) {
      throw new Error(`Server API rejected record: Invalid or missing vehicle number "${vehicleNo || ''}"`);
    }

    const payloadObj = {
      company_id: "CRUSHER-2",
      companyId: "CRUSHER-2",
      uuid: record.uuid,
      id: record.id,
      date_time: formattedDateTime,
      tare_datetime: formattedTareDateTime,
      vehicleNo: vehicleNo,
      vehicle_no: vehicleNo,
      dc_num: record.dc_num || '',
      dcNum: record.dc_num || '',
      your_dc: '',
      yourDc: '',
      party: record.contractor || '',
      contractor: record.contractor || '',
      quarry: record.quarry || '',
      product: record.material || '',
      material: record.material || '',
      gross: Number(record.gross || 0),
      tare: Number(record.tare || 0),
      net: Number(record.net || 0),
      driver: record.driver || '',
      transporter: record.transporter || '',
      destination: record.destination || ''
    };

    console.log("PAYLOAD BEING SENT:", payloadObj);

    const payload = JSON.stringify(payloadObj);
    const syncUrl = 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders?company_id=CRUSHER-2';
    const parsedUrl = urlModule.parse(syncUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000,
      rejectUnauthorized: false
    };

    const req = protocol.request(options, (res) => {
      let body = '';
      console.log("STATUS CODE:", res.statusCode);
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log("RESPONSE BODY:", body);
      });
    });

    req.on('error', (err) => {
      console.error("REQUEST ERROR:", err);
    });

    req.write(payload);
    req.end();
  }
});
