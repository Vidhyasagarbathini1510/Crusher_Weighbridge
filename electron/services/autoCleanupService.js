'use strict';

/**
 * autoCleanupService.js — Automated Daily Data Retention & Cleanup Service
 * ----------------------------------------------------------------------------
 * Periodically checks the database retention policy and automatically purges
 * synchronized records older than the configured retention threshold (default: 1 day).
 * 
 * Safety features:
 * - Only runs when enabled in settings.
 * - Only purges records with sync_status = 1 and no active sync_queue items.
 * - Single-flight lock ensures no concurrent purge operations run.
 * - Periodic check runs hourly but actual cleanup only triggers if >= 24h since last run.
 * - Graceful error handling prevents any unhandled crash in the main process.
 */

const db = require('../database/db');

let cleanupTimer = null;
let initialTimeout = null;
let isRunning = false;

// Check interval: hourly heartbeat check
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// Minimum time between automated cleanup runs
const MIN_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function executeAutoCleanup(reason = 'scheduled') {
  if (isRunning) {
    console.log(`[AutoCleanup] Cleanup already in progress, skipping (${reason}).`);
    return;
  }

  try {
    const config = db.getCleanupConfig ? db.getCleanupConfig() : null;
    if (!config || !config.enabled) {
      return;
    }

    // Check if 24 hours have passed since the last run (unless forced or first run)
    if (config.lastRun) {
      const lastRunTime = new Date(config.lastRun).getTime();
      const elapsed = Date.now() - lastRunTime;
      if (elapsed < MIN_RUN_INTERVAL_MS && reason === 'heartbeat') {
        return;
      }
    }

    isRunning = true;
    console.log(`[AutoCleanup] Starting automated retention cleanup (${reason}) — Retention: ${config.days} day(s), Scope: ${config.tables}...`);

    const result = db.purgeOldRecords({
      days: config.days,
      tables: config.tables
    });

    if (result && result.success) {
      console.log(`[AutoCleanup] Cleanup complete: ${result.totalDeleted} records removed, ${result.reclaimedFormatted} storage reclaimed.`);
    } else {
      console.warn('[AutoCleanup] Cleanup returned non-success result:', result ? result.error : 'Unknown error');
    }
  } catch (err) {
    console.error('[AutoCleanup] Error during automated cleanup execution:', err.message || err);
  } finally {
    isRunning = false;
  }
}

function start() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  if (initialTimeout) {
    clearTimeout(initialTimeout);
  }

  console.log('[AutoCleanup] Automated cleanup service initialized.');

  // Run initial check 15 seconds after app startup
  initialTimeout = setTimeout(() => {
    executeAutoCleanup('startup').catch(err => {
      console.error('[AutoCleanup] Startup cleanup check error:', err);
    });
  }, 15000);

  // Hourly heartbeat check
  cleanupTimer = setInterval(() => {
    executeAutoCleanup('heartbeat').catch(err => {
      console.error('[AutoCleanup] Heartbeat cleanup check error:', err);
    });
  }, CHECK_INTERVAL_MS);
}

function stop() {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  console.log('[AutoCleanup] Automated cleanup service stopped.');
}

module.exports = {
  start,
  stop,
  executeAutoCleanup
};
