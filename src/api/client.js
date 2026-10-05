// SQLite-backed API client routing queries through secure Electron IPC bridge

export const api = {
  login: async (username, password) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const user = await window.electronAPI.login({ username, password });
      if (!user) throw new Error('Invalid username or password');
      return { token: 'mock-jwt-token-from-sqlite', user };
    }
    // Offline/Browser fallback
    const cleanUser = String(username || '').trim().toLowerCase();
    if (cleanUser === 'operator') {
      if (password !== 'operator123') throw new Error('Invalid username or password');
      const user = { username: 'operator', full_name: 'Weighbridge Operator', role: 'operator' };
      return { token: 'mock-jwt-token-for-operator', user };
    }
    if (cleanUser === 'admin') {
      if (password !== 'admin.123$') throw new Error('Invalid username or password');
      const user = { username: 'admin', full_name: 'Administrator', role: 'admin' };
      return { token: 'mock-jwt-token-for-admin', user };
    }
    throw new Error('Invalid username or password');
  },

  logout: async () => {
    return true;
  },

  cameras: async () => {
    if (window.electronAPI) {
      const cams = await window.electronAPI.getCameras();
      return cams.map(c => {
        const auth = c.username ? `${encodeURIComponent(c.username)}:${encodeURIComponent(c.password || '')}@` : '';
        return {
          ...c,
          rtsp_url: `rtsp://${auth}${c.ip_address}:${c.rtsp_port}${c.stream_path}`
        };
      });
    }
    return [];
  },

  // Probes an RTSP URL without saving anything. Used by the Add Camera form to
  // confirm the brand-generated stream path actually works.
  testCamera: async (url) => {
    if (window.electronAPI && window.electronAPI.testCamera) {
      return window.electronAPI.testCamera({ url });
    }
    return { ok: false, code: 'unavailable', message: 'Connection testing is only available in the desktop app.' };
  },

  addCamera: async (data) => {
    if (window.electronAPI) {
      return window.electronAPI.addCamera(data);
    }
    return data;
  },

  updateCamera: async (data) => {
    if (window.electronAPI) {
      return window.electronAPI.updateCamera(data);
    }
    return data;
  },

  deleteCamera: async (id) => {
    if (window.electronAPI) {
      return window.electronAPI.deleteCamera(id);
    }
    return true;
  },

  status: async () => {
    if (window.electronAPI) {
      const cams = await window.electronAPI.getCameras();
      return cams.map(c => ({
        camera_id: c.id,
        state: c.status || 'unknown',
        last_checked: c.last_checked || new Date().toISOString()
      }));
    }
    return [];
  },

  reportStatus: async (camera_id, state) => {
    return true;
  },

  settings: async () => {
    if (window.electronAPI) {
      return window.electronAPI.getSettings();
    }
    return {};
  },

  saveSetting: async (key, value) => {
    if (window.electronAPI) {
      return window.electronAPI.saveSetting({ key, value });
    }
    return true;
  },

  // Pass { withImages: true } only when the caller actually renders the
  // snapshots. Hydrating them reads every photo off the disk and base64-encodes
  // it on the main process, which blocks the whole window while it runs.
  transactions: async (options) => {
    if (window.electronAPI) {
      return window.electronAPI.getTransactions(options);
    }
    return [];
  },

  addTransaction: async (txData, base64Image = null) => {
    if (window.electronAPI && window.electronAPI.addTransaction) {
      return window.electronAPI.addTransaction({ tx: txData, base64Image });
    }
    const recordUuid = txData.uuid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now() + '-' + Math.floor(Math.random() * 1000000));
    txData.uuid = recordUuid;
    try {
      fetch('https://crusher.norissolutions.com/backend/api/weighbridge/boulders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: txData.company_id || txData.companyId || 'CRUSHER-3080',
          companyId: txData.company_id || txData.companyId || 'CRUSHER-3080',
          uuid: recordUuid,
          dc_num: txData.dc_num || txData.token || 'N/A',
          date_time: txData.date_time || new Date().toLocaleString(),
          vehicle_no: txData.vehicle_no || txData.vehicle || '',
          vehicleNo: txData.vehicle_no || txData.vehicle || '',
          party: txData.party || txData.contractor || 'N/A',
          contractor: txData.contractor || txData.party || 'N/A',
          quarry: txData.quarry || 'Noris',
          product: txData.product || txData.material || 'BOULDERS',
          material: txData.material || txData.product || 'BOULDERS',
          gross: Number(txData.gross || 0),
          tare: Number(txData.tare || 0),
          net: Number(txData.net || 0),
          driver: txData.driver || 'N/A',
          transporter: txData.transporter || 'N/A',
          destination: txData.destination || 'YARD',
          operator: txData.operator || 'Admin',
          image_url: 'snapshot.jpg',
          image_base64: base64Image || txData.base64Image || ''
        })
      }).catch(err => console.error('[API Client] Direct push to transaction server failed:', err));
    } catch (_) {}
    return txData;
  },

  boulders: async (options) => {
    if (window.electronAPI && window.electronAPI.getBoulders) {
      return window.electronAPI.getBoulders(options);
    }
    return [];
  },

  getBoulders: async (options) => {
    if (window.electronAPI && window.electronAPI.getBoulders) {
      return window.electronAPI.getBoulders(options);
    }
    return [];
  },

  addBoulder: async (txData, base64Image) => {
    if (window.electronAPI && window.electronAPI.addBoulder) {
      return window.electronAPI.addBoulder({ tx: txData, base64Image });
    }
    const recordUuid = txData.uuid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now() + '-' + Math.floor(Math.random() * 1000000));
    txData.uuid = recordUuid;
    try {
      fetch('https://crusher.norissolutions.com/backend/api/weighbridge/boulders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: txData.company_id || txData.companyId || 'CRUSHER-3080',
          companyId: txData.company_id || txData.companyId || 'CRUSHER-3080',
          uuid: recordUuid,
          dc_num: txData.dc_num || txData.token || 'N/A',
          date_time: txData.date_time || new Date().toLocaleString(),
          vehicle_no: txData.vehicle_no || txData.vehicle || '',
          vehicleNo: txData.vehicle_no || txData.vehicle || '',
          contractor: txData.contractor || txData.party || 'N/A',
          party: txData.party || txData.contractor || 'N/A',
          quarry: txData.quarry || 'Noris',
          material: txData.material || 'BOULDERS',
          gross: Number(txData.gross || 0),
          tare: Number(txData.tare || 0),
          net: Number(txData.net || 0),
          driver: txData.driver || 'N/A',
          transporter: txData.transporter || 'N/A',
          destination: txData.destination || 'YARD',
          operator: txData.operator || 'Admin',
          image_url: 'snapshot.jpg',
          image_base64: base64Image || txData.base64Image || ''
        })
      }).catch(err => console.error('[API Client] Direct push to boulders server failed:', err));
    } catch (_) {}
    return txData;
  },

  salesUnits: async (options) => {
    if (window.electronAPI && window.electronAPI.getSalesUnits) {
      return window.electronAPI.getSalesUnits(options);
    }
    return [];
  },

  addSalesUnits: async (txData, base64Image) => {
    if (window.electronAPI && window.electronAPI.addSalesUnits) {
      return window.electronAPI.addSalesUnits({ tx: txData, base64Image });
    }
    const recordUuid = txData.uuid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now() + '-' + Math.floor(Math.random() * 1000000));
    txData.uuid = recordUuid;
    try {
      fetch('https://crusher.norissolutions.com/backend/api/weighbridge/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: txData.company_id || txData.companyId || 'CRUSHER-3080',
          companyId: txData.company_id || txData.companyId || 'CRUSHER-3080',
          uuid: recordUuid,
          dc_num: txData.dc_num || txData.dcNum || 'N/A',
          dcNum: txData.dc_num || txData.dcNum || 'N/A',
          dc_no: txData.dc_num || txData.dcNum || 'N/A',
          dcNo: txData.dc_num || txData.dcNum || 'N/A',
          dc: txData.dc_num || txData.dcNum || 'N/A',
          token: txData.dc_num || txData.dcNum || 'N/A',
          your_dc: (txData.your_dc && String(txData.your_dc).trim()) ? String(txData.your_dc).trim() : ((txData.yourDc && String(txData.yourDc).trim()) ? String(txData.yourDc).trim() : (txData.dc_num || txData.dcNum || '')),
          yourDc: (txData.your_dc && String(txData.your_dc).trim()) ? String(txData.your_dc).trim() : ((txData.yourDc && String(txData.yourDc).trim()) ? String(txData.yourDc).trim() : (txData.dc_num || txData.dcNum || '')),
          date_time: txData.date_time || new Date().toLocaleString(),
          vehicle_no: txData.vehicle_no || txData.vehicle || '',
          vehicleNo: txData.vehicle_no || txData.vehicle || '',
          party: txData.party || 'N/A',
          material: txData.material || 'N/A',
          unit_type: txData.unit_type || txData.unitType || 'units',
          units_val: Number(txData.units_val || txData.unitsVal || 0),
          destination: txData.destination || 'YARD',
          source: txData.source || 'CRUSHER',
          transporter: txData.transporter || 'N/A',
          driver: txData.driver || 'N/A',
          phone: txData.phone || 'N/A',
          stationary: txData.stationary || 'N/A',
          royalty_type: txData.royalty_type || txData.royaltyType || 'None',
          royaltyType: txData.royalty_type || txData.royaltyType || 'None',
          royalty_amount: Number(txData.royalty_amount || txData.royaltyAmount || 0),
          royaltyAmount: Number(txData.royalty_amount || txData.royaltyAmount || 0),
          po_number: txData.po_number || txData.poNumber || 'N/A',
          po_date: txData.po_date || txData.poDate || 'N/A',
          payment: txData.payment || 'Credit',
          gross: Number(txData.gross || 0),
          tare: Number(txData.tare || 0),
          net: Number(txData.net || 0),
          rate: Number(txData.rate || 0),
          amount: Number(txData.amount || 0),
          bill_type: txData.bill_type || txData.billType || 'NON-GST',
          transport: Number(txData.transport || 0),
          party_transport_rate: Number(txData.party_transport_rate || txData.partyTransportRate || txData.destination_rate || txData.destinationRate || 0),
          party_transport_amount: Number(txData.party_transport_amount || txData.partyTransportAmount || txData.destination_amount || txData.destinationAmount || 0),
          transporter_rate: Number(txData.transporter_rate || txData.transporterRate || txData.trate || 0),
          transporter_amount: Number(txData.transporter_amount || txData.transporterAmount || txData.tamount || 0),
          destination_rate: Number(txData.destination_rate || txData.destinationRate || txData.party_transport_rate || txData.partyTransportRate || 0),
          destination_amount: Number(txData.destination_amount || txData.destinationAmount || txData.party_transport_amount || txData.partyTransportAmount || 0),
          trate: Number(txData.trate || txData.transporter_rate || txData.transporterRate || 0),
          tamount: Number(txData.tamount || txData.transporter_amount || txData.transporterAmount || 0),
          discount: Number(txData.discount || 0),
          grand_total: Number(txData.grand_total || txData.grandTotal || txData.amount || 0),
          cash_amount: String(txData.payment || '').trim().toLowerCase() === 'pending' ? 0 : Number(txData.cash_amount || txData.cashAmount || 0),
          upi_amount: String(txData.payment || '').trim().toLowerCase() === 'pending' ? 0 : Number(txData.upi_amount || txData.upiAmount || 0),
          credit_amount: String(txData.payment || '').trim().toLowerCase() === 'pending' ? 0 : Number(txData.credit_amount || txData.creditAmount || 0),
          operator: txData.operator || 'Admin',
          image_url: 'snapshot.jpg',
          image_base64: base64Image || txData.base64Image || ''
        })
      }).catch(err => console.error('[API Client] Direct push to sales server failed:', err));
    } catch (_) {}
    return txData;
  },

  yardWeighments: async (options) => {
    if (window.electronAPI && window.electronAPI.getYardWeighments) {
      return window.electronAPI.getYardWeighments(options);
    }
    return [];
  },

  addYardWeighment: async (txData, base64Image) => {
    if (window.electronAPI && window.electronAPI.addYardWeighment) {
      return window.electronAPI.addYardWeighment({ tx: txData, base64Image });
    }
    const recordUuid = txData.uuid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'uuid-' + Date.now() + '-' + Math.floor(Math.random() * 1000000));
    txData.uuid = recordUuid;
    try {
      fetch('https://crusher.norissolutions.com/backend/api/weighbridge/yard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: txData.company_id || txData.companyId || 'CRUSHER-3080',
          companyId: txData.company_id || txData.companyId || 'CRUSHER-3080',
          uuid: recordUuid,
          dc_num: txData.dc_num || txData.dcNum || 'N/A',
          date_time: txData.date_time || new Date().toLocaleString(),
          vehicle_no: txData.vehicle_no || txData.vehicle || '',
          vehicleNo: txData.vehicle_no || txData.vehicle || '',
          party: txData.party || 'YARD',
          material: txData.material || 'N/A',
          unit_type: txData.unit_type || txData.unitType || 'units',
          units_val: Number(txData.units_val || txData.unitsVal || 0),
          destination: txData.destination || 'YARD',
          source: txData.source || 'CRUSHER',
          transporter: txData.transporter || 'N/A',
          driver: txData.driver || 'N/A',
          phone: txData.phone || 'N/A',
          stationary: txData.stationary || 'N/A',
          po_number: txData.po_number || txData.poNumber || 'N/A',
          po_date: txData.po_date || txData.poDate || 'N/A',
          payment: txData.payment || 'Credit',
          gross: Number(txData.gross || 0),
          tare: Number(txData.tare || 0),
          net: Number(txData.net || 0),
          operator: txData.operator || 'Admin',
          image_url: 'snapshot.jpg',
          image_base64: base64Image || txData.base64Image || ''
        })
      }).catch(err => console.error('[API Client] Direct push to yard server failed:', err));
    } catch (_) {}
    return txData;
  },

  loadingSlips: async (options) => {
    if (window.electronAPI && window.electronAPI.getLoadingSlips) {
      return window.electronAPI.getLoadingSlips(options);
    }
    return [];
  },

  addLoadingSlip: async (txData, base64Image) => {
    if (window.electronAPI && window.electronAPI.addLoadingSlip) {
      return window.electronAPI.addLoadingSlip({ tx: txData, base64Image });
    }
    return txData;
  },

  firstWeighments: async (options) => {
    if (window.electronAPI && window.electronAPI.getFirstWeighments) {
      return window.electronAPI.getFirstWeighments(options);
    }
    return [];
  },

  addFirstWeighment: async (txData, base64Image) => {
    if (window.electronAPI && window.electronAPI.addFirstWeighment) {
      return window.electronAPI.addFirstWeighment({ tx: txData, base64Image });
    }
    return txData;
  },

  secondWeighments: async (options) => {
    if (window.electronAPI && window.electronAPI.getSecondWeighments) {
      return window.electronAPI.getSecondWeighments(options);
    }
    return [];
  },

  addSecondWeighment: async (txData, base64Image) => {
    if (window.electronAPI && window.electronAPI.addSecondWeighment) {
      return window.electronAPI.addSecondWeighment({ tx: txData, base64Image });
    }
    return txData;
  },

  getDebitors: async () => {
    if (window.electronAPI) {
      return window.electronAPI.getDebitors();
    }
    return [];
  },

  getMaterials: async () => {
    if (window.electronAPI) {
      return window.electronAPI.getMaterials();
    }
    return [];
  },

  getDestinations: async () => {
    if (window.electronAPI) {
      return window.electronAPI.getDestinations();
    }
    return [];
  },

  getTransporters: async () => {
    if (window.electronAPI) {
      return window.electronAPI.getTransporters();
    }
    return [];
  },

  getContractors: async () => {
    if (window.electronAPI) {
      return window.electronAPI.getContractors();
    }
    return [];
  },

  getContractorMaterials: async () => {
    if (window.electronAPI && window.electronAPI.getContractorMaterials) {
      return window.electronAPI.getContractorMaterials();
    }
    return [];
  },

  getSources: async () => {
    if (window.electronAPI && window.electronAPI.getSources) {
      return window.electronAPI.getSources();
    }
    return [];
  },

  getVehicleTares: async () => {
    if (window.electronAPI && window.electronAPI.getVehicleTares) {
      return window.electronAPI.getVehicleTares();
    }
    const cached = localStorage.getItem('noris_vehicle_tares');
    return cached ? JSON.parse(cached) : [];
  },

  saveVehicleTare: async (data) => {
    if (window.electronAPI && window.electronAPI.saveVehicleTare) {
      return window.electronAPI.saveVehicleTare(data);
    }
    return true;
  },

  deleteVehicleTare: async (id) => {
    if (window.electronAPI && window.electronAPI.deleteVehicleTare) {
      return window.electronAPI.deleteVehicleTare(id);
    }
    return true;
  },

  deleteVehicleTareByNumber: async (vehicleNo) => {
    if (window.electronAPI && window.electronAPI.deleteVehicleTareByNumber) {
      return window.electronAPI.deleteVehicleTareByNumber(vehicleNo);
    }
    return true;
  },

  syncMasterData: async () => {
    if (window.electronAPI) {
      return window.electronAPI.syncMasterData();
    }
    return { success: false, error: 'Desktop bridge not available' };
  },

  resetSyncStatus: async () => {
    if (window.electronAPI && window.electronAPI.resetSyncStatus) {
      return window.electronAPI.resetSyncStatus();
    }
    return true;
  },

  clearTable: async (tableName) => {
    if (window.electronAPI && window.electronAPI.clearTable) {
      return window.electronAPI.clearTable(tableName);
    }
    return { success: true, message: `Cleared table ${tableName}` };
  },

  clearPreTare: async (bouldersDelete, salesDelete) => {
    if (window.electronAPI && window.electronAPI.clearPreTare) {
      return window.electronAPI.clearPreTare({ bouldersDelete, salesDelete });
    }
    return { success: true, message: 'Cleared pre-tare' };
  },

  getNetworkConfig: async () => {
    if (window.electronAPI && window.electronAPI.getNetworkConfig) {
      return window.electronAPI.getNetworkConfig();
    }
    return { mode: 'HOST', hostIp: '127.0.0.1', hostPort: 5000 };
  },

  saveNetworkConfig: async (config) => {
    if (window.electronAPI && window.electronAPI.saveNetworkConfig) {
      return window.electronAPI.saveNetworkConfig(config);
    }
    return config;
  },

  testHostConnection: async (config) => {
    if (window.electronAPI && window.electronAPI.testHostConnection) {
      return window.electronAPI.testHostConnection(config);
    }
    return { success: false, error: 'Desktop API unavailable' };
  },

  peekNextDcNumber: async (type = 'NON-GST', prefix = 'DC-', module = 'sales') => {
    if (window.electronAPI && window.electronAPI.peekNextDcNumber) {
      return window.electronAPI.peekNextDcNumber({ type, prefix, module });
    }
    return 'DC-1';
  },

  getAndAssignDc: async (type = 'NON-GST', prefix = 'DC-', module = 'sales') => {
    if (window.electronAPI && window.electronAPI.getAndAssignDc) {
      return window.electronAPI.getAndAssignDc({ type, prefix, module });
    }
    return 'DC-1';
  },

  setDcSequence: async (type = 'NON-GST', prefix = 'DC-', module = 'sales', startingNumber = 1) => {
    if (window.electronAPI && window.electronAPI.setDcSequence) {
      return window.electronAPI.setDcSequence({ type, prefix, module, startingNumber });
    }
    return { success: true, dcNumber: `${prefix}${startingNumber}`, nextSeq: startingNumber };
  },

  getRfidCards: async () => {
    if (window.electronAPI && window.electronAPI.getRfidCards) {
      return window.electronAPI.getRfidCards();
    }
    return [];
  },

  saveRfidCard: async (data) => {
    if (window.electronAPI && window.electronAPI.saveRfidCard) {
      return window.electronAPI.saveRfidCard(data);
    }
    return false;
  },

  deleteRfidCard: async (id) => {
    if (window.electronAPI && window.electronAPI.deleteRfidCard) {
      return window.electronAPI.deleteRfidCard(id);
    }
    return false;
  },

  getRfidCardByNumber: async (cardNumber) => {
    if (window.electronAPI && window.electronAPI.getRfidCardByNumber) {
      return window.electronAPI.getRfidCardByNumber(cardNumber);
    }
    return null;
  },

  getVehicleTareByNumber: async (vehicleNo) => {
    if (window.electronAPI && window.electronAPI.getVehicleTareByNumber) {
      return window.electronAPI.getVehicleTareByNumber(vehicleNo);
    }
    return null;
  }
};
