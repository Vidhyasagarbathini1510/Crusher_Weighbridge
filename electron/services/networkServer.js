'use strict';
/**
 * networkServer.js — Embedded LAN HTTP Server for Host PC
 * ----------------------------------------------------------------------------
 * Listens on LAN port (default 5000) and exposes SQLite database methods
 * to Client PCs on the local network.
 * Uses native Node.js 'http' and 'os' modules for zero external dependencies.
 * ----------------------------------------------------------------------------
 */
const http = require('http');
const os = require('os');
const db = require('../database/db');

let serverInstance = null;
let currentPort = 5000;
const processedRequestIds = new Map(); // requestId -> { timestamp, response }

// Keep deduplication memory bounded (clear entries older than 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, meta] of processedRequestIds.entries()) {
    if (now - meta.timestamp > 300000) {
      processedRequestIds.delete(id);
    }
  }
}, 60000);

/**
 * Get list of local IPv4 network addresses on this machine.
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  return addresses;
}

/**
 * Set CORS headers on response
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-ID');
}

/**
 * Read JSON body from incoming request
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      // 50MB safety payload limit (for base64 weighbridge images)
      if (body.length > 52428800) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Start the LAN API Server
 */
function startServer(port = 5000) {
  if (serverInstance) {
    console.log(`[NetworkServer] Server already running on port ${currentPort}`);
    return Promise.resolve({ running: true, port: currentPort, ips: getLocalIpAddresses() });
  }

  currentPort = Number(port) || 5000;

  return new Promise((resolve, reject) => {
    serverInstance = http.createServer(async (req, res) => {
      setCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      const reqUrl = req.url.split('?')[0];

      // Health check endpoint
      if (req.method === 'GET' && (reqUrl === '/' || reqUrl === '/api/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'ok',
          service: 'Crusher Weighbridge LAN Host',
          serverTime: new Date().toISOString(),
          ips: getLocalIpAddresses()
        }));
      }

      // Local IP listing endpoint
      if (req.method === 'GET' && reqUrl === '/api/ip') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ips: getLocalIpAddresses() }));
      }

      // Database Call endpoint: POST /api/db/call or POST /api/db/:methodName
      if (req.method === 'POST' && reqUrl.startsWith('/api/db')) {
        try {
          const body = await parseJsonBody(req);
          const methodName = reqUrl.replace('/api/db/', '').replace('/call', '') || body.method;
          const args = body.args || [];
          const requestId = body.requestId;

          // Request deduplication check
          if (requestId && processedRequestIds.has(requestId)) {
            const cached = processedRequestIds.get(requestId);
            console.log(`[NetworkServer] Returning cached result for duplicate requestId: ${requestId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(cached.response));
          }

          if (!methodName || typeof db[methodName] !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: `Invalid database method: ${methodName}` }));
          }

          // Execute database operation on Host
          const result = await Promise.resolve(db[methodName](...args));
          const responsePayload = { success: true, data: result };

          if (requestId) {
            processedRequestIds.set(requestId, { timestamp: Date.now(), response: responsePayload });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(responsePayload));
        } catch (err) {
          console.error(`[NetworkServer] Error handling DB request (${reqUrl}):`, err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: err.message || 'Internal database error' }));
        }
      }

      // 404 Not Found
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Endpoint not found' }));
    });

    serverInstance.on('error', (err) => {
      console.error('[NetworkServer] Server error:', err);
      serverInstance = null;
      reject(err);
    });

    serverInstance.listen(currentPort, '0.0.0.0', () => {
      console.log(`[NetworkServer] Host LAN API Server listening on 0.0.0.0:${currentPort}`);
      resolve({ running: true, port: currentPort, ips: getLocalIpAddresses() });
    });
  });
}

/**
 * Stop the LAN API Server
 */
function stopServer() {
  return new Promise((resolve) => {
    if (!serverInstance) return resolve(true);
    serverInstance.close(() => {
      console.log('[NetworkServer] LAN API Server stopped.');
      serverInstance = null;
      resolve(true);
    });
  });
}

function isServerRunning() {
  return serverInstance !== null;
}

module.exports = {
  startServer,
  stopServer,
  isServerRunning,
  getLocalIpAddresses
};
