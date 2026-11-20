'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { spawn } = require('child_process');

const UPDATE_METADATA_URL = 'https://crusher.norissolutions.com/weighbridge_autoupdate_file/version.json';

/**
 * Compare two semver strings: returns true if remote > local
 */
function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const parse = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const r = parse(remote);
  const l = parse(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rVal = r[i] || 0;
    const lVal = l[i] || 0;
    if (rVal > lVal) return true;
    if (rVal < lVal) return false;
  }
  return false;
}

/**
 * Fetch remote version.json
 */
function checkForUpdate() {
  return new Promise((resolve, reject) => {
    const urlWithCacheBust = `${UPDATE_METADATA_URL}?_t=${Date.now()}`;
    const client = urlWithCacheBust.startsWith('https') ? https : http;

    const req = client.get(urlWithCacheBust, { timeout: 8000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return resolve({
          hasUpdate: false,
          error: `HTTP Error ${res.statusCode}`
        });
      }

      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        try {
          let cleanStr = rawData.trim();
          const firstBrace = cleanStr.indexOf('{');
          const lastBrace = cleanStr.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            cleanStr = cleanStr.substring(firstBrace, lastBrace + 1);
          }
          const info = JSON.parse(cleanStr);
          const currentVersion = app.getVersion();
          const hasUpdate = isNewerVersion(info.version, currentVersion);

          resolve({
            hasUpdate,
            currentVersion,
            latestVersion: info.version,
            releaseNotes: info.releaseNotes || 'Bug fixes and performance improvements.',
            downloadUrl: info.downloadUrl
          });
        } catch (err) {
          resolve({
            hasUpdate: false,
            error: `Failed to parse update manifest: ${err.message}`
          });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ hasUpdate: false, error: 'Update check timed out' });
    });

    req.on('error', (err) => {
      resolve({ hasUpdate: false, error: err.message });
    });
  });
}

/**
 * Download the .exe update and launch installer silently
 */
function downloadAndInstallUpdate(downloadUrl, onProgress) {
  return new Promise((resolve, reject) => {
    if (!downloadUrl) {
      return reject(new Error('No download URL provided'));
    }

    const tempDir = app.getPath('temp');
    const targetFile = path.join(tempDir, 'Crusher-Weighbridge-Setup.exe');

    const downloadWithRedirect = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects while downloading update'));
      }

      const client = currentUrl.startsWith('https') ? https : http;
      const req = client.get(currentUrl, (res) => {
        // Handle HTTP redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            const parsed = new URL(currentUrl);
            nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
          }
          return downloadWithRedirect(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download update file: HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        let lastEmitTime = 0;

        const fileStream = fs.createWriteStream(targetFile, { highWaterMark: 1024 * 1024 });

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          const now = Date.now();
          if (totalBytes > 0 && typeof onProgress === 'function' && (now - lastEmitTime >= 200 || receivedBytes >= totalBytes)) {
            lastEmitTime = now;
            const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
            onProgress({
              percent,
              receivedBytes,
              totalBytes
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            console.log(`[Updater] Installer downloaded successfully to ${targetFile}`);
            if (typeof onProgress === 'function') {
              onProgress({ percent: 100, receivedBytes: totalBytes, totalBytes });
            }

            // Launch installer with silent flag and restart
            try {
              console.log('[Updater] Launching installer in silent mode and exiting old app...');
              // /S = silent install. --force-run makes the installer start the
              // app again once it finishes (a silent install otherwise skips
              // the "Run app" step and the app stays closed).
              const child = spawn(targetFile, ['/S', '--force-run'], {
                detached: true,
                stdio: 'ignore'
              });
              child.unref();

              // Give process 500ms to spawn then exit cleanly
              setTimeout(() => {
                app.quit();
              }, 500);

              resolve({ success: true });
            } catch (execErr) {
              console.error('[Updater] Error executing installer:', execErr);
              reject(execErr);
            }
          });
        });

        fileStream.on('error', (err) => {
          fs.unlink(targetFile, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });
    };

    downloadWithRedirect(downloadUrl);
  });
}

module.exports = {
  checkForUpdate,
  downloadAndInstallUpdate,
  isNewerVersion
};
