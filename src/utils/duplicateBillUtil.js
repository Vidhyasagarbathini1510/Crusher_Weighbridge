import { api } from '../api/client.js';

export const DUPLICATE_BILL_MODES = {
  SHOW: 'SHOW', // Show duplicate bills in menus and allow access
  HIDE: 'HIDE'  // Hide duplicate bills in menus and disable access
};

export const PRINT_ONCE_MODES = {
  STAY: 'STAY', // Stay visible after click (Allow re-print)
  HIDE: 'HIDE'  // Hide print button immediately once clicked
};

/**
 * Fetch Duplicate Bills Mode (SHOW or HIDE)
 */
export async function getDuplicateBillsMode() {
  try {
    if (api && api.getSettings) {
      const settings = await api.getSettings();
      if (settings && settings.duplicate_bills_mode) {
        return settings.duplicate_bills_mode;
      }
    }
  } catch (err) {
    console.warn('[duplicateBillUtil] Error reading duplicate_bills_mode:', err);
  }
  return localStorage.getItem('noris_duplicate_bills_mode') || DUPLICATE_BILL_MODES.SHOW;
}

/**
 * Save Duplicate Bills Mode (SHOW or HIDE)
 */
export async function setDuplicateBillsMode(mode) {
  try {
    localStorage.setItem('noris_duplicate_bills_mode', mode);
    if (api && api.saveSetting) {
      await api.saveSetting('duplicate_bills_mode', mode);
    }
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('workflow-setting-changed', { detail: { duplicateBillsMode: mode } }));
  } catch (err) {
    console.error('[duplicateBillUtil] Error saving duplicate_bills_mode:', err);
  }
}

/**
 * Fetch Print Once Hide Mode (STAY or HIDE)
 */
export async function getPrintOnceHideMode() {
  try {
    if (api && api.getSettings) {
      const settings = await api.getSettings();
      if (settings && settings.print_once_hide_mode) {
        return settings.print_once_hide_mode;
      }
    }
  } catch (err) {
    console.warn('[duplicateBillUtil] Error reading print_once_hide_mode:', err);
  }
  return localStorage.getItem('noris_print_once_hide_mode') || PRINT_ONCE_MODES.STAY;
}

/**
 * Save Print Once Hide Mode (STAY or HIDE)
 */
export async function setPrintOnceHideMode(mode) {
  try {
    localStorage.setItem('noris_print_once_hide_mode', mode);
    if (api && api.saveSetting) {
      await api.saveSetting('print_once_hide_mode', mode);
    }
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('workflow-setting-changed', { detail: { printOnceHideMode: mode } }));
  } catch (err) {
    console.error('[duplicateBillUtil] Error saving print_once_hide_mode:', err);
  }
}
