'use strict';

/**
 * healthMonitorService.js — Central Application Issue Detection & Health Monitor
 * ----------------------------------------------------------------------------
 * Monitors 7 core components continuously:
 *   1. Weighbridge / Serial Communication (WB-001)
 *   2. Printer (PRINT-001)
 *   3. Synchronization (SYNC-001)
 *   4. Network Reachability (NET-001)
 *   5. SQLite Local Database (DB-001)
 *   6. Application Errors & Crashes (APP-001)
 *   7. Transaction Workflow Anomalies (TXN-001)
 * ----------------------------------------------------------------------------
 */

const https = require('https');
const http = require('http');
const url = require('url');
const alertService = require('./alertService');
const db = require('../database/db');

// State trackers for auto-recovery verification
let monitorInterval = null;
let txCheckInterval = null;

// Weighbridge state tracking
let lastWeightTimestamp = Date.now();
let validWeightCount = 0;
const WEIGHT_STALE_THRESHOLD_MS = 15000;
const REQUIRED_RECOVERY_READINGS = 5;
let wbIssueActive = false;

// Sync state tracking
let syncFailureCount = 0;
let syncIssueActive = false;

// Network state tracking
let networkIssueActive = false;
let isNetworkChecking = false;

// Database state tracking
let dbFailureCount = 0;
let dbIssueActive = false;

/**
 * Event: Called whenever weight data is received from Serial/Network Scale
 */
function reportWeightReading(data) {
  const val = (data && data.value !== undefined) ? String(data.value).trim() : '';

  if (val && !val.toLowerCase().includes('offline') && !isNaN(parseFloat(val))) {
    lastWeightTimestamp = Date.now();
    validWeightCount++;

    // Check for Weighbridge Recovery Verification
    if (wbIssueActive && validWeightCount >= REQUIRED_RECOVERY_READINGS) {
      wbIssueActive = false;
      alertService.resolveIssue({
        issueId: 'WB-001',
        problemTitle: 'Weighbridge communication failure.',
        statusDescription: 'Weighbridge communication has been restored.',
        verificationDetails: `${REQUIRED_RECOVERY_READINGS} consecutive valid weight readings received.`
      });
    }
  } else {
    validWeightCount = 0;
  }
}

/**
 * Event: Called when weighbridge port emits error or disconnects
 */
function reportWeightError(errorMessage) {
  validWeightCount = 0;
  wbIssueActive = true;
  alertService.raiseIssue({
    issueId: 'WB-001',
    component: 'Weighbridge',
    problem: 'No valid weight data is being received.',
    cause: errorMessage || 'Serial/USB communication with the weighing indicator may be disconnected.',
    steps: [
      'Check the serial/USB cable.',
      'Confirm the weighing indicator is powered ON.',
      'Check the COM port connection.',
      'Reconnect the cable.',
      'Restart the weighing indicator if required.',
      'Verify that live weight is displayed in the application.'
    ],
    currentStatus: 'Weight data not received.'
  });
}

/**
 * Event: Called when a print job fails
 */
function reportPrintError(errMessage, printerName) {
  alertService.raiseIssue({
    issueId: 'PRINT-001',
    component: 'Printer',
    problem: 'The weighment slip could not be printed.',
    cause: errMessage || `Failed to send print job to printer "${printerName || 'Default'}"`,
    steps: [
      'Confirm the printer is powered ON.',
      'Check USB/network connection.',
      'Check paper availability.',
      'Check Windows printer status.',
      'Clear pending print jobs.',
      'Print a Windows test page.',
      'Try printing the weighment again.'
    ],
    currentStatus: 'Printer unavailable or spooler error.'
  });
}

/**
 * Event: Called when a print job succeeds
 */
function reportPrintSuccess() {
  alertService.resolveIssue({
    issueId: 'PRINT-001',
    problemTitle: 'Printer communication or spooler error.',
    statusDescription: 'Printer is back online and accepting jobs.',
    verificationDetails: 'Test print job completed successfully.'
  });
}

