'use strict';

/**
 * IndicatorParsers.js
 * Multi-indicator protocol framing and decoding engine for Weighbridge indicators.
 * Supports:
 *  - Weitex: Frame delimiter 'z', format 's  [b] [+/-]weight z' (typically 2400 baud, 8-N-1)
 *  - Icom: Frame delimiter ':', numeric scaled by /10
 *  - Eassey: Frame delimiter ':', deduplicated repeating character pattern
 *  - Generic / Avery / Netron: Frame delimiter '\r\n', standard signed decimal
 */

const INDICATOR_PROTOCOLS = {
  WEITEX: 'Weitex',
  ICOM: 'Icom',
  EASSEY: 'Eassey',
  AVERY: 'Avery',
  GENERIC: 'Generic'
};

/**
 * Returns the packet delimiter RegExp or character for the given protocol.
 */
function getProtocolDelimiter(protocolName) {
  const norm = String(protocolName || '').trim().toLowerCase();
  if (norm.includes('weitex')) {
    return 'z';
  }
  if (norm.includes('icom') || norm.includes('eassey')) {
    return ':';
  }
  // Avery, Generic, or fallback: CR / LF
  return /[\r\n]+/;
}

/**
 * Parse a single frame/chunk according to the selected indicator protocol.
 * @param {string} chunk - Raw text between packet delimiters
 * @param {string} protocolName - Protocol name ('Weitex', 'Icom', 'Eassey', 'Avery', etc.)
 * @returns {{ value: string|null, isStable?: boolean, raw: string }}
 */
function parseIndicatorFrame(chunk, protocolName) {
  if (!chunk) return { value: null, raw: chunk };
  const raw = String(chunk).trim();
  if (!raw) return { value: null, raw };

  const norm = String(protocolName || '').trim().toLowerCase();

  // 1. WEITEX INDICATOR (e.g., 's  b    0', 's  -20', 's  100', 's  50')
  if (norm.includes('weitex')) {
    const isStable = raw.startsWith('s') || raw.startsWith('S');

    // Check for negative number: e.g. '-20', '- 20'
    const signedMatch = raw.match(/([+-]?\s*\d+)/);
    if (signedMatch) {
      // Clean inner spaces if any (e.g. '- 20' -> '-20')
      const cleanNumStr = signedMatch[1].replace(/\s+/g, '');
      const parsedNum = parseInt(cleanNumStr, 10);
      if (!isNaN(parsedNum)) {
        return {
          value: String(parsedNum),
          isStable,
          raw
        };
      }
    }

    // Fallback: extract any digits
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits) {
      const val = parseInt(digits, 10);
      return {
        value: String(isNaN(val) ? 0 : val),
        isStable,
        raw
      };
    }
    return { value: null, isStable, raw };
  }

  // 2. ICOM INDICATOR (e.g. ': 0012340 :' -> 1234.0 or 1234)
  if (norm.includes('icom')) {
    // Extract signed number or digits
    const cleaned = raw.replace(/[^0-9.-]/g, '');
    if (cleaned) {
      const num = parseFloat(cleaned);
      if (!isNaN(num)) {
        // Divided by 10 as per legacy IcomString implementation
        const scaled = num / 10;
        // Format nicely: avoid trailing .0 if integer
        const formatted = Number.isInteger(scaled) ? String(scaled) : String(Math.round(scaled * 100) / 100);
        return {
          value: formatted,
          isStable: true,
          raw
        };
      }
    }
    return { value: null, raw };
  }

  // 3. EASSEY INDICATOR (Legacy half-string deduplication)
  if (norm.includes('eassey')) {
    let digits = raw.replace(/[^0-9]/g, '');
    if (digits.length > 2) {
      digits = digits.slice(0, -2);
      const j = Math.floor((digits.length - 1) / 2);
      let weight1 = '';
      for (let i = 0; i < j; i++) {
        weight1 += digits[i];
      }
      if (weight1) {
        const parsed = parseInt(weight1, 10);
        if (!isNaN(parsed)) {
          return {
            value: String(parsed),
            isStable: true,
            raw
          };
        }
      }
    }
    return { value: null, raw };
  }

  // 4. GENERIC / AVERY / ASCII STANDARD
  const numeric = raw.replace(/[^0-9.-]/g, '');
  if (numeric && !isNaN(Number(numeric))) {
    // Clean redundant negative signs or points
    const parsed = parseFloat(numeric);
    if (!isNaN(parsed)) {
      return {
        value: Number.isInteger(parsed) ? String(parsed) : String(parsed),
        isStable: true,
        raw
      };
    }
  }

  return { value: null, raw };
}

module.exports = {
  INDICATOR_PROTOCOLS,
  getProtocolDelimiter,
  parseIndicatorFrame
};
