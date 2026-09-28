'use strict';

/**
 * alertService.js — Centralized Alerting & nChat Integration Service
 * ----------------------------------------------------------------------------
 * Handles sending structured alerts via the nChat API endpoint:
 *   https://nchat.norissolutions.com/backend/api/erp.php?action
 * 
 * Features:
 *  - Deduplication: Prevents duplicate alert spam for active issues.
 *  - Issue Lifecycle: DETECTED -> DIAGNOSING -> ALERT_SENT -> WAITING -> VERIFYING -> RESOLVED
 *  - Dynamic Sender/Receiver: SenderNumber = company_id, ReceiverNumber = setting or default.
 *  - Offline Queuing: Retries queued alerts if nChat API is temporarily unreachable.
 *  - Non-blocking: All operations run asynchronously and never block weighing or UI.
 * ----------------------------------------------------------------------------
 */

const https = require('https');
const http = require('http');
const url = require('url');
const db = require('../database/db');

const NCHAT_API_URL = 'https://nchat.norissolutions.com/backend/api/erp.php?action';
const DEFAULT_RECEIVER = '9959608198';
const DEFAULT_SENDER = '36AAACW0387R4ZL';

// In-memory active issue registry: issueId -> { state, firstDetectedAt, alertSentAt, lastCheckedAt }
const activeIssues = new Map();

// Retry timer for queued alerts
let queueRetryInterval = null;

/**
 * Fetch active settings for Sender and Receiver numbers
 */
function getAlertConfig() {
  let senderNumber = DEFAULT_SENDER;
  let receiverNumber = DEFAULT_RECEIVER;
  let enabled = true;

  try {
    const settings = db.getSettings ? db.getSettings() : {};
    if (settings.company_id && settings.company_id.trim()) {
      senderNumber = settings.company_id.trim();
    }
    if (settings.nchat_receiver_number && settings.nchat_receiver_number.trim()) {
      receiverNumber = settings.nchat_receiver_number.trim();
    }
    if (settings.nchat_alerts_enabled !== undefined) {
      enabled = String(settings.nchat_alerts_enabled) !== 'false';
    }
  } catch (err) {
    console.error('[AlertService] Error reading settings for alert config:', err.message);
  }

  return { senderNumber, receiverNumber, enabled };
}

/**
 * Directly post payload to nChat API via standard Node https/http module
 */
function postToNChat(payload) {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(payload);
    const parsedUrl = url.parse(NCHAT_API_URL);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataStr)
      },
      timeout: 10000 // 10s timeout
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) {}

        const apiSuccess = parsed && parsed.success !== undefined ? parsed.success : true;
        if (res.statusCode >= 200 && res.statusCode < 300 && apiSuccess) {
          console.log(`[AlertService] nChat API success (${res.statusCode}):`, body);
          resolve({ success: true, statusCode: res.statusCode, body, data: parsed });
        } else {
          const errorDetail = (parsed && (parsed.message || parsed.error)) || body || `HTTP ${res.statusCode}`;
          console.warn(`[AlertService] nChat API error (${res.statusCode}):`, body);
          reject(new Error(errorDetail));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[AlertService] nChat request network error:', err.message);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('nChat request timeout'));
    });

    req.write(dataStr);
    req.end();
  });
}

/**
 * Send an alert message immediately or queue if offline
 */
async function dispatchAlert(content, customReceiver = null) {
  const { senderNumber, receiverNumber, enabled } = getAlertConfig();

  if (!enabled) {
    console.log('[AlertService] Alerts disabled in settings. Skipping dispatch.');
    return { success: false, reason: 'disabled' };
  }

  let targets = [];
  if (customReceiver) {
    targets = Array.isArray(customReceiver)
      ? customReceiver.map(n => String(n).trim()).filter(Boolean)
      : String(customReceiver).split(',').map(n => n.trim()).filter(Boolean);
  } else {
    targets = String(receiverNumber).split(',').map(n => n.trim()).filter(Boolean);
  }
  if (targets.length === 0) {
    targets = [DEFAULT_RECEIVER];
  }

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const num = targets[i];
    const payload = {
      SenderNumber: senderNumber,
      ReceiverNumber: num,
      Content: content,
      ContentType: 'Text'
    };

    if (i > 0) {
      // Small 300ms delay between consecutive requests to avoid API rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    try {
      const res = await postToNChat(payload);
      results.push({ receiver: num, success: true, ...res });
    } catch (err) {
      console.warn(`[AlertService] Direct nChat delivery to ${num} failed:`, err.message);
      const isValidationError = err.message && (err.message.includes('not a valid phone number') || err.message.includes('400'));
      let queued = false;

      if (!isValidationError && db.queueOfflineAlert) {
        db.queueOfflineAlert(payload);
        queued = true;
      }
      results.push({ receiver: num, success: false, queued, error: err.message });
    }
  }

  const successfulCount = results.filter(r => r.success).length;
  const allSuccess = results.length > 0 && results.every(r => r.success);
  const partialSuccess = successfulCount > 0 && !allSuccess;

  return {
    success: allSuccess,
    partialSuccess,
    successfulCount,
    failedCount: results.length - successfulCount,
    recipientCount: targets.length,
    results
  };
}

