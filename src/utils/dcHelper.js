// Centralized DC Helper — routes preview and assignment requests to Host PC SQLite database

function parseArgs(arg1, arg2, arg3) {
  let type = 'NON-GST';
  let prefix = 'DC-';
  let module = 'sales';

  const knownModules = ['sales', 'boulders', 'yard', 'loading'];

  if (arg1 === 'GST' || arg1 === 'NON-GST') {
    type = arg1;
  } else if (arg1 && typeof arg1 === 'string') {
    const norm = String(arg1).trim().toLowerCase();
    if (knownModules.includes(norm) && arg1.toLowerCase() !== 'dc-') {
      module = norm;
    } else {
      prefix = arg1;
    }
  }

  if (arg2 && typeof arg2 === 'string') {
    const norm = String(arg2).trim().toLowerCase();
    if (knownModules.includes(norm)) {
      module = norm;
    } else {
      prefix = arg2;
    }
  }

  if (arg3 && typeof arg3 === 'string') {
    module = String(arg3).trim().toLowerCase();
  }

  return { type, prefix, module };
}

/**
 * Read-only preview of next DC number from Host PC.
 * Returns a Promise resolving to formatted DC string (e.g. "DC-1", "DC-2").
 */
export function getNextDcNumber(arg1 = 'NON-GST', arg2 = 'DC-', arg3 = 'sales') {
  const { type, prefix, module } = parseArgs(arg1, arg2, arg3);
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.peekNextDcNumber) {
    return window.electronAPI.peekNextDcNumber({ type, prefix, module });
  }
  return Promise.resolve(`${prefix}1`);
}

/**
 * Atomic DC assignment and increment on Host PC.
 * Returns a Promise resolving to assigned DC string.
 */
export function incrementDcNumber(arg1 = 'NON-GST', arg2 = 'DC-', arg3 = 'sales') {
  const { type, prefix, module } = parseArgs(arg1, arg2, arg3);
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getAndAssignDc) {
    return window.electronAPI.getAndAssignDc({ type, prefix, module });
  }
  return Promise.resolve(`${prefix}1`);
}

export function resetDcCounter(arg1 = 'NON-GST', arg2 = 'DC-', arg3 = 'sales') {
  return `${arg2 || 'DC-'}1`;
}

export function syncDcCounterFromTransactions() {
  // No-op: DC numbers are centrally managed by Host PC SQLite database (weighbridge.db)
}
