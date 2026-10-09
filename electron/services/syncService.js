'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const urlModule = require('url');
const { app } = require('electron');
const db = require('../database/db');

let syncInterval = null;
let masterSyncInterval = null;
let editsSyncInterval = null;
let isSyncing = false;
let isMasterSyncing = false;
let isEditsSyncing = false;

// Default sync endpoints. Can be overridden in settings (saved in SQLite).
const DEFAULT_SYNC_URL = 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders';
const DEFAULT_BOULDER_SYNC_URL = 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders';
const DEFAULT_SALES_SYNC_URL = 'https://crusher.norissolutions.com/backend/api/weighbridge/sales';
const DEFAULT_YARD_SYNC_URL = 'https://crusher.norissolutions.com/backend/api/weighbridge/yard';
const DEFAULT_SECOND_WEIGHMENT_SYNC_URL = 'https://crusher.norissolutions.com/backend/api/weighbridge/second-weighment';

function injectCompanyId(urlStr, companyId) {
  if (!urlStr || typeof urlStr !== 'string') return urlStr;
  try {
    if (urlStr.includes('company_id=')) {
      return urlStr.replace(/company_id=[^&]+/, `company_id=${encodeURIComponent(companyId)}`);
    } else {
      return urlStr + (urlStr.includes('?') ? '&' : '?') + `company_id=${encodeURIComponent(companyId)}`;
    }
  } catch (_) {
    return urlStr;
  }
}

function startSyncService(intervalMs = 3000) {
  console.log('[Sync Service] Starting sync service (polling every', intervalMs, 'ms)...');
  
  if (syncInterval) clearInterval(syncInterval);
  if (masterSyncInterval) clearInterval(masterSyncInterval);
  if (editsSyncInterval) clearInterval(editsSyncInterval);
  
  syncInterval = setInterval(() => {
    runSyncCycle();
  }, intervalMs);

  // Poll master data automatically every 2 seconds (2000 ms) for near-instant updates
  masterSyncInterval = setInterval(() => {
    syncMasterData();
  }, 2000);

  // Poll pending server edits (boulders and sales) every 5 seconds (5000 ms)
  editsSyncInterval = setInterval(() => {
    syncServerEdits();
  }, 5000);

  // Run immediately on start
  setTimeout(runSyncCycle, 1000);
  setTimeout(syncMasterData, 1000);
  setTimeout(syncServerEdits, 2000);
}

function stopSyncService() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (masterSyncInterval) {
    clearInterval(masterSyncInterval);
    masterSyncInterval = null;
  }
  if (editsSyncInterval) {
    clearInterval(editsSyncInterval);
    editsSyncInterval = null;
  }
  console.log('[Sync Service] Stopped sync service.');
}

