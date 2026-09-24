// cameraSnapshot.js - Capture live camera feed snapshots as neat, crisp, clean images (~25-30 KB)
function compressElementToTargetDataUrl(el) {
  if (!el) return null;
  try {
    if (el.tagName === 'VIDEO') {
      if (el.readyState < 2 || !el.videoWidth || !el.videoHeight) {
        return null;
      }
    } else if (el.tagName === 'IMG') {
      if (!el.complete || !el.naturalWidth || !el.naturalHeight) {
        return null;
      }
    }

    const srcW = el.naturalWidth || el.videoWidth || 1280;
    const srcH = el.naturalHeight || el.videoHeight || 720;

    if (!srcW || !srcH) return null;

    // 640px max width preserves neat, crisp, and clean vehicle & plate details
    const maxW = 640;
    const scale = srcW > maxW ? maxW / srcW : 1;
    const targetW = Math.max(120, Math.round(srcW * scale));
    const targetH = Math.max(90, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(el, 0, 0, targetW, targetH);

    // Sample pixels across canvas to verify this is a real camera feed (not a 100% solid black offline box)
    const imgData = ctx.getImageData(0, 0, targetW, targetH).data;
    let isNonBlackPixelFound = false;
    for (let i = 0; i < imgData.length; i += 160) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      if (r > 12 || g > 12 || b > 12) {
        isNonBlackPixelFound = true;
        break;
      }
    }

    if (!isNonBlackPixelFound) {
      // Offline/black camera feed frame detected - return null to avoid saving a black box
      return null;
    }

    let dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    return dataUrl;
  } catch (e) {
    console.error('[CameraSnapshot] Error compressing frame:', e);
    return null;
  }
}

export function captureCameraSnapshot() {
  try {
    // 1. Query media elements inside each distinct .camera-tile container
    const tiles = Array.from(document.querySelectorAll('.camera-tile, .wb-cam-tile'));
    const tileMediaEls = [];

    for (const tile of tiles) {
      const mediaEl = tile.querySelector('video, img.camera-media, img');
      if (mediaEl) {
        if (mediaEl.tagName === 'IMG') {
          const src = mediaEl.getAttribute('src') || '';
          if (!src.includes('logo') && !src.includes('icon') && !src.includes('avatar') && !src.includes('svg')) {
            tileMediaEls.push(mediaEl);
          }
        } else if (mediaEl.tagName === 'VIDEO') {
          tileMediaEls.push(mediaEl);
        }
      }
    }

    let videoEls = tileMediaEls;

    // Fallback search if specific container tiles were not matched
    if (videoEls.length === 0) {
      const candidates = Array.from(document.querySelectorAll('video.camera-media, img.camera-media, video, img'));
      videoEls = Array.from(new Set(candidates)).filter(el => {
        if (el.tagName === 'IMG') {
          const src = el.getAttribute('src') || '';
          return !src.includes('logo') && !src.includes('icon') && !src.includes('avatar') && !src.includes('svg');
        }
        return el.tagName === 'VIDEO';
      });
    }

    if (videoEls.length === 0) {
      return {
        image_base64: null,
        image_base64_2: null
      };
    }

    const img1 = compressElementToTargetDataUrl(videoEls[0]);
    const img2 = videoEls.length > 1 ? compressElementToTargetDataUrl(videoEls[1]) : null;

    return {
      image_base64: img1,
      image_base64_2: img2
    };
  } catch (e) {
    console.error('[CameraSnapshot] Error capturing snapshot:', e);
    return {
      image_base64: null,
      image_base64_2: null
    };
  }
}

