// Brand-wise RTSP stream path templates.
//
// Every IP camera vendor exposes its streams under a different URL path. Rather
// than asking the operator to know that a Hikvision main stream lives at
// /Streaming/Channels/101 while the Dahua equivalent is
// /cam/realmonitor?channel=1&subtype=0, the Add Camera form asks for the brand
// and builds the path from these templates.
//
// `main` is the full-resolution stream, `sub` the lower-resolution one most
// NVR grids use for multi-camera views.

export const RTSP_BRANDS = [
  {
    id: 'hikvision',
    label: 'Hikvision',
    main: '/Streaming/Channels/101',
    sub: '/Streaming/Channels/102'
  },
  {
    id: 'dahua',
    label: 'Dahua',
    main: '/cam/realmonitor?channel=1&subtype=0',
    sub: '/cam/realmonitor?channel=1&subtype=1'
  },
  {
    // CP Plus units are Dahua OEM hardware and share the Dahua URL scheme.
    id: 'cpplus',
    label: 'CP Plus',
    main: '/cam/realmonitor?channel=1&subtype=0',
    sub: '/cam/realmonitor?channel=1&subtype=1'
  },
  {
    id: 'uniview',
    label: 'Uniview (UNV)',
    main: '/media/video1',
    sub: '/media/video2'
  },
  {
    // Amcrest is also Dahua-derived.
    id: 'amcrest',
    label: 'Amcrest',
    main: '/cam/realmonitor?channel=1&subtype=0',
    sub: '/cam/realmonitor?channel=1&subtype=1'
  },
  {
    id: 'reolink',
    label: 'Reolink',
    main: '/h264Preview_01_main',
    sub: '/h264Preview_01_sub'
  },
  {
    id: 'tplink',
    label: 'TP-Link / Tapo',
    main: '/stream1',
    sub: '/stream2'
  },
  {
    id: 'hanwha',
    label: 'Hanwha / Samsung',
    main: '/profile1/media.smp',
    sub: '/profile2/media.smp'
  },
  {
    id: 'axis',
    label: 'Axis',
    main: '/axis-media/media.amp',
    sub: '/axis-media/media.amp?resolution=640x480'
  },
  {
    id: 'bosch',
    label: 'Bosch',
    main: '/rtsp_tunnel?h26x=4&line=1&inst=1',
    sub: '/rtsp_tunnel?h26x=4&line=1&inst=2'
  },
  {
    id: 'honeywell',
    label: 'Honeywell',
    main: '/h264/ch1/main/av_stream',
    sub: '/h264/ch1/sub/av_stream'
  },
  {
    // Escape hatch: unknown vendor, operator supplies the path by hand.
    id: 'other',
    label: 'Other / Custom path',
    main: '',
    sub: ''
  }
];

export const STREAM_TYPES = [
  { id: 'main', label: 'Main Stream (high quality)' },
  { id: 'sub', label: 'Sub Stream (low bandwidth)' }
];

export function getBrand(brandId) {
  return RTSP_BRANDS.find(b => b.id === brandId) || null;
}

export function isCustomBrand(brandId) {
  return !brandId || brandId === 'other';
}

/** The stream path for a brand + Main/Sub choice. Empty for the custom brand. */
export function buildStreamPath(brandId, streamType = 'main') {
  const brand = getBrand(brandId);
  if (!brand) return '';
  return (streamType === 'sub' ? brand.sub : brand.main) || '';
}

/**
 * Full RTSP URL the streaming engine will use.
 * Pass maskPassword: true for the on-screen preview so the password is not
 * shown in plain text.
 */
export function buildRtspUrl({ ip_address, rtsp_port, stream_path, username, password }, { maskPassword = false } = {}) {
  if (!ip_address || !stream_path) return '';
  const port = rtsp_port || 554;
  let auth = '';
  if (username) {
    const pass = maskPassword ? (password ? '••••••' : '') : encodeURIComponent(password || '');
    auth = `${encodeURIComponent(username)}:${pass}@`;
  }
  return `rtsp://${auth}${ip_address}:${port}${stream_path}`;
}

/**
 * Reverse lookup used when editing a saved camera: work out which brand and
 * stream type produced the stored path, so the form can pre-select them without
 * needing extra database columns.
 */
export function detectBrandFromPath(streamPath) {
  if (!streamPath) return { brand: 'other', streamType: 'main' };
  for (const brand of RTSP_BRANDS) {
    if (brand.id === 'other') continue;
    if (brand.main && brand.main === streamPath) return { brand: brand.id, streamType: 'main' };
    if (brand.sub && brand.sub === streamPath) return { brand: brand.id, streamType: 'sub' };
  }
  return { brand: 'other', streamType: 'main' };
}