async function runSyncCycle() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // Populate sync queue for any unsynced table rows before starting batch pass
    if (db.populateInitialSyncQueue) {
      db.populateInitialSyncQueue();
    }

    const settings = db.getSettings();
    const companyId = settings.company_id || 'CRUSHER-3080';
    const boulderSyncUrl = injectCompanyId(settings.boulder_sync_url || settings.sync_server_url || DEFAULT_BOULDER_SYNC_URL, companyId);
    const salesSyncUrl = injectCompanyId(settings.sales_sync_url || DEFAULT_SALES_SYNC_URL, companyId);
    const yardSyncUrl = injectCompanyId(settings.yard_sync_url || DEFAULT_YARD_SYNC_URL, companyId);
    const secondWeighmentSyncUrl = injectCompanyId(settings.second_weighment_sync_url || DEFAULT_SECOND_WEIGHMENT_SYNC_URL, companyId);

    // 1. Fetch PENDING/FAILED items from sync_queue (Strict FIFO order)
    const queueItems = db.getPendingSyncQueue ? db.getPendingSyncQueue(30) : [];

    if (queueItems.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`[Sync Service] Found ${queueItems.length} pending items in sync_queue. Checking connectivity...`);

    // 2. Test connectivity to boulder sync server
    const online = await checkOnline(boulderSyncUrl);
    if (!online) {
      console.log('[Sync Service] Server offline. Skipping sync cycle.');
      try {
        const healthMonitorService = require('./healthMonitorService');
        healthMonitorService.reportSyncStatus(false, 'Sync server endpoint offline', queueItems.length);
      } catch (_) {}
      isSyncing = false;
      return;
    }

    console.log(`[Sync Service] Server reachable. Uploading batch of ${queueItems.length} records in FIFO order...`);

    // 3. Process batch sequentially
    for (const item of queueItems) {
      const record = db.getRecordByUuid ? db.getRecordByUuid(item.table_name, item.record_uuid) : null;

      if (!record) {
        if (db.updateSyncQueueStatus) db.updateSyncQueueStatus(item.id, 'COMPLETED');
        continue;
      }

      // First weighments and loading slips are stored in local DB only (pre-registration / no remote server endpoint)
      if (
        item.table_name === 'first_weighment' ||
        item.table_name === 'first_weighments' ||
        item.table_name === 'loading_slips' ||
        item.table_name === 'loading_slip'
      ) {
        if (db.updateSyncQueueStatus) db.updateSyncQueueStatus(item.id, 'COMPLETED');
        if (db.markLoadingSlipSynced) db.markLoadingSlipSynced(item.record_uuid);
        continue;
      }

      record._source = item.table_name;

      // Select specific target endpoint per record type / table
      let targetSyncUrl = boulderSyncUrl;
      if (item.table_name === 'second_weighment' || item.table_name === 'second_weighments') {
        targetSyncUrl = secondWeighmentSyncUrl;
      } else if (item.table_name === 'sales_units' || item.table_name === 'sales_weighment_units') {
        targetSyncUrl = salesSyncUrl;
      } else if (item.table_name === 'yard' || item.table_name === 'yard_weighments') {
        targetSyncUrl = yardSyncUrl;
      } else if (item.table_name === 'boulders' || record.material === 'BOULDERS') {
        targetSyncUrl = boulderSyncUrl;
      } else {
        // Fallback for general transactions or other tables based on material / party
        const mat = (record.material || record.product || '').toUpperCase();
        const pty = (record.party || record.destination || '').toUpperCase();
        if (mat === 'BOULDERS') {
          targetSyncUrl = boulderSyncUrl;
        } else if (pty.includes('YARD')) {
          targetSyncUrl = yardSyncUrl;
        } else {
          targetSyncUrl = salesSyncUrl;
        }
      }

      try {
        await uploadRecord(targetSyncUrl, record);

        // Update queue item status to COMPLETED
        if (db.updateSyncQueueStatus) db.updateSyncQueueStatus(item.id, 'COMPLETED');

        // Update business table sync_status = 1
        if (item.table_name === 'boulders' && db.markBoulderSynced) {
          db.markBoulderSynced(item.record_uuid);
        } else if ((item.table_name === 'sales_units' || item.table_name === 'sales_weighment_units') && db.markSalesWeighmentUnitsSynced) {
          db.markSalesWeighmentUnitsSynced(item.record_uuid);
        } else if ((item.table_name === 'yard' || item.table_name === 'yard_weighments') && db.markYardWeighmentSynced) {
          db.markYardWeighmentSynced(item.record_uuid);
        } else if (item.table_name === 'loading_slips' && db.markLoadingSlipSynced) {
          db.markLoadingSlipSynced(item.record_uuid);
        } else if (item.table_name === 'first_weighment' && db.markFirstWeighmentSynced) {
          db.markFirstWeighmentSynced(item.record_uuid);
        } else if (item.table_name === 'second_weighment' && db.markSecondWeighmentSynced) {
          db.markSecondWeighmentSynced(item.record_uuid);
        } else if (db.markTransactionSynced) {
          db.markTransactionSynced(item.record_uuid);
        }

        console.log(`[Sync Service] Synced ${item.table_name} [${item.record_uuid}] (Queue #${item.id}) to ${targetSyncUrl}`);
      } catch (err) {
        console.error(`[Sync Service] Upload failed for queue item #${item.id} (${item.table_name} -> ${targetSyncUrl}):`, err.message);
        
        // Error Classification:
        // Record-Specific Errors: HTTP 400, HTTP 422, or explicit schema/data rejection
        const isRecordError = err.isRecordError === true ||
          err.statusCode === 400 ||
          err.statusCode === 422 ||
          (err.message && err.message.includes('Server API rejected record'));

        if (isRecordError) {
          // Record-specific error: Mark as REJECTED and CONTINUE so other pending records can sync
          if (db.updateSyncQueueStatus) db.updateSyncQueueStatus(item.id, 'REJECTED', err.message);
          continue;
        } else {
          // Network or server outage error (500, 502, 503, 504, timeout, network offline):
          // Increment retry_count up to 20. If 20 exceeded, mark REJECTED to preserve history.
          const nextRetry = Number(item.retry_count || 0) + 1;
          if (nextRetry >= 20) {
            if (db.updateSyncQueueStatus) db.updateSyncQueueStatus(item.id, 'REJECTED', `Max retries (20) exceeded: ${err.message}`);
          } else {
            if (db.updateSyncQueueStatus) db.updateSyncQueueStatus(item.id, 'FAILED', err.message);
          }
          // Break to pause batch and avoid hammering the server during an outage
          break;
        }
      }
    }

    // 4. Throttle pause (200ms) between batches to keep CPU and disk I/O low
    await new Promise(r => setTimeout(r, 200));

    // If queue still has pending items, trigger next batch pass
    const remainingCheck = db.getPendingSyncQueue ? db.getPendingSyncQueue(1) : [];
    if (remainingCheck.length > 0) {
      setTimeout(runSyncCycle, 300);
    }
  } catch (err) {
    console.error('[Sync Service] Error in sync cycle:', err);
  } finally {
    isSyncing = false;
  }
}

