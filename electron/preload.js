'use strict';
/**
 * preload.js — the SECURE BRIDGE.
 * ----------------------------------------------------------------------------
 * Runs before the renderer's web page loads, in a privileged context, but with
 * contextIsolation ON. We use contextBridge to expose a SMALL, explicit API to
 * the React app as `window.electronAPI`. React can only do what we allow here —
 * it can never call `require('net')` or spawn processes itself. This is the
 * recommended, secure Electron pattern.
 * ----------------------------------------------------------------------------
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- commands (renderer -> main) ----
  openCamera: (payload) => ipcRenderer.invoke('camera:open', payload),
  closeCamera: (payload) => ipcRenderer.invoke('camera:close', payload),
  pauseCamera: (payload) => ipcRenderer.invoke('camera:pause', payload),
  testCamera: (payload) => ipcRenderer.invoke('camera:test', payload),

  // ---- events (main -> renderer) ----
  onFrame: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('camera:frame', listener);
    return () => ipcRenderer.removeListener('camera:frame', listener);
  },
  onSegment: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('camera:segment', listener);
    return () => ipcRenderer.removeListener('camera:segment', listener);
  },
  onLog: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('camera:log', listener);
    return () => ipcRenderer.removeListener('camera:log', listener);
  },
  onNetronData: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('netron:data', listener);
    return () => ipcRenderer.removeListener('netron:data', listener);
  },
  onMasterDataSynced: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('master-data:synced', listener);
    return () => ipcRenderer.removeListener('master-data:synced', listener);
  },
  onAiMaterialDetected: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('ai:material-detected', listener);
    return () => ipcRenderer.removeListener('ai:material-detected', listener);
  },

  // ---- database operations (renderer -> main) ----
  login: (payload) => ipcRenderer.invoke('db:login', payload),
  getCameras: () => ipcRenderer.invoke('db:getCameras'),
  addCamera: (payload) => ipcRenderer.invoke('db:addCamera', payload),
  updateCamera: (payload) => ipcRenderer.invoke('db:updateCamera', payload),
  deleteCamera: (payload) => ipcRenderer.invoke('db:deleteCamera', payload),
  getTransactions: () => ipcRenderer.invoke('db:getTransactions'),
  addTransaction: (payload) => ipcRenderer.invoke('db:addTransaction', payload),
  getBoulders: () => ipcRenderer.invoke('db:getBoulders'),
  addBoulder: (payload) => ipcRenderer.invoke('db:addBoulder', payload),
  getSalesUnits: () => ipcRenderer.invoke('db:getSalesUnits'),
  addSalesUnits: (payload) => ipcRenderer.invoke('db:addSalesUnits', payload),
  getYardWeighments: () => ipcRenderer.invoke('db:getYardWeighments'),
  addYardWeighment: (payload) => ipcRenderer.invoke('db:addYardWeighment', payload),
  getLoadingSlips: () => ipcRenderer.invoke('db:getLoadingSlips'),
  addLoadingSlip: (payload) => ipcRenderer.invoke('db:addLoadingSlip', payload),
  getFirstWeighments: () => ipcRenderer.invoke('db:getFirstWeighments'),
  addFirstWeighment: (payload) => ipcRenderer.invoke('db:addFirstWeighment', payload),
  getSecondWeighments: () => ipcRenderer.invoke('db:getSecondWeighments'),
  addSecondWeighment: (payload) => ipcRenderer.invoke('db:addSecondWeighment', payload),
  getSettings: () => ipcRenderer.invoke('db:getSettings'),
  verifyOwnerPassword: (password) => ipcRenderer.invoke('auth:verifyOwner', password),
  saveSetting: (payload) => ipcRenderer.invoke('db:saveSetting', payload),
  getDebitors: () => ipcRenderer.invoke('db:getDebitors'),
  getMaterials: () => ipcRenderer.invoke('db:getMaterials'),
  getDestinations: () => ipcRenderer.invoke('db:getDestinations'),
  getTransporters: () => ipcRenderer.invoke('db:getTransporters'),
  getContractors: () => ipcRenderer.invoke('db:getContractors'),
  getContractorMaterials: () => ipcRenderer.invoke('db:getContractorMaterials'),
  getSources: () => ipcRenderer.invoke('db:getSources'),
  getVehicleTares: () => ipcRenderer.invoke('db:getVehicleTares'),
  saveVehicleTare: (payload) => ipcRenderer.invoke('db:saveVehicleTare', payload),
  deleteVehicleTare: (id) => ipcRenderer.invoke('db:deleteVehicleTare', id),
  deleteVehicleTareByNumber: (vehicleNo) => ipcRenderer.invoke('db:deleteVehicleTareByNumber', vehicleNo),
  getRfidCards: () => ipcRenderer.invoke('db:getRfidCards'),
  saveRfidCard: (payload) => ipcRenderer.invoke('db:saveRfidCard', payload),
  deleteRfidCard: (id) => ipcRenderer.invoke('db:deleteRfidCard', id),
  getRfidCardByNumber: (cardNumber) => ipcRenderer.invoke('db:getRfidCardByNumber', cardNumber),
  getVehicleTareByNumber: (vehicleNo) => ipcRenderer.invoke('db:getVehicleTareByNumber', vehicleNo),
  syncMasterData: () => ipcRenderer.invoke('db:syncMasterData'),
  resetSyncStatus: () => ipcRenderer.invoke('db:resetSyncStatus'),
  getSyncQueueSummary: () => ipcRenderer.invoke('db:get-sync-queue-summary'),
  getFailedSyncQueue: (limit) => ipcRenderer.invoke('db:get-failed-sync-queue', limit),
  retrySyncQueueItem: (id) => ipcRenderer.invoke('db:retry-sync-queue-item', id),
  retryAllFailedSyncQueue: () => ipcRenderer.invoke('db:retry-all-failed-sync-queue'),
  clearTable: (tableName) => ipcRenderer.invoke('db:clearTable', tableName),
  clearPreTare: (payload) => ipcRenderer.invoke('db:clearPreTare', payload),
  purgeOldRecords: (payload) => ipcRenderer.invoke('db:purge-old-records', payload),
  getCleanupConfig: () => ipcRenderer.invoke('db:get-cleanup-config'),
  setCleanupConfig: (payload) => ipcRenderer.invoke('db:set-cleanup-config', payload),
  getCleanupStatus: () => ipcRenderer.invoke('db:get-cleanup-status'),
  listSerialPorts: () => ipcRenderer.invoke('serial:list-ports'),

  // ---- DC Sequence operations (Host Centralized) ----
  peekNextDcNumber: (payload) => ipcRenderer.invoke('db:peekNextDcNumber', payload),
  getNextDcSequence: (payload) => ipcRenderer.invoke('db:getNextDcSequence', payload),
  getAndAssignDc: (payload) => ipcRenderer.invoke('db:getAndAssignDc', payload),
  setDcSequence: (payload) => ipcRenderer.invoke('db:setDcSequence', payload),

  // ---- LAN Network configuration ----
  getNetworkConfig: () => ipcRenderer.invoke('network:getConfig'),
  saveNetworkConfig: (payload) => ipcRenderer.invoke('network:saveConfig', payload),
  testHostConnection: (payload) => ipcRenderer.invoke('network:testConnection', payload),

  // ---- printer operations ----
  getPrinters: () => ipcRenderer.invoke('printer:get-list'),
  printRaw: (payload) => ipcRenderer.invoke('printer:print-raw', payload),
  printHtml: (payload) => ipcRenderer.invoke('printer:print-html', payload),

  reportAppError: (errStr) => ipcRenderer.invoke('app:report-error', errStr),

  // ---- RFID Reader operations ----
  onRfidData: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('rfid-card-data', listener);
    return () => ipcRenderer.removeListener('rfid-card-data', listener);
  },
  onRfidAutoMapped: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('rfid-auto-mapped', listener);
    return () => ipcRenderer.removeListener('rfid-auto-mapped', listener);
  },
  onRfidAutoWeighSuccess: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('rfid-auto-weigh-success', listener);
    return () => ipcRenderer.removeListener('rfid-auto-weigh-success', listener);
  },

  // allow the UI to detach listeners when a component unmounts
  removeAll: () => {
    ipcRenderer.removeAllListeners('camera:frame');
    ipcRenderer.removeAllListeners('camera:segment');
    ipcRenderer.removeAllListeners('camera:log');
    ipcRenderer.removeAllListeners('netron:data');
    ipcRenderer.removeAllListeners('rfid-card-data');
    ipcRenderer.removeAllListeners('master-data:synced');
  },
});