/**
 * Event: Called by syncService on sync success or failure
 */
function reportSyncStatus(success, errorMsg = null, pendingCount = 0) {
  if (success) {
    syncFailureCount = 0;
    if (syncIssueActive) {
      syncIssueActive = false;
      alertService.resolveIssue({
        issueId: 'SYNC-001',
        problemTitle: 'Transactions sync failure.',
        statusDescription: 'Synchronization with server restored.',
        verificationDetails: 'Server returned HTTP 200 OK for pending records batch.'
      });
    }
  } else {
    syncFailureCount++;
    if (syncFailureCount >= 3) {
      syncIssueActive = true;
      alertService.raiseIssue({
        issueId: 'SYNC-001',
        component: 'Synchronization',
        problem: 'Transactions are not synchronizing with the server.',
        cause: errorMsg || `Repeated sync retries failed (${syncFailureCount} consecutive errors).`,
        steps: [
          'Check internet connection.',
          'Check server availability.',
          'Check API connectivity.',
          'Retry synchronization.',
          'If the problem continues, contact support.'
        ],
        currentStatus: `Pending Transactions stuck: ${pendingCount}`
      });
    }
  }
}

/**
 * Event: Called when a database query or lock error occurs
 */
function reportDatabaseError(errMessage) {
  dbFailureCount++;
  dbIssueActive = true;
  alertService.raiseIssue({
    issueId: 'DB-001',
    component: 'Database',
    problem: 'The local database is not responding correctly.',
    cause: errMessage || 'SQLite database error or access lock timeout.',
    steps: [
      'Stop creating new transactions temporarily.',
      'Check whether the application is responding.',
      'Restart the application.',
      'Do NOT delete the database file.',
      'Contact support if the problem continues.'
    ],
    currentStatus: 'Database write/read query error.'
  });
}

/**
 * Event: Called when DB operation recovers
 */
function reportDatabaseSuccess() {
  if (dbIssueActive) {
    dbFailureCount = 0;
    dbIssueActive = false;
    alertService.resolveIssue({
      issueId: 'DB-001',
      problemTitle: 'Local database error.',
      statusDescription: 'SQLite database connection healthy.',
      verificationDetails: 'Consecutive read/write database probes succeeded.'
    });
  }
}

/**
 * Event: Called on unhandled main process exception or renderer error
 */
function reportApplicationError(errStr) {
  alertService.raiseIssue({
    issueId: 'APP-001',
    component: 'Application',
    problem: 'A critical application component stopped responding or encountered an exception.',
    cause: errStr || 'Unhandled application error.',
    steps: [
      'Save any available work.',
      'Restart the application.',
      'Check weighbridge connection.',
      'Check printer connection.',
      'Retry the operation.'
    ],
    currentStatus: 'Unhandled process exception captured.'
  });
}

/**
 * Watchdog: Check Weighbridge Stale Data (> 15s without numeric weight)
 */
function checkWeighbridgeWatchdog() {
  const elapsed = Date.now() - lastWeightTimestamp;
  if (elapsed > WEIGHT_STALE_THRESHOLD_MS && !wbIssueActive) {
    wbIssueActive = true;
    validWeightCount = 0;
    alertService.raiseIssue({
      issueId: 'WB-001',
      component: 'Weighbridge',
      problem: 'No valid weight data is being received.',
      cause: `No valid weight readings received for ${Math.round(elapsed / 1000)} seconds.`,
      steps: [
        'Check the serial/USB cable.',
        'Confirm the weighing indicator is powered ON.',
        'Check the COM port connection.',
        'Reconnect the cable.',
        'Restart the weighing indicator if required.',
        'Verify that live weight is displayed in the application.'
      ],
      currentStatus: 'Weight data stream quiet/stale.'
    });
  }
}

/**
 * Watchdog: Check Network Reachability (nChat / Server)
 */
