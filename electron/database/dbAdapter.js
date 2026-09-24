'use strict';
/**
 * dbAdapter.js — Unified Database Adapter (HOST / CLIENT LAN Switch)
 * ----------------------------------------------------------------------------
 * Sits between Electron IPC handlers and the actual database implementation.
 *
 * If mode === 'HOST':
 *   Executes database methods directly against local SQLite (weighbridge.db).
 *
 * If mode === 'CLIENT':
 *   Sends HTTP POST requests to Host PC's LAN API server (http://HOST_IP:5000)
 *   with exponential backoff retries and request deduplication.
 * ----------------------------------------------------------------------------
 */
const crypto = require('crypto');
const db = require('./db');

let cachedConfig = null;

/**
 * Load current network configuration from local settings table
 */
function getNetworkConfig() {
  try {
    const settings = db.getSettings ? db.getSettings() : {};
    cachedConfig = {
      mode: settings.network_mode || 'HOST',
      hostIp: settings.network_host_ip || '127.0.0.1',
      hostPort: Number(settings.network_port) || 5000
    };
  } catch (err) {
    console.error('[dbAdapter] Failed to load network config from DB, defaulting to HOST:', err);
    cachedConfig = { mode: 'HOST', hostIp: '127.0.0.1', hostPort: 5000 };
  }
  return cachedConfig;
}

/**
 * Save updated network configuration
 */
function saveNetworkConfig({ mode, hostIp, hostPort }) {
  const newMode = (mode || 'HOST').toUpperCase();
  const newIp = (hostIp || '127.0.0.1').trim();
  const newPort = Number(hostPort) || 5000;

  if (db.saveSetting) {
    db.saveSetting('network_mode', newMode);
    db.saveSetting('network_host_ip', newIp);
    db.saveSetting('network_port', String(newPort));
  }

  cachedConfig = { mode: newMode, hostIp: newIp, hostPort: newPort };
  console.log('[dbAdapter] Updated network configuration:', cachedConfig);
  return cachedConfig;
}

/**
 * Test HTTP connection to Host PC
 */
async function testHostConnection(hostIp, hostPort = 5000) {
  const targetIp = (hostIp || '127.0.0.1').trim();
  const targetPort = Number(hostPort) || 5000;
  const targetUrl = `http://${targetIp}:${targetPort}/api/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { success: false, error: `Host returned HTTP status ${response.status}` };
    }
    const data = await response.json();
    return { success: true, hostInfo: data };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Connection timed out (Host PC unreachable)' : err.message
    };
  }
}

/**
 * Perform remote API database call to Host PC with automatic retries
 */
async function performRemoteCall(methodName, args, retries = 3, backoffMs = 150) {
  const config = getNetworkConfig();
  const url = `http://${config.hostIp}:${config.hostPort}/api/db/${methodName}`;
  const requestId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 second timeout for long calls

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId
        },
        body: JSON.stringify({ method: methodName, args, requestId }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Host returned HTTP status ${response.status}`);
      }

      const payload = await response.json();

      if (!payload.success) {
        throw new Error(payload.error || 'Database operation failed on Host');
      }

      return payload.data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      console.warn(`[dbAdapter] Remote call attempt ${attempt}/${retries} failed for ${methodName}:`, err.message);

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
      }
    }
  }

  throw new Error(`LAN Network Error: Unable to communicate with Host PC (${config.hostIp}:${config.hostPort}) for '${methodName}'. Details: ${lastError ? lastError.message : 'Unknown error'}`);
}

/**
 * Central Database Call Adapter
 * Invoked by Electron main process IPC handlers
 */
async function call(methodName, ...args) {
  const config = getNetworkConfig();

  // Mode === HOST: Call local SQLite database directly
  if (config.mode === 'HOST') {
    if (typeof db[methodName] !== 'function') {
      throw new Error(`Local database method not found: ${methodName}`);
    }
    return db[methodName](...args);
  }

  // Mode === CLIENT: Send over LAN network to Host PC
  if (methodName === 'loginUser') {
    try {
      return await performRemoteCall(methodName, args);
    } catch (err) {
      console.warn('[dbAdapter] Remote login failed, attempting local fallback login:', err.message);
      if (typeof db.loginUser === 'function') {
        const localLogin = db.loginUser(...args);
        if (localLogin) return localLogin;
      }
      throw err;
    }
  }

  return performRemoteCall(methodName, args);
}

module.exports = {
  call,
  getNetworkConfig,
  saveNetworkConfig,
  testHostConnection
};