// Check if endpoint is reachable via a quick request
function checkOnline(targetUrl) {
  return new Promise((resolve) => {
    try {
      if (!targetUrl || typeof targetUrl !== 'string') {
        return resolve(false);
      }
      const parsedUrl = urlModule.parse(targetUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.path,
        method: 'GET',
        timeout: 4000,
        rejectUnauthorized: false
      };

      const req = protocol.request(options, (res) => {
        res.resume(); // Consume data stream so socket closes cleanly
        resolve(true);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    } catch (_) {
      resolve(false);
    }
  });
}

// Upload a single transaction (and its snapshot image if available)
function uploadRecord(syncUrl, record) {
  return new Promise((resolve, reject) => {
    try {
      const settings = db.getSettings ? db.getSettings() : {};
      const companyId = (settings && (settings.company_id || settings.companyId)) || 'CRUSHER-3080';
      const finalUrl = injectCompanyId(syncUrl, companyId);
      const parsedUrl = urlModule.parse(finalUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      // Resolve the actual image file path for Image 1 (handling absolute, relative, or just filename cases)
      let resolvedImagePath = null;
      if (typeof record.image_path === 'string' && record.image_path.trim() !== '') {
        if (fs.existsSync(record.image_path)) {
          resolvedImagePath = record.image_path;
        } else {
          // Try resolving inside the user's weighbridge_images directory
          try {
            const userDataPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd();
            const filename = path.basename(record.image_path);
            const possiblePath = path.join(userDataPath, 'weighbridge_images', filename);
            if (fs.existsSync(possiblePath)) {
              resolvedImagePath = possiblePath;
            }
          } catch (resolveErr) {
            console.error('[Sync Service] Error resolving image path:', resolveErr);
          }
        }
      }

      // Load image 1 as base64
      let base64Image = null;
      if (resolvedImagePath) {
        try {
          const fileData = fs.readFileSync(resolvedImagePath);
          base64Image = fileData.toString('base64');
        } catch (err) {
          console.error('[Sync Service] Could not read image file:', resolvedImagePath, err);
        }
      }

      if (!base64Image && typeof record.image_base64 === 'string' && record.image_base64.trim() !== '') {
        base64Image = record.image_base64;
      }

      // Resolve the actual image file path for Image 2
      let resolvedImagePath2 = null;
      if (typeof record.image_path_2 === 'string' && record.image_path_2.trim() !== '') {
        if (fs.existsSync(record.image_path_2)) {
          resolvedImagePath2 = record.image_path_2;
        } else {
          // Try resolving inside the user's weighbridge_images directory
          try {
            const userDataPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd();
            const filename = path.basename(record.image_path_2);
            const possiblePath = path.join(userDataPath, 'weighbridge_images', filename);
            if (fs.existsSync(possiblePath)) {
              resolvedImagePath2 = possiblePath;
            }
          } catch (resolveErr) {
            console.error('[Sync Service] Error resolving image path 2:', resolveErr);
          }
        }
      }

      // Load image 2 as base64
      let base64Image2 = null;
      if (resolvedImagePath2) {
        try {
          const fileData = fs.readFileSync(resolvedImagePath2);
          base64Image2 = fileData.toString('base64');
        } catch (err) {
          console.error('[Sync Service] Could not read image file 2:', resolvedImagePath2, err);
        }
      }

      if (!base64Image2 && typeof record.image_base64_2 === 'string' && record.image_base64_2.trim() !== '') {
        base64Image2 = record.image_base64_2;
      }

      const compressBase64To25KB = (base64Str) => {
        if (!base64Str || typeof base64Str !== 'string' || base64Str.trim() === '') return '';
        try {
          const { nativeImage } = require('electron');
          const clean = base64Str.replace(/^data:image\/\w+;base64,/, '');
          const buf = Buffer.from(clean, 'base64');
          const img = nativeImage.createFromBuffer(buf);
          if (!img.isEmpty()) {
            const size = img.getSize();
            let targetImg = img;
            if (size.width > 640) {
              const scale = 640 / size.width;
              targetImg = img.resize({
                width: 640,
                height: Math.round(size.height * scale),
                quality: 'better'
              });
            }
            return targetImg.toJPEG(60).toString('base64');
          }
        } catch (_) {}
        return base64Str.replace(/^data:image\/\w+;base64,/, '');
      };

      let rawBase64 = compressBase64To25KB(base64Image);
      let formattedBase64 = rawBase64 ? `data:image/jpeg;base64,${rawBase64}` : null;

      let rawBase64_2 = compressBase64To25KB(base64Image2);
      let formattedBase64_2 = rawBase64_2 ? `data:image/jpeg;base64,${rawBase64_2}` : null;

      const recordUuid = record.uuid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now() + '-' + Math.floor(Math.random() * 1000000));

      // Validate vehicle_no: refuse to sync only if truly empty or placeholder
      const vehicleNo = (record.vehicle_no || record.vehicle || '').trim().toUpperCase();
      const cleanVeh = vehicleNo.replace(/[\s\-\.]/g, '');
      if (!vehicleNo || cleanVeh === 'N/A' || cleanVeh === 'NA' || cleanVeh === 'NONE' || cleanVeh.length === 0) {
        const valErr = new Error(`Server API rejected record: Invalid or missing vehicle number "${vehicleNo || ''}"`);
        valErr.isRecordError = true;
        return reject(valErr);
      }

      const validMat = (record.material || record.product || '').trim();

      // Format date/time helper for dd-mm-yyyy HH:mm:ss (24h)
      const formatTo24Hr = (dtStr) => {
        if (!dtStr || typeof dtStr !== 'string') return '';
        const str = dtStr.trim();

        // Check if the string has standard locale-formatted features (like a comma, AM/PM, or ISO 'T'/'Z').
        // If it does, standard Date parsing is extremely reliable and handles AM/PM and 12/24 hour conversion.
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

        // Clean commas and collapse extra whitespaces
        const cleanStr = str.replace(/,/g, '').replace(/\s+/g, ' ');
        // Regex pattern to capture: DD/MM/YYYY or DD-MM-YYYY (or M/D/YYYY)
        // plus optional space and HH:MM:SS or HH:MM plus optional AM/PM
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

          // If month is greater than 12, it's likely MM/DD/YYYY format, swap them
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

      // Helper to convert DD-MM-YYYY HH:mm:ss to YYYY-MM-DD HH:mm:ss for SQL DATETIME columns
      const toSqlDateTime = (ddMMyyyyStr) => {
        if (!ddMMyyyyStr) return '';
        const match = ddMMyyyyStr.match(/^(\d{2})\-(\d{2})\-(\d{4})\s+(.+)$/);
        if (match) {
          return `${match[3]}-${match[2]}-${match[1]} ${match[4]}`;
        }
        return ddMMyyyyStr;
      };

      const formattedDateTime = formatTo24Hr(record.date_time) || formatTo24Hr(new Date().toISOString());
      const rawTareDate = (record.tare_date || record.tareDate || '').trim();
      const rawTareTime = (record.tare_time || record.tareTime || '').trim();
      const rawTareDateTime = rawTareDate ? (rawTareDate + (rawTareTime ? ' ' + rawTareTime : '')) : '';
      
      const formattedTareDateTimeStr = formatTo24Hr(rawTareDateTime) || formattedDateTime;
      const formattedTareDateTime = toSqlDateTime(formattedTareDateTimeStr);

      const rawGrossDate = (record.gross_date || record.grossDate || '').trim();
      const rawGrossTime = (record.gross_time || record.grossTime || '').trim();

      const cleanTareDate = (rawTareDate ? rawTareDate.split(' ')[0] : (formattedTareDateTimeStr ? formattedTareDateTimeStr.split(' ')[0] : '')).substring(0, 10);
      const cleanTareTime = (rawTareTime || (rawTareDate.includes(' ') ? rawTareDate.split(' ')[1] : '') || (formattedTareDateTimeStr ? formattedTareDateTimeStr.split(' ')[1] : '')).substring(0, 8);
      const cleanGrossDate = (rawGrossDate ? rawGrossDate.split(' ')[0] : (formattedDateTime ? formattedDateTime.split(' ')[0] : '')).substring(0, 10);
      const cleanGrossTime = (rawGrossTime || (rawGrossDate.includes(' ') ? rawGrossDate.split(' ')[1] : '') || (formattedDateTime ? formattedDateTime.split(' ')[1] : '')).substring(0, 8);

      const serialNoStr = String(record.dc_num || record.dcNum || record.token || record.your_dc || '');
      const tareValStr = String(record.tare !== undefined && record.tare !== null ? record.tare : (record.tareVal || 0));
      const grossValStr = String(record.gross !== undefined && record.gross !== null ? record.gross : (record.grossVal || 0));
      const nettValStr = String(record.net !== undefined && record.net !== null ? record.net : (record.nettVal || record.net_weight || 0));

      const payload = JSON.stringify({
        // Exact custom mapped fields
        ID: String(record.id || recordUuid),
        SerialNo: serialNoStr,
        Vehicle: vehicleNo,
        Material: validMat,
        Tare: tareValStr,
        TareDate: cleanTareDate,
        TareTime: cleanTareTime,
        FirstDateTime: formattedTareDateTimeStr ? formattedTareDateTimeStr.replace(/[\s\-\:]/g, '') : '',
        Gross: grossValStr,
        GrossDate: cleanGrossDate,
        GrossTime: cleanGrossTime,
        Nett: nettValStr,
        Qty: String(record.units_val || record.unitsVal || record.qty || nettValStr),
        Amount: record.amount !== undefined ? record.amount : null,
        Charges: record.charges !== undefined ? record.charges : null,
        Party: record.party || record.contractor || null,
        SecondDateTime: formattedDateTime ? formattedDateTime.replace(/[\s\-\:]/g, '') : '',

        // Standard API backwards-compatibility fields
        company_id: companyId,
        companyId: companyId,
        uuid: recordUuid,
        id: record.id,
        date_time: formattedDateTime,
        tare_datetime: formattedTareDateTime,
        vehicleNo: vehicleNo,
        vehicle_no: vehicleNo,
        dc_num: serialNoStr,
        dcNum: serialNoStr,
        dc_no: serialNoStr,
        dcNo: serialNoStr,
        dc: serialNoStr,
        your_dc: record.your_dc ?? record.yourDc ?? '',
        yourDc: record.your_dc ?? record.yourDc ?? '',
        party: record.party || record.contractor || '',
        contractor: record.contractor || record.party || '',
        quarry: record.quarry || '',
        product: validMat,
        material: validMat,
        contractor_material: validMat,
        contractor_material_name: validMat,
        contractorMaterial: validMat,
        gross: Number(grossValStr),
        tare: Number(tareValStr),
        net: Number(nettValStr),
        driver: record.driver || '',
        transporter: record.transporter || '',
        destination: record.destination || '',
        source: record.source || '',
        unit_type: record.unit_type || record.unitType || 'units',
        units_val: Number(record.units_val || record.unitsVal || 0),
        rate: (() => {
          let r = Number(record.rate || 0);
          if (record._source === 'boulders' && r === 0) {
            try {
              const contractorName = (record.contractor || record.party || '').trim().toUpperCase();
              const quarryName = (record.quarry || '').trim().toUpperCase();
              const materialName = (validMat || '').trim().toUpperCase();

              // 1. Try contractor_materials lookup
              if (db.getContractorMaterials) {
                const cmList = db.getContractorMaterials();
                const cmMatch = cmList.find(cm => {
                  const cName = (cm.contractorName || '').trim().toUpperCase();
                  const qName = (cm.quarryName || '').trim().toUpperCase();
                  const mName = (cm.material || '').trim().toUpperCase();
                  if (cName !== contractorName) return false;
                  if (qName && quarryName && qName !== quarryName) return false;
                  if (mName && materialName && mName !== materialName) return false;
                  return true;
                });
                if (cmMatch && cmMatch.rate !== undefined && cmMatch.rate !== null) {
                  r = parseFloat(cmMatch.rate) || 0;
                }
              }

              // 2. Fallback to contractors table
              if (r === 0 && db.getContractors) {
                const contractors = db.getContractors();
                const match = contractors.find(c => {
                  const name1 = (c.contractorName || c.contractor || '').trim().toUpperCase();
                  return name1 && contractorName && name1 === contractorName;
                });
                if (match) {
                  const rateVal = match.rate !== undefined && match.rate !== null ? match.rate : match.ton;
                  if (rateVal !== undefined && rateVal !== null) {
                    r = parseFloat(rateVal) || 0;
                  }
                }
              }
            } catch (e) {}
          }
          return r;
        })(),
        amount: (() => {
          let a = Number(record.amount || 0);
          if (record._source === 'boulders' && a === 0) {
            try {
              const contractorName = (record.contractor || record.party || '').trim().toUpperCase();
              const quarryName = (record.quarry || '').trim().toUpperCase();
              const materialName = (record.material || record.product || '').trim().toUpperCase();
              let r = Number(record.rate || 0);

              if (r === 0 && db.getContractorMaterials) {
                const cmList = db.getContractorMaterials();
                const cmMatch = cmList.find(cm => {
                  const cName = (cm.contractorName || '').trim().toUpperCase();
                  const qName = (cm.quarryName || '').trim().toUpperCase();
                  const mName = (cm.material || '').trim().toUpperCase();
                  if (cName !== contractorName) return false;
                  if (qName && quarryName && qName !== quarryName) return false;
                  if (mName && materialName && mName !== materialName) return false;
                  return true;
                });
                if (cmMatch && cmMatch.rate !== undefined && cmMatch.rate !== null) {
                  r = parseFloat(cmMatch.rate) || 0;
                }
              }

              if (r === 0 && db.getContractors) {
                const contractors = db.getContractors();
                const match = contractors.find(c => {
                  const name1 = (c.contractorName || c.contractor || '').trim().toUpperCase();
                  return name1 && contractorName && name1 === contractorName;
                });
                if (match) {
                  const rateVal = match.rate !== undefined && match.rate !== null ? match.rate : match.ton;
                  if (rateVal !== undefined && rateVal !== null) {
                    r = parseFloat(rateVal) || 0;
                  }
                }
              }

              if (r > 0) {
                const netWeightTons = (parseFloat(record.net) || 0) / 1000;
                a = r * netWeightTons;
              }
            } catch (e) {}
          }
          return a;
        })(),
        transport: Number(record.transport || 0),
        ...(() => {
          let partyRate = Number(record.party_transport_rate || record.partyTransportRate || record.destination_rate || record.destinationRate || 0);
          if (partyRate === 0 && db.getDestinations) {
            try {
              const partyName = (record.party || '').trim().toUpperCase();
              const destName = (record.destination || '').trim().toUpperCase();
              if (partyName && destName) {
                const dests = db.getDestinations();
                const match = dests.find(d => 
                  (d.party || '').trim().toUpperCase() === partyName &&
                  (d.destination || '').trim().toUpperCase() === destName
                );
                if (match && match.rate !== undefined && match.rate !== null) {
                  partyRate = parseFloat(match.rate) || 0;
                }
              }
            } catch (e) {}
          }

          let partyAmount = Number(record.party_transport_amount || record.partyTransportAmount || record.destination_amount || record.destinationAmount || 0);
          if (partyAmount === 0 && partyRate > 0) {
            const isUnits = (record.unit_type || record.unitType || '').toLowerCase() === 'units';
            const qty = isUnits ? (parseFloat(record.units_val || record.unitsVal) || 0) : ((parseFloat(record.net) || 0) / 1000);
            partyAmount = Number((qty * partyRate).toFixed(2));
          }

          let transRate = Number(record.transporter_rate || record.transporterRate || record.trate || 0);
          if (transRate === 0 && db.getTransporters) {
            try {
              const transName = (record.transporter || '').trim().toUpperCase();
              const destName = (record.destination || '').trim().toUpperCase();
              if (transName) {
                const transList = db.getTransporters();
                const match = transList.find(t => 
                  (t.transporterName || t.transporter || '').trim().toUpperCase() === transName &&
                  (!destName || (t.destination || '').trim().toUpperCase() === destName)
                );
                if (match && match.rate !== undefined && match.rate !== null) {
                  transRate = parseFloat(match.rate) || 0;
                }
              }
            } catch (e) {}
          }

          let transAmount = Number(record.transporter_amount || record.transporterAmount || record.tamount || 0);
          if (transAmount === 0 && transRate > 0) {
            const isUnits = (record.unit_type || record.unitType || '').toLowerCase() === 'units';
            const qty = isUnits ? (parseFloat(record.units_val || record.unitsVal) || 0) : ((parseFloat(record.net) || 0) / 1000);
            transAmount = Number((qty * transRate).toFixed(2));
          }

          return {
            party_transport_rate: partyRate,
            party_transport_amount: partyAmount,
            transporter_rate: transRate,
            transporter_amount: transAmount,
            destination_rate: partyRate,
            destination_amount: partyAmount,
            trate: transRate,
            tamount: transAmount,
            transport_rate: partyRate,
            transport_amount: partyAmount || Number(record.transport || 0)
          };
        })(),
        discount: Number(record.discount || 0),
        po_number: record.po_number || record.poNumber || '',
        po_date: record.po_date || record.poDate || '',
        payment: record.payment || '',
        stationary: record.stationary || '',
        phone: record.phone || '',
        royalty_type: record.royalty_type || record.royaltyType || 'None',
        royaltyType: record.royalty_type || record.royaltyType || 'None',
        royalty_amount: Number(record.royalty_amount || record.royaltyAmount || 0),
        royaltyAmount: Number(record.royalty_amount || record.royaltyAmount || 0),
        bill_type: record.bill_type || record.billType || 'NON-GST',
        billType: record.bill_type || record.billType || 'NON-GST',
        grand_total: Math.max(0, Number(Number(record.grand_total || record.grandTotal || record.amount || 0).toFixed(2))),
        grandTotal: Math.max(0, Number(Number(record.grand_total || record.grandTotal || record.amount || 0).toFixed(2))),
        cash_amount: Number(record.cash_amount || record.cashAmount || 0),
        upi_amount: Number(record.upi_amount || record.upiAmount || 0),
        credit_amount: Number(record.credit_amount || record.creditAmount || 0),
        operator: record.operator || 'Admin',
        card: record.card || '',
        vehicle_type: record.vehicle_type || 'Truck',
        token: record.token || record.dc_num || '',
        image_base64: formattedBase64 || null,
        image_base64_2: formattedBase64_2 || null,
        image_data: formattedBase64 || null,
        raw_base64: rawBase64 || null,
        image: formattedBase64 || null,
        snapshot: formattedBase64 || null,
        image_name: formattedBase64 ? `${recordUuid}.jpg` : null,
        file_name: formattedBase64 ? `${recordUuid}.jpg` : null,
        image_url: formattedBase64 || null,
        image_url_2: formattedBase64_2 || null,
        image_name_2: formattedBase64_2 ? `${recordUuid}_2.jpg` : null
      });

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
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              if (parsed.success === false || parsed.status === 'error' || parsed.error || (parsed.result && parsed.result.failed > 0)) {
                const apiErr = new Error(`Server API rejected record: ${parsed.result && parsed.result.errors ? JSON.stringify(parsed.result.errors) : (parsed.message || parsed.error || body)}`);
                apiErr.isRecordError = true;
                apiErr.statusCode = res.statusCode;
                return reject(apiErr);
              }
            } catch (_) {
              // Body is non-JSON or plain OK text
            }
            resolve(body);
          } else {
            const httpErr = new Error(`Server returned status code ${res.statusCode}: ${body}`);
            httpErr.statusCode = res.statusCode;
            if (res.statusCode === 400 || res.statusCode === 422) {
              httpErr.isRecordError = true;
            } else {
              httpErr.isServerError = true;
            }
            reject(httpErr);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upload request timed out'));
      });

      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function fetchJson(targetUrl) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = urlModule.parse(targetUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.path,
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        timeout: 10000,
        rejectUnauthorized: false
      };

      const req = protocol.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Failed to parse response body as JSON: ${body}`));
            }
          } else {
            reject(new Error(`Server returned status code ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function postJson(targetUrl, payloadObj) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = urlModule.parse(targetUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const payload = JSON.stringify(payloadObj);

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
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve({ success: true, raw: body });
            }
          } else {
            reject(new Error(`Server returned status code ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function syncMasterData() {
  if (isMasterSyncing) return { success: false, error: 'Sync already in progress' };
  isMasterSyncing = true;
  try {
    const settings = db.getSettings();
    const companyId = settings.company_id || 'CRUSHER-3080';
    let baseUrl = settings.master_sync_url || 'https://crusher.norissolutions.com/backend/api/weighbridge/pending';
    const url = injectCompanyId(baseUrl, companyId);

    const data = await fetchJson(url);
    if (data) {
      const rawCM = data.contractor_materials || data.contractorMaterials;
      const hasNewItems = (data.debitors && data.debitors.length > 0) ||
                          (data.materials && data.materials.length > 0) ||
                          (data.destinations && data.destinations.length > 0) ||
                          (data.transporters && data.transporters.length > 0) ||
                          (data.contractors && data.contractors.length > 0) ||
                          (rawCM && rawCM.length > 0) ||
                          (data.sources && data.sources.length > 0);

      if (hasNewItems) {
        const isImported = db.savePendingData(data);
        if (isImported) {
          console.log('[Sync Service] Successfully stored new server endpoint master data into local SQLite database.');
          
          try {
            const ackUrl = injectCompanyId('https://crusher.norissolutions.com/backend/api/weighbridge/ack', companyId);
            console.log('[Sync Service] Sending acknowledgment to server endpoint:', ackUrl);
            const ackResult = await postJson(ackUrl, { company_id: companyId, status: 'updated' });
            console.log('[Sync Service] Server acknowledgment response:', JSON.stringify(ackResult));
            if (db.markMasterDataUpdated) {
              db.markMasterDataUpdated();
            }
            if (db.retryAllFailedSyncQueue) {
              db.retryAllFailedSyncQueue();
            }
            // Immediately run a sync pass to push pending/previously failed transactions with the new master data
            setTimeout(runSyncCycle, 300);
          } catch (ackErr) {
            console.error('[Sync Service] Acknowledgment request failed:', ackErr.message);
          }
        } else {
          console.error('[Sync Service] Failed to store downloaded data into SQLite database.');
        }
      }

      // Broadcast sync event to renderer windows
      try {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('master-data:synced');
          }
        }
      } catch (e) {
        console.error('[Sync Service] Error broadcasting sync event:', e.message);
      }

      return { success: true };
    }
    return { success: false, error: 'Empty or invalid response from master server' };
  } catch (err) {
    console.error('[Sync Service] Error syncing pending master data from server endpoint:', err.message);
    return { success: false, error: err.message };
  } finally {
    isMasterSyncing = false;
  }
}

function isToday(dateStr) {
  if (!dateStr) return false;
  try {
    const today = new Date();
    const recordDate = new Date(dateStr);
    if (!isNaN(recordDate.getTime())) {
      return recordDate.getDate() === today.getDate() &&
             recordDate.getMonth() === today.getMonth() &&
             recordDate.getFullYear() === today.getFullYear();
    }
    
    // Fallback parser for strings like "8/7/2026, 10:21:59 AM" or "07-08-2026"
    const todayStringEN = today.toLocaleDateString('en-IN'); // e.g. "7/8/2026" or "07/08/2026"
    const todayStringUS = today.toLocaleDateString('en-US'); // e.g. "8/7/2026"
    const cleanDateStr = dateStr.split(',')[0].trim();
    
    if (cleanDateStr === todayStringEN || cleanDateStr === todayStringUS) {
      return true;
    }
    
    // Check if parts match
    const parts = cleanDateStr.split(/[-/]/);
    if (parts.length === 3) {
      const year = parseInt(parts[2]) || 0;
      const month = parseInt(parts[1]) || 0;
      const day = parseInt(parts[0]) || 0;
      if (year === today.getFullYear()) {
        // match DD/MM or MM/DD
        if ((day === today.getDate() && month === today.getMonth() + 1) ||
            (month === today.getDate() && day === today.getMonth() + 1)) {
          return true;
        }
      }
    }
    return dateStr.includes(today.getFullYear().toString()) && dateStr.includes((today.getMonth() + 1).toString()) && dateStr.includes(today.getDate().toString());
  } catch (_) {
    return false;
  }
}

async function processIncomingPendingRecords(tableName, records, companyId) {
  const processedUuids = [];
  
  for (const record of records) {
    if (!record || !record.uuid) continue;
    
    // Extract fields object (falling back to record root if not present)
    const fields = record.fields || {};
    
    // The record date no longer decides whether the edit is applied — an edit to
    // an old record must still land locally. It decides one thing only: whether a
    // record that is MISSING locally may be created. Today's may, older may not.
    //
    // A payload with no usable date cannot be proven to be from today, so it is
    // treated as old: existing records still update, missing ones are skipped
    // rather than inserted as empty rows.
    const recordDateStr = fields.date_time || fields.dateTime || record.date_time || record.dateTime || record.created_at || '';
    const allowInsertWhenMissing = !!recordDateStr && isToday(recordDateStr);

    // Flatten the record structure for the DB updater
    const flattenedRecord = {
      uuid: record.uuid,
      ...fields
    };

    let result;
    try {
      result = db.updateRecordFromPending
        ? db.updateRecordFromPending(tableName, flattenedRecord, { allowInsertWhenMissing })
        : { applied: false, action: 'failed', reason: 'updateRecordFromPending is unavailable' };
    } catch (dbErr) {
      result = { applied: false, action: 'failed', reason: dbErr.message };
    }

    if (result.action === 'updated') {
      console.log(`[Sync Service] ${tableName} ${record.uuid} updated from server edit`);
    } else if (result.action === 'inserted') {
      // Log why the insert was allowed: an empty payload date counts as today, so
      // a server payload that omits the date will always create the record.
      console.log(`[Sync Service] ${tableName} ${record.uuid} inserted from today's server edit (payload date: ${recordDateStr || 'MISSING'}, payload fields: ${Object.keys(fields).join(', ') || 'none'})`);
    } else if (result.action === 'skipped') {
      console.log(`[Sync Service] ${tableName} ${record.uuid} is an old record and does not exist locally - skipped insert (payload date: ${recordDateStr || 'MISSING'})`);
    } else {
      console.error(`[Sync Service] ${tableName} ${record.uuid} failed to apply - ${result.reason}`);
    }

    // ACK only what actually landed (or was deliberately skipped). Anything that
    // failed stays unacked so the server resends it on the next cycle.
    if (result.applied) {
      processedUuids.push(record.uuid);
    }
  }

  // Send ACK back to server
  if (processedUuids.length > 0) {
    try {
      const ackUrlBase = tableName === 'boulders' 
        ? 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders/ack'
        : 'https://crusher.norissolutions.com/backend/api/weighbridge/sales/ack';
      const ackUrl = injectCompanyId(ackUrlBase, companyId);
      
      console.log(`[Sync Service] Sending ACK for ${processedUuids.length} records to ${ackUrl}`);
      const response = await postJson(ackUrl, { uuids: processedUuids });
      console.log(`[Sync Service] ACK response from server:`, JSON.stringify(response));
    } catch (ackErr) {
      console.error(`[Sync Service] Failed to send ACK back to server:`, ackErr.message);
    }
  }
}

async function syncServerEdits() {
  if (isEditsSyncing) return;
  isEditsSyncing = true;

  try {
    const settings = db.getSettings();
    const companyId = settings.company_id || 'CRUSHER-3080';

    // 1. Fetch pending boulders
    try {
      const bouldersUrl = injectCompanyId('https://crusher.norissolutions.com/backend/api/weighbridge/boulders/pending', companyId);
      const bouldersData = await fetchJson(bouldersUrl);
      if (bouldersData) {
        const boulderRecords = Array.isArray(bouldersData) ? bouldersData : (bouldersData.records || bouldersData.boulders || bouldersData.data || []);
        if (boulderRecords.length > 0) {
          await processIncomingPendingRecords('boulders', boulderRecords, companyId);
        }
      }
    } catch (boulderErr) {
      console.error('[Sync Service] Error fetching pending boulders from server:', boulderErr.message);
    }

    // 2. Fetch pending sales
    try {
      const salesUrl = injectCompanyId('https://crusher.norissolutions.com/backend/api/weighbridge/sales/pending', companyId);
      const salesData = await fetchJson(salesUrl);
      if (salesData) {
        const salesRecords = Array.isArray(salesData) ? salesData : (salesData.records || salesData.sales || salesData.data || []);
        if (salesRecords.length > 0) {
          await processIncomingPendingRecords('sales_weighment_units', salesRecords, companyId);
        }
      }
    } catch (salesErr) {
      console.error('[Sync Service] Error fetching pending sales from server:', salesErr.message);
    }
  } catch (err) {
    console.error('[Sync Service] Error in syncServerEdits cycle:', err.message);
  } finally {
    isEditsSyncing = false;
  }
}

module.exports = {
  startSyncService,
  stopSyncService,
  runSyncCycle,
  syncMasterData,
  syncServerEdits,
  uploadRecord
};
