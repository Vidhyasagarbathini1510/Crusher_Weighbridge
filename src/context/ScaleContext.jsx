import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client.js';

const ScaleContext = createContext();

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
      isConnected, setIsConnected
    }}>
      {children}
    </ScaleContext.Provider>
  );
}

export function useScale() {
  return useContext(ScaleContext);
}
