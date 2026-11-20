// Date & time display preferences for the navbar clock (stored in the DB settings table).
import { api } from '../api/client.js';
const KEYS = {
  timeFormat: 'noris_clock_time_format',
  dateFormat: 'noris_clock_date_format',
  size: 'noris_clock_size',
};

export const DATE_FORMAT_OPTIONS = [
  { value: 'full', label: 'Tuesday 17 November 2026' },
  { value: 'dd/mm/yyyy', label: '17/11/2026' },
  { value: 'mm/dd/yyyy', label: '11/17/2026' },
  { value: 'yyyy-mm-dd', label: '2026-11-17' },
  { value: 'dd-mmm-yyyy', label: '17 Nov 2026' },
];

const DEFAULTS = { timeFormat: '12', dateFormat: 'full', size: 'normal' };
let cache = { ...DEFAULTS };

const normalize = (raw = {}) => ({
  timeFormat: String(raw.timeFormat) === '24' ? '24' : '12',
  dateFormat: DATE_FORMAT_OPTIONS.some(o => o.value === raw.dateFormat) ? raw.dateFormat : 'full',
  size: raw.size === 'large' ? 'large' : 'normal',
});

// Current in-memory copy (filled from the database by loadClockSettings).
export const getClockSettings = () => cache;

// Read the saved preferences from the database settings table.
export const loadClockSettings = async () => {
  try {
    const s = await api.settings();
    cache = normalize({
      timeFormat: s?.[KEYS.timeFormat],
      dateFormat: s?.[KEYS.dateFormat],
      size: s?.[KEYS.size],
    });
  } catch (e) {
    console.warn('[clockSettings] load failed:', e);
  }
  window.dispatchEvent(new Event('clock-settings-changed'));
  return cache;
};

// Apply immediately, then persist to the database.
export const saveClockSettings = async (patch) => {
  cache = normalize({ ...cache, ...patch });
  window.dispatchEvent(new Event('clock-settings-changed'));
  try {
    await Promise.all([
      api.saveSetting(KEYS.timeFormat, cache.timeFormat),
      api.saveSetting(KEYS.dateFormat, cache.dateFormat),
      api.saveSetting(KEYS.size, cache.size),
    ]);
  } catch (e) {
    console.error('[clockSettings] save failed:', e);
  }
  return cache;
};

export const formatClockTime = (date, timeFormat) =>
  date.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: timeFormat !== '24',
    ...(timeFormat === '24' ? { hourCycle: 'h23' } : {}),
  });

export const formatClockDate = (date, dateFormat) => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  switch (dateFormat) {
    case 'dd/mm/yyyy': return `${dd}/${mm}/${yyyy}`;
    case 'mm/dd/yyyy': return `${mm}/${dd}/${yyyy}`;
    case 'yyyy-mm-dd': return `${yyyy}-${mm}-${dd}`;
    case 'dd-mmm-yyyy':
      return `${dd} ${date.toLocaleDateString('en-GB', { month: 'short' })} ${yyyy}`;
    default:
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  }
};

export const clockFontSizes = (size) =>
  size === 'large' ? { time: '0.88rem', date: '0.76rem' } : { time: '0.75rem', date: '0.65rem' };
