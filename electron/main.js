'use strict';
/**
 * main.js — Electron MAIN PROCESS (Node.js side).
 * ----------------------------------------------------------------------------
 * The main process is the "backend" of the desktop app. It is the ONLY place
 * with full OS access: it can open TCP sockets, spawn FFmpeg, and read the disk.
 * The React UI runs in a separate, sandboxed RENDERER process and talks to main
 * only through the safe channels we expose in preload.js.
 *
 *   ┌─────────────────────┐  IPC (contextBridge)  ┌──────────────────────────┐
 *   │  MAIN (this file)   │◀────────────────────▶│  RENDERER (React in HTML) │
 *   │  net sockets, FFmpeg│                       │  no direct OS access      │
 *   └─────────────────────┘                       └──────────────────────────┘
 * ----------------------------------------------------------------------------
 */
const { app, BrowserWindow, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const bcrypt = require('bcryptjs');
const { registerCameraHandlers } = require('./ipc/cameraHandlers');
const NetronReader = require('./socket/NetronReader');
const db = require('./database/db');
const dbAdapter = require('./database/dbAdapter');
const networkServer = require('./services/networkServer');

/**
 * Software-owner password, used ONLY to unlock the Cloud Sync / Company ID
 * configuration. This is deliberately NOT the customer's admin password: a site
 * admin can clear tables, but must not be able to re-point the machine at a
 * different tenant.
 *
 * Only the bcrypt hash is stored, and it is verified here in the main process —
 * so the secret never reaches the renderer bundle, which is the easiest file to
 * read inside a packaged build. Rotate by generating a new hash with:
 *   node -e "console.log(require('bcryptjs').hashSync('YOUR-PASSWORD', 12))"
 */
const OWNER_PASSWORD_HASH = '$2b$12$2ryHmWLp/ji8pHf3R5nE4OqtSM2uAj43GpldTmrObyASjju1Yszu6';
const { startSyncService, stopSyncService, runSyncCycle } = require('./services/syncService');
const autoCleanupService = require('./services/autoCleanupService');
const printerService = require('./services/printerService');
const { startAiService, stopAiService } = require('./services/aiService');
const { startHealthMonitorService, stopHealthMonitorService, reportApplicationError } = require('./services/healthMonitorService');
const { sendTestAlert, getAlertConfig } = require('./services/alertService');

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught Exception:', err);
  reportApplicationError(`Uncaught Exception: ${err ? err.message : String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled Rejection:', reason);
  reportApplicationError(`Unhandled Rejection: ${reason ? (reason.message || String(reason)) : 'Unknown'}`);
});

const isDev = !app.isPackaged;

// Electron derives the user-data folder from productName, so renaming the
// product from "Noris Weighbridge" to "Crusher Weighbridge" points the app at a
// brand new, empty folder — every weighment record, the Company ID lock and the
// scale/printer settings would appear to have vanished on an upgraded machine.
// This copies the old folder across once, on first run under the new name.
//
// The legacy folder is left in place: if this build is ever rolled back, the
// site still has its data. Caches are skipped — they are large and rebuild
// themselves. Must run before db.init(), which resolves the database path.
const LEGACY_USER_DATA_DIRS = ['Noris Weighbridge'];

function migrateLegacyUserData() {
  const fs = require('fs');
  const currentDir = app.getPath('userData');

  // Already has a database here — nothing to carry over.
  if (fs.existsSync(path.join(currentDir, 'weighbridge.db'))) return;

  const parent = path.dirname(currentDir);
  const legacyDir = LEGACY_USER_DATA_DIRS
    .map((name) => path.join(parent, name))
    .find((dir) => dir !== currentDir && fs.existsSync(path.join(dir, 'weighbridge.db')));

  if (!legacyDir) return;

  const skip = new Set([
    'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache',
    'DawnWebGPUCache', 'blob_storage', 'Crashpad', 'logs', 'Dictionaries'
  ]);

  console.log(`[Main] Migrating user data from "${legacyDir}" to "${currentDir}"...`);
  try {
    fs.mkdirSync(currentDir, { recursive: true });
    for (const entry of fs.readdirSync(legacyDir)) {
      if (skip.has(entry)) continue;
      fs.cpSync(path.join(legacyDir, entry), path.join(currentDir, entry), { recursive: true });
    }
    console.log('[Main] User data migration complete. The old folder was left untouched.');
  } catch (e) {
    console.error('[Main] User data migration failed:', e);
  }
}

/** Where to find the ffmpeg binary. In production, bundle it under resources/. */
function getFfmpegPath() {
  if (isDev) {
    const fs = require('fs');
    const localFfmpeg = path.join(__dirname, '..', 'ffmpeg.exe');
    if (fs.existsSync(localFfmpeg)) {
      return localFfmpeg;
    }
    return process.env.FFMPEG_PATH || 'ffmpeg'; // must be on PATH in dev
  }
  return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
}

// The window/taskbar icon. In dev it sits in the repo; in a packaged build it
// is copied to resources/assets by the extraResources rule in package.json.
// electron-builder stamps the same file onto the exe and the installer via
// build.win.icon, so all three stay in sync.
function getAppIconPath() {
  return isDev
    ? path.join(__dirname, '..', 'assets', 'icon.ico')
    : path.join(process.resourcesPath, 'assets', 'icon.ico');
}

function registerDatabaseHandlers() {
  ipcMain.handle('db:login', async (event, { username, password }) => {
    return dbAdapter.call('loginUser', username, password);
  });
  ipcMain.handle('db:getCameras', async () => {
    return dbAdapter.call('getAllCameras');
  });
  ipcMain.handle('db:addCamera', async (event, cam) => {
    return dbAdapter.call('addCamera', cam);
  });
  ipcMain.handle('db:updateCamera', async (event, cam) => {
    return dbAdapter.call('updateCamera', cam);
  });
  ipcMain.handle('db:deleteCamera', async (event, id) => {
    return dbAdapter.call('deleteCamera', id);
  });
  ipcMain.handle('db:getTransactions', async () => {
    return dbAdapter.call('getAllTransactions');
  });
  ipcMain.handle('db:addTransaction', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addTransaction', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getBoulders', async () => {
    return dbAdapter.call('getAllBoulders');
  });
  ipcMain.handle('db:addBoulder', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addBoulderTransaction', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getSalesUnits', async () => {
    return dbAdapter.call('getAllSalesWeighmentUnits');
  });
  ipcMain.handle('db:addSalesUnits', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addSalesWeighmentUnits', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getYardWeighments', async () => {
    return dbAdapter.call('getAllYardWeighments');
  });
  ipcMain.handle('db:addYardWeighment', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addYardWeighment', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getLoadingSlips', async () => {
    return dbAdapter.call('getAllLoadingSlips');
  });
  ipcMain.handle('db:addLoadingSlip', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addLoadingSlip', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getFirstWeighments', async () => {
    return dbAdapter.call('getAllFirstWeighments');
  });
  ipcMain.handle('db:addFirstWeighment', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addFirstWeighment', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getSecondWeighments', async () => {
    return dbAdapter.call('getAllSecondWeighments');
  });
  ipcMain.handle('db:addSecondWeighment', async (event, { tx, base64Image }) => {
    const result = await dbAdapter.call('addSecondWeighment', tx, base64Image);
    const cfg = dbAdapter.getNetworkConfig();
    if (cfg.mode === 'HOST') runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:getSettings', async () => {
    return dbAdapter.call('getSettings');
  });
  ipcMain.handle('auth:verifyOwner', async (event, password) => {
    try {
      return bcrypt.compareSync(String(password || ''), OWNER_PASSWORD_HASH);
    } catch (e) {
      console.error('[Main] Owner password verification failed:', e.message);
      return false;
    }
  });
  ipcMain.handle('db:saveSetting', async (event, { key, value }) => {
    const result = await dbAdapter.call('saveSetting', key, value);
    if (key === 'comPort' || key === 'baudRate' || key === 'scaleType' || key === 'scaleIp') {
      console.log(`[Main] Scale setting '${key}' changed to '${value}'. Restarting reader...`);
      if (global.restartSerialReader) {
        global.restartSerialReader();
      }
    }
    if (key === 'rfid_com_port' || key === 'rfid_baud_rate' || key === 'rfidComPort' || key === 'rfidBaudRate') {
      console.log(`[Main] RFID setting '${key}' changed to '${value}'. Restarting RFID reader...`);
      if (global.restartRfidReader) {
        global.restartRfidReader();
      }
    }
    return result;
  });
  ipcMain.handle('db:getDebitors', async () => {
    return dbAdapter.call('getDebitors');
  });
  ipcMain.handle('db:getMaterials', async () => {
    return dbAdapter.call('getMaterials');
  });
  ipcMain.handle('db:getDestinations', async () => {
    return dbAdapter.call('getDestinations');
  });
  ipcMain.handle('db:getTransporters', async () => {
    return dbAdapter.call('getTransporters');
  });
  ipcMain.handle('db:getContractors', async () => {
    return dbAdapter.call('getContractors');
  });
  ipcMain.handle('db:getContractorMaterials', async () => {
    return dbAdapter.call('getContractorMaterials');
  });
  ipcMain.handle('db:getSources', async () => {
    return dbAdapter.call('getSources');
  });
  ipcMain.handle('db:getVehicleTares', async () => {
    return dbAdapter.call('getVehicleTares');
  });
  ipcMain.handle('db:getRfidCards', async () => {
    return dbAdapter.call('getRfidCards');
  });
  ipcMain.handle('db:saveRfidCard', async (event, payload) => {
    return dbAdapter.call('saveRfidCard', payload);
  });
  ipcMain.handle('db:deleteRfidCard', async (event, id) => {
    return dbAdapter.call('deleteRfidCard', id);
  });
  ipcMain.handle('db:getRfidCardByNumber', async (event, cardNumber) => {
    return dbAdapter.call('getRfidCardByNumber', cardNumber);
  });
  ipcMain.handle('db:getVehicleTareByNumber', async (event, vehicleNo) => {
    return dbAdapter.call('getVehicleTareByNumber', vehicleNo);
  });
  ipcMain.handle('db:saveVehicleTare', async (event, data) => {
    return dbAdapter.call('saveVehicleTare', data);
  });
  ipcMain.handle('db:deleteVehicleTare', async (event, id) => {
    return dbAdapter.call('deleteVehicleTare', id);
  });

  // ---- LAN Network Settings Handlers ----
  ipcMain.handle('network:getConfig', async () => {
    const config = dbAdapter.getNetworkConfig();
    const localIps = networkServer.getLocalIpAddresses();
    const serverRunning = networkServer.isServerRunning();
    return { ...config, localIps, serverRunning };
  });

  ipcMain.handle('network:saveConfig', async (event, newConfig) => {
    const saved = dbAdapter.saveNetworkConfig(newConfig);
    if (saved.mode === 'HOST') {
      try {
        await networkServer.startServer(saved.hostPort);
      } catch (e) {
        console.error('[Main] Failed to start LAN API server:', e);
      }
    } else {
      await networkServer.stopServer();
    }
    return saved;
  });

  ipcMain.handle('network:testConnection', async (event, { hostIp, hostPort }) => {
    return dbAdapter.testHostConnection(hostIp, hostPort);
  });

  ipcMain.handle('db:peekNextDcNumber', async (event, payload = {}) => {
    const { type, prefix, module: mod } = payload;
    return dbAdapter.call('peekNextDcNumber', type, prefix, mod);
  });

  ipcMain.handle('db:getNextDcSequence', async (event, payload = {}) => {
    const { type, prefix, module: mod } = payload;
    return dbAdapter.call('peekNextDcNumber', type, prefix, mod);
  });

  ipcMain.handle('db:getAndAssignDc', async (event, payload = {}) => {
    const { type, prefix, module: mod } = payload;
    return dbAdapter.call('getAndAssignDc', type, prefix, mod);
  });

  ipcMain.handle('db:setDcSequence', async (event, payload = {}) => {
    const { type, prefix, module: mod, startingNumber } = payload;
    return dbAdapter.call('setDcSequence', type, prefix, mod, startingNumber);
  });

  ipcMain.handle('db:syncMasterData', async () => {
    const { syncMasterData } = require('./services/syncService');
    return syncMasterData();
  });
  ipcMain.handle('db:resetSyncStatus', async () => {
    const result = db.resetSyncStatus();
    runSyncCycle().catch(() => {});
    return result;
  });
  ipcMain.handle('db:get-sync-queue-summary', async () => {
    return db.getSyncQueueSummary ? db.getSyncQueueSummary() : { pending: 0, completed: 0, failed: 0, rejected: 0, total: 0 };
  });
  ipcMain.handle('db:get-failed-sync-queue', async (event, limit) => {
    return db.getFailedSyncQueue ? db.getFailedSyncQueue(limit) : [];
  });
  ipcMain.handle('db:retry-sync-queue-item', async (event, id) => {
    const result = db.retrySyncQueueItem ? db.retrySyncQueueItem(id) : { success: false, error: 'Unavailable' };
    if (result && result.success) {
      runSyncCycle().catch(() => {});
    }
    return result;
  });
  ipcMain.handle('db:retry-all-failed-sync-queue', async () => {
    const result = db.retryAllFailedSyncQueue ? db.retryAllFailedSyncQueue() : { success: false, error: 'Unavailable' };
    if (result && result.success) {
      runSyncCycle().catch(() => {});
    }
    return result;
  });
  // clearTable/clearPreTare block this process for seconds (DELETE + VACUUM +
  // full file write). The browser process also presents the renderer's frames,
  // so starting the work the instant the IPC lands can swallow the "Clearing,
  // please wait..." frame the renderer just produced and leave the window
  // looking frozen. One tick of breathing room lets that frame go out first.
  const yieldToCompositor = () => new Promise(resolve => setTimeout(resolve, 32));

  ipcMain.handle('db:clearTable', async (event, tableName) => {
    await yieldToCompositor();
    return db.clearTable(tableName);
  });
  ipcMain.handle('db:clearPreTare', async (event, { bouldersDelete, salesDelete }) => {
    await yieldToCompositor();
    return db.clearPreTare(bouldersDelete, salesDelete);
  });
  ipcMain.handle('db:purge-old-records', async (event, payload) => {
    await yieldToCompositor();
    return db.purgeOldRecords(payload || {});
  });
  ipcMain.handle('db:get-cleanup-config', async () => {
    return db.getCleanupConfig();
  });
  ipcMain.handle('db:set-cleanup-config', async (event, payload) => {
    return db.setCleanupConfig(payload || {});
  });
  ipcMain.handle('db:get-cleanup-status', async () => {
    return db.getCleanupStatus();
  });
  ipcMain.handle('serial:list-ports', async () => {
    try {
      const { SerialPort } = require('serialport');
      const ports = await SerialPort.list();
      return ports.map(p => p.path);
    } catch (e) {
      console.error('[SerialPort] Error listing ports:', e);
      return [];
    }
  });

  // Printer IPC Handlers
  ipcMain.handle('printer:get-list', async () => {
    const wins = BrowserWindow.getAllWindows();
    const activeWin = wins.length > 0 ? wins[0] : null;
    return printerService.getAvailablePrinters(activeWin);
  });
  ipcMain.handle('printer:print-raw', async (event, payload) => {
    const printerName = typeof payload === 'string' ? payload : (payload && payload.printerName);
    const rawText = typeof payload === 'object' ? payload.rawText : payload;
    return printerService.printRawText(printerName, rawText);
  });
  ipcMain.handle('printer:print-html', async (event, payload) => {
    const { printerName, htmlContent, options } = payload || {};
    return printerService.printSilentHtml(printerName, htmlContent, options);
  });

  // nChat Alert & Health Monitor Handlers
  ipcMain.handle('nchat:send-test', async (event, targetNumber) => {
    return sendTestAlert(targetNumber);
  });
  ipcMain.handle('nchat:get-config', async () => {
    return getAlertConfig();
  });
  ipcMain.handle('app:report-error', async (event, errStr) => {
    reportApplicationError(errStr);
    return { ok: true };
  });
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f1720',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // renderer cannot touch Node directly (secure)
      nodeIntegration: false,  // no require() in the renderer
    },
  });

  mainWindow = win;

  win.maximize();

  // Handle renderer crash / out-of-memory after long multi-day continuous runtime
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process gone (crash/OOM):', details.reason);
    reportApplicationError(`Renderer process gone: ${details.reason}`);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      console.log('[Main] Reloading application window to recover from renderer crash...');
      win.reload();
    }
  });

  win.on('unresponsive', () => {
    console.error('[Main] Window became unresponsive!');
    reportApplicationError('Window became unresponsive');
  });

  // Dynamic scale reader setup
  let activeReader = null;
  let restartTimeout = null;
  let globalLatestLiveWeight = '0';

  const startReader = () => {
    if (restartTimeout) {
      clearTimeout(restartTimeout);
    }

    // Debounce restarts by 250ms to allow database batches to finish saving
    // and prevent concurrent port access conflicts
    restartTimeout = setTimeout(() => {
      const runNewReader = () => {
        const settings = db.getSettings ? db.getSettings() : {};
        const scaleType = settings.scaleType || 'serial'; // 'serial' | 'network'
        const comPort = settings.comPort || 'COM7';
        const baudRate = Number(settings.baudRate) || 9600;
        const scaleIp = settings.scaleIp || '192.168.0.50';

        if (scaleType === 'network') {
          let url = (scaleIp || '192.168.0.50').trim();
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `http://${url}`;
          }
          try {
            const parsedUrl = new URL(url);
            if (!parsedUrl.pathname || parsedUrl.pathname === '/' || parsedUrl.pathname === '/raw') {
              parsedUrl.pathname = '/weight';
              url = parsedUrl.toString();
            }
          } catch (_) {
            if (!url.includes('/', 8)) {
              url = `${url}/weight`;
            }
          }
          console.log(`[Main] Starting Network IP scale reader on ${url}...`);
          activeReader = new NetronReader(url);
        } else {
          console.log(`[Main] Starting SerialPortReader on ${comPort} (${baudRate} baud)...`);
          const SerialPortReader = require('./socket/SerialPortReader');
          activeReader = new SerialPortReader(comPort, baudRate);
        }

        activeReader.on('data', (data) => {
          if (data && data.value) {
            const numeric = String(data.value).replace(/[^0-9.-]/g, '');
            if (numeric) {
              globalLatestLiveWeight = numeric;
            }
          }
          if (!win.isDestroyed()) {
            win.webContents.send('netron:data', data);
          }
        });
        activeReader.start();
      };

      if (activeReader) {
        const oldReader = activeReader;
        activeReader = null;
        oldReader.stop(() => {
          setTimeout(() => {
            runNewReader();
          }, 300);
        });
      } else {
        runNewReader();
      }
    }, 250);
  };

  global.restartSerialReader = startReader;
  startReader();

  // ---- RFID Serial Reader Setup ----
  let activeRfidReader = null;
  const startRfidReader = () => {
    try {
      const settings = db.getSettings ? db.getSettings() : {};
      const rfidPortSetting = settings.rfid_com_port || settings.rfidComPort || 'COM1';
      const rfidBaudSetting = settings.rfid_baud_rate || settings.rfidBaudRate || '9600';
      const RfidSerialReader = require('./socket/RfidSerialReader');

      if (activeRfidReader) {
        activeRfidReader.stop();
        activeRfidReader = null;
      }

      console.log(`[Main] Starting RfidSerialReader on ${rfidPortSetting} (${rfidBaudSetting} baud)...`);
      activeRfidReader = new RfidSerialReader(rfidPortSetting, rfidBaudSetting);
      activeRfidReader.on('card', async (cardData) => {
        if (!win || win.isDestroyed()) return;
        win.webContents.send('rfid-card-data', cardData);

        const cardNo = cardData.cardNo || cardData.epc;
        if (!cardNo) return;

        try {
          const rfidCard = await dbAdapter.call('getRfidCardByNumber', cardNo);
          if (rfidCard && rfidCard.vehicle) {
            const vehicleNo = rfidCard.vehicle;
            const tareRecord = await dbAdapter.call('getVehicleTareByNumber', vehicleNo);
            const tareWeight = tareRecord ? Number(tareRecord.weight || 0) : 0;
            const grossWeight = Number(globalLatestLiveWeight) || 0;
            const nettWeight = Math.abs(grossWeight - tareWeight);

            console.log(`[AutoWeigh] RFID Card ${cardNo} mapped to Vehicle ${vehicleNo} | Tare: ${tareWeight} kg | Gross: ${grossWeight} kg | Nett: ${nettWeight} kg`);

            win.webContents.send('rfid-auto-mapped', {
              cardNo,
              vehicleNo,
              material: rfidCard.material || 'BOULDERS',
              contractor: rfidCard.contractor || '',
              tareWeight,
              grossWeight
            });

            // Automatically save Boulder transaction into local SQLite DB & queue for server upload without manual save click
            const txData = {
              date_time: new Date().toLocaleString(),
              vehicle_no: vehicleNo,
              contractor: rfidCard.contractor || 'N/A',
              party: rfidCard.contractor || 'N/A',
              material: rfidCard.material || 'BOULDERS',
              gross: grossWeight,
              tare: tareWeight,
              net: nettWeight,
              operator: 'RFID Auto-Weigh',
              card: cardNo
            };

            const savedTx = await dbAdapter.call('addBoulderTransaction', txData, null);
            console.log(`[AutoWeigh] Automatically saved Boulder transaction ${savedTx.dc_num} (UUID: ${savedTx.uuid}) for ${vehicleNo}. Pushed to sync queue for server upload.`);

            win.webContents.send('rfid-auto-weigh-success', {
              tx: savedTx,
              message: `Auto-weighed vehicle ${vehicleNo} (${nettWeight} kg Net). Saved DC ${savedTx.dc_num} and syncing to server!`
            });
          }
        } catch (e) {
          console.error('[AutoWeigh] Error in RFID auto-weighing:', e.message);
        }
      });
      activeRfidReader.start();
    } catch (e) {
      console.error('[Main] Error starting RfidSerialReader:', e);
    }
  };

  global.restartRfidReader = startRfidReader;
  startRfidReader();

  win.on('closed', () => {
    mainWindow = null;
    if (restartTimeout) {
      clearTimeout(restartTimeout);
    }
    if (activeReader) {
      activeReader.stop();
    }
    if (activeRfidReader) {
      activeRfidReader.stop();
      activeRfidReader = null;
    }
    global.restartSerialReader = null;
    global.restartRfidReader = null;
    try {
      db.saveToDiskSync();
    } catch (e) {
      console.error('[Main] Error saving database synchronously on window close:', e);
    }
  });

  // In dev, load the Vite dev server; in prod, load the built files.
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Wire up all camera IPC handlers, bound to this window.
  registerCameraHandlers(win, getFfmpegPath);

  // Start local Python AI Material Detection Engine
  startAiService(win);
}