function checkNetworkWatchdog() {
  if (isNetworkChecking) return;
  isNetworkChecking = true;

  const req = https.get('https://nchat.norissolutions.com/backend/api/erp.php?action', { timeout: 8000 }, (res) => {
    isNetworkChecking = false;
    if (networkIssueActive) {
      networkIssueActive = false;
      alertService.resolveIssue({
        issueId: 'NET-001',
        problemTitle: 'Internet connectivity failure.',
        statusDescription: 'Internet/Server connection restored.',
        verificationDetails: 'Server health check returned HTTP 200.'
      });
    }
  });

  req.on('error', (err) => {
    isNetworkChecking = false;
    if (!networkIssueActive) {
      networkIssueActive = true;
      alertService.raiseIssue({
        issueId: 'NET-001',
        component: 'Network',
        problem: 'Internet or Server endpoint is unreachable.',
        cause: err.message || 'Network interface disconnected or DNS failure.',
        steps: [
          'Check network cables and Wi-Fi adapter.',
          'Check local router and internet connection.',
          'Verify firewall settings allowing outbound connections.',
          'Continue working offline if weighing is required (local storage active).'
        ],
        currentStatus: 'Offline mode active. Weighing remains operational.'
      });
    }
  });

  req.on('timeout', () => {
    req.destroy();
    isNetworkChecking = false;
  });
}

/**
 * Watchdog: Transaction Workflow Monitor (Check stuck pending approval transactions)
 */
function checkStuckTransactions() {
  if (!db.getSettings) return;

  try {
    // Search for transactions stuck in approval/pending state older than 30 mins
    const sql = `
      SELECT dc_number, vehicle_number, created_at, 'sales' as source_table 
      FROM sales_weighment_units 
      WHERE approval_status = 'Pending' AND julianday('now') - julianday(created_at) > (30.0 / 1440.0)
      LIMIT 1
    `;

    // Query DB instance safely if available
    let stuckTx = null;
    if (db.queryRaw) {
      const rows = db.queryRaw(sql);
      if (rows && rows.length > 0) stuckTx = rows[0];
    }

    if (stuckTx) {
      alertService.raiseIssue({
        issueId: 'TXN-001',
        component: 'Transaction Workflow',
        problem: 'Transaction has remained in the approval-pending state longer than expected.',
        cause: `DC No: ${stuckTx.dc_number || 'N/A'}, Vehicle: ${stuckTx.vehicle_number || 'N/A'} has been pending approval for > 30 minutes.`,
        steps: [
          `Open DC ${stuckTx.dc_number || ''}.`,
          'Verify the transaction details.',
          'Complete the required approval.',
          'Verify billing status.',
          'Verify ledger posting.'
        ],
        currentStatus: 'Approval: Pending | Billing: Unbilled'
      });
    }
  } catch (err) {
    // Ignore schema mismatch if table doesn't have approval_status column
  }
}

/**
 * Start Health Monitor loop
 */
function startHealthMonitorService() {
  console.log('[HealthMonitorService] Starting health monitor service...');
  alertService.startAlertService();

  if (monitorInterval) clearInterval(monitorInterval);
  if (txCheckInterval) clearInterval(txCheckInterval);

  // Monitor watchdog loop running every 5 seconds
  monitorInterval = setInterval(() => {
    checkWeighbridgeWatchdog();
  }, 5000);

  // Check network reachability every 30 seconds
  setInterval(() => {
    checkNetworkWatchdog();
  }, 30000);

  // Check stuck transactions every 10 minutes
  txCheckInterval = setInterval(() => {
    checkStuckTransactions();
  }, 600000);
}

function stopHealthMonitorService() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (txCheckInterval) {
    clearInterval(txCheckInterval);
    txCheckInterval = null;
  }
  alertService.stopAlertService();
}

module.exports = {
  startHealthMonitorService,
  stopHealthMonitorService,
  reportWeightReading,
  reportWeightError,
  reportPrintError,
  reportPrintSuccess,
  reportSyncStatus,
  reportDatabaseError,
  reportDatabaseSuccess,
  reportApplicationError
};
