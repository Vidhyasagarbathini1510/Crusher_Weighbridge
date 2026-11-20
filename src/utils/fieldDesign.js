// "Bold field text" preference: a light bold on the text in the input
// boxes and dropdowns of the Boulders and Sales Weighment (Units) screens.
// Stored in the DB settings table (key below), cached in memory while running.
import { useEffect } from 'react';
import { api } from '../api/client.js';

const KEY = 'bold_field_text';
let enabled = false;
let loaded = false;

export const isThickFieldDesign = () => enabled;

export const loadFieldDesign = async () => {
  try {
    const s = await api.settings();
    enabled = String(s?.[KEY]) === 'true';
    loaded = true;
  } catch (e) {
    console.warn('[fieldDesign] load failed:', e);
  }
  window.dispatchEvent(new Event('field-design-changed'));
  return enabled;
};

export const saveFieldDesign = async (value) => {
  enabled = !!value;
  window.dispatchEvent(new Event('field-design-changed'));
  try {
    await api.saveSetting(KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('[fieldDesign] save failed:', e);
  }
  return enabled;
};

// Call from a page: adds the `bold-fields` class to <body> while the page is
// open and the setting is on. Nothing changes when the setting is off.
export function useThickFields() {
  useEffect(() => {
    const apply = () => document.body.classList.toggle('bold-fields', enabled);
    window.addEventListener('field-design-changed', apply);
    if (loaded) apply(); else loadFieldDesign();
    return () => {
      window.removeEventListener('field-design-changed', apply);
      document.body.classList.remove('bold-fields');
    };
  }, []);
}
