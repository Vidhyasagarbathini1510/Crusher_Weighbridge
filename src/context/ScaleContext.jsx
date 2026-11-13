import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client.js';

const defaultScaleContext = {
  showFooter: true,
  setShowFooter: () => {},
  card: '',
  setCard: () => {},
  vehicle: '',
  setVehicle: () => {},
  gross: '',
  setGross: () => {},
  tare: '',
  setTare: () => {},
  nett: '',
  setNett: () => {},
  isConnected: true,
  setIsConnected: () => {},
  signalGo: false,
  setSignalGo: () => {},
  signalStop: true,
  setSignalStop: () => {},
  signalAlert: false,
  setSignalAlert: () => {},
  cooldownAlert: null,
  setCooldownAlert: () => {}
};

const ScaleContext = createContext(defaultScaleContext);

export function ScaleProvider({ children }) {
  const [showFooter, setShowFooter] = useState(true);
  const [card, setCard] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [nett, setNett] = useState('');
  
  const [isConnected, setIsConnected] = useState(true);
  
  const [signalGo, setSignalGo] = useState(false);
  const [signalStop, setSignalStop] = useState(true);
  const [signalAlert, setSignalAlert] = useState(false);

  // Load footer visibility setting from DB/backend
  useEffect(() => {
    if (api && api.settings) {
      api.settings().then(s => {
        if (s && s.footer_visibility !== undefined) {
          setShowFooter(s.footer_visibility !== 'hide' && s.footer_visibility !== 'false');
        }
      }).catch(err => console.error('[ScaleContext] Error loading footer visibility:', err));
    }

    const handleFooterChange = (e) => {
      if (e && e.detail && e.detail.visibility !== undefined) {
        setShowFooter(e.detail.visibility !== 'hide' && e.detail.visibility !== 'false');
      }
    };
    window.addEventListener('footer-visibility-changed', handleFooterChange);
    return () => {
      window.removeEventListener('footer-visibility-changed', handleFooterChange);
    };
  }, []);

  // Auto calculate Nett when Gross or Tare changes (higher value - lower value = net)
  useEffect(() => {
    const g = parseFloat(gross) || 0;
    const t = parseFloat(tare) || 0;
    setNett(Math.abs(g - t).toString());
  }, [gross, tare]);

  // Optionally listen to Electron Netron Weight Scale globally
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onNetronData((data) => {
      if (data && data.value) {
        const valStr = String(data.value);
        if (valStr.includes('Offline')) {
          setIsConnected(false);
        } else {
          setIsConnected(true);
          const isBouldersManual = localStorage.getItem('noris_boulders_manual_entry') === 'true';
          const isBouldersHash = typeof window !== 'undefined' && window.location.hash.toLowerCase().includes('boulders');
          if (isBouldersManual && isBouldersHash) {
            return;
          }
          const numeric = valStr.replace(/[^0-9.-]/g, '');
          if (numeric) {
            setGross(numeric);
          }
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Listen to RFID Reader globally (IPC channel)
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onRfidData) return;
    const unsubscribe = window.electronAPI.onRfidData((data) => {
      if (data && (data.cardNo || data.epc)) {
        setCard(data.cardNo || data.epc);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Listen to Unmanned Serial Box globally (IPC channel)
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUnmannedCardData) return;
    const unsubscribe = window.electronAPI.onUnmannedCardData((data) => {
      if (data && data.cardNo) {
        console.log('[ScaleContext] Unmanned card scan received:', data.cardNo);
        setCard(String(data.cardNo).trim());
        if (data.vehicleNo) setVehicle(String(data.vehicleNo).trim());
        if (data.gross !== undefined && data.gross !== null && !isNaN(data.gross)) setGross(String(data.gross));
        if (data.tare !== undefined && data.tare !== null && !isNaN(data.tare)) setTare(String(data.tare));
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Global USB Keyboard RFID Scanner listener (for USB HID mode RFID readers)
  useEffect(() => {
    let scanBuffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e) => {
      // Ignore functional keys except Enter
      if (e.key.length > 1 && e.key !== 'Enter') return;

      const now = Date.now();
      // Scanners type keypresses in < 60ms sequence. Reset if gap > 100ms
      if (now - lastKeyTime > 100) {
        scanBuffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        const cleaned = scanBuffer.trim();
        // RFID cards are typically 3 to 64 alphanumeric characters
        if (cleaned.length >= 3 && cleaned.length <= 64 && /^[A-Za-z0-9\-\_]+$/.test(cleaned)) {
          console.log('[ScaleContext] Captured USB HID RFID scan:', cleaned);
          setCard(cleaned);
        }
        scanBuffer = '';
      } else if (e.key.length === 1) {
        scanBuffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const [cooldownAlert, setCooldownAlert] = useState(null);

  // Listen to Card Cooldown Blocked events (IPC channel)
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onCardCooldownBlocked) return;
    const unsubscribe = window.electronAPI.onCardCooldownBlocked((data) => {
      if (data && data.cardNo) {
        console.warn(`[ScaleContext] Card ${data.cardNo} blocked by cooldown! Remaining: ${data.remainingMins} min`);
        setCooldownAlert({
          cardNo: data.cardNo,
          remainingMins: data.remainingMins,
          remainingSecs: data.remainingSecs,
          source: data.source
        });
        setTimeout(() => {
          setCooldownAlert(null);
        }, 6000);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Listen to physical signal changes (B = Green, C = Red) from Unmanned Serial Box
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onSignalStatusChange) return;
    const unsubscribe = window.electronAPI.onSignalStatusChange((data) => {
      if (data) {
        if (typeof data.signalGo === 'boolean') setSignalGo(data.signalGo);
        if (typeof data.signalStop === 'boolean') setSignalStop(data.signalStop);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  return (
    <ScaleContext.Provider value={{
      showFooter, setShowFooter,
      card, setCard,
      vehicle, setVehicle,
      gross, setGross,
      tare, setTare,
      nett, setNett,
      signalGo, setSignalGo,
      signalStop, setSignalStop,
      signalAlert, setSignalAlert,
      isConnected, setIsConnected,
      cooldownAlert, setCooldownAlert
    }}>
      {children}
    </ScaleContext.Provider>
  );
}

export function useScale() {
  const context = useContext(ScaleContext);
  return context || defaultScaleContext;
}
