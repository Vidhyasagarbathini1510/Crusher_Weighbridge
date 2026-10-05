'use strict';
const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * Fetch available system printers.
 */
async function getAvailablePrinters(win) {
  try {
    if (win && win.webContents && win.webContents.getPrintersAsync) {
      return await win.webContents.getPrintersAsync();
    }
    if (win && win.webContents && win.webContents.getPrinters) {
      return win.webContents.getPrinters();
    }
    return [];
  } catch (err) {
    console.error('[Printer Service] Error getting printers:', err);
    return [];
  }
}

/**
 * Filter out virtual/file printers like OneNote, XPS, PDF when finding a default printer.
 */
function isVirtualPrinter(name) {
  if (!name) return true;
  return /onenote|microsoft print to pdf|fax|xps document writer|send to onenote/i.test(name);
}

/**
 * Resolve exact printer device name from available system printers list.
 * Prevents silent fallback to Windows default printer (OneNote).
 */
async function resolvePrinterDeviceName(win, requestedName) {
  try {
    const printers = await getAvailablePrinters(win);
    if (!printers || printers.length === 0) return requestedName || '';

    // First check if a physical non-virtual printer exists in system
    const physicalPrinter = printers.find(p => !isVirtualPrinter(p.name));

    if (requestedName && typeof requestedName === 'string' && requestedName.trim()) {
      const target = requestedName.trim();

      // If target requested is a physical printer, resolve it directly
      if (!isVirtualPrinter(target)) {
        // 1. Exact match
        const exact = printers.find(p => p.name === target);
        if (exact) return exact.name;

        // 2. Case-insensitive match
        const caseInsensitive = printers.find(p => p.name.toLowerCase() === target.toLowerCase());
        if (caseInsensitive) return caseInsensitive.name;

        // 3. Substring match (e.g. "Samsung" matches "Samsung ML-2160 Series")
        const partial = printers.find(p =>
          p.name.toLowerCase().includes(target.toLowerCase()) ||
          target.toLowerCase().includes(p.name.toLowerCase())
        );
        if (partial) return partial.name;
      } else if (physicalPrinter) {
        // If requested target IS a virtual printer (e.g. OneNote/PDF) but a physical printer (Samsung, etc.) is connected,
        // automatically redirect to the physical printer!
        console.log(`[Printer Service] Automatically resolved physical printer "${physicalPrinter.name}" (bypassing virtual printer "${target}")`);
        return physicalPrinter.name;
      }
    }

    // If requestedName is empty or not matched:
    // First try to find a physical printer (Samsung, Thermal, HP, Epson, etc.) that is NOT virtual OneNote/PDF/XPS
    if (physicalPrinter) {
      console.log(`[Printer Service] Automatically resolved physical printer "${physicalPrinter.name}" (bypassing virtual default printer)`);
      return physicalPrinter.name;
    }

    // If only virtual printers exist, use system default
    const defaultPrinter = printers.find(p => p.isDefault);
    if (defaultPrinter) return defaultPrinter.name;

    // Fallback to first available printer
    if (printers[0]) return printers[0].name;
  } catch (e) {
    console.error('[Printer Service] Error resolving device name:', e);
  }
  return requestedName || '';
}

