// Fixed order for materials in report summaries:
// 40MM, 20MM, 12MM, 6MM, M SAND, MIXING, BOULDERS — anything else after, A–Z.
// Names are matched loosely ("40 MM METAL", "M-SAND", "BOULDER") so spelling
// differences between masters still land in the right slot.
const MATERIAL_ORDER = [
  /(^|\D)40\s*MM/,
  /(^|\D)20\s*MM/,
  /(^|\D)12\s*MM/,
  /(^|\D)6\s*MM/,
  /(^|[^A-Z])M\W*SAND/,
  /MIX/,
  /BOULDER/
];

export function materialRank(name) {
  const n = String(name || '').toUpperCase();
  const i = MATERIAL_ORDER.findIndex(re => re.test(n));
  return i === -1 ? MATERIAL_ORDER.length : i;
}

export function compareMaterials(a, b) {
  return materialRank(a) - materialRank(b) || String(a || '').localeCompare(String(b || ''));
}
