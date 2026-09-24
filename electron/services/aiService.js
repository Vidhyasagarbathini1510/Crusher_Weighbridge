'use strict';
/**
 * aiService.js — Electron AI Material Classification Service
 * ----------------------------------------------------------------------------
 * Manages local Python AI engine execution (`python_ai/ai_engine.py`).
 * Reads active RTSP camera URL from SQLite database, passes it dynamically to
 * python_ai, and forwards stable material predictions to renderer windows over IPC.
 * ----------------------------------------------------------------------------
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dbAdapter = require('../database/dbAdapter');

let aiProcess = null;
let activeWindow = null;

function getPythonExecutable() {
  const isWin = process.platform === 'win32';
  // Check for bundled portable python inside resources/ (production)
  const bundledPy = path.join(process.resourcesPath, 'python-portable', isWin ? 'python.exe' : 'bin/python3');
  if (fs.existsSync(bundledPy)) return bundledPy;

  // Otherwise fallback to system python
  return isWin ? 'python' : 'python3';
}

function startAiService(win) {
  if (win) activeWindow = win;
  if (aiProcess) return;

  try {
    const cameras = dbAdapter.call('getAllCameras');
    const activeCam = (cameras && cameras.length > 0) ? cameras[0] : null;
    const rtspUrl = activeCam ? (activeCam.rtspUrl || activeCam.url || '') : '';

    const scriptPath = path.join(__dirname, '..', '..', 'python_ai', 'ai_engine.py');
    if (!fs.existsSync(scriptPath)) {
      console.log('[AIService] Python AI script not found at', scriptPath);
      return;
    }

    const pyExe = getPythonExecutable();
    const args = [scriptPath];
    if (rtspUrl) {
      args.push('--rtsp_url', rtspUrl);
    }

    console.log(`[AIService] Launching AI engine using "${pyExe}"...`);
    aiProcess = spawn(pyExe, args, { cwd: path.join(__dirname, '..', '..') });

    let lineBuffer = '';

    aiProcess.stdout.on('data', (data) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // keep partial trailing line

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[AI_PREDICTION]')) {
          try {
            const jsonStr = trimmed.replace('[AI_PREDICTION]', '').trim();
            const payload = JSON.parse(jsonStr);
            if (payload && payload.stable && payload.material) {
              if (activeWindow && !activeWindow.isDestroyed()) {
                activeWindow.webContents.send('ai:material-detected', payload);
              }
            }
          } catch (err) {
            console.error('[AIService] Failed to parse prediction payload:', err);
          }
        }
      }
    });

    aiProcess.stderr.on('data', (data) => {
      console.log(`[AIService Stderr] ${data.toString().trim()}`);
    });

    aiProcess.on('error', (err) => {
      console.log('[AIService] Error running Python AI engine:', err.message);
      aiProcess = null;
    });

    aiProcess.on('exit', (code) => {
      console.log(`[AIService] AI engine process exited with code ${code}`);
      aiProcess = null;
    });

  } catch (err) {
    console.error('[AIService] Exception starting AI service:', err);
    aiProcess = null;
  }
}

function stopAiService() {
  if (aiProcess) {
    try {
      aiProcess.kill();
    } catch (_) {}
    aiProcess = null;
  }
}

module.exports = {
  startAiService,
  stopAiService
};