// Hands the bytes to the spooler as they are, with the RAW datatype, so the
// printer sees the ESC/P codes rather than Windows seeing text.
//
// The old path piped the slip through Out-Printer, which is not raw at all: it
// draws the text with a GDI font on a graphics page. The escape codes came out
// as stray characters, the column stops landed wherever the proportional font
// put them, and nothing the slip asked for — form length, ten pitch, bold
// figures — ever reached the printer. WritePrinter is the only way to tell a dot
// matrix what to do.
const RAW_PRINT_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NorisRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static int Send(string printer, byte[] bytes, string docName) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return -1;      // no such queue, or no rights
    DOCINFO di = new DOCINFO();
    di.pDocName = docName;
    di.pDataType = "RAW";
    int written = 0;
    bool ok = false;
    try {
      if (StartDocPrinter(h, 1, di)) {
        try {
          if (StartPagePrinter(h)) {
            IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
            try {
              Marshal.Copy(bytes, 0, buf, bytes.Length);
              ok = WritePrinter(h, buf, bytes.Length, out written);
            } finally { Marshal.FreeCoTaskMem(buf); }
            EndPagePrinter(h);
          }
        } finally { EndDocPrinter(h); }
      }
    } finally { ClosePrinter(h); }
    return ok ? written : -2;                                      // -2: spooler took the job but wrote nothing
  }
}
'@
$name = $env:NORIS_PRINTER
if (-not $name) { $name = (Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name }
if (-not $name) { throw 'no printer' }
$bytes = [System.IO.File]::ReadAllBytes($env:NORIS_RAW_FILE)
$written = [NorisRawPrinter]::Send($name, $bytes, 'Weighment Slip')
if ($written -lt 0) { throw "WritePrinter failed ($written) for $name" }
Write-Output ("RAW|" + $name + "|" + $written)
`;

/**
 * Print raw text / ESC/P commands directly to a Windows printer.
 */
function printRawText(printerName, rawText) {
  return new Promise((resolve, reject) => {
    try {
      const tempPath = path.join(app.getPath('temp'), `noris_print_${Date.now()}.prn`);
      // latin1, not utf8: every byte in the slip has to reach the printer as
      // written. In utf8 an ESC code is safe but anything above 127 becomes two
      // bytes, and the printer reads the second one as a command of its own.
      fs.writeFileSync(tempPath, rawText, { encoding: 'latin1' });

      const done = (error) => {
        setTimeout(() => {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        }, 1000);
        if (error) {
          try {
            const healthMonitorService = require('./healthMonitorService');
            healthMonitorService.reportPrintError(error.message, printerName);
          } catch (_) {}
          return reject(error);
        }
        try {
          const healthMonitorService = require('./healthMonitorService');
          healthMonitorService.reportPrintSuccess();
        } catch (_) {}
        resolve({ success: true });
      };

      if (process.platform !== 'win32') {
        const command = printerName ? `lpr -P "${printerName}" "${tempPath}"` : `lpr "${tempPath}"`;
        return exec(command, (error) => {
          if (error) console.error('[Printer Service] Raw print error:', error.message);
          done(error);
        });
      }

      // The printer name and the file path go through the environment rather
      // than the command line: both carry spaces, and a name with an apostrophe
      // in it used to break the quoting and take the whole command with it.
      const encoded = Buffer.from(RAW_PRINT_PS, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        {
          timeout: 30000,
          windowsHide: true,
          env: { ...process.env, NORIS_PRINTER: printerName || '', NORIS_RAW_FILE: tempPath }
        },
        (error, stdout, stderr) => {
          if (!error) {
            const line = String(stdout).split(/\r?\n/).find(l => l.startsWith('RAW|')) || '';
            const [, name, written] = line.split('|');
            console.log(`[Printer Service] Sent ${written || '?'} raw bytes to "${name || printerName || '(default)'}"`);
            return done(null);
          }

          // Falling back rather than failing: on a queue that will not take a
          // raw job the slip is still worth printing, even if it comes out in
          // the driver's own font.
          console.warn('[Printer Service] Raw passthrough failed, falling back to Out-Printer:',
            String(stderr || error.message).split('\n')[0]);
          const safePath = tempPath.replace(/'/g, "''");
          const fallback = printerName
            ? `powershell -NoProfile -Command "Get-Content -Raw -Path '${safePath}' | Out-Printer -Name '${printerName.replace(/'/g, "''")}'"`
            : `powershell -NoProfile -Command "Get-Content -Raw -Path '${safePath}' | Out-Printer"`;
          exec(fallback, (fallbackError) => {
            if (fallbackError) console.error('[Printer Service] Raw print error:', fallbackError.message);
            done(fallbackError);
          });
        });
    } catch (err) {
      console.error('[Printer Service] Print raw exception:', err);
      reject(err);
    }
  });
}

/**
 * Print HTML silently using background BrowserWindow.
 */
// How long to wait for the driver to acknowledge the job before giving up. Some
// host-based (GDI) drivers — the HP LaserJet P1108 among them — never call the
// print callback at all, which used to leave the hidden window alive and the
// caller's promise pending for the rest of the shift.
const PRINT_ACK_TIMEOUT_MS = 30000;

// Sheet sizes in millimetres, portrait. Chromium is told the paper by name, but
// the page has to know the same figures itself: the slip is centred inside a box
// of exactly this size, and a box that guessed the paper would centre the slip
// on the wrong sheet.
const PAGE_SIZE_MM = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8]
};

// Fits the slip to the sheet before printing.
//
// Each form is drawn at the pixel width its Crystal original used, which has
// nothing to do with the paper it ends up on: the half-sheet forms came out as a
// small block adrift in the middle of an A4 sheet, and the wide ones ran off the
// edge of a half sheet with the outer captions cut in half. Measuring the form
// against the printable box and scaling it to match puts every layout on its
// paper at the size that paper deserves, proportions kept.
//
// The scale is applied to the form itself rather than to the full-width box
// holding it — the box is already exactly the size of the paper, so scaling that
// could only ever be a no-op.
const FIT_SCALE_MIN = 0.5;
const FIT_SCALE_MAX = 1.5;

const FIT_TO_PAGE_SCRIPT = `
  (function () {
    try {
      var sheet = document.querySelector('.noris-sheet');
      var slip = document.querySelector('.noris-slip');
      if (!sheet || !slip) return;
      var form = slip.firstElementChild || slip;

      if (form) {
        form.style.maxWidth = '100%';
        form.style.width = '100%';
        form.style.boxSizing = 'border-box';
      }
      slip.style.width = '100%';

      var sheetW = sheet.clientWidth;
      var sheetH = sheet.clientHeight;
      var slipW = slip.scrollWidth;
      var slipH = slip.scrollHeight;

      if (!sheetW || !sheetH || !slipW || !slipH) return;

      var scale = 1;
      if (slipH > sheetH) {
        scale = Math.max(${FIT_SCALE_MIN}, sheetH / slipH);
      }

      if (scale < 0.98) {
        slip.style.transformOrigin = 'top center';
        slip.style.transform = 'scale(' + scale + ')';
      } else {
        slip.style.transform = 'none';
      }
    } catch (e) {}
  })();`;

// The paper the Windows queue is set to, per printer, as this session last left
// it. Asking the queue costs a PowerShell start — about a second — which is a
// second too many on a weighbridge that prints a slip a minute, so it is asked
// once per printer and paper and remembered.
const appliedPaper = new Map();

// ...but not remembered for the whole shift. Anything else on the machine can
// set the queue back — another app, a driver update, an operator in Windows
// printer preferences — so the app checks again every so often and puts the
// paper right rather than trusting a note it made an hour ago.
const PAPER_CACHE_MS = 10 * 60 * 1000;

// Windows knows these forms by name. Anything not listed is left to the driver.
const WINDOWS_PAPER = {
  A3: 'A3',
  A4: 'A4',
  A5: 'A5',
  Letter: 'Letter',
  Legal: 'Legal',
  Tabloid: 'Tabloid'
};

/**
 * Set the printer's own paper to the sheet this slip is laid out for.
 *
 * Asking for a page size in the print job is only half of it: a host-based
 * driver like the HP LaserJet P1108 images whatever form its queue is set to and
 * quietly ignores the request. This site's queue sat on Letter — 216mm across
 * against A4's 210 — so every slip was rendered for one sheet and printed onto
 * another, which is what sheared the captions off the left-hand edge.
 *
 * Setting the queue means the operator never opens Windows printer preferences:
 * choosing a template chooses the paper, and the paper reaches the printer. It
 * is a best effort — a printer that cannot take the form, or a queue this
 * account may not configure, leaves the job to print as it would have.
 */
function applyPrinterPaper(printerName, pageSize) {
  const wanted = WINDOWS_PAPER[pageSize];
  if (process.platform !== 'win32' || !wanted) return Promise.resolve(null);

  const cacheKey = `${printerName || '(default)'}::${wanted}`;
  const lastApplied = appliedPaper.get(cacheKey);
  if (lastApplied && Date.now() - lastApplied < PAPER_CACHE_MS) return Promise.resolve(null);

  return new Promise((resolve) => {
    const safeName = String(printerName || '').replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$n = '${safeName}'`,
      "if (-not $n) { $n = (Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name }",
      "if (-not $n) { throw 'no printer' }",
      '$c = Get-PrintConfiguration -PrinterName $n',
      `if ($c.PaperSize -ne '${wanted}') { Set-PrintConfiguration -PrinterName $n -PaperSize '${wanted}' }`,
      `Write-Output ('PAPER|' + $n + '|' + $c.PaperSize + '|${wanted}')`
    ].join('; ');

    // Handed over base64 rather than as a command line. A printer name carries
    // spaces and the script carries quotes of its own; between cmd.exe and
    // PowerShell one of the two always lost a quote, and the whole thing failed
    // to parse — which looked exactly like a printer that would not take the
    // paper. Encoded, there is nothing left for a shell to mangle.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 15000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          // Not fatal: the job still prints, it just prints on whatever the
          // queue was already set to.
          console.warn('[Printer Service] Could not set the printer paper to', wanted, '-', error.message.split('\n')[0]);
          return resolve(null);
        }
        appliedPaper.set(cacheKey, Date.now());
        const line = String(stdout).split(/\r?\n/).find(l => l.startsWith('PAPER|')) || '';
        const [, name, was] = line.split('|');
        if (was && was !== wanted) {
          console.log(`[Printer Service] Paper for "${name}" changed from ${was} to ${wanted}`);
        }
        resolve({ printer: name, from: was, to: wanted });
      });
  });
}

