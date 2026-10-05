import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import Loader from '../components/Loader.jsx';
import CameraManagement from './CameraManagement.jsx';
import {
  PRINTER_TEMPLATES, getSelectedTemplate, setSelectedTemplate,
  getDcPrintTemplate, setDcPrintTemplate, getGatePassTemplate, setGatePassTemplate,
  generateSlipHtml, printTicket, getPrinterConfig, setPrinterConfig, getPaperForTemplate
} from '../utils/printHelper.js';
import { RPT_TEMPLATE_CATALOGUE } from '../utils/rptSlipTemplates.js';
import { getCompanyDetails, saveCompanyDetails } from '../utils/classicReportPrinter.js';
import {
  RPT_HEADER_MODES, getRptHeaderMode, setRptHeaderMode,
  getRptHeaderGap, setRptHeaderGap, getCompanyHeaderLines
} from '../utils/rptPageHeader.js';
import { useScale } from '../context/ScaleContext.jsx';
import { VEHICLE_OPTION_MODES, getVehicleOptionMode, setVehicleOptionMode } from '../utils/vehicleFilterUtil.js';


// Display names for the slip templates. The `id` is the value stored in
// localStorage and handed to generateSlipHtml/printTicket — it must stay
// exactly as it is. Only the wording shown to the operator lives here, so the
// picker reads as plain language instead of "IMAGE-4".
const TEMPLATE_CATALOGUE = [
  // The Crystal Reports designs come first — these are the layouts the site
  // already prints, so they are what an operator is normally looking for.
  ...RPT_TEMPLATE_CATALOGUE,
  { id: 'TEMPLATE 1 - CLASSIC BLUE', name: 'Classic Blue', detail: 'Blue header band, full field grid', paper: 'A5' },
  { id: 'TEMPLATE 2 - MODERN MINIMAL', name: 'Modern Minimal', detail: 'Clean layout with QR code', paper: 'A5' },
  { id: 'TEMPLATE 3 - INDUSTRIAL STYLE', name: 'Industrial', detail: 'Hazard stripe header', paper: 'A5' },
  { id: 'TEMPLATE 4 - PROFESSIONAL CORPORATE', name: 'Corporate', detail: 'Hex badge, formal look', paper: 'A5' },
  { id: 'TEMPLATE 5 - COMPACT RECEIPT STYLE', name: 'Compact Receipt', detail: 'Dotted receipt style', paper: 'Slip' },
  { id: 'TEMPLATE 7 - AMR INFRA', name: 'AMR INFRA (A4 Dual Slip with CCTV Images)', detail: '2-Up A4 layout with vehicle CCTV camera snapshots', paper: 'A4' },
  { id: 'IMAGE-4', name: 'Standard Slip', detail: 'Matches the printed sample', paper: 'A5' },
  { id: 'IMAGE-1', name: 'Minimalist', detail: 'Modern corporate, light rules', paper: 'A5' },
  { id: 'IMAGE-2', name: 'Industrial Challan', detail: 'Full challan with all fields', paper: 'A5' },
  { id: 'IMAGE-3', name: 'Dual Weight Certificate', detail: 'Gross and tare certificate', paper: 'A4' },
  { id: 'IMAGE-5', name: 'Thermal Receipt', detail: 'For 80mm thermal printers', paper: '80mm' },
  { id: 'IMAGE-6', name: 'Quarry Dispatch Pass', detail: 'Gate pass layout', paper: 'A5' },
  { id: 'IMAGE-7', name: 'Executive Tax Invoice', detail: 'Invoice with tax summary', paper: 'A4' },
  { id: 'IMAGE-8', name: 'Delivery Challan Dual A5 (Photo Exact Match)', detail: 'Twin side-by-side Delivery Challan slips on A5 paper matching printed sample photo', paper: 'A5' },
  { id: 'RAW', name: 'Dot-Matrix Slip', detail: 'ESC/P text, 5in continuous form, auto form feed', paper: 'RAW' },
  { id: 'RAW_LARGE', name: 'Dot-Matrix Slip (Large Text)', detail: 'ESC/P text, enlarged font size for high visibility', paper: 'RAW' }
];

const BAUD_RATES = ['110', '300', '1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600'];

// Sample ticket used for every preview and for Test Print, so what the operator
// sees on screen is exactly what the test page prints.
const PREVIEW_TICKET = {
  dcNum: '270', vehicle: 'TN20DM3666', material: 'CRF SAND', party: 'SRI SRINIVASA', destination: 'CHENNAI',
  source: 'CRUSHER', gross: '59260', tare: '14900', net: '44360', qty: '44360', units_val: '44360',
  stationary: 'STN-1001', transporter: 'GSM INFRA', driver: 'ASHOK', gstin: '33AAAAA0000A1Z5',
  siteAddress: 'CHENNAI', billType: 'GST', date: '13-08-2026', time: '18:26', tareDate: '12-08-2026', tareTime: '17:57'
};

// Lets the browser actually paint before we hand control to a blocking call
// (a native confirm(), or an IPC round trip that stalls the main process while
// SQLite VACUUMs and rewrites the file). React commits state synchronously but
// the frame is only composited on the next tick — without this wait the button
// still reads "Clear Selected Table" for the whole operation, which looks like
// a frozen label. Two rAFs plus a macrotask guarantee one composited frame.
const waitForPaint = () => new Promise((resolve) => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
});

// How long a Notice banner stays on screen before it dismisses itself.
const NOTICE_TIMEOUT_MS = 4000;