// Single Instance Lock: Prevents duplicate instances running in Task Manager
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Another instance of Crusher Weighbridge is already running. Quitting duplicate instance...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Main] Second instance launched. Bringing existing window to focus...');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Without this Windows groups the taskbar button under "Electron" and shows
    // the default Electron icon instead of the installed shortcut's icon.
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.norissolutions.weighbridge');
    }
    nativeTheme.themeSource = 'light';
    // Disable default menu bar (File, Edit, etc.)
    Menu.setApplicationMenu(null);

    // Carry data over from the pre-rename folder, before anything reads the disk.
    try {
      migrateLegacyUserData();
    } catch (e) {
      console.error('[Main] User data migration error:', e);
    }

    // Initialize Database schemas & seed data
    try {
      await db.init();
    } catch (e) {
      console.error('[Main] Database init error:', e);
    }

    // Register DB IPC handlers
    try {
      registerDatabaseHandlers();
    } catch (e) {
      console.error('[Main] Register DB handlers error:', e);
    }

    // Start LAN Network API Server if configured in HOST mode
    try {
      const netConfig = dbAdapter.getNetworkConfig();
      if (netConfig.mode === 'HOST') {
        networkServer.startServer(netConfig.hostPort).catch(err => {
          console.error('[Main] Failed to start LAN Network Server on boot:', err);
        });
        startSyncService();
      }
    } catch (e) {
      console.error('[Main] Network config / Sync start error:', e);
    }

    // Start Automated Daily Retention / Cleanup Service
    try {
      autoCleanupService.start();
    } catch (e) {
      console.error('[Main] Auto cleanup service error:', e);
    }

    // Start Issue Detection & Health Monitoring Service
    try {
      startHealthMonitorService();
    } catch (e) {
      console.error('[Main] Health monitor service error:', e);
    }

    createWindow();
  });
}

app.on('window-all-closed', () => {
  stopHealthMonitorService();
  stopSyncService();
  stopAiService();
  autoCleanupService.stop();
  networkServer.stopServer().catch(() => {});
  try {
    db.saveToDiskSync();
  } catch (e) {
    console.error('[Main] Error saving database synchronously on app quit:', e);
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