/**
 * The page a slip is printed from: one sheet the exact size of the printable
 * area, the slip centred on it and scaled to fit. Built here rather than inline
 * so the same page can be rendered to PDF and checked without a printer.
 */
function buildPrintablePage(htmlContent, { pageSize = 'A4', landscape = false, marginMm = 12, jobName = 'Weighment Slip' } = {}) {
  const isA5 = pageSize === 'A5';

  // For A5 horizontal paper feed (Image 1 format):
  // Laying out a 210mm width x 148mm height slip at the top of an A4 frame
  // ensures standard Windows printer drivers print 100% full size without thumbnail scaling.
  const pageWidthMm = 210;
  const pageHeightMm = isA5 ? 148 : (landscape ? 210 : 297);
  const effectiveMargin = isA5 ? 4 : Math.min(marginMm, 8);
  const areaWidthMm = Math.max(20, pageWidthMm - effectiveMargin * 2);
  const areaHeightMm = Math.max(20, pageHeightMm - effectiveMargin * 2);

  return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${jobName}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: ${effectiveMargin}mm;
        }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        body { font-family: sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        /* Printable sheet area formatted for A5 wide feed (202mm x 140mm) */
        .noris-sheet {
          width: ${areaWidthMm}mm;
          height: ${areaHeightMm}mm;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          box-sizing: border-box;
          overflow: hidden;
        }
        /* Full width of printable area */
        .noris-slip { flex: 1 1 auto; width: 100%; box-sizing: border-box; }
      </style>
    </head>
    <body>
    
      <div class="noris-sheet"><div class="noris-slip">${htmlContent}</div></div>
      <script>${FIT_TO_PAGE_SCRIPT}<\/script>
    </body>
    </html>`;
}

function printSilentHtml(printerName, htmlContent, options = {}) {
  return new Promise((resolve, reject) => {
    let printWin = null;
    let tempPath = null;
    let settled = false;

    // The window, the temp file and the promise all have to be torn down
    // together, whichever of the three paths below gets there first.
    const cleanup = () => {
      if (printWin && !printWin.isDestroyed()) printWin.destroy();
      printWin = null;
      if (tempPath) {
        const doomed = tempPath;
        tempPath = null;
        setTimeout(() => {
          try { if (fs.existsSync(doomed)) fs.unlinkSync(doomed); } catch (_) {}
        }, 5000);
      }
    };

    const settle = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err); else resolve({ success: true });
    };

    try {
      // Page setup has to be stated. Without a `size` the sheet takes whatever
      // the driver last defaulted to, and the old `margin: 0` pushed the slip
      // into the strip most printers physically cannot mark, so it came out
      // jammed against the top-left corner of the paper.
      const pageSize = options.pageSize || 'A4';
      const isA5 = pageSize === 'A5';
      const marginMm = isA5 ? 4 : (options.marginMm === undefined ? 12 : Number(options.marginMm));
      // Windows names the spool job after the document title. Without one the
      // queue filled up with entries called "data_text_html;charset=utf-8,..."
      // — the whole slip URL — which is unreadable and impossible to cancel
      // selectively when a job jams.
      const jobName = String(options.jobName || 'Weighment Slip').replace(/[<>&]/g, '');

      printWin = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const html = buildPrintablePage(htmlContent, { pageSize, marginMm, jobName });

      // Started now rather than at print time so the queue is being set while
      // the slip renders — the operator waits for one of the two, not both.
      const paperReady = applyPrinterPaper(printerName, 'A4');

      // Loaded from a file rather than a data: URL. A data URL carries the whole
      // slip in the address, so the spooler took that for the job name and the
      // page had no title to override it.
      tempPath = path.join(app.getPath('temp'), `noris_slip_${Date.now()}.html`);
      fs.writeFileSync(tempPath, html, { encoding: 'utf8' });

      printWin.webContents.once('did-finish-load', async () => {
        if (settled || !printWin) return;

        // The queue has to carry the right form before the job is handed over —
        // a job spooled against the old paper is imaged against the old paper.
        await paperReady;
        if (settled || !printWin || printWin.isDestroyed()) return;

        const resolvedName = await resolvePrinterDeviceName(printWin, printerName);
        console.log(`[Printer Service] Printing HTML ticket silently to target printer "${printerName || '(auto)'}" -> Resolved deviceName: "${resolvedName}"`);

        const printSettings = {
          silent: true,
          printBackground: true,
          deviceName: resolvedName,
          copies: Number(options.copies) || 1,
          pageSize: 'A4',
          landscape: false,
          // Let the @page rule above own the margins; asking Chromium for the
          // printable area as well would inset the page a second time.
          margins: { marginType: 'none' }
        };

        const ackTimer = setTimeout(() => {
          console.warn('[Printer Service] No response from the driver after 30s — job may still be spooling:', printerName || '(default)');
          settle(new Error('The printer did not respond. Check the Windows print queue for stuck jobs.'));
        }, PRINT_ACK_TIMEOUT_MS);

        printWin.webContents.print(printSettings, (success, failureReason) => {
          clearTimeout(ackTimer);
          if (!success) {
            console.error('[Printer Service] Silent HTML print failed:', failureReason);
            settle(new Error(`Print failed: ${failureReason || 'unknown driver error'}`));
          } else {
            console.log(`[Printer Service] HTML print job spooled successfully to "${printerName || '(default)'}"`);
            settle();
          }
        });
      });

      printWin.webContents.on('did-fail-load', (_e, code, desc) => {
        settle(new Error(`Could not render the slip for printing (${code} ${desc})`));
      });

      printWin.loadFile(tempPath).catch(err => settle(err));
    } catch (err) {
      console.error('[Printer Service] Silent HTML print exception:', err);
      settle(err);
    }
  });
}

module.exports = {
  getAvailablePrinters,
  printRawText,
  printSilentHtml,
  buildPrintablePage
};