export default function Settings() {
  const { card, gross, isConnected } = useScale() || {};
  const [activeTab, setActiveTab] = useState('printer');
  const [msg, setMsg] = useState('');
  const [printCategory, setPrintCategory] = useState('PRINT'); // 'PRINT' | 'DC' | 'GATE_PASS'
  const [selectedTemplate, setSelectedTemplateState] = useState(getSelectedTemplate());
  const [dcPrintTemplate, setDcPrintTemplateState] = useState(getDcPrintTemplate());
  const [gatePassTemplate, setGatePassTemplateState] = useState(getGatePassTemplate());
  const [showFullPreviewModal, setShowFullPreviewModal] = useState(false);

  // Active template based on selected print category (Print, DC Print, Gate Pass)
  const activeCategoryTemplate =
    printCategory === 'DC' ? dcPrintTemplate :
    printCategory === 'GATE_PASS' ? gatePassTemplate :
    selectedTemplate;

  const handleTemplateChange = (newTpl) => {
    if (printCategory === 'DC') {
      setDcPrintTemplate(newTpl);
      setDcPrintTemplateState(newTpl);
      setMsg(`DC Print format updated to "${newTpl}"`);
    } else if (printCategory === 'GATE_PASS') {
      setGatePassTemplate(newTpl);
      setGatePassTemplateState(newTpl);
      setMsg(`Gate Pass format updated to "${newTpl}"`);
    } else {
      setSelectedTemplate(newTpl);
      setSelectedTemplateState(newTpl);
      setMsg(`Print format updated to "${newTpl}"`);
    }
    setTimeout(() => setMsg(''), 4000);
  };

  // Look up name, paper size and description for active category template
  const selectedTemplateInfo = TEMPLATE_CATALOGUE.find(t => t.id === activeCategoryTemplate) || null;
  const rptTemplates = TEMPLATE_CATALOGUE.filter(t => t.id.startsWith('RPT-'));
  const appTemplates = TEMPLATE_CATALOGUE.filter(t => !t.id.startsWith('RPT-'));
  const selectedPaper = getPaperForTemplate(activeCategoryTemplate);

  // Page header printed above the slip. Held in state purely so the preview
  // below re-renders the moment the choice changes.
  const [rptHeaderMode, setRptHeaderModeState] = useState(getRptHeaderMode());
  const [rptHeaderGap, setRptHeaderGapState] = useState(getRptHeaderGap());

  const handleRptHeaderModeChange = (mode) => {
    setRptHeaderMode(mode);
    setRptHeaderModeState(mode);
  };

  const handleRptHeaderGapChange = (px) => {
    const value = Math.max(0, Number(px) || 0);
    setRptHeaderGap(value);
    setRptHeaderGapState(value);
  };
  const [printersList, setPrintersList] = useState([]);
  const [hardwarePrinterConfig, setHardwarePrinterConfig] = useState(getPrinterConfig());
  const [isPrinterSetupOpen, setIsPrinterSetupOpen] = useState(false);

  const activeCategoryPrinter =
    printCategory === 'DC' ? (hardwarePrinterConfig.dcPrinterName || hardwarePrinterConfig.printerName || 'Windows Default') :
    printCategory === 'GATE_PASS' ? (hardwarePrinterConfig.gatePassPrinterName || hardwarePrinterConfig.printerName || 'Windows Default') :
    (hardwarePrinterConfig.printerName || 'Windows Default');

  const activeCategoryMode =
    (activeCategoryTemplate && activeCategoryTemplate.startsWith('RPT-')) ? 'HTML_DRIVER' :
    printCategory === 'DC' ? (hardwarePrinterConfig.dcMode || 'HTML_DRIVER') :
    printCategory === 'GATE_PASS' ? (hardwarePrinterConfig.gatePassMode || 'HTML_DRIVER') :
    (hardwarePrinterConfig.mode || 'RAW_TEXT');

  const handleSaveHardwarePrinter = () => {
    setPrinterConfig(hardwarePrinterConfig);
    setMsg('Hardware Printer Settings saved successfully!');
    setIsPrinterSetupOpen(false);
  };

  // 1. Primary Scale Settings State
  const [commSettings, setCommSettings] = useState({
    scaleType: 'serial',
    scaleIp: '192.168.0.50',
    comPort: 'COM7',
    baudRate: '9600',
    company: 'Weitex'
  });

  // 2. Unmanned Scale Settings State
  const [unmannedSettings, setUnmannedSettings] = useState({
    scaleType: 'serial',
    scaleIp: '192.168.0.51',
    comPort: 'COM1',
    baudRate: '9600',
    company: 'Icom'
  });

  // 3. RFID Settings State
  const [rfidSettings, setRfidSettings] = useState({
    scaleType: 'serial',
    scaleIp: '192.168.0.52',
    comPort: 'COM1',
    baudRate: '9600',
    rfIdNo: 'RFID-01'
  });

  const [availablePorts, setAvailablePorts] = useState([]);

  // Server & Company Sync State
  const [syncSettings, setSyncSettings] = useState({
    companyId: '',
    masterSyncUrl: 'https://crusher.norissolutions.com/backend/api/weighbridge/pending',
    boulderSyncUrl: 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders',
    salesSyncUrl: 'https://crusher.norissolutions.com/backend/api/weighbridge/sales',
    yardSyncUrl: 'https://crusher.norissolutions.com/backend/api/weighbridge/yard'
  });

  const [isCompanyIdSaved, setIsCompanyIdSaved] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');

  // Footer display visibility state ('show' | 'hide')
  const [footerVisibility, setFooterVisibility] = useState('show');

  // Royalty Rates state
  const [govRoyaltyRate, setGovRoyaltyRate] = useState(localStorage.getItem('noris_royalty_gov_rate') || '0');
  const [genRoyaltyRate, setGenRoyaltyRate] = useState(localStorage.getItem('noris_royalty_gen_rate') || '0');

  const handleSaveRoyaltySettings = () => {
    localStorage.setItem('noris_royalty_gov_rate', govRoyaltyRate);
    localStorage.setItem('noris_royalty_gen_rate', genRoyaltyRate);
    setMsg('Royalty Rates saved successfully!');
  };

  // LAN Multi-PC Network Settings state
  const [netConfig, setNetConfig] = useState({
    mode: 'HOST',
    hostIp: '127.0.0.1',
    hostPort: 5000,
    localIps: [],
    serverRunning: false
  });
  const [netTestStatus, setNetTestStatus] = useState(null);

  // Vehicle Option Type Settings State
  const [vehicleOptionMode, setVehicleOptionModeState] = useState(VEHICLE_OPTION_MODES.STAY_ALL);

  useEffect(() => {
    getVehicleOptionMode().then(mode => {
      if (mode) setVehicleOptionModeState(mode);
    });
  }, []);

  const handleSaveVehicleOptionMode = async (mode) => {
    await setVehicleOptionMode(mode);
    setVehicleOptionModeState(mode);
    const labels = {
      [VEHICLE_OPTION_MODES.STAY_ALL]: 'Show All (Stay)',
      [VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY]: 'Hide Empty Completed',
      [VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE]: 'Quarry/Own Stay, Others Hide'
    };
    setMsg(`Vehicle Option Type updated to "${labels[mode] || mode}"`);
  };



  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getNetworkConfig) {
      window.electronAPI.getNetworkConfig().then((cfg) => {
        if (cfg) {
          setNetConfig(cfg);
        }
      }).catch(err => console.error('[Settings] Error fetching network config:', err));
    }
  }, []);

  const handleSaveNetworkConfig = async () => {
    try {
      if (window.electronAPI && window.electronAPI.saveNetworkConfig) {
        const saved = await window.electronAPI.saveNetworkConfig({
          mode: netConfig.mode,
          hostIp: netConfig.hostIp,
          hostPort: netConfig.hostPort
        });
        setNetConfig(prev => ({ ...prev, ...saved }));
        setMsg(`Network configuration saved! App set to ${saved.mode} mode.`);
      }
    } catch (err) {
      setMsg(`Error saving network settings: ${err.message}`);
    }
  };

  const handleTestNetworkConnection = async () => {
    setNetTestStatus({ testing: true, success: false, msg: 'Testing connection to Host PC...' });
    try {
      if (window.electronAPI && window.electronAPI.testHostConnection) {
        const res = await window.electronAPI.testHostConnection({
          hostIp: netConfig.hostIp,
          hostPort: netConfig.hostPort
        });
        if (res.success) {
          setNetTestStatus({
            testing: false,
            success: true,
            msg: `Connected successfully to Host PC (${netConfig.hostIp}:${netConfig.hostPort})!`
          });
        } else {
          setNetTestStatus({
            testing: false,
            success: false,
            msg: `Connection Failed: ${res.error}`
          });
        }
      }
    } catch (err) {
      setNetTestStatus({ testing: false, success: false, msg: `Error testing connection: ${err.message}` });
    }
  };

  // Guards against a second port scan starting while the previous one is still
  // running. Without it, a burst of queued timers (for example after a modal
  // dialog has blocked the UI thread) fires several scans back to back.
  const portScanInFlight = useRef(false);

  const refreshSerialPorts = () => {
    if (window.electronAPI && window.electronAPI.listSerialPorts) {
      if (portScanInFlight.current) return;
      portScanInFlight.current = true;
      window.electronAPI.listSerialPorts()
        .then((ports) => {
          if (ports && Array.isArray(ports)) {
            setAvailablePorts(ports);
          } else {
            setAvailablePorts([]);
          }
        })
        .catch(err => {
          console.error('[Settings] Error listing serial ports:', err);
          setAvailablePorts([]);
        })
        .finally(() => { portScanInFlight.current = false; });
    }
  };

  // Only scan serial ports while the Communication tab is on screen — it is the
  // only tab with port dropdowns. Scanning while the operator is on Clearing or
  // Camera IP Settings just loads the main process for nothing.
  useEffect(() => {
    if (activeTab !== 'comm') return;
    refreshSerialPorts();
    const portsInterval = setInterval(refreshSerialPorts, 3000);
    return () => clearInterval(portsInterval);
  }, [activeTab]);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getPrinters) {
      window.electronAPI.getPrinters().then((printers) => {
        if (printers && Array.isArray(printers)) {
          setPrintersList(printers);
        }
      }).catch(err => console.error('[Settings] Error fetching printers:', err));
    }

    api.settings().then((s) => {
      if (s) {
        setIsCompanyIdSaved(!!s.company_id);
        setSyncSettings({
          companyId: s.company_id || '',
          masterSyncUrl: s.master_sync_url || 'https://crusher.norissolutions.com/backend/api/weighbridge/pending',
          boulderSyncUrl: s.boulder_sync_url || 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders',
          salesSyncUrl: s.sales_sync_url || 'https://crusher.norissolutions.com/backend/api/weighbridge/sales',
          yardSyncUrl: s.yard_sync_url || 'https://crusher.norissolutions.com/backend/api/weighbridge/yard',
          secondWeighmentSyncUrl: s.second_weighment_sync_url || 'https://crusher.norissolutions.com/backend/api/weighbridge/second-weighment'
        });

        const activePort = s.comPort || 'COM7';
        setCommSettings({
          scaleType: s.scaleType || 'serial',
          scaleIp: s.scaleIp || '192.168.0.50',
          comPort: activePort,
          baudRate: s.baudRate || '9600',
          company: s.protocol || 'Weitex'
        });

        setUnmannedSettings({
          scaleType: s.unmannedScaleType || 'serial',
          scaleIp: s.unmannedScaleIp || '192.168.0.51',
          comPort: s.unmannedComPort || 'COM1',
          baudRate: s.unmannedBaudRate || '9600',
          company: s.unmannedProtocol || 'Icom'
        });

        setRfidSettings({
          scaleType: s.rfidScaleType || 'serial',
          scaleIp: s.rfidScaleIp || '192.168.0.52',
          comPort: s.rfidComPort || 'COM1',
          baudRate: s.rfidBaudRate || '9600',
          rfIdNo: s.rfIdNo || 'RFID-01'
        });

        if (s.footer_visibility) {
          setFooterVisibility(s.footer_visibility);
        }


      }
    }).catch(err => console.error('[Settings] Error fetching settings:', err));
  }, []);

  const handleSaveSerialSettings = async () => {
    try {
      await api.saveSetting('scaleType', commSettings.scaleType);
      await api.saveSetting('scaleIp', commSettings.scaleIp);
      await api.saveSetting('comPort', commSettings.comPort);
      await api.saveSetting('baudRate', commSettings.baudRate);
      await api.saveSetting('protocol', commSettings.company);
      setMsg(`Primary Scale settings saved: Connection type is ${commSettings.scaleType.toUpperCase()}`);
    } catch (e) {
      setMsg('Error saving serial settings: ' + e.message);
    }
  };

  const handleSaveUnmannedSettings = async () => {
    try {
      await api.saveSetting('unmannedScaleType', unmannedSettings.scaleType);
      await api.saveSetting('unmannedScaleIp', unmannedSettings.scaleIp);
      await api.saveSetting('unmannedComPort', unmannedSettings.comPort);
      await api.saveSetting('unmannedBaudRate', unmannedSettings.baudRate);
      await api.saveSetting('unmannedProtocol', unmannedSettings.company);
      setMsg(`Unmanned Scale settings saved: Connection type is ${unmannedSettings.scaleType.toUpperCase()}`);
    } catch (e) {
      setMsg('Error saving unmanned settings: ' + e.message);
    }
  };

  const handleSaveRfidSettings = async () => {
    try {
      await api.saveSetting('rfidScaleType', rfidSettings.scaleType);
      await api.saveSetting('rfidScaleIp', rfidSettings.scaleIp);
      await api.saveSetting('rfidComPort', rfidSettings.comPort);
      await api.saveSetting('rfidBaudRate', rfidSettings.baudRate);
      await api.saveSetting('rfid_com_port', rfidSettings.comPort);
      await api.saveSetting('rfid_baud_rate', rfidSettings.baudRate);
      await api.saveSetting('rfIdNo', rfidSettings.rfIdNo);
      setMsg(`RFID settings saved: Port ${rfidSettings.comPort} (${rfidSettings.baudRate} baud)`);
    } catch (e) {
      setMsg('Error saving RFID settings: ' + e.message);
    }
  };

  const handleSaveSyncSettings = async () => {
    try {
      await api.saveSetting('company_id', syncSettings.companyId);
      await api.saveSetting('master_sync_url', syncSettings.masterSyncUrl);
      await api.saveSetting('boulder_sync_url', syncSettings.boulderSyncUrl);
      await api.saveSetting('sales_sync_url', syncSettings.salesSyncUrl);
      await api.saveSetting('yard_sync_url', syncSettings.yardSyncUrl);
      await api.saveSetting('second_weighment_sync_url', syncSettings.secondWeighmentSyncUrl);
      setMsg(`Server & Sync settings updated! Company ID: ${syncSettings.companyId}`);
      if (syncSettings.companyId) {
        setIsCompanyIdSaved(true);
      }
    } catch (e) {
      setMsg('Error saving sync settings: ' + e.message);
    }
  };

  const handleSaveFooterSetting = async () => {
    try {
      await api.saveSetting('footer_visibility', footerVisibility);
      window.dispatchEvent(new CustomEvent('footer-visibility-changed', {
        detail: { visibility: footerVisibility }
      }));
      setMsg(`Footer display setting saved: ${footerVisibility === 'hide' ? 'Hidden' : 'Shown'}`);
    } catch (e) {
      setMsg('Error saving footer display setting: ' + e.message);
    }
  };

  // Re-opens the Cloud Sync form after it has been locked. Gated by the SOFTWARE
  // OWNER password — deliberately not the site admin password used elsewhere in
  // Settings, so a customer's admin cannot re-point this machine to another
  // tenant. The password is verified in the main process (see main.js), so no
  // hash or secret is present in this bundle. Saved values are kept, so the form
  // reappears pre-filled — pressing Save locks it again.
  const handleUnlockSyncSettings = async () => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (!unlockPassword) {
      setMsg('⚠️ Please enter the Software Owner Password to unlock the configuration.');
      return;
    }

    let authorised = false;
    try {
      if (window.electronAPI && window.electronAPI.verifyOwnerPassword) {
        authorised = await window.electronAPI.verifyOwnerPassword(unlockPassword);
      } else {
        setMsg('⚠️ Owner verification is unavailable outside the desktop app.');
        return;
      }
    } catch (e) {
      setMsg('⚠️ Could not verify the owner password: ' + e.message);
      return;
    }

    if (!authorised) {
      setMsg('⚠️ Incorrect Software Owner Password. Unauthorized action!');
      setUnlockPassword('');
      return;
    }

    setIsCompanyIdSaved(false);
    setShowUnlock(false);
    setUnlockPassword('');
    setMsg('Cloud Sync configuration unlocked — edit the values, then press Save to lock it again.');
  };

  // 2. Printer Settings State
  const [printerSettings, setPrinterSettings] = useState({
    printerName: 'POS-80 Thermal Printer',
    copies: '2',
    slipHeader: 'NORIS WEIGHBRIDGE SYSTEM',
    slipFooter: 'Thank you! Drive Safely.'
  });

  // 3. Address Settings State. Seeded from whatever the report masthead is
  // currently using, so opening the tab shows what actually prints.
  const [addressSettings, setAddressSettings] = useState(() => ({
    ...getCompanyDetails(),
    phone: '+91 98765 43210',
    gstin: '37AAAAA0000A1Z5'
  }));
  const [addressSaved, setAddressSaved] = useState(false);

  const handleSaveAddress = () => {
    saveCompanyDetails({
      companyName: addressSettings.companyName || '',
      address1: addressSettings.address1 || '',
      address2: addressSettings.address2 || '',
      pageFormat: addressSettings.pageFormat || ''
    });
    setAddressSaved(true);
    setTimeout(() => setAddressSaved(false), 2500);
  };

  // 4. RFID Cards State (Tab: RF IDs Adding)
  const [rfidForm, setRfidForm] = useState({
    cardNumber: '',
    vehicle: '',
    material: 'BOULDERS',
    contractor: ''
  });
  const [rfidList, setRfidList] = useState([]);
  const [contractorsList, setContractorsList] = useState([]);

  // 5. Transporter Vehicles State
  const [transporterForm, setTransporterForm] = useState({ transporter: '', vehicleNo: '', capacity: '' });
  const [transporterList, setTransporterList] = useState([]);

  // 6. Get Old DC State
  const [searchDc, setSearchDc] = useState('');
  const [oldDcResult, setOldDcResult] = useState(null);

  // 7. Clearing Tab States
  const [clearTableSelected, setClearTableSelected] = useState('boulders');
  const [clearAdminPassword, setClearAdminPassword] = useState('');
  const [deleteBouldersPretare, setDeleteBouldersPretare] = useState('NO');
  const [deleteSalesPretare, setDeleteSalesPretare] = useState('NO');
  const [isClearing, setIsClearing] = useState(false);
  const [isPurgingPreTare, setIsPurgingPreTare] = useState(false);

  // Auto Data Cleanup & Retention States
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [autoCleanupDays, setAutoCleanupDays] = useState(1);
  const [autoCleanupTables, setAutoCleanupTables] = useState('all');
  const [lastCleanupInfo, setLastCleanupInfo] = useState(null);
  const [isPurgingManual, setIsPurgingManual] = useState(false);
  const [cleanupStatusText, setCleanupStatusText] = useState('Idle (Protected)');

  useEffect(() => {
    if (activeTab === 'clearing' && window.electronAPI && window.electronAPI.getCleanupConfig) {
      window.electronAPI.getCleanupConfig().then(cfg => {
        if (cfg) {
          setAutoCleanupEnabled(cfg.enabled !== false);
          setAutoCleanupDays(cfg.days || 1);
          setAutoCleanupTables(cfg.tables || 'all');
          setLastCleanupInfo({
            lastRun: cfg.lastRun,
            lastResult: cfg.lastResult
          });
        }
      }).catch(() => {});
    }
  }, [activeTab]);

  const handleSaveAutoCleanupPolicy = async (e) => {
    if (e) e.preventDefault();
    try {
      if (window.electronAPI && window.electronAPI.setCleanupConfig) {
        const res = await window.electronAPI.setCleanupConfig({
          enabled: autoCleanupEnabled,
          days: Number(autoCleanupDays) || 1,
          tables: autoCleanupTables
        });
        if (res && res.success) {
          setMsg(`Auto-Cleanup Policy saved: ${autoCleanupEnabled ? `Enabled (${autoCleanupDays} Day(s) retention)` : 'Disabled'}`);
        }
      }
    } catch (err) {
      setMsg('Error saving auto cleanup policy: ' + err.message);
    }
  };

  const handleManualPurgeNow = async () => {
    if (isPurgingManual) return;
    setIsPurgingManual(true);
    setCleanupStatusText('Cleaning synchronized records older than retention period...');
    setMsg('Purging records older than retention period, please wait...');
    try {
      await waitForPaint();
      if (window.electronAPI && window.electronAPI.purgeOldRecords) {
        const res = await window.electronAPI.purgeOldRecords({
          days: Number(autoCleanupDays) || 1,
          tables: autoCleanupTables
        });
        if (res && res.success) {
          setLastCleanupInfo({
            lastRun: res.timestamp,
            lastResult: res
          });
          setCleanupStatusText(`Completed: ${res.totalDeleted} records purged, ${res.reclaimedFormatted} reclaimed.`);
          setMsg(`Success: ${res.totalDeleted} synchronized records purged. Reclaimed ${res.reclaimedFormatted} storage.`);
        } else {
          setMsg('Cleanup notice: ' + (res?.error || 'Failed to complete cleanup'));
          setCleanupStatusText('Idle (Notice: ' + (res?.error || 'No records affected') + ')');
        }
      }
    } catch (err) {
      setMsg('Error during manual cleanup: ' + err.message);
      setCleanupStatusText('Error: ' + err.message);
    } finally {
      setIsPurgingManual(false);
    }
  };

  // Auto-dismiss the Notice banner.
  const busy = isClearing || isPurgingPreTare || isPurgingManual;
  useEffect(() => {
    if (!msg || busy) return undefined;
    const timer = setTimeout(() => setMsg(''), NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [msg, busy]);

  const handleClearSelectedTable = async (e) => {
    if (e) e.preventDefault();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (isClearing) return;
    if (!clearAdminPassword) {
      setMsg('⚠️ Please enter Admin Password to authorize clearing data.');
      return;
    }
    if (clearAdminPassword !== 'admin.123$') {
      setMsg('⚠️ Incorrect Admin Password. Unauthorized action!');
      return;
    }

    const labels = {
      boulders: 'Boulders Weighment',
      sales_weighment_units: 'Sales Weighment Units',
      yard_weighments: 'Yard Weighment',
      first_weighments: 'First Weighment',
      second_weighments: 'Second Weighment',
      loading_slips: 'Loading Slips',
      transactions: 'All Transactions / Weighments',
      all: 'ALL TABLES (RESET ALL)'
    };

    const targetLabel = labels[clearTableSelected] || clearTableSelected;

    setIsClearing(true);
    setMsg(`Clearing '${targetLabel}' and compacting the database, please wait...`);
    try {
      await waitForPaint();
      const res = await api.clearTable(clearTableSelected);
      if (res && res.success) {
        if (clearTableSelected === 'yard_weighments' || clearTableSelected === 'all') {
          localStorage.removeItem('noris_yard_transactions');
          localStorage.removeItem('noris_yard_dc_counter_seq');
          localStorage.removeItem('noris_yard_dc_counter_date');
        }
        if (clearTableSelected === 'boulders' || clearTableSelected === 'all') {
          localStorage.removeItem('noris_boulders_transactions');
          localStorage.removeItem('noris_boulders_dc_counter_seq');
          localStorage.removeItem('noris_boulders_dc_counter_date');
        }
        if (clearTableSelected === 'sales_weighment_units' || clearTableSelected === 'transactions' || clearTableSelected === 'all') {
          localStorage.removeItem('noris_sales_transactions');
          localStorage.removeItem('noris_sales_dc_counter_seq');
          localStorage.removeItem('noris_sales_dc_counter_date');
          localStorage.removeItem('noris_dc_counter_seq');
          localStorage.removeItem('noris_dc_counter_date');
        }
        if (clearTableSelected === 'transactions' || clearTableSelected === 'all') {
          localStorage.removeItem('noris_yard_transactions');
          localStorage.removeItem('noris_boulders_transactions');
          localStorage.removeItem('noris_sales_transactions');
          localStorage.removeItem('noris_transactions');
        }
        setMsg(`Success: All records from '${targetLabel}' table have been permanently deleted.`);
        setClearAdminPassword('');
      } else {
        setMsg('Failed to clear table: ' + (res?.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      setMsg('Error clearing table: ' + err.message);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSavePreTareSettings = async (e) => {
    if (e) e.preventDefault();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (isPurgingPreTare) return;
    const bDel = deleteBouldersPretare === 'YES';
    const sDel = deleteSalesPretare === 'YES';

    if (!bDel && !sDel) {
      setMsg('PreTare Settings saved.');
      return;
    }

    setIsPurgingPreTare(true);
    setMsg('Purging the selected PreTare records, please wait...');
    try {
      await waitForPaint();
      const res = await api.clearPreTare(bDel, sDel);
      if (res && res.success) {
        setMsg('Selected PreTare records have been purged from local database.');
        setDeleteBouldersPretare('NO');
        setDeleteSalesPretare('NO');
      } else {
        setMsg('Error purging PreTare records: ' + (res?.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      setMsg('Error purging PreTare records: ' + err.message);
    } finally {
      setIsPurgingPreTare(false);
    }
  };

  // Load RFID Cards from SQLite database
  const loadRfidCardsFromDb = async () => {
    try {
      if (api.getRfidCards) {
        const list = await api.getRfidCards();
        if (Array.isArray(list)) {
          setRfidList(list.map(r => ({
            id: r.id,
            cardNumber: r.card_number || r.cardNumber,
            vehicle: r.vehicle,
            material: r.material || 'BOULDERS',
            contractor: r.contractor || ''
          })));
        }
      }
    } catch (e) {
      console.error('[Settings] Error loading RFID cards:', e);
    }
  };

  // Load Contractors from local SQLite database
  const loadContractorsFromDb = async () => {
    try {
      if (api.getContractors) {
        const list = await api.getContractors();
        if (Array.isArray(list)) {
          const names = list
            .map(c => typeof c === 'string' ? c : (c.contractorName || c.contractor || c.name || c.title))
            .filter(Boolean);
          setContractorsList([...new Set(names)]);
        }
      }
    } catch (e) {
      console.error('[Settings] Error loading contractors from local DB:', e);
    }
  };

  useEffect(() => {
    loadContractorsFromDb();
  }, []);

  useEffect(() => {
    if (activeTab === 'rfid') {
      loadRfidCardsFromDb();
      loadContractorsFromDb();
    }
  }, [activeTab]);

  // Auto-fill CARD NUMBER field when an RFID card is swiped/scanned
  useEffect(() => {
    if (activeTab === 'rfid' && card) {
      setRfidForm(prev => ({ ...prev, cardNumber: card }));
    }
  }, [card, activeTab]);

  // Save RFID Card to Database
  const handleSaveRfid = async (e) => {
    if (e) e.preventDefault();
    if (!rfidForm.cardNumber || !rfidForm.vehicle) {
      setMsg('⚠️ Please enter Card Number and Vehicle');
      return;
    }
    try {
      if (api.saveRfidCard) {
        await api.saveRfidCard(rfidForm);
        await loadRfidCardsFromDb();
        setRfidForm({ cardNumber: '', vehicle: '', material: 'BOULDERS', contractor: '' });
        setMsg('RFID Card saved successfully.');
      }
    } catch (err) {
      console.error(err);
      setMsg('Error saving RFID card: ' + err.message);
    }
  };

  const handleDeleteRfid = async (id) => {
    try {
      if (api.deleteRfidCard) {
        await api.deleteRfidCard(id);
        await loadRfidCardsFromDb();
        setMsg('RFID Card deleted.');
      }
    } catch (err) {
      console.error(err);
      setMsg('Error deleting RFID card: ' + err.message);
    }
  };

  // Search Old DC
  const handleSearchOldDc = (e) => {
    e.preventDefault();
    if (!searchDc) return;
    setOldDcResult({
      dcNum: searchDc.toUpperCase(),
      date: new Date().toLocaleDateString(),
      vehicle: 'AP 39 AB 1234',
      material: 'BOULDERS',
      gross: '12,560 kg',
      tare: '6,670 kg',
      net: '5,890 kg',
      contractor: 'RAO CONTRACTS'
    });
  };

  // DC Sequence Tab State
  const [dcModule, setDcModule] = useState('sales');
  const [dcType, setDcType] = useState('NON-GST');
  const [dcPrefix, setDcPrefix] = useState('DC-');
  const [dcStartingNumber, setDcStartingNumber] = useState('1');
  const [dcPreview, setDcPreview] = useState('DC-1');
  const [dcResetTime, setDcResetTime] = useState('07:00');
  const [isDcLoading, setIsDcLoading] = useState(false);

  const formatTime12Hour = (timeStr) => {
    if (!timeStr) return '7:00 AM';
    const parts = String(timeStr).split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] ? String(parts[1]).padStart(2, '0') : '00';
    if (isNaN(h)) return '7:00 AM';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  const loadDcSequenceInfo = async (mod = dcModule, typ = dcType, pfx = dcPrefix) => {
    try {
      if (api.getSettings) {
        const s = await api.getSettings();
        if (s && s.dc_reset_time) {
          setDcResetTime(s.dc_reset_time);
        }
      }
    } catch (_) {}
    if (window.electronAPI && window.electronAPI.peekNextDcNumber) {
      try {
        setIsDcLoading(true);
        const nextDc = await window.electronAPI.peekNextDcNumber({ type: typ, prefix: pfx, moduleKey: mod });
        setDcPreview(nextDc || `${pfx}1`);
        const numericPart = String(nextDc || '').replace(/[^0-9]/g, '');
        if (numericPart) {
          setDcStartingNumber(numericPart);
        }
      } catch (err) {
        console.error('Failed to load DC sequence preview:', err);
      } finally {
        setIsDcLoading(false);
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'dc_sequence') {
      loadDcSequenceInfo();
    }
  }, [activeTab, dcModule, dcType]);

  const handleSaveDcSequence = async () => {
    if (!window.electronAPI || !window.electronAPI.setDcSequence) {
      setMsg('Sequence management is available on Electron runtime.');
      return;
    }
    try {
      if (api.saveSetting) {
        await api.saveSetting('dc_reset_time', dcResetTime || '07:00');
      }
      const startNum = Math.max(1, parseInt(dcStartingNumber, 10) || 1);
      const res = await window.electronAPI.setDcSequence({
        type: dcType,
        prefix: dcPrefix,
        moduleKey: dcModule,
        startingNumber: startNum
      });

      if (res && res.success) {
        setMsg(`✔ DC Sequence for ${dcModule.toUpperCase()} (${dcType}) set to ${res.dcNumber || `${dcPrefix}${startNum}`} (Daily Reset: ${formatTime12Hour(dcResetTime)})`);
        await loadDcSequenceInfo(dcModule, dcType, dcPrefix);
      } else {
        setMsg(`Error setting DC Sequence: ${res?.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error saving DC sequence:', err);
      setMsg(`Error saving DC sequence: ${err.message}`);
    }
  };

  const tabs = [
    { id: 'vehicle_options', label: '🚚 Vehicle Options' },
    { id: 'network', label: '🌐 Network & Multi-PC' },
    { id: 'dc_sequence', label: '🔢 DC Sequence' },
    { id: 'comm', label: 'Communication' },
    { id: 'royalty', label: '👑 Royalty Rates' },
    { id: 'clearing', label: 'Clearing' },
    { id: 'printer', label: 'Printer Setting' },
    { id: 'address', label: 'Address Setting' },
    { id: 'camera', label: 'Camera IP Settings' },
    { id: 'rfid', label: 'RF IDs Adding' },
    { id: 'transporter', label: 'Transporter Vehicles' },
    { id: 'olddc', label: 'Get Old DC' }
  ];

  return (
    <div className="d-flex flex-column gap-3 animate-fade-in settings-container overflow-y-auto h-100 pb-5" style={{ maxHeight: 'calc(100vh - 80px)' }}>
      {/* Sub-Tab Navigation Bar */}
      <div 
        className="d-flex gap-2 flex-wrap bg-white p-2 border rounded-3 shadow-sm mb-3" 
        style={{ borderColor: 'var(--line-strong)', zIndex: 10 }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-sm px-3 py-2 fw-bold transition-all ${
                isActive 
                  ? 'btn-dark bg-dark text-white shadow-sm' 
                  : 'btn-light text-secondary bg-transparent border-0'
              }`}
              style={{ 
                fontSize: '0.85rem', 
                borderRadius: '6px',
                letterSpacing: '0.01em',
                transition: 'all 0.15s ease-in-out'
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {msg && (
        <div
          className={`alert ${/^(error|failed)/i.test(msg) ? 'alert-danger' : 'alert-success'} alert-dismissible fade show py-2 px-3 mb-2 shadow-sm`}
          role="alert"
          style={{ fontSize: '0.85rem' }}
        >
          <strong>Notice:</strong> {msg}
          <button type="button" className="btn-close py-2" onClick={() => setMsg('')}></button>
        </div>
      )}

      {/* TAB: Vehicle Option Type Settings */}
      {activeTab === 'vehicle_options' && (
        <div className="card shadow-sm border-0 mb-4" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
          <div className="card-header border-0 py-3 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
            <div>
              <span className="fw-bold fs-6" style={{ color: 'var(--ink)' }}>🚚 Vehicle Option Type & Empty Completion Settings</span>
              <p className="text-muted mb-0 small">Configure how vehicles are displayed in selection dropdowns once an empty weighment or exit trip is completed.</p>
            </div>
            <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1" style={{ fontSize: '0.75rem' }}>
              Active Mode: {vehicleOptionMode}
            </span>
          </div>
          <div className="card-body p-4">
            <div className="row g-3">

              {/* Mode 1: Stay All */}
              <div className="col-12 col-md-4">
                <div 
                  className={`p-3 rounded-3 border transition-all h-100 ${vehicleOptionMode === VEHICLE_OPTION_MODES.STAY_ALL ? 'border-primary bg-primary-subtle text-dark shadow-sm' : 'border-secondary-subtle bg-light text-secondary'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSaveVehicleOptionMode(VEHICLE_OPTION_MODES.STAY_ALL)}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <input 
                      type="radio" 
                      name="vehOptMode" 
                      id="opt_stay_all"
                      checked={vehicleOptionMode === VEHICLE_OPTION_MODES.STAY_ALL} 
                      onChange={() => handleSaveVehicleOptionMode(VEHICLE_OPTION_MODES.STAY_ALL)} 
                    />
                    <label htmlFor="opt_stay_all" className="fw-bold mb-0 cursor-pointer" style={{ fontSize: '0.92rem' }}>
                      📌 Show All (Stay)
                    </label>
                  </div>
                  <p className="mb-0 text-muted" style={{ fontSize: '0.8rem', lineHeight: '1.4' }}>
                    Completed empty vehicles remain in the vehicle selection dropdown at all times for repeated entry.
                  </p>
                </div>
              </div>

              {/* Mode 2: Hide Empty Completed */}
              <div className="col-12 col-md-4">
                <div 
                  className={`p-3 rounded-3 border transition-all h-100 ${vehicleOptionMode === VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY ? 'border-warning bg-warning-subtle text-dark shadow-sm' : 'border-secondary-subtle bg-light text-secondary'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSaveVehicleOptionMode(VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY)}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <input 
                      type="radio" 
                      name="vehOptMode" 
                      id="opt_hide_empty"
                      checked={vehicleOptionMode === VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY} 
                      onChange={() => handleSaveVehicleOptionMode(VEHICLE_OPTION_MODES.HIDE_COMPLETED_EMPTY)} 
                    />
                    <label htmlFor="opt_hide_empty" className="fw-bold mb-0 cursor-pointer" style={{ fontSize: '0.92rem' }}>
                      🚫 Hide &amp; Delete Completed
                    </label>
                  </div>
                  <p className="mb-0 text-muted" style={{ fontSize: '0.8rem', lineHeight: '1.4' }}>
                    Automatically delete &amp; remove vehicles from database tare records and selection dropdowns once weighment is completed.
                  </p>
                </div>
              </div>

              {/* Mode 3: Quarry/Own Stay, Others Hide */}
              <div className="col-12 col-md-4">
                <div 
                  className={`p-3 rounded-3 border transition-all h-100 ${vehicleOptionMode === VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE ? 'border-success bg-success-subtle text-dark shadow-sm' : 'border-secondary-subtle bg-light text-secondary'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSaveVehicleOptionMode(VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE)}
                >
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <input 
                      type="radio" 
                      name="vehOptMode" 
                      id="opt_quarry_stay"
                      checked={vehicleOptionMode === VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE} 
                      onChange={() => handleSaveVehicleOptionMode(VEHICLE_OPTION_MODES.QUARRY_STAY_OTHERS_HIDE)} 
                    />
                    <label htmlFor="opt_quarry_stay" className="fw-bold mb-0 cursor-pointer" style={{ fontSize: '0.92rem' }}>
                      🏗️ Quarry Stay, Others Delete
                    </label>
                  </div>
                  <p className="mb-0 text-muted" style={{ fontSize: '0.8rem', lineHeight: '1.4' }}>
                    Quarry &amp; Own fleet vehicles stay in database; third-party/Other vehicles auto-delete after weighment completion.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}


      {/* TAB 0: Network & Multi-PC Setup */}
      {activeTab === 'network' && (
        <div className="row g-3">
          <div className="col-12 col-lg-9">
            <div className="card shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>🌐 LAN Multi-PC Network Architecture</span>
                <span className={`badge ${netConfig.mode === 'HOST' ? 'bg-success-subtle text-success border-success-subtle' : 'bg-primary-subtle text-primary border-primary-subtle'}`} style={{ fontSize: '0.72rem' }}>
                  Active Mode: {netConfig.mode}
                </span>
              </div>
              <div className="card-body p-4 d-flex flex-column gap-3">
                
                {/* Role Selector Cards */}
                <div>
                  <label className="form-label fw-bold text-dark mb-2" style={{ fontSize: '0.85rem' }}>Select This PC's Network Role:</label>
                  <div className="row g-3">
                    <div className="col-12 col-md-6">
                      <div 
                        className={`p-3 rounded-3 border cursor-pointer transition-all ${netConfig.mode === 'HOST' ? 'border-success bg-success-subtle text-dark shadow-sm' : 'border-secondary-subtle bg-light text-secondary'}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setNetConfig({ ...netConfig, mode: 'HOST' })}
                      >
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <input type="radio" name="netMode" checked={netConfig.mode === 'HOST'} onChange={() => setNetConfig({ ...netConfig, mode: 'HOST' })} />
                          <span className="fw-bold" style={{ fontSize: '0.9rem' }}>🖥️ HOST / SERVER PC</span>
                        </div>
                        <p className="mb-0 text-muted" style={{ fontSize: '0.78rem' }}>
                          This computer holds the central SQLite database (<code>weighbridge.db</code>) and hosts the LAN server for other PCs.
                        </p>
                      </div>
                    </div>

                    <div className="col-12 col-md-6">
                      <div 
                        className={`p-3 rounded-3 border cursor-pointer transition-all ${netConfig.mode === 'CLIENT' ? 'border-primary bg-primary-subtle text-dark shadow-sm' : 'border-secondary-subtle bg-light text-secondary'}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setNetConfig({ ...netConfig, mode: 'CLIENT' })}
                      >
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <input type="radio" name="netMode" checked={netConfig.mode === 'CLIENT'} onChange={() => setNetConfig({ ...netConfig, mode: 'CLIENT' })} />
                          <span className="fw-bold" style={{ fontSize: '0.9rem' }}>💻 CLIENT PC</span>
                        </div>
                        <p className="mb-0 text-muted" style={{ fontSize: '0.78rem' }}>
                          This computer connects over the local network (LAN) to PC 1 (Host) to save and read weighbridge data.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Host IP Address Input (visible if CLIENT) */}
                {netConfig.mode === 'CLIENT' && (
                  <div className="p-3 bg-light rounded-3 border border-secondary-subtle">
                    <h6 className="fw-bold mb-2 text-dark" style={{ fontSize: '0.85rem' }}>🔗 Host PC Connection Details</h6>
                    <div className="row g-2 align-items-center">
                      <div className="col-12 col-md-7">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Host PC IP Address</label>
                        <input 
                          type="text" 
                          className="form-control form-control-sm border-secondary-subtle fw-bold" 
                          value={netConfig.hostIp} 
                          onChange={(e) => setNetConfig({ ...netConfig, hostIp: e.target.value })} 
                          placeholder="e.g. 192.168.1.100" 
                        />
                      </div>
                      <div className="col-12 col-md-5">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>LAN Port</label>
                        <input 
                          type="number" 
                          className="form-control form-control-sm border-secondary-subtle" 
                          value={netConfig.hostPort} 
                          onChange={(e) => setNetConfig({ ...netConfig, hostPort: Number(e.target.value) || 5000 })} 
                        />
                      </div>
                    </div>

                    <div className="mt-3 d-flex align-items-center gap-2">
                      <button 
                        type="button" 
                        className="btn btn-sm btn-outline-primary fw-semibold px-3" 
                        onClick={handleTestNetworkConnection}
                        disabled={netTestStatus?.testing}
                      >
                        {netTestStatus?.testing ? 'Testing...' : '⚡ Test Connection to Host'}
                      </button>
                    </div>

                    {netTestStatus && (
                      <div className={`mt-2 alert ${netTestStatus.success ? 'alert-success' : 'alert-danger'} py-1.5 px-2.5 mb-0`} style={{ fontSize: '0.78rem' }}>
                        {netTestStatus.msg}
                      </div>
                    )}
                  </div>
                )}

                {/* Local IPs Info for Host PC */}
                {netConfig.mode === 'HOST' && (
                  <div className="p-3 bg-success-subtle rounded-3 border border-success-subtle text-success-emphasis">
                    <h6 className="fw-bold mb-1" style={{ fontSize: '0.85rem' }}>📡 Local Network Addresses for this Host PC</h6>
                    <p className="mb-2 text-secondary" style={{ fontSize: '0.78rem' }}>
                      Share one of these IP addresses with Client PCs on your LAN so they can connect to this machine:
                    </p>
                    <div className="d-flex flex-wrap gap-2">
                      {netConfig.localIps && netConfig.localIps.length > 0 ? (
                        netConfig.localIps.map((ip, idx) => (
                          <span key={idx} className="badge bg-white text-dark border px-2.5 py-1.5 fs-7 font-monospace shadow-sm">
                            {ip.interface}: <strong>{ip.address}</strong> (Port {netConfig.hostPort})
                          </span>
                        ))
                      ) : (
                        <span className="badge bg-white text-dark border px-2">127.0.0.1 (Port {netConfig.hostPort})</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button type="button" className="btn btn-sm btn-success fw-bold px-4 py-2 shadow-sm" onClick={handleSaveNetworkConfig}>
                    💾 Save Network Configuration
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}



      {/* TAB: DC Sequence Settings */}
      {activeTab === 'dc_sequence' && (
        <div className="row g-3">
          <div className="col-12 col-lg-8">
            <div className="card shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>🔢 Delivery Challan (DC) Sequence & Data Formatting</span>
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle" style={{ fontSize: '0.68rem' }}>Host DB Configuration</span>
              </div>
              <div className="card-body p-4 d-flex flex-column gap-3">
                <p className="text-secondary mb-2" style={{ fontSize: '0.82rem' }}>
                  Configure your Delivery Challan starting numbers, prefix formats, and reset sequence rules across your weighbridge operations.
                </p>

                <div className="row g-3">
                  {/* Select Module */}
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Operational Module</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle fw-semibold"
                      value={dcModule}
                      onChange={(e) => setDcModule(e.target.value)}
                    >
                      <option value="sales">🚚 Sales Weighment</option>
                      <option value="boulders">🪨 Boulders Weighment</option>
                      <option value="yard">🏗️ Yard Weighment</option>
                    </select>
                  </div>

                  {/* Select Reset Type */}
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Sequence Reset Type</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle fw-semibold"
                      value={dcType}
                      onChange={(e) => setDcType(e.target.value)}
                    >
                      <option value="NON-GST">NON-GST (Daily Shift Reset)</option>
                      <option value="GST">GST (Financial Year - April 1)</option>
                    </select>
                  </div>

                  {/* Daily Reset Time Option */}
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold text-secondary mb-1 d-flex justify-content-between align-items-center" style={{ fontSize: '0.78rem' }}>
                      <span>Daily Reset Time</span>
                      <span className="badge bg-light text-primary border" style={{ fontSize: '0.65rem' }}>{formatTime12Hour(dcResetTime)}</span>
                    </label>
                    <input 
                      type="time" 
                      className="form-control form-control-sm border-secondary-subtle fw-bold"
                      value={dcResetTime}
                      onChange={(e) => setDcResetTime(e.target.value)}
                      title="Daily shift start time when NON-GST sequence resets to starting number"
                    />
                  </div>

                  {/* Prefix Format */}
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Custom Prefix / Format</label>
                    <input 
                      type="text" 
                      className="form-control form-control-sm border-secondary-subtle font-monospace fw-bold"
                      value={dcPrefix}
                      onChange={(e) => setDcPrefix(e.target.value)}
                      placeholder="e.g. DC- or GST-"
                    />
                  </div>
                </div>

                <div className="row g-3 align-items-center pt-2">
                  {/* Next Sequence Number */}
                  <div className="col-12 col-md-6">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Next DC Starting Number</label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text bg-light text-muted font-monospace">#</span>
                      <input 
                        type="number" 
                        className="form-control form-control-sm border-secondary-subtle font-monospace fw-bold text-primary"
                        value={dcStartingNumber}
                        onChange={(e) => setDcStartingNumber(Number(e.target.value) || 1)}
                        min="1"
                      />
                    </div>
                    <small className="text-muted" style={{ fontSize: '0.72rem' }}>
                      Set existing client continuation number (e.g. 450).
                    </small>
                  </div>

                  {/* Live Preview Badge */}
                  <div className="col-12 col-md-6">
                    <div className="p-3 bg-light rounded-3 border d-flex flex-column gap-1">
                      <span className="text-muted fw-semibold" style={{ fontSize: '0.75rem' }}>Live Format Preview</span>
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge bg-success fs-6 font-monospace px-3 py-1.5 shadow-sm">
                          {isDcLoading ? '...' : (dcPreview || `${dcPrefix}${dcStartingNumber}`)}
                        </span>
                        <span className="text-secondary" style={{ fontSize: '0.75rem' }}>Next assigned ticket DC</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-top d-flex gap-2">
                  <button 
                    type="button" 
                    className="btn btn-sm btn-success fw-bold px-4 py-2 shadow-sm"
                    onClick={handleSaveDcSequence}
                    disabled={isDcLoading}
                  >
                    💾 Save Sequence & Data Format
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-sm btn-outline-secondary px-3 py-2"
                    onClick={loadDcSequenceInfo}
                    disabled={isDcLoading}
                  >
                    🔄 Refresh Sequence
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Telemetry / Info Card */}
          <div className="col-12 col-lg-4">
            <div className="card shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>ℹ️ Sequence Engine Rules</span>
              </div>
              <div className="card-body p-3 d-flex flex-column gap-2" style={{ fontSize: '0.8rem' }}>
                <div className="p-2.5 bg-light rounded border mb-1">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <strong className="text-dark">🌅 NON-GST Sequence</strong>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace" style={{ fontSize: '0.72rem' }}>
                      {formatTime12Hour(dcResetTime)} Shift
                    </span>
                  </div>
                  <span className="text-secondary">
                    Resets daily at <b>{formatTime12Hour(dcResetTime)}</b> shift start. Ticket sequence will start from your configured starting number each operational day.
                  </span>
                </div>
                <div className="p-2.5 bg-light rounded border mb-1">
                  <strong className="d-block text-dark mb-1">💼 GST Sequence</strong>
                  <span className="text-secondary">Resets annually on April 1st (Financial Year). Preserves continuous invoice sequence required for GST compliance.</span>
                </div>
                <div className="p-2.5 bg-light rounded border">
                  <strong className="d-block text-dark mb-1">🔄 Multi-Module Isolation</strong>
                  <span className="text-secondary">Sales, Boulders, and Yard weighments maintain separate counter sequences so non-gst & gst numbers do not conflict.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: Communication (Enterprise Side-by-Side Card Layout) */}
      {activeTab === 'comm' && (
        <div className="row g-3">
          {/* Card 1: Serial Port */}
          <div className="col-12 col-md-4">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>🔌 Serial Port</span>
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle" style={{ fontSize: '0.68rem' }}>Primary</span>
              </div>
              <div className="card-body p-3 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Connection Type</label>
                  <select className="form-select form-select-sm border-secondary-subtle" value={commSettings.scaleType} onChange={(e) => setCommSettings({ ...commSettings, scaleType: e.target.value })}>
                    <option value="serial">🔌 Serial Port</option>
                    <option value="network">🌐 Network IP Scale</option>
                  </select>
                </div>

                {commSettings.scaleType === 'network' ? (
                  <div>
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>IP Address / URL</label>
                    <input type="text" className="form-control form-control-sm border-secondary-subtle" value={commSettings.scaleIp} onChange={(e) => setCommSettings({ ...commSettings, scaleIp: e.target.value })} placeholder="192.168.0.50" />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Port Name</label>
                      <select className="form-select form-select-sm border-secondary-subtle" value={commSettings.comPort} onChange={(e) => setCommSettings({ ...commSettings, comPort: e.target.value })}>
                        {availablePorts.length === 0 && !commSettings.comPort ? (
                          <option value="">No Ports Detected</option>
                        ) : (
                          <>
                            {commSettings.comPort && !availablePorts.includes(commSettings.comPort) && (
                              <option value={commSettings.comPort}>{commSettings.comPort} (Not Detected)</option>
                            )}
                            {availablePorts.map((port) => (
                              <option key={port} value={port}>{port}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Baud Rate</label>
                      <select className="form-select form-select-sm border-secondary-subtle" value={commSettings.baudRate} onChange={(e) => setCommSettings({ ...commSettings, baudRate: e.target.value })}>
                        {BAUD_RATES.map((rate) => (
                          <option key={rate} value={rate}>{rate}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Indicator Brand / Protocol</label>
                  <select className="form-select form-select-sm border-secondary-subtle" value={commSettings.company || 'Weitex'} onChange={(e) => setCommSettings({ ...commSettings, company: e.target.value })}>
                    <option value="Weitex">Weitex (z-delimited continuous stream / 2400 baud)</option>
                    <option value="Icom">Icom (: delimited, /10 scale)</option>
                    <option value="Eassey">Eassey / Essae (: delimited, deduplicated)</option>
                    <option value="Avery">Avery (Standard ASCII CR/LF)</option>
                    <option value="Generic">Generic ASCII (CR/LF)</option>
                  </select>
                </div>

                <div className="p-2 rounded bg-dark text-white font-monospace d-flex justify-content-between align-items-center" style={{ fontSize: '0.80rem' }}>
                  <span className="text-secondary small">Live Scale:</span>
                  <span className={`fw-bold ${isConnected ? 'text-warning' : 'text-danger'}`}>
                    {isConnected ? `${gross || '0'} kg` : 'Offline'}
                  </span>
                </div>

                <div className="mt-auto pt-2">
                  <button className="btn btn-sm btn-primary w-100 fw-semibold py-1.5" onClick={handleSaveSerialSettings}>
                    💾 Save Serial Port
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Unmanned Serial Port */}
          <div className="col-12 col-md-4">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>⚖️ Unmanned Serial Port</span>
                <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle" style={{ fontSize: '0.68rem' }}>Auto Weigh</span>
              </div>
              <div className="card-body p-3 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Connection Type</label>
                  <select className="form-select form-select-sm border-secondary-subtle" value={unmannedSettings.scaleType} onChange={(e) => setUnmannedSettings({ ...unmannedSettings, scaleType: e.target.value })}>
                    <option value="serial">🔌 Serial Port</option>
                    <option value="network">🌐 Network IP Scale</option>
                  </select>
                </div>

                {unmannedSettings.scaleType === 'network' ? (
                  <div>
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>IP Address / URL</label>
                    <input type="text" className="form-control form-control-sm border-secondary-subtle" value={unmannedSettings.scaleIp} onChange={(e) => setUnmannedSettings({ ...unmannedSettings, scaleIp: e.target.value })} placeholder="192.168.0.51" />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Port Name</label>
                      <select className="form-select form-select-sm border-secondary-subtle" value={unmannedSettings.comPort} onChange={(e) => setUnmannedSettings({ ...unmannedSettings, comPort: e.target.value })}>
                        {availablePorts.length === 0 && !unmannedSettings.comPort ? (
                          <option value="">No Ports Detected</option>
                        ) : (
                          <>
                            {unmannedSettings.comPort && !availablePorts.includes(unmannedSettings.comPort) && (
                              <option value={unmannedSettings.comPort}>{unmannedSettings.comPort} (Not Detected)</option>
                            )}
                            {availablePorts.map((port) => (
                              <option key={port} value={port}>{port}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Baud Rate</label>
                      <select className="form-select form-select-sm border-secondary-subtle" value={unmannedSettings.baudRate} onChange={(e) => setUnmannedSettings({ ...unmannedSettings, baudRate: e.target.value })}>
                        {BAUD_RATES.map((rate) => (
                          <option key={rate} value={rate}>{rate}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Indicator Brand / Protocol</label>
                  <select className="form-select form-select-sm border-secondary-subtle" value={unmannedSettings.company || 'Icom'} onChange={(e) => setUnmannedSettings({ ...unmannedSettings, company: e.target.value })}>
                    <option value="Weitex">Weitex (z-delimited continuous stream / 2400 baud)</option>
                    <option value="Icom">Icom (: delimited, /10 scale)</option>
                    <option value="Eassey">Eassey / Essae (: delimited, deduplicated)</option>
                    <option value="Avery">Avery (Standard ASCII CR/LF)</option>
                    <option value="Generic">Generic ASCII (CR/LF)</option>
                  </select>
                </div>
                <div className="mt-auto pt-2">
                  <button className="btn btn-sm btn-primary w-100 fw-semibold py-1.5" onClick={handleSaveUnmannedSettings}>
                    💾 Save Unmanned Port
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Unmanned RFID Serial Port */}
          <div className="col-12 col-md-4">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>📇 RFID Serial Port</span>
                <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle" style={{ fontSize: '0.68rem' }}>Scanner</span>
              </div>
              <div className="card-body p-3 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Connection Type</label>
                  <select className="form-select form-select-sm border-secondary-subtle" value={rfidSettings.scaleType} onChange={(e) => setRfidSettings({ ...rfidSettings, scaleType: e.target.value })}>
                    <option value="serial">🔌 Serial Port</option>
                    <option value="network">🌐 Network IP Scale</option>
                  </select>
                </div>

                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>RF ID No</label>
                  <select className="form-select form-select-sm border-secondary-subtle" value={rfidSettings.rfIdNo} onChange={(e) => setRfidSettings({ ...rfidSettings, rfIdNo: e.target.value })}>
                    <option value="RFID-01">RFID-01</option>
                    <option value="RFID-02">RFID-02</option>
                  </select>
                </div>

                {rfidSettings.scaleType === 'network' ? (
                  <div>
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>IP Address / URL</label>
                    <input type="text" className="form-control form-control-sm border-secondary-subtle" value={rfidSettings.scaleIp} onChange={(e) => setRfidSettings({ ...rfidSettings, scaleIp: e.target.value })} placeholder="192.168.0.52" />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Port Name</label>
                      <select className="form-select form-select-sm border-secondary-subtle" value={rfidSettings.comPort} onChange={(e) => setRfidSettings({ ...rfidSettings, comPort: e.target.value })}>
                        {availablePorts.length === 0 && !rfidSettings.comPort ? (
                          <option value="">No Ports Detected</option>
                        ) : (
                          <>
                            {rfidSettings.comPort && !availablePorts.includes(rfidSettings.comPort) && (
                              <option value={rfidSettings.comPort}>{rfidSettings.comPort} (Not Detected)</option>
                            )}
                            {availablePorts.map((port) => (
                              <option key={port} value={port}>{port}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Baud Rate</label>
                      <select className="form-select form-select-sm border-secondary-subtle" value={rfidSettings.baudRate} onChange={(e) => setRfidSettings({ ...rfidSettings, baudRate: e.target.value })}>
                        {BAUD_RATES.map((rate) => (
                          <option key={rate} value={rate}>{rate}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className="mt-auto pt-2">
                  <button className="btn btn-sm btn-primary w-100 fw-semibold py-1.5" onClick={handleSaveRfidSettings}>
                    💾 Save RFID Settings
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Cloud Sync & Company ID Settings */}
          <div className="col-12 col-md-4">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>☁️ Cloud Sync & Endpoints</span>
                <span className="badge bg-success-subtle text-success border border-success-subtle" style={{ fontSize: '0.68rem' }}>Active Endpoints</span>
              </div>
              <div className="card-body p-3 d-flex flex-column gap-2" style={{ fontSize: '0.8rem' }}>
                {isCompanyIdSaved ? (
                  <div className="alert alert-success d-flex flex-column align-items-center text-center p-3 mb-2" style={{ borderRadius: '6px' }}>
                    <span style={{ fontSize: '2rem' }}>🔒</span>
                    <h6 className="fw-bold mt-2 mb-1">Configuration Locked</h6>
                    <p className="text-secondary mb-0" style={{ fontSize: '0.75rem' }}>
                      Company ID and sync endpoints have been configured and locked.
                    </p>
                    <div className="mt-3 p-2 bg-light border w-100 rounded text-start">
                      <strong>Company ID:</strong> {syncSettings.companyId}
                    </div>

                    {!showUnlock ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary fw-semibold mt-3"
                        onClick={() => setShowUnlock(true)}
                      >
                        🔓 Unlock Configuration
                      </button>
                    ) : (
                      <div className="w-100 mt-3 text-start">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.75rem' }}>
                          Software Owner Password
                        </label>
                        <input
                          type="password"
                          className="form-control form-control-sm border-secondary-subtle"
                          value={unlockPassword}
                          onChange={(e) => setUnlockPassword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockSyncSettings(); }}
                          placeholder="Owner password required"
                          autoComplete="off"
                          autoFocus
                        />
                        <div className="d-flex gap-2 mt-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-warning fw-semibold flex-grow-1"
                            onClick={handleUnlockSyncSettings}
                          >
                            Confirm Unlock
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary fw-semibold"
                            onClick={() => { setShowUnlock(false); setUnlockPassword(''); }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.75rem' }}>Company ID</label>
                    <input 
                      type="text" 
                      className="form-control form-control-sm border-secondary-subtle fw-bold" 
                      value={syncSettings.companyId} 
                      onChange={(e) => setSyncSettings({ ...syncSettings, companyId: e.target.value })} 
                      placeholder="e.g. CRUSHER-3080"
                    />
                  </div>
                )}
                <div className="mt-auto pt-2 d-flex flex-column gap-1.5">
                  {!isCompanyIdSaved && (
                    <button className="btn btn-sm btn-success w-100 fw-semibold py-1.5" onClick={handleSaveSyncSettings}>
                      💾 Save Cloud Sync Settings
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card 5: Footer Bar Display Settings */}
          <div className="col-12 col-md-4">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>📏 Footer Bar Visibility</span>
                <span className={`badge ${footerVisibility === 'show' ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-secondary-subtle text-secondary border border-secondary-subtle'}`} style={{ fontSize: '0.68rem' }}>
                  {footerVisibility === 'show' ? 'Visible' : 'Hidden'}
                </span>
              </div>
              <div className="card-body p-3 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                    Footer Bar Option (Show / Hide)
                  </label>
                  <select 
                    className="form-select form-select-sm border-secondary-subtle fw-semibold"
                    value={footerVisibility}
                    onChange={(e) => setFooterVisibility(e.target.value)}
                  >
                    <option value="show">👁️ Show Footer</option>
                    <option value="hide">🙈 Hide Footer</option>
                  </select>
                </div>

                <div className="p-2.5 rounded bg-light border" style={{ fontSize: '0.78rem' }}>
                  <div className="fw-semibold text-dark mb-1">Status & Behavior:</div>
                  <div className="text-secondary" style={{ lineHeight: 1.4 }}>
                    {footerVisibility === 'show' 
                      ? 'The bottom scale weight console (Card, Vehicle, Gross, Tare, Nett, Signals) is displayed across all pages.'
                      : 'The bottom footer bar is hidden to maximize workspace screen area.'}
                  </div>
                </div>

                <div className="mt-auto pt-2">
                  <button 
                    type="button"
                    className="btn btn-sm btn-primary w-100 fw-semibold py-1.5" 
                    onClick={handleSaveFooterSetting}
                  >
                    💾 Save Footer Setting
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Clearing (Enterprise Side-by-Side Card Layout) */}
      {activeTab === 'clearing' && (
        <div className="row g-3">
          {/* Card 1: Memory Clear */}
          <div className="col-12 col-md-6">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold text-danger" style={{ fontSize: '0.88rem' }}>🗑️ Memory Clear</span>
                <span className="badge bg-danger-subtle text-danger border border-danger-subtle fw-semibold" style={{ fontSize: '0.68rem' }}>Admin Only</span>
              </div>
              <form onSubmit={handleClearSelectedTable} className="card-body p-3 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Select Table</label>
                  <select 
                    className="form-select form-select-sm border-secondary-subtle"
                    value={clearTableSelected}
                    onChange={(e) => setClearTableSelected(e.target.value)}
                  >
                    <option value="boulders">Boulders (boulders)</option>
                    <option value="sales_weighment_units">Sales Weighment Units (sales_weighment_units)</option>
                    <option value="yard_weighments">Yard Weighment (yard_weighments)</option>
                    <option value="first_weighments">First Weighment (first_weighments)</option>
                    <option value="second_weighments">Second Weighment (second_weighments)</option>
                    <option value="loading_slips">Loading Slips (loading_slips)</option>
                    <option value="transactions">All Transactions (transactions)</option>
                    <option value="all">Reset All Tables</option>
                  </select>
                </div>
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Admin Password</label>
                  <input 
                    type="password" 
                    className="form-control form-control-sm border-secondary-subtle" 
                    placeholder="Enter password to authorize"
                    value={clearAdminPassword}
                    onChange={(e) => setClearAdminPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="mt-auto pt-2">
                  <button type="submit" className="btn btn-sm btn-danger w-100 fw-semibold py-1.5" disabled={isClearing}>
                    {isClearing ? 'Clearing, please wait...' : '⚠️ Clear Selected Table'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Card 2: PreTare Delete */}
          <div className="col-12 col-md-6">
            <div className="card h-100 shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>🔄 PreTare Delete</span>
                <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle" style={{ fontSize: '0.68rem' }}>Purge Option</span>
              </div>
              <form onSubmit={handleSavePreTareSettings} className="card-body p-3 d-flex flex-column gap-3">
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Delete Boulders PreTare?</label>
                  <select 
                    className="form-select form-select-sm border-secondary-subtle"
                    value={deleteBouldersPretare}
                    onChange={(e) => setDeleteBouldersPretare(e.target.value)}
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>
                <div>
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Delete Sales PreTare?</label>
                  <select 
                    className="form-select form-select-sm border-secondary-subtle"
                    value={deleteSalesPretare}
                    onChange={(e) => setDeleteSalesPretare(e.target.value)}
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>
                <div className="mt-auto pt-2">
                  <button type="submit" className="btn btn-sm btn-primary w-100 fw-semibold py-1.5" disabled={isPurgingPreTare}>
                    {isPurgingPreTare ? 'Purging, please wait...' : '💾 Save PreTare Settings'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Card 3: Auto Data Cleanup & Retention (Daily 1-Day Purge) */}
          <div className="col-12">
            <div className="card shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center flex-wrap gap-2" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <div className="d-flex align-items-center gap-2">
                  <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>⚡ Auto Data Cleanup &amp; Retention</span>
                  <span className={`badge ${autoCleanupEnabled ? 'bg-success-subtle text-success border border-success-subtle' : 'bg-secondary-subtle text-secondary border border-secondary-subtle'} fw-semibold`} style={{ fontSize: '0.68rem' }}>
                    {autoCleanupEnabled ? 'Active (Every 24 Hours)' : 'Disabled'}
                  </span>
                </div>
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle fw-normal" style={{ fontSize: '0.70rem' }}>
                  🔒 Unsynced &amp; Today&apos;s Active Weighments are Never Deleted
                </span>
              </div>

              <div className="card-body p-3">
                <div className="row g-3">
                  {/* Left Form Controls */}
                  <div className="col-12 col-lg-7 d-flex flex-column gap-3 border-end-lg pe-lg-4">
                    <div className="d-flex justify-content-between align-items-center bg-light p-2.5 rounded-2 border">
                      <div>
                        <div className="fw-bold text-dark" style={{ fontSize: '0.82rem' }}>Automated Daily Data Cleanup</div>
                        <div className="text-secondary" style={{ fontSize: '0.72rem' }}>
                          Automatically purges fully synced records older than the retention threshold.
                        </div>
                      </div>
                      <div className="form-check form-switch m-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          id="autoCleanupSwitch"
                          checked={autoCleanupEnabled}
                          onChange={(e) => setAutoCleanupEnabled(e.target.checked)}
                          style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                        />
                      </div>
                    </div>

                    <div className="row g-2">
                      <div className="col-12 col-sm-6">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Retention Period</label>
                        <select
                          className="form-select form-select-sm border-secondary-subtle fw-semibold"
                          value={autoCleanupDays}
                          onChange={(e) => setAutoCleanupDays(Number(e.target.value))}
                        >
                          <option value="1">1 Day (24 Hours) — Default</option>
                          <option value="2">2 Days</option>
                          <option value="7">7 Days</option>
                          <option value="30">30 Days</option>
                        </select>
                      </div>

                      <div className="col-12 col-sm-6">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Cleanup Scope</label>
                        <select
                          className="form-select form-select-sm border-secondary-subtle fw-semibold"
                          value={autoCleanupTables}
                          onChange={(e) => setAutoCleanupTables(e.target.value)}
                        >
                          <option value="all">All Transaction Tables (Default)</option>
                          <option value="boulders">Boulders (boulders)</option>
                          <option value="sales_weighment_units">Sales Units (sales_weighment_units)</option>
                          <option value="yard_weighments">Yard Weighments (yard_weighments)</option>
                          <option value="first_weighments">First Weighments (first_weighments)</option>
                          <option value="second_weighments">Second Weighments (second_weighments)</option>
                          <option value="loading_slips">Loading Slips (loading_slips)</option>
                          <option value="transactions">Transactions (transactions)</option>
                        </select>
                      </div>
                    </div>

                    <div className="d-flex gap-2 pt-1">
                      <button
                        type="button"
                        className="btn btn-sm btn-dark fw-bold px-3 py-1.5"
                        onClick={handleSaveAutoCleanupPolicy}
                      >
                        💾 Save Policy
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger fw-semibold px-3 py-1.5"
                        onClick={handleManualPurgeNow}
                        disabled={isPurgingManual}
                      >
                        {isPurgingManual ? 'Cleaning...' : '🗑️ Clean Records Older Than Retention Period Now'}
                      </button>
                    </div>
                  </div>

                  {/* Right Telemetry & Status Panel */}
                  <div className="col-12 col-lg-5 ps-lg-3">
                    <div className="border rounded-2 p-3 bg-light h-100 d-flex flex-column justify-content-between">
                      <div>
                        <div className="fw-bold text-secondary mb-2" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Cleanup Telemetry &amp; Storage
                        </div>
                        <div className="d-flex justify-content-between align-items-center py-1 border-bottom" style={{ fontSize: '0.78rem' }}>
                          <span className="text-secondary">Last Execution:</span>
                          <span className="fw-semibold text-dark">
                            {lastCleanupInfo?.lastRun ? new Date(lastCleanupInfo.lastRun).toLocaleString() : 'Pending Next Schedule'}
                          </span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center py-1 border-bottom" style={{ fontSize: '0.78rem' }}>
                          <span className="text-secondary">Records Removed:</span>
                          <span className="fw-bold text-danger">
                            {lastCleanupInfo?.lastResult?.totalDeleted ?? 0} records
                          </span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center py-1 border-bottom" style={{ fontSize: '0.78rem' }}>
                          <span className="text-secondary">Storage Reclaimed:</span>
                          <span className="fw-bold text-success">
                            {lastCleanupInfo?.lastResult?.reclaimedFormatted || '0.0 MB'}
                          </span>
                        </div>
                        <div className="d-flex justify-content-between align-items-center py-1" style={{ fontSize: '0.78rem' }}>
                          <span className="text-secondary">Current Status:</span>
                          <span className="fw-semibold text-primary" style={{ fontSize: '0.74rem' }}>
                            {cleanupStatusText}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 p-2 bg-white border rounded text-secondary" style={{ fontSize: '0.70rem', lineHeight: '1.4' }}>
                        💡 <b>Safety Guarantee:</b> Records are only deleted if they have successfully synchronized with the cloud server (<code>sync_status = 1</code>) and are not pending in <code>sync_queue</code>.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Printer Setting (Hardware & Template Configuration) */}
      {activeTab === 'printer' && (
        <div className="d-flex flex-column gap-3">
          {/* Hardware Printer Setup Card (Collapsible) */}
          <div className="card p-3 border-0 shadow-sm" style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <h6 className="fw-bold text-dark m-0 d-flex align-items-center gap-2">
                  <span>🖨️</span> Hardware Printer Setup
                </h6>
                <span className="badge bg-dark text-white px-2 py-1" style={{ fontSize: '0.72rem' }}>
                  {activeCategoryPrinter}
                </span>
                <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1" style={{ fontSize: '0.72rem' }}>
                  {activeCategoryMode === 'RAW_TEXT' ? '⚡ Raw ESC/P' : activeCategoryMode === 'HTML_DRIVER' ? '📄 HTML Driver' : '🖨️ Ask Each Time'}
                </span>
                <span className="badge bg-light text-dark border px-2 py-1" style={{ fontSize: '0.72rem' }}>
                  {hardwarePrinterConfig.copies} {hardwarePrinterConfig.copies > 1 ? 'Copies' : 'Copy'}
                </span>
              </div>
              <div className="d-flex align-items-center gap-2">
                <button 
                  type="button" 
                  className="btn btn-sm btn-outline-secondary fw-semibold py-1 px-2.5" 
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => {
                    if (window.electronAPI && window.electronAPI.getPrinters) {
                      window.electronAPI.getPrinters().then(setPrintersList);
                    }
                  }}
                >
                  🔄 Refresh Printers
                </button>
                <button
                  type="button"
                  className={`btn btn-sm fw-bold py-1 px-3 ${isPrinterSetupOpen ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ fontSize: '0.75rem' }}
                  onClick={() => setIsPrinterSetupOpen(!isPrinterSetupOpen)}
                >
                  {isPrinterSetupOpen ? '▲ Close Setup' : '⚙️ Configure Printer'}
                </button>
              </div>
            </div>

            {/* Collapsible Config Form */}
            {isPrinterSetupOpen && (
              <div className="border-top mt-3 pt-3">
                <div className="row g-3 align-items-end">
                  {/* Dedicated Printers Selection */}
                  <div className="col-12 col-md-4">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>🖨️ Standard Ticket Printer</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle fw-semibold"
                      value={hardwarePrinterConfig.printerName}
                      onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, printerName: e.target.value })}
                    >
                      <option value="">-- Windows System Default Printer --</option>
                      {printersList.map((p, idx) => (
                        <option key={idx} value={p.name}>
                          {p.name} {p.isDefault ? '(Default Printer)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-12 col-md-4">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>📄 Delivery Challan (DC) Printer</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle fw-semibold"
                      value={hardwarePrinterConfig.dcPrinterName}
                      onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, dcPrinterName: e.target.value })}
                    >
                      <option value="">-- Same as Ticket Printer --</option>
                      {printersList.map((p, idx) => (
                        <option key={idx} value={p.name}>
                          {p.name} {p.isDefault ? '(Default Printer)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-12 col-md-4">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>🎟️ Gate Pass Printer</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle fw-semibold"
                      value={hardwarePrinterConfig.gatePassPrinterName}
                      onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, gatePassPrinterName: e.target.value })}
                    >
                      <option value="">-- Same as Ticket Printer --</option>
                      {printersList.map((p, idx) => (
                        <option key={idx} value={p.name}>
                          {p.name} {p.isDefault ? '(Default Printer)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Printing Mode */}
                  <div className="col-12 col-md-4">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Print Output Mode</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle fw-bold"
                      value={hardwarePrinterConfig.mode}
                      onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, mode: e.target.value })}
                    >
                      <option value="RAW_TEXT">⚡ Raw Text (ESC/P - DOT Matrix High Speed)</option>
                      <option value="HTML_DRIVER">📄 Silent HTML Driver Mode (Visual Graphics)</option>
                      <option value="DIALOG">🖨️ Ask Every Time (choose printer, paper &amp; copies)</option>
                    </select>
                  </div>

                  {/* Number of Copies */}
                  <div className="col-6 col-md-2">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>Copies</label>
                    <select 
                      className="form-select form-select-sm border-secondary-subtle"
                      value={hardwarePrinterConfig.copies}
                      onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, copies: Number(e.target.value) })}
                    >
                      <option value="1">1 Copy</option>
                      <option value="2">2 Copies (NCR Carbon)</option>
                      <option value="3">3 Copies (Triplicate)</option>
                    </select>
                  </div>

                  {/* Save Button */}
                  <div className="col-6 col-md-2 d-flex gap-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-dark w-100 fw-bold py-1.5"
                      onClick={handleSaveHardwarePrinter}
                    >
                      💾 Save &amp; Close
                    </button>
                  </div>

                  {/* Dot-Matrix Form Height & Feed Control (Visible in RAW_TEXT mode) */}
                  {hardwarePrinterConfig.mode === 'RAW_TEXT' && (
                    <>
                      <div className="col-12 col-md-6">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                          Dot-Matrix Slip Height (Form Length)
                        </label>
                        <select
                          className="form-select form-select-sm border-secondary-subtle fw-bold"
                          value={hardwarePrinterConfig.formLines || 24}
                          onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, formLines: Number(e.target.value) })}
                        >
                          <option value="24">📏 4.0 Inches / 24 Lines (Standard 8-Hole Continuous Slip - Recommended)</option>
                          <option value="27">📏 4.5 Inches / 27 Lines (9-Hole Continuous Slip)</option>
                          <option value="30">📏 5.0 Inches / 30 Lines (10-Hole Continuous Slip)</option>
                          <option value="36">📏 6.0 Inches / 36 Lines (12-Hole / Half A4 Slip)</option>
                          <option value="72">📏 12.0 Inches / 72 Lines (Full A4 Continuous Sheet)</option>
                        </select>
                        <div className="text-secondary mt-1" style={{ fontSize: '0.72rem' }}>
                          Select your physical paper height. <b>4.0 Inches (24 Lines)</b> matches standard 8-hole pre-printed continuous forms.
                        </div>
                      </div>

                      <div className="col-12 col-md-6">
                        <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                          Paper Tear-off / Advance Mode
                        </label>
                        <select
                          className="form-select form-select-sm border-secondary-subtle fw-bold"
                          value={hardwarePrinterConfig.feedMode || 'EXACT_LINES'}
                          onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, feedMode: e.target.value })}
                        >
                          <option value="EXACT_LINES">✂️ Exact Line Feeds (Stops precisely at tear perforation — No Extra Feed)</option>
                          <option value="FORM_FEED">📄 Hardware Form Feed (ESC/P FF \x0C Command)</option>
                          <option value="NONE">🛑 Stop immediately after last line (No padding)</option>
                        </select>
                        <div className="text-secondary mt-1" style={{ fontSize: '0.72rem' }}>
                          <b>Exact Line Feeds</b> ensures the paper stops exactly at the perforation line so zero extra paper is wasted.
                        </div>
                      </div>
                    </>
                  )}

                  {/* A5 Paper Printer Tray Feeding Mode (Image 1 vs Image 2 Format) */}
                  <div className="col-12 col-md-12">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                      A5 Paper Printer Tray Feed Mode (Paper Insertion Format)
                    </label>
                    <select
                      className="form-select form-select-sm border-secondary-subtle fw-bold"
                      value={hardwarePrinterConfig.a5FeedMode || 'IMAGE_1_WIDE'}
                      onChange={(e) => setHardwarePrinterConfig({ ...hardwarePrinterConfig, a5FeedMode: e.target.value })}
                    >
                      <option value="IMAGE_1_WIDE">🖼️ Image 1 Format: Wide / Horizontal Feed (Load paper sideways into printer tray - Default)</option>
                      <option value="IMAGE_2_NARROW">🖼️ Image 2 Format: Narrow / Vertical Feed (Load paper portrait into printer tray)</option>
                    </select>
                    <div className="text-secondary mt-1" style={{ fontSize: '0.72rem' }}>
                      <b>Image 1 Format (Recommended):</b> Insert paper horizontally with the wide edge entering the printer tray (210mm wide slot).
                    </div>
                  </div>

                  {/* Paper — set by the slip template, never picked by hand */}
                  <div className="col-12">
                    <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                      Paper Size &amp; Orientation
                    </label>
                    <div
                      className="d-flex align-items-center justify-content-between gap-2 border rounded-2 px-2 py-1"
                      style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', minHeight: '31px' }}
                    >
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span className="badge bg-dark" style={{ fontSize: '0.72rem' }}>{selectedPaper.label}</span>
                        <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{selectedPaper.dimensions}</span>
                        <span className="text-secondary" style={{ fontSize: '0.72rem' }}>
                          · {selectedPaper.marginMm}mm margin
                        </span>
                      </div>
                      <span className="text-success fw-semibold" style={{ fontSize: '0.72rem' }}>
                        ✓ Automatic
                      </span>
                    </div>
                    <div className="text-secondary mt-1" style={{ fontSize: '0.72rem' }}>
                      Taken from the <b>{(TEMPLATE_CATALOGUE.find(t => t.id === selectedTemplate) || {}).name || selectedTemplate}</b> template
                      and sent to Windows with the job.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="row g-3">
            {/* Left Column: visual template picker — each card shows the real slip */}
            <div className="col-12 col-lg-5">
              <div className="card border-0 shadow-sm h-100" style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <div className="border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                  <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>📄 Slip Template Setup</span>
                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle" style={{ fontSize: '0.68rem' }}>
                    {TEMPLATE_CATALOGUE.length} designs
                  </span>
                </div>

                <div className="p-3">
                  {/* Category Buttons: Print, DC Print, Gate Pass */}
                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                    Select Document Type to Configure:
                  </label>
                  <div className="d-flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setPrintCategory('PRINT')}
                      className="btn btn-sm fw-bold flex-fill py-1.5"
                      style={{
                        backgroundColor: printCategory === 'PRINT' ? '#865518' : '#f1f5f9',
                        borderColor: '#865518',
                        color: printCategory === 'PRINT' ? '#ffffff' : '#475569',
                        borderRadius: '6px',
                        fontSize: '0.8rem'
                      }}
                    >
                      Print (Bill)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrintCategory('DC')}
                      className="btn btn-sm fw-bold flex-fill py-1.5"
                      style={{
                        backgroundColor: printCategory === 'DC' ? '#865518' : '#f1f5f9',
                        borderColor: '#865518',
                        color: printCategory === 'DC' ? '#ffffff' : '#475569',
                        borderRadius: '6px',
                        fontSize: '0.8rem'
                      }}
                    >
                      DC Print
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrintCategory('GATE_PASS')}
                      className="btn btn-sm fw-bold flex-fill py-1.5"
                      style={{
                        backgroundColor: printCategory === 'GATE_PASS' ? '#865518' : '#f1f5f9',
                        borderColor: '#865518',
                        color: printCategory === 'GATE_PASS' ? '#ffffff' : '#475569',
                        borderRadius: '6px',
                        fontSize: '0.8rem'
                      }}
                    >
                      Gate Pass
                    </button>
                  </div>

                  <label className="form-label fw-semibold text-secondary mb-1" style={{ fontSize: '0.78rem' }}>
                    {printCategory === 'DC' ? 'DC Print Format' : printCategory === 'GATE_PASS' ? 'Gate Pass Format' : 'Standard Print Format'}
                  </label>
                  <select
                    className="form-select form-select-sm fw-semibold"
                    value={activeCategoryTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                  >
                    <optgroup label="Crystal Reports designs">
                      {rptTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>{tpl.name} — {getPaperForTemplate(tpl.id).label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="App designs">
                      {appTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>{tpl.name} — {getPaperForTemplate(tpl.id).label}</option>
                      ))}
                    </optgroup>
                  </select>

                  {selectedTemplateInfo && (
                    <div className="border rounded-2 mt-3 px-2 py-2" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}>
                      <div className="d-flex justify-content-between align-items-center gap-1">
                        <span className="fw-bold text-truncate" style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>
                          {selectedTemplateInfo.name}
                        </span>
                        <span className="badge bg-light text-secondary border" style={{ fontSize: '0.62rem' }}>
                          {selectedPaper.label}
                        </span>
                      </div>
                      <div className="text-secondary" style={{ fontSize: '0.7rem' }}>{selectedTemplateInfo.detail}</div>
                      <div className="text-primary fw-bold mt-1" style={{ fontSize: '0.68rem' }}>
                        ✓ Selected for {printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Standard Print'} · {selectedPaper.label} ({selectedPaper.dimensions})
                      </div>
                    </div>
                  )}

                  {/* Connected Printer Selection for active category */}
                  <label className="form-label fw-semibold text-secondary mb-1 mt-3" style={{ fontSize: '0.78rem' }}>
                    🖨️ Connected Printer for {printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Standard Print (Bill)'}
                  </label>
                  <select
                    className="form-select form-select-sm fw-semibold"
                    value={
                      printCategory === 'DC' ? (hardwarePrinterConfig.dcPrinterName || '') :
                      printCategory === 'GATE_PASS' ? (hardwarePrinterConfig.gatePassPrinterName || '') :
                      (hardwarePrinterConfig.printerName || '')
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      let updated;
                      const isStandardPrinter = /samsung|hp|canon|brother|epson\s*l|deskjet|laserjet|pixma|pdf|onenote/i.test(val);
                      
                      if (printCategory === 'DC') {
                        updated = {
                          ...hardwarePrinterConfig,
                          dcPrinterName: val,
                          ...(isStandardPrinter && hardwarePrinterConfig.dcMode === 'RAW_TEXT' ? { dcMode: 'HTML_DRIVER' } : {})
                        };
                      } else if (printCategory === 'GATE_PASS') {
                        updated = {
                          ...hardwarePrinterConfig,
                          gatePassPrinterName: val,
                          ...(isStandardPrinter && hardwarePrinterConfig.gatePassMode === 'RAW_TEXT' ? { gatePassMode: 'HTML_DRIVER' } : {})
                        };
                      } else {
                        updated = {
                          ...hardwarePrinterConfig,
                          printerName: val,
                          ...(isStandardPrinter && hardwarePrinterConfig.mode === 'RAW_TEXT' ? { mode: 'HTML_DRIVER' } : {})
                        };
                      }
                      setHardwarePrinterConfig(updated);
                      setPrinterConfig(updated);
                      setMsg(`${printCategory === 'DC' ? 'DC' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Print'} printer updated to "${val || 'Default Printer'}"`);
                      setTimeout(() => setMsg(''), 3000);
                    }}
                  >
                    <option value="">-- Windows System Default Printer --</option>
                    {printersList.map((p, idx) => (
                      <option key={idx} value={p.name}>
                        {p.name} {p.isDefault ? '(Default Printer)' : ''}
                      </option>
                    ))}
                  </select>

                  {/* Print Output Mode for active category */}
                  <label className="form-label fw-semibold text-secondary mb-1 mt-3" style={{ fontSize: '0.78rem' }}>
                    ⚡ Print Output Mode for {printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Standard Print (Bill)'}
                  </label>
                  <select
                    className="form-select form-select-sm fw-bold border-secondary-subtle"
                    value={
                      printCategory === 'DC' ? (hardwarePrinterConfig.dcMode || 'HTML_DRIVER') :
                      printCategory === 'GATE_PASS' ? (hardwarePrinterConfig.gatePassMode || 'HTML_DRIVER') :
                      (hardwarePrinterConfig.mode || 'HTML_DRIVER')
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      let updated;
                      if (printCategory === 'DC') {
                        updated = { ...hardwarePrinterConfig, dcMode: val };
                      } else if (printCategory === 'GATE_PASS') {
                        updated = { ...hardwarePrinterConfig, gatePassMode: val };
                      } else {
                        updated = { ...hardwarePrinterConfig, mode: val };
                      }
                      setHardwarePrinterConfig(updated);
                      setPrinterConfig(updated);
                      setMsg(`${printCategory === 'DC' ? 'DC' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Print'} mode set to "${val === 'RAW_TEXT' ? 'Raw ESC/P' : val === 'HTML_DRIVER' ? 'HTML Driver' : 'Ask Each Time'}"`);
                      setTimeout(() => setMsg(''), 3000);
                    }}
                  >
                    <option value="HTML_DRIVER">📄 Silent HTML Driver Mode (Visual Graphics - Recommended for Samsung/HP/Laser/Inkjet)</option>
                    <option value="RAW_TEXT">⚡ Raw Text (ESC/P - DOT Matrix High Speed)</option>
                    <option value="DIALOG">🖨️ Ask Every Time (choose printer, paper &amp; copies)</option>
                  </select>

                  {/* Page header printed above the slip */}
                  <label className="form-label fw-semibold text-secondary mb-1 mt-3" style={{ fontSize: '0.78rem' }}>
                    Page header
                  </label>
                  <select
                    className="form-select form-select-sm fw-semibold"
                    value={rptHeaderMode}
                    onChange={(e) => handleRptHeaderModeChange(e.target.value)}
                  >
                    {RPT_HEADER_MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>

                  {rptHeaderMode === 'AUTO_GST' && (
                    <div className="text-primary mt-2 p-2 rounded border border-primary-subtle" style={{ backgroundColor: '#eff6ff', fontSize: '0.73rem', lineHeight: '1.4' }}>
                      <b>🌟 Smart Header Active:</b> When printing for a <b>GST Party</b>, the <b>Company Header</b> will print. For a <b>Non-GST Party</b>, a <b>blank space ({rptHeaderGap}px)</b> is reserved for pre-printed paper.
                    </div>
                  )}

                  {(rptHeaderMode === 'EMPTY' || rptHeaderMode === 'AUTO_GST') && (
                    <div className="d-flex align-items-center gap-2 mt-2">
                      <span className="text-secondary" style={{ fontSize: '0.72rem' }}>Blank space height</span>
                      <input
                        type="number"
                        min="0"
                        step="5"
                        className="form-control form-control-sm"
                        style={{ width: '90px', fontSize: '0.78rem' }}
                        value={rptHeaderGap}
                        onChange={(e) => handleRptHeaderGapChange(e.target.value)}
                      />
                      <span className="text-secondary" style={{ fontSize: '0.72rem' }}>px</span>
                    </div>
                  )}

                  {(rptHeaderMode === 'COMPANY' || rptHeaderMode === 'AUTO_GST') && getCompanyHeaderLines().length === 0 && (
                    <div className="text-warning-emphasis mt-2" style={{ fontSize: '0.71rem' }}>
                      No address saved yet — fill in the <b>Address Setting</b> tab and press Save, or nothing will print here.
                    </div>
                  )}

                  {/* Scaled-down render of the actual slip: what you see is what prints */}
                  <div
                    className="border rounded-2 mt-2 overflow-hidden"
                    style={{ height: '150px', backgroundColor: '#ffffff', borderColor: 'var(--line)' }}
                  >
                    <div
                      style={{ width: '700px', transform: 'scale(0.30)', transformOrigin: 'top left', pointerEvents: 'none' }}
                      dangerouslySetInnerHTML={{ __html: generateSlipHtml(PREVIEW_TICKET, activeCategoryTemplate) }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: full-size preview of the selected slip */}
            <div className="col-12 col-lg-7">
              <div className="card border-0 shadow-sm h-100" style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <div className="border-0 py-2.5 px-3 d-flex justify-content-between align-items-center flex-wrap gap-2" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>🔍 Preview ({printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Standard Print'})</span>
                    <span className="badge bg-success-subtle text-success border border-success-subtle" style={{ fontSize: '0.68rem' }}>
                      {(TEMPLATE_CATALOGUE.find(t => t.id === activeCategoryTemplate) || {}).name || activeCategoryTemplate}
                    </span>
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-outline-secondary fw-semibold py-0 px-2"
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => setShowFullPreviewModal(true)}
                    >
                      Full Screen
                    </button>
                    <button
                      className="btn btn-sm btn-primary fw-semibold py-0 px-2"
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => printTicket(PREVIEW_TICKET, activeCategoryTemplate)}
                    >
                      🖨️ Test {printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Print'}
                    </button>
                  </div>
                </div>

                <div className="p-3 overflow-auto" style={{ backgroundColor: 'var(--surface-2)', maxHeight: '520px' }}>
                  <div className="border bg-white p-3 shadow-sm rounded-2 mx-auto w-100" style={{ maxWidth: '680px', minHeight: '420px', borderColor: 'var(--line)' }}>
                    <div dangerouslySetInnerHTML={{ __html: generateSlipHtml(PREVIEW_TICKET, activeCategoryTemplate) }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL SCREEN TEMPLATE PREVIEW MODAL */}
      {showFullPreviewModal && (
        <div 
          className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-75 d-flex align-items-center justify-content-center p-3" 
          style={{ zIndex: 1050 }}
        >
          <div className="card shadow-lg w-100 h-100 max-vw-100 max-vh-100 d-flex flex-column" style={{ maxWidth: '900px', maxHeight: '90vh' }}>
            <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center py-2 px-3">
              <span className="fw-bold">
                🔍 Full View ({printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Standard Print'}) — {(TEMPLATE_CATALOGUE.find(t => t.id === activeCategoryTemplate) || {}).name || activeCategoryTemplate}
              </span>
              <div className="d-flex gap-2">
                <button
                  className="btn btn-sm btn-success fw-bold px-3"
                  onClick={() => printTicket(PREVIEW_TICKET, activeCategoryTemplate)}
                >
                  🖨️ Test {printCategory === 'DC' ? 'DC Print' : printCategory === 'GATE_PASS' ? 'Gate Pass' : 'Print'}
                </button>
                <button 
                  className="btn btn-sm btn-light fw-bold"
                  onClick={() => setShowFullPreviewModal(false)}
                >
                  ✕ Close
                </button>
              </div>
            </div>
            <div className="card-body overflow-auto p-4 bg-light d-flex justify-content-center align-items-start">
              <div className="bg-white p-4 shadow-sm border rounded-3 w-100" style={{ maxWidth: '720px' }}>
                <div dangerouslySetInnerHTML={{ __html: generateSlipHtml(PREVIEW_TICKET, activeCategoryTemplate) }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Address Setting (Matching Screenshot 1) */}
      {activeTab === 'address' && (
        <div className="card p-4" style={{ backgroundColor: '#D8E2DC', borderColor: '#5B8C5A', borderRadius: '4px' }}>
          <div className="d-flex flex-column gap-3 max-w-100">
            <div className="d-flex align-items-center gap-3">
              <label className="fw-bold text-dark text-nowrap" style={{ width: '150px', fontSize: '0.88rem' }}>Company Name</label>
              <input 
                className="form-control bg-white border border-secondary" 
                value={addressSettings.companyName} 
                onChange={(e) => setAddressSettings({ ...addressSettings, companyName: e.target.value })} 
              />
            </div>
            <div className="d-flex align-items-center gap-3">
              <label className="fw-bold text-dark text-nowrap" style={{ width: '150px', fontSize: '0.88rem' }}>Address Line 1 :</label>
              <input 
                className="form-control bg-white border border-secondary" 
                value={addressSettings.address1} 
                onChange={(e) => setAddressSettings({ ...addressSettings, address1: e.target.value })} 
              />
            </div>
            <div className="d-flex align-items-center gap-3">
              <label className="fw-bold text-dark text-nowrap" style={{ width: '150px', fontSize: '0.88rem' }}>Address Line 2 :</label>
              <input 
                className="form-control bg-white border border-secondary" 
                value={addressSettings.address2} 
                onChange={(e) => setAddressSettings({ ...addressSettings, address2: e.target.value })} 
              />
            </div>
            <div className="d-flex align-items-center gap-3">
              <label className="fw-bold text-dark text-nowrap" style={{ width: '150px', fontSize: '0.88rem' }}>Page A5 Landscape</label>
              <input 
                className="form-control bg-white border border-secondary" 
                placeholder="A5 Landscape Print Setting" 
                value={addressSettings.pageFormat ?? ''} 
                onChange={(e) => setAddressSettings({ ...addressSettings, pageFormat: e.target.value })} 
              />
            </div>

            <div className="d-flex justify-content-end align-items-center gap-3 mt-2">
              {addressSaved && (
                <span className="fw-bold text-success" style={{ fontSize: '0.82rem' }}>
                  ✔ Saved — reports will use this heading
                </span>
              )}
              <button
                className="btn fw-bold px-4 py-1"
                style={{ backgroundColor: '#E0E000', border: '1px solid #999', color: '#000', minWidth: '100px' }}
                onClick={handleSaveAddress}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Camera IP Settings */}
      {activeTab === 'camera' && (
        <div className="fluent-card p-3">
          <h6 className="fw-bold mb-3 border-bottom pb-2">Camera IP Settings</h6>
          <CameraManagement />
        </div>
      )}

      {/* TAB 6: RF IDs Adding (Matching Screenshot 2 1:1) */}
      {activeTab === 'rfid' && (
        <div className="row g-3 align-items-stretch">
          {/* Left Form Box */}
          <div className="col-12 col-md-4">
            <div className="card p-3 d-flex flex-column h-100" style={{ backgroundColor: '#D8E2DC', border: '2px solid #5B8C5A', borderRadius: '4px' }}>
              <form onSubmit={handleSaveRfid} className="d-flex flex-column h-100">
                <div className="mb-2">
                  <label className="form-label text-dark fw-bold mb-1" style={{ fontSize: '0.8rem' }}>CARD NUMBER</label>
                  <input 
                    className="form-control form-control-sm bg-white border border-secondary" 
                    value={rfidForm.cardNumber} 
                    onChange={(e) => setRfidForm({ ...rfidForm, cardNumber: e.target.value })} 
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label text-dark fw-bold mb-1" style={{ fontSize: '0.8rem' }}>VEHICLE</label>
                  <input 
                    className="form-control form-control-sm bg-white border border-secondary" 
                    value={rfidForm.vehicle} 
                    onChange={(e) => setRfidForm({ ...rfidForm, vehicle: e.target.value })} 
                  />
                </div>

                <div className="mb-2">
                  <label className="form-label text-dark fw-bold mb-1" style={{ fontSize: '0.8rem' }}>MATERIAL</label>
                  <input 
                    className="form-control form-control-sm bg-white border border-secondary" 
                    value={rfidForm.material} 
                    onChange={(e) => setRfidForm({ ...rfidForm, material: e.target.value })} 
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label text-dark fw-bold mb-1" style={{ fontSize: '0.8rem' }}>CONTRACTOR</label>
                  <select 
                    className="form-select form-select-sm bg-white border border-secondary" 
                    value={rfidForm.contractor} 
                    onChange={(e) => setRfidForm({ ...rfidForm, contractor: e.target.value })}
                  >
                    <option value="">Select Contractor</option>
                    {(() => {
                      const list = [...contractorsList];
                      if (rfidForm.contractor && !list.includes(rfidForm.contractor)) {
                        list.unshift(rfidForm.contractor);
                      }
                      return list.map((cName, idx) => (
                        <option key={idx} value={cName}>{cName}</option>
                      ));
                    })()}
                  </select>
                </div>

                <div className="d-flex gap-2 justify-content-center mt-auto">
                  <button type="submit" className="btn btn-sm fw-bold px-4 text-dark" style={{ backgroundColor: '#E0E000', border: '1px solid #666', minWidth: '80px' }}>Save</button>
                  <button type="button" className="btn btn-sm fw-bold px-4 text-white" style={{ backgroundColor: '#C84B4B', border: '1px solid #666', minWidth: '80px' }} onClick={() => setRfidForm({ cardNumber: '', vehicle: '', material: 'BOULDERS', contractor: '' })}>Delete</button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Display Panel */}
          <div className="col-12 col-md-8">
            <div className="card p-3 d-flex flex-column h-100" style={{ backgroundColor: '#D8E2DC', border: '2px solid #5B8C5A', borderRadius: '4px' }}>
              <div className="table-responsive bg-white border border-secondary flex-grow-1 overflow-auto rounded-1" style={{ minHeight: '260px', maxHeight: '420px' }}>
                <table className="table table-bordered table-sm align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light text-secondary text-uppercase" style={{ fontSize: '0.75rem', backgroundColor: '#e9ecef' }}>
                    <tr>
                      <th style={{ width: '22%' }}>CARD NUMBER</th>
                      <th style={{ width: '25%' }}>VEHICLE</th>
                      <th style={{ width: '25%' }}>MATERIAL</th>
                      <th style={{ width: '20%' }}>CONTRACTOR</th>
                      <th style={{ width: '8%' }} className="text-center">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfidList.map((item) => (
                      <tr key={item.id}>
                        <td className="fw-bold">{item.cardNumber}</td>
                        <td>{item.vehicle}</td>
                        <td>{item.material}</td>
                        <td>{item.contractor || '—'}</td>
                        <td className="text-center">
                          <button className="btn btn-sm text-danger border-danger py-0 px-2" style={{ fontSize: '0.75rem', borderRadius: '10px' }} onClick={() => handleDeleteRfid(item.id)}>Del</button>
                        </td>
                      </tr>
                    ))}
                    {rfidList.length === 0 && (
                      <tr><td colSpan="5" className="text-center text-muted py-5">No registered RFID cards found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: Transporter Vehicles (Matching Screenshot 3 1:1) */}
      {activeTab === 'transporter' && (
        <div className="row g-3 align-items-stretch">
          {/* Left Panel */}
          <div className="col-12 col-md-4">
            <div className="card p-3 d-flex flex-column h-100" style={{ backgroundColor: '#D8E2DC', border: '2px solid #5B8C5A', borderRadius: '4px' }}>
              <div className="mb-2">
                <label className="form-label text-dark fw-bold mb-1" style={{ fontSize: '0.8rem' }}>TRANSPORTER</label>
                <input 
                  className="form-control form-control-sm bg-white border border-secondary" 
                  value={transporterForm.transporter} 
                  onChange={(e) => setTransporterForm({ ...transporterForm, transporter: e.target.value })} 
                />
              </div>

              <div className="mb-3">
                <label className="form-label text-dark fw-bold mb-1" style={{ fontSize: '0.8rem' }}>VEHICLE</label>
                <input 
                  className="form-control form-control-sm bg-white border border-secondary" 
                  value={transporterForm.vehicleNo} 
                  onChange={(e) => setTransporterForm({ ...transporterForm, vehicleNo: e.target.value })} 
                />
              </div>

              <div className="d-flex gap-2 justify-content-center mt-auto">
                <button 
                  type="button" 
                  className="btn btn-sm fw-bold px-4 text-dark" 
                  style={{ backgroundColor: '#E0E000', border: '1px solid #666', minWidth: '80px' }}
                  onClick={() => {
                    if (!transporterForm.transporter || !transporterForm.vehicleNo) return alert('Please enter Transporter and Vehicle');
                    setTransporterList([...transporterList, { id: Date.now(), ...transporterForm }]);
                    setTransporterForm({ transporter: '', vehicleNo: '', capacity: '' });
                  }}
                >
                  Save
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm fw-bold px-4 text-white" 
                  style={{ backgroundColor: '#C84B4B', border: '1px solid #666', minWidth: '80px' }}
                  onClick={() => setTransporterForm({ transporter: '', vehicleNo: '', capacity: '' })}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="col-12 col-md-8">
            <div className="card p-3 d-flex flex-column h-100" style={{ backgroundColor: '#D8E2DC', border: '2px solid #5B8C5A', borderRadius: '4px' }}>
              <div className="table-responsive bg-white border border-secondary flex-grow-1 overflow-auto rounded-1" style={{ minHeight: '260px', maxHeight: '420px' }}>
                <table className="table table-bordered table-sm align-middle mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light text-secondary text-uppercase" style={{ fontSize: '0.75rem', backgroundColor: '#e9ecef' }}>
                    <tr>
                      <th style={{ width: '45%' }}>TRANSPORTER</th>
                      <th style={{ width: '45%' }}>VEHICLE</th>
                      <th style={{ width: '10%' }} className="text-center">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transporterList.map(t => (
                      <tr key={t.id}>
                        <td className="fw-bold">{t.transporter}</td>
                        <td>{t.vehicleNo}</td>
                        <td className="text-center">
                          <button className="btn btn-sm text-danger border-danger py-0 px-2" style={{ fontSize: '0.75rem', borderRadius: '10px' }} onClick={() => setTransporterList(transporterList.filter(x => x.id !== t.id))}>Del</button>
                        </td>
                      </tr>
                    ))}
                    {transporterList.length === 0 && (
                      <tr><td colSpan="3" className="text-center text-muted py-5">No transporter records registered.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: Get Old DC (Matching Screenshot 4 1:1) */}
      {activeTab === 'olddc' && (
        <div className="row g-3 align-items-stretch">
          {/* Left Box */}
          <div className="col-12 col-md-4">
            <div className="card p-3 d-flex flex-column h-100" style={{ backgroundColor: '#D8E2DC', border: '2px solid #5B8C5A', borderRadius: '4px' }}>
              <form onSubmit={handleSearchOldDc} className="d-flex flex-column h-100">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '90px', fontSize: '0.82rem' }}>DC Number :</label>
                  <input 
                    className="form-control form-control-sm bg-white border border-secondary" 
                    value={searchDc} 
                    onChange={(e) => setSearchDc(e.target.value)} 
                  />
                </div>

                <div className="d-flex align-items-center gap-2 mb-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '90px', fontSize: '0.82rem' }}>Date</label>
                  <input 
                    type="text" 
                    className="form-control form-control-sm bg-white border border-secondary" 
                    defaultValue="21-07-2026" 
                  />
                </div>

                <div className="d-flex align-items-center gap-2 mb-3">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '90px', fontSize: '0.82rem' }}>Type :</label>
                  <select className="form-select form-select-sm bg-white border border-secondary">
                    <option value="All">All Transactions</option>
                    <option value="Sales">Sales Weighment</option>
                    <option value="Boulders">Boulders</option>
                  </select>
                </div>

                <div className="d-flex justify-content-end mt-auto">
                  <button 
                    type="submit" 
                    className="btn btn-sm fw-bold px-4 text-white" 
                    style={{ backgroundColor: '#C84B4B', border: '1px solid #666', minWidth: '70px' }}
                  >
                    Get
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Display Box */}
          <div className="col-12 col-md-8">
            <div className="card p-3 d-flex flex-column h-100" style={{ backgroundColor: '#D8E2DC', border: '2px solid #5B8C5A', borderRadius: '4px' }}>
              <div className="d-flex flex-column gap-2 mb-3">
                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Vehicle :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value={oldDcResult?.vehicle || ''} readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Party :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value={oldDcResult?.contractor || oldDcResult?.party || ''} readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Material :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value={oldDcResult?.material || ''} readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Source :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value="BMW Quarry" readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Destination :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value="Stock Yard" readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Gross :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value={oldDcResult?.gross || ''} readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Tare :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary" value={oldDcResult?.tare || ''} readOnly />
                </div>

                <div className="d-flex align-items-center gap-2">
                  <label className="fw-bold text-dark text-nowrap" style={{ width: '100px', fontSize: '0.82rem' }}>Nett :</label>
                  <input className="form-control form-control-sm bg-white border border-secondary fw-bold" value={oldDcResult?.net || ''} readOnly />
                </div>
              </div>

              <div className="d-flex gap-2 justify-content-center mt-auto">
                <button 
                  type="button" 
                  className="btn btn-sm fw-bold px-3 text-white" 
                  style={{ backgroundColor: '#C84B4B', border: '1px solid #666' }}
                  onClick={() => printTicket({ dcNum: searchDc || '1', vehicle: oldDcResult?.vehicle || 'TEST', material: oldDcResult?.material || 'Gravel', party: oldDcResult?.party || 'BMW', gross: oldDcResult?.gross || '56750', tare: oldDcResult?.tare || '16500', net: oldDcResult?.net || '40250' })}
                >
                  Print Bill
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm fw-bold px-3 text-white" 
                  style={{ backgroundColor: '#C84B4B', border: '1px solid #666' }}
                  onClick={() => printTicket({ dcNum: searchDc || '1', vehicle: oldDcResult?.vehicle || 'TEST', material: oldDcResult?.material || 'Gravel', party: oldDcResult?.party || 'BMW', gross: oldDcResult?.gross || '56750', tare: oldDcResult?.tare || '16500', net: oldDcResult?.net || '40250' })}
                >
                  DC Print
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm fw-bold px-3 text-white" 
                  style={{ backgroundColor: '#C84B4B', border: '1px solid #666' }}
                  onClick={() => alert('Printing Gate Pass...')}
                >
                  Gate Pass
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Royalty Settings */}
      {activeTab === 'royalty' && (
        <div className="row g-3">
          <div className="col-12 col-md-8 col-lg-6">
            <div className="card shadow-sm border-0" style={{ borderRadius: '8px', overflow: 'hidden', background: '#ffffff', border: '1px solid var(--line)' }}>
              <div className="card-header border-0 py-2.5 px-3 d-flex justify-content-between align-items-center" style={{ backgroundColor: 'var(--surface-2)', borderBottom: '1.5px solid var(--line-soft)' }}>
                <span className="fw-bold" style={{ color: 'var(--ink)', fontSize: '0.88rem' }}>👑 Royalty Rates Configuration</span>
              </div>
              <div className="card-body p-4">
                <div className="mb-3">
                  <label className="form-label fw-bold" style={{ fontSize: '0.85rem' }}>Government Royalty Rate (₹ / Tonne or Unit)</label>
                  <input
                    type="number"
                    step="any"
                    className="form-control"
                    value={govRoyaltyRate}
                    onChange={(e) => setGovRoyaltyRate(e.target.value)}
                    placeholder="Enter Government Royalty Rate"
                  />
                  <div className="form-text text-muted" style={{ fontSize: '0.75rem' }}>Applied automatically when 'Government' royalty type is selected in Sales.</div>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-bold" style={{ fontSize: '0.85rem' }}>General Royalty Rate (₹ / Tonne or Unit)</label>
                  <input
                    type="number"
                    step="any"
                    className="form-control"
                    value={genRoyaltyRate}
                    onChange={(e) => setGenRoyaltyRate(e.target.value)}
                    placeholder="Enter General Royalty Rate"
                  />
                  <div className="form-text text-muted" style={{ fontSize: '0.75rem' }}>Applied automatically when 'General' royalty type is selected in Sales.</div>
                </div>
                <button
                  type="button"
                  className="btn btn-dark fw-bold px-4"
                  onClick={handleSaveRoyaltySettings}
                >
                  Save Royalty Rates
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