/**
 * Process offline alert queue retry
 */
async function processOfflineAlertQueue() {
  if (!db.getPendingOfflineAlerts) return;
  try {
    const pending = db.getPendingOfflineAlerts(10);
    if (!pending || pending.length === 0) return;

    console.log(`[AlertService] Processing ${pending.length} pending offline alerts...`);
    for (const item of pending) {
      try {
        const payload = JSON.parse(item.payload_json);
        const numbers = String(payload.ReceiverNumber || '').split(',').map(n => n.trim()).filter(Boolean);
        const targetList = numbers.length > 0 ? numbers : [DEFAULT_RECEIVER];
        
        for (const num of targetList) {
          await postToNChat({ ...payload, ReceiverNumber: num });
        }

        if (db.markOfflineAlertCompleted) {
          db.markOfflineAlertCompleted(item.id);
        }
      } catch (err) {
        console.warn(`[AlertService] Retry failed for offline alert ID ${item.id}:`, err.message);
        if (err.message && err.message.includes('400')) {
          // HTTP 400 means client request validation failed (e.g. malformed payload); mark done to clear queue
          if (db.markOfflineAlertCompleted) {
            db.markOfflineAlertCompleted(item.id);
          }
        } else if (db.incrementOfflineAlertRetry) {
          db.incrementOfflineAlertRetry(item.id, err.message);
        }
        break; // Stop pass if server still unreachable
      }
    }
  } catch (err) {
    console.error('[AlertService] Error processing offline alert queue:', err.message);
  }
}

/**
 * Trigger an Issue Alert with automatic deduplication
 */
async function raiseIssue({ issueId, component, problem, cause, steps, currentStatus }) {
  if (!issueId) return;

  const now = Date.now();
  const existing = activeIssues.get(issueId);

  // Deduplication check: Do NOT send repeated alert if issue is already active
  if (existing && existing.state === 'ALERT_SENT') {
    existing.lastCheckedAt = now;
    return;
  }

  activeIssues.set(issueId, {
    issueId,
    component,
    state: 'DIAGNOSING',
    firstDetectedAt: existing ? existing.firstDetectedAt : now,
    lastCheckedAt: now
  });

  const message = `${component ? `⚠️ ${component.toUpperCase()} ALERT` : '⚠️ APPLICATION ALERT'}

Problem:
${problem}

Possible Cause:
${cause}

Please check:
${steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

Current Status:
${currentStatus}

Issue ID: ${issueId}`;

  const issueRecord = activeIssues.get(issueId);
  issueRecord.state = 'ALERT_SENT';
  issueRecord.alertSentAt = now;

  console.log(`[AlertService] Raising new alert for Issue ID [${issueId}]...`);
  await dispatchAlert(message);
}

/**
 * Verify & Resolve an Issue, sending "Issue Resolved" message
 */
async function resolveIssue({ issueId, problemTitle, statusDescription, verificationDetails }) {
  if (!issueId) return;

  const existing = activeIssues.get(issueId);
  if (!existing) {
    return; // No active issue to resolve
  }

  const now = new Date();
  const dateFormatted = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`;

  const resolvedMessage = `✅ ISSUE RESOLVED

Problem:
${problemTitle}

Status:
${statusDescription}

Verification:
${verificationDetails}

Issue ID:
${issueId}

Resolved At:
${dateFormatted}`;

  console.log(`[AlertService] Resolving Issue ID [${issueId}]...`);
  activeIssues.delete(issueId);
  await dispatchAlert(resolvedMessage);
}

/**
 * Start queue retry timer on boot
 */
function startAlertService() {
  if (queueRetryInterval) clearInterval(queueRetryInterval);
  queueRetryInterval = setInterval(() => {
    processOfflineAlertQueue().catch(() => {});
  }, 15000);
}

function stopAlertService() {
  if (queueRetryInterval) {
    clearInterval(queueRetryInterval);
    queueRetryInterval = null;
  }
}

/**
 * Send a test nChat alert to verify settings
 */
async function sendTestAlert(targetNumber = null) {
  const { senderNumber, receiverNumber } = getAlertConfig();
  const rawTarget = targetNumber || receiverNumber;
  const targets = Array.isArray(rawTarget)
    ? rawTarget.map(n => String(n).trim()).filter(Boolean)
    : String(rawTarget).split(',').map(n => n.trim()).filter(Boolean);

  const testMsg = `🔔 NCHAT TEST ALERT

Sender (Company ID): ${senderNumber}
Receivers (${targets.length}): ${targets.join(', ')}
Status: Communication OK

This is a test notification from the Weighbridge Application Issue Detection System.`;

  return dispatchAlert(testMsg, targets);
}

module.exports = {
  startAlertService,
  stopAlertService,
  raiseIssue,
  resolveIssue,
  dispatchAlert,
  sendTestAlert,
  getAlertConfig,
  activeIssues
};
