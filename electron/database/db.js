'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Determine database path
const userDataPath = (app && typeof app.getPath === 'function') ? app.getPath('userData') : process.cwd();
const dbPath = path.join(userDataPath, 'weighbridge.db');
const imagesDir = path.join(userDataPath, 'weighbridge_images');

// Create images directory if it doesn't exist
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

let dbInstance = null;

let saveTimeout = null;
let isSaving = false;
let pendingSave = false;

function saveToDisk() {
  if (!dbInstance) return;

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    performSave();
  }, 100); // 100ms debounce to prevent multiple consecutive writes blocking the main thread
}

function performSave() {
  if (isSaving) {
    pendingSave = true;
    return;
  }

  isSaving = true;
  try {
    // export() is synchronous and copies the entire database out of WASM memory:
    // for as long as it runs the whole app is unresponsive. Log it when it hurts.
    const startedAt = Date.now();
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const blockedMs = Date.now() - startedAt;
    if (blockedMs > 150) {
      console.warn(`[SQLite] export() blocked the main process for ${blockedMs}ms (${(buffer.length / 1048576).toFixed(1)} MB)`);
    }

    const tmpPath = dbPath + '.tmp';
    const bakPath = dbPath + '.bak';

    // Atomic save pattern: Write to .tmp first, back up existing .db to .bak, then copy .tmp to .db
    fs.writeFile(tmpPath, buffer, (err) => {
      isSaving = false;
      if (err) {
        console.error('[SQLite] Error persisting database to temp file (async):', err);
      } else {
        try {
          if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, bakPath);
          }
          fs.copyFileSync(tmpPath, dbPath);
          try { fs.unlinkSync(tmpPath); } catch (_) {}
        } catch (copyErr) {
          console.error('[SQLite] Error during atomic DB file replacement:', copyErr);
        }
      }
      if (pendingSave) {
        pendingSave = false;
        performSave();
      }
    });
  } catch (err) {
    isSaving = false;
    console.error('[SQLite] Error exporting database:', err);
  }
}

function saveToDiskSync() {
  if (!dbInstance) return;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  try {
    const startedAt = Date.now();
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const tmpPath = dbPath + '.tmp';
    const bakPath = dbPath + '.bak';

    fs.writeFileSync(tmpPath, buffer);
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, bakPath);
    }
    fs.copyFileSync(tmpPath, dbPath);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    console.log(`[SQLite] Synchronous database save completed in ${Date.now() - startedAt}ms (${(buffer.length / 1048576).toFixed(1)} MB).`);
  } catch (err) {
    console.error('[SQLite] Error persisting database synchronously:', err);
  }
}

function isValidSqliteHeader(buffer) {
  if (!buffer || buffer.length < 100) return false;
  const magic = buffer.toString('utf8', 0, 16);
  return magic.startsWith('SQLite format 3');
}

async function init() {
  console.log('[SQLite] Initializing WASM database at:', dbPath);
  const SQL = await initSqlJs();
  const bakPath = dbPath + '.bak';

  let loadedSuccessfully = false;

  const tryLoadFromPath = (targetPath) => {
    try {
      if (!fs.existsSync(targetPath)) return false;
      const filebuffer = fs.readFileSync(targetPath);
      if (!isValidSqliteHeader(filebuffer)) {
        console.warn(`[SQLite] File at ${targetPath} lacks valid SQLite header signature (length: ${filebuffer.length})`);
        return false;
      }
      const testDb = new SQL.Database(filebuffer);
      // Validate that database is executable and not corrupted
      testDb.exec('SELECT 1;');
      dbInstance = testDb;
      console.log(`[SQLite] Database loaded successfully from ${targetPath}.`);
      return true;
    } catch (err) {
      console.error(`[SQLite] Error opening database at ${targetPath}:`, err.message);
      return false;
    }
  };

  // 1. Try primary database file
  if (tryLoadFromPath(dbPath)) {
    loadedSuccessfully = true;
  } else if (tryLoadFromPath(bakPath)) {
    // 2. Try loading backup file (.bak) if primary is corrupt
    console.log('[SQLite] Successfully recovered database from backup (.bak)!');
    loadedSuccessfully = true;
    try {
      fs.copyFileSync(bakPath, dbPath);
    } catch (_) {}
  }

  if (!loadedSuccessfully) {
    if (fs.existsSync(dbPath)) {
      const corruptBackupPath = dbPath + '.corrupt_' + Date.now();
      console.warn(`[SQLite] Moving corrupted database file to ${corruptBackupPath}`);
      try {
        fs.renameSync(dbPath, corruptBackupPath);
      } catch (_) {}
    }
    dbInstance = new SQL.Database();
    console.log('[SQLite] Created new clean database instance.');
  }

  // Enable WAL mode and busy_timeout for high-performance concurrent reads/writes
  try {
    dbInstance.run('PRAGMA journal_mode = WAL;');
    dbInstance.run('PRAGMA busy_timeout = 5000;');
  } catch (e) {
    console.error('[SQLite] Error setting PRAGMAs:', e);
  }

  // 1. Create Tables
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS alert_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      retries INTEGER DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_uuid TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'operator',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      rtsp_port INTEGER DEFAULT 554,
      stream_path TEXT NOT NULL,
      username TEXT,
      password TEXT,
      group_name TEXT,
      group_id INTEGER,
      is_active INTEGER DEFAULT 1,
      status TEXT DEFAULT 'unknown',
      last_checked TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      party TEXT,
      product TEXT,
      gross REAL,
      tare REAL,
      net REAL,
      operator TEXT,
      card TEXT,
      vehicle_type TEXT,
      token TEXT,
      image_path TEXT,
      sync_status INTEGER DEFAULT 0,
      dc_num TEXT,
      contractor TEXT,
      quarry TEXT,
      material TEXT,
      driver TEXT,
      transporter TEXT,
      destination TEXT,
      bill_type TEXT DEFAULT 'NON-GST',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS boulders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      dc_num TEXT,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      contractor TEXT,
      quarry TEXT,
      material TEXT DEFAULT 'BOULDERS',
      gross REAL,
      tare REAL,
      net REAL,
      driver TEXT,
      transporter TEXT,
      destination TEXT,
      operator TEXT DEFAULT 'Admin',
      rate REAL,
      amount REAL,
      sync_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS sales_weighment_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      dc_num TEXT,
      your_dc TEXT,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      party TEXT,
      material TEXT,
      unit_type TEXT,
      units_val REAL,
      destination TEXT,
      source TEXT,
      transporter TEXT,
      driver TEXT,
      phone TEXT,
      stationary TEXT,
      po_number TEXT,
      po_date TEXT,
      payment TEXT,
      gross REAL,
      tare REAL,
      net REAL,
      rate REAL,
      amount REAL,
      bill_type TEXT DEFAULT 'NON-GST',
      transport REAL,
      discount REAL,
      grand_total REAL,
      cash_amount REAL,
      upi_amount REAL,
      credit_amount REAL,
      operator TEXT DEFAULT 'Admin',
      royalty_type TEXT DEFAULT 'None',
      royalty_amount REAL DEFAULT 0,
      sync_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS yard_weighments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      dc_num TEXT,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      party TEXT DEFAULT 'YARD',
      material TEXT,
      gross REAL,
      tare REAL,
      net REAL,
      card TEXT,
      vehicle_type TEXT,
      destination TEXT DEFAULT 'Yard',
      source TEXT,
      transporter TEXT,
      driver TEXT,
      operator TEXT DEFAULT 'Admin',
      sync_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS loading_slips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      dc_num TEXT,
      copy_num TEXT,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      party TEXT,
      material TEXT,
      destination TEXT,
      source TEXT,
      transporter TEXT,
      payment TEXT,
      phone TEXT,
      weight TEXT DEFAULT 'Pending',
      operator TEXT DEFAULT 'Admin',
      image_path TEXT,
      image_base64 TEXT,
      status TEXT DEFAULT 'pending',
      sync_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS rfid_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_number TEXT UNIQUE NOT NULL,
      vehicle TEXT NOT NULL,
      material TEXT DEFAULT 'BOULDERS',
      contractor TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS transporter_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transporter TEXT NOT NULL,
      vehicle_no TEXT NOT NULL,
      capacity TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS dc_sequences (
      module_key TEXT NOT NULL,
      type_key TEXT NOT NULL,
      seq_value INTEGER NOT NULL DEFAULT 1,
      cycle_value TEXT NOT NULL,
      PRIMARY KEY (module_key, type_key)
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS first_weighments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      dc_num TEXT,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      party TEXT,
      material TEXT,
      gross REAL,
      tare REAL,
      net REAL,
      destination TEXT,
      source TEXT,
      transporter TEXT,
      driver TEXT,
      phone TEXT,
      operator TEXT DEFAULT 'Admin',
      image_path TEXT,
      image_base64 TEXT,
      sync_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS second_weighments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      dc_num TEXT,
      first_weighment_id TEXT,
      date_time TEXT NOT NULL,
      vehicle_no TEXT,
      party TEXT,
      material TEXT,
      gross REAL,
      tare REAL,
      net REAL,
      destination TEXT,
      source TEXT,
      transporter TEXT,
      driver TEXT,
      phone TEXT,
      operator TEXT DEFAULT 'Admin',
      image_path TEXT,
      image_base64 TEXT,
      sync_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Auto-migrate: add columns if they don't exist in existing database
  const columnsToAdd = ['dc_num', 'contractor', 'quarry', 'material', 'driver', 'transporter', 'destination', 'bill_type'];
  for (const col of columnsToAdd) {
    try {
      dbInstance.run(`ALTER TABLE transactions ADD COLUMN ${col} TEXT;`);
    } catch (e) {
      // Column already exists or table doesn't exist yet, ignore
    }
  }

  // Auto-migrate sales_weighment_units table
  try {
    dbInstance.run(`ALTER TABLE sales_weighment_units ADD COLUMN bill_type TEXT DEFAULT 'NON-GST';`);
  } catch (e) {
    // Column already exists, ignore
  }

  const salesTransportCols = [
    'party_transport_rate REAL',
    'party_transport_measurement TEXT',
    'party_transport_amount REAL',
    'transporter_rate REAL',
    'transporter_measurement TEXT',
    'transporter_amount REAL',
    'destination_rate REAL',
    'destination_amount REAL'
  ];
  for (const colDef of salesTransportCols) {
    try { dbInstance.run(`ALTER TABLE sales_weighment_units ADD COLUMN ${colDef};`); } catch (e) { }
  }
  const salesRoyaltyCols = [
    "royalty_type TEXT DEFAULT 'None'",
    "royalty_amount REAL DEFAULT 0"
  ];
  for (const colDef of salesRoyaltyCols) {
    try { dbInstance.run(`ALTER TABLE sales_weighment_units ADD COLUMN ${colDef};`); } catch (e) { }
  }

  // Auto-migrate rate and amount for boulders table
  try {
    dbInstance.run(`ALTER TABLE boulders ADD COLUMN rate REAL;`);
  } catch (e) { }
  try {
    dbInstance.run(`ALTER TABLE boulders ADD COLUMN amount REAL;`);
  } catch (e) { }

  // Auto-migrate image_path, image_base64, image_path_2, and image_base64_2 for all tables
  const tablesForImages = ['boulders', 'sales_weighment_units', 'yard_weighments', 'loading_slips', 'first_weighments', 'second_weighments', 'transactions'];
  for (const tbl of tablesForImages) {
    try { dbInstance.run(`ALTER TABLE ${tbl} ADD COLUMN image_path TEXT;`); } catch (e) { }
    try { dbInstance.run(`ALTER TABLE ${tbl} ADD COLUMN image_base64 TEXT;`); } catch (e) { }
    try { dbInstance.run(`ALTER TABLE ${tbl} ADD COLUMN image_path_2 TEXT;`); } catch (e) { }
    try { dbInstance.run(`ALTER TABLE ${tbl} ADD COLUMN image_base64_2 TEXT;`); } catch (e) { }
  }

  // Auto-migrate tare_date and tare_time columns for all relevant tables
  const tablesForTare = ['boulders', 'sales_weighment_units', 'yard_weighments', 'loading_slips', 'first_weighments', 'second_weighments', 'transactions'];
  for (const tbl of tablesForTare) {
    try { dbInstance.run(`ALTER TABLE ${tbl} ADD COLUMN tare_date TEXT;`); } catch (e) { }
    try { dbInstance.run(`ALTER TABLE ${tbl} ADD COLUMN tare_time TEXT;`); } catch (e) { }
  }
  // Auto-migrate contractors table rate column
  try { dbInstance.run(`ALTER TABLE contractors ADD COLUMN rate REAL;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN billingType TEXT;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN gstSale INTEGER;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN phone TEXT;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN contact TEXT;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN email TEXT;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN pan TEXT;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN ledgerId INTEGER;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE debitors ADD COLUMN ledgerType TEXT;`); } catch (e) { }
  try { dbInstance.run(`ALTER TABLE loading_slips ADD COLUMN status TEXT DEFAULT 'pending';`); } catch (e) { }
  try {
    // Keep loading slips strictly local-only on desktop; dismiss any pending loading slips from sync_queue
    dbInstance.run("UPDATE sync_queue SET status = 'COMPLETED' WHERE table_name = 'loading_slips' OR table_name = 'loading_slip';");
    dbInstance.run("UPDATE loading_slips SET sync_status = 1 WHERE sync_status = 0;");
  } catch (e) { }


  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS debitors (
      id INTEGER PRIMARY KEY,
      party TEXT,
      creditLimit REAL,
      site TEXT,
      vendorName TEXT,
      gstin TEXT,
      address TEXT,
      status TEXT,
      online TEXT,
      billingType TEXT,
      gstSale INTEGER,
      phone TEXT,
      contact TEXT,
      email TEXT,
      pan TEXT,
      ledgerId INTEGER,
      ledgerType TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY,
      debitorId INTEGER,
      party TEXT,
      material TEXT,
      measurement TEXT,
      rate REAL,
      status TEXT,
      online TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY,
      debitorId INTEGER,
      party TEXT,
      destination TEXT,
      measurement TEXT,
      rate REAL,
      status TEXT,
      online TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS transporters (
      id INTEGER PRIMARY KEY,
      transporterName TEXT,
      destination TEXT,
      measurement TEXT,
      rate REAL,
      status TEXT,
      online TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS contractors (
      id INTEGER PRIMARY KEY,
      contractorName TEXT,
      quarryName TEXT,
      ton REAL,
      rate REAL,
      gstin TEXT,
      phone TEXT,
      status TEXT,
      online TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS contractor_materials (
      id INTEGER PRIMARY KEY,
      contractorId INTEGER,
      contractorName TEXT,
      quarryName TEXT,
      materialId INTEGER,
      material TEXT,
      measurement TEXT,
      rate REAL,
      status TEXT,
      online TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      sourceName TEXT,
      status TEXT,
      online TEXT
    );
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS vehicle_tares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle TEXT UNIQUE NOT NULL,
      vehicleType TEXT,
      material TEXT,
      ownership TEXT,
      weight REAL,
      date TEXT,
      time TEXT,
      token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Purge any lingering inactive records or orphans from master tables on startup
  try {
    const inactiveCleanFilter = "LOWER(TRIM(COALESCE(status, ''))) IN ('inactive', 'deleted', 'delete', 'disabled', 'deactive', '0', 'false', 'remove', 'removed', 'trash') OR status = 0 OR status = '0'";
    dbInstance.run(`DELETE FROM debitors WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM materials WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM destinations WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM transporters WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM contractors WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM contractor_materials WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM sources WHERE ${inactiveCleanFilter}`);

    // Cleanup orphaned records where parent debitor/contractor no longer exists
    dbInstance.run("DELETE FROM materials WHERE debitorId IS NOT NULL AND debitorId NOT IN (SELECT id FROM debitors)");
    dbInstance.run("DELETE FROM destinations WHERE debitorId IS NOT NULL AND debitorId NOT IN (SELECT id FROM debitors)");
    dbInstance.run("DELETE FROM contractor_materials WHERE contractorId IS NOT NULL AND contractorId NOT IN (SELECT id FROM contractors)");
  } catch (e) {
    console.error('[SQLite] Error purging inactive master data on init:', e);
  }

  // Save structural updates immediately
  saveToDisk();

  // 2. Seed Default Admin and Operator Users
  try {
    const adminCheck = dbInstance.prepare("SELECT id FROM users WHERE LOWER(username) = 'admin'");
    const hasAdmin = adminCheck.step();
    adminCheck.free();
    if (!hasAdmin) {
      console.log('[SQLite] Seeding default admin user...');
      const adminHash = bcrypt.hashSync('admin.123$', 10);
      dbInstance.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [
        'admin', adminHash, 'Offline Administrator', 'admin'
      ]);
    }

    const operatorCheck = dbInstance.prepare("SELECT id FROM users WHERE LOWER(username) = 'operator'");
    const hasOperator = operatorCheck.step();
    operatorCheck.free();
    if (!hasOperator) {
      console.log('[SQLite] Seeding default operator user...');
      const opHash = bcrypt.hashSync('operator123', 10);
      dbInstance.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [
        'operator', opHash, 'Weighbridge Operator', 'operator'
      ]);
    } else {
      // Ensure password hash and role are up to date
      const opHash = bcrypt.hashSync('operator123', 10);
      dbInstance.run("UPDATE users SET password_hash = ?, role = 'operator' WHERE LOWER(username) = 'operator'", [opHash]);
    }
    saveToDisk();
  } catch (e) {
    console.error('[SQLite] Error seeding default users:', e);
  }

  // 3. Seed Default Cameras if empty
  const cameraCheck = dbInstance.prepare('SELECT COUNT(*) as count FROM cameras');
  const cameraCount = cameraCheck.step() ? cameraCheck.getAsObject().count : 0;
  cameraCheck.free();

  if (cameraCount === 0) {
    console.log('[SQLite] Seeding default cameras...');
    const defaultCameras = [
      ['Gate Entry', '192.168.0.3', 554, '/cam/realmonitor?channel=1&subtype=0', 'admin', 'admin.123$', 'Main Gate', 1, 1, 'online'],
      ['Weighbridge Outbound', '192.168.0.12', 554, '/stream1', 'admin', 'Admin.123$', 'Weighbridge', 2, 1, 'online']
    ];

    for (const cam of defaultCameras) {
      dbInstance.run(`
        INSERT INTO cameras (name, ip_address, rtsp_port, stream_path, username, password, group_name, group_id, is_active, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, cam);
    }
    saveToDisk();
  }

  // 5. Seed Settings if empty
  const settingsCheck = dbInstance.prepare('SELECT COUNT(*) as count FROM settings');
  const settingsCount = settingsCheck.step() ? settingsCheck.getAsObject().count : 0;
  settingsCheck.free();

  if (settingsCount === 0) {
    dbInstance.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['system_name', 'Noris CCTV Desktop Monitor']);
    dbInstance.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['refresh_rate_seconds', '10']);
    dbInstance.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['debug_mode', 'true']);
    dbInstance.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['company_id', '']);
    saveToDisk();
  }

  // Seed default settings if not already present
  try {
    dbInstance.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('boulder_sync_url', 'https://crusher.norissolutions.com/backend/api/weighbridge/boulders')");
    dbInstance.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('sales_sync_url', 'https://crusher.norissolutions.com/backend/api/weighbridge/sales')");
    dbInstance.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('yard_sync_url', 'https://crusher.norissolutions.com/backend/api/weighbridge/yard')");

    // Auto-migrate: Force reset sync_status = 0 for existing local records so they get re-queued and uploaded to server endpoints
    const resyncCheck = dbInstance.prepare("SELECT value FROM settings WHERE key = 'resync_v3_done'");
    const resyncDone = resyncCheck.step();
    resyncCheck.free();
    if (!resyncDone) {
      console.log('[SQLite] Resetting sync_status = 0 for existing local records to push them to server MySQL...');
      dbInstance.run("UPDATE boulders SET sync_status = 0;");
      dbInstance.run("UPDATE sales_weighment_units SET sync_status = 0;");
      dbInstance.run("UPDATE yard_weighments SET sync_status = 0;");
      dbInstance.run("UPDATE transactions SET sync_status = 0;");
      dbInstance.run("DELETE FROM sync_queue;");
      dbInstance.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('resync_v3_done', 'true');");
    }
    saveToDisk();
  } catch (e) {
    console.error('[SQLite] Error migrating company_id / sync settings:', e);
  }

  // Move any photos still embedded in the database out to .jpg files. Runs once
  // per installation; keeping them inline made every save rewrite the lot.
  try {
    externalizeStoredImages();
  } catch (e) {
    console.error('[SQLite] Snapshot migration failed (non-fatal, photos left in place):', e);
  }

  // Clean up any historical orphaned images from previous table clears
  try {
    cleanOrphanImages();
  } catch (e) {
    console.error('[SQLite] Error cleaning orphan images on startup:', e);
  }

  // Populate initial sync_queue from existing unsynced records
  populateInitialSyncQueue();
}


// --- SYNC QUEUE OPERATIONS ---
function pushToSyncQueue(tableName, recordUuid) {
  if (!dbInstance || !tableName || !recordUuid) return;
  try {
    // Check if item is already in queue
    const checkStmt = dbInstance.prepare("SELECT id FROM sync_queue WHERE record_uuid = ?", [recordUuid]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) {
      dbInstance.run("INSERT INTO sync_queue (table_name, record_uuid, status) VALUES (?, ?, 'PENDING')", [tableName, recordUuid]);
      saveToDisk();
    }
  } catch (e) {
    console.error('[SQLite] Error pushing to sync_queue:', e);
  }
}

function getPendingSyncQueue(limit = 30) {
  if (!dbInstance) return [];
  try {
    const stmt = dbInstance.prepare("SELECT * FROM sync_queue WHERE status = 'PENDING' OR (status = 'FAILED' AND retry_count < 20) ORDER BY id ASC LIMIT ?", [limit]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (e) {
    console.error('[SQLite] Error fetching sync_queue:', e);
    return [];
  }
}

function updateSyncQueueStatus(queueId, status, errorMsg = null) {
  if (!dbInstance) return;
  try {
    if (status === 'FAILED') {
      dbInstance.run("UPDATE sync_queue SET status = ?, retry_count = retry_count + 1, error_message = ? WHERE id = ?", [status, errorMsg || '', queueId]);
    } else if (status === 'REJECTED') {
      dbInstance.run("UPDATE sync_queue SET status = ?, error_message = ? WHERE id = ?", [status, errorMsg || '', queueId]);
    } else {
      dbInstance.run("UPDATE sync_queue SET status = ?, error_message = NULL WHERE id = ?", [status, queueId]);
    }
    saveToDisk();
  } catch (e) {
    console.error('[SQLite] Error updating sync_queue status:', e);
  }
}

function getSyncQueueSummary() {
  if (!dbInstance) return { pending: 0, completed: 0, failed: 0, rejected: 0, total: 0 };
  try {
    const stmt = dbInstance.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
        COUNT(*) as total
      FROM sync_queue
    `);
    let summary = { pending: 0, completed: 0, failed: 0, rejected: 0, total: 0 };
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      summary = {
        pending: obj.pending || 0,
        completed: obj.completed || 0,
        failed: obj.failed || 0,
        rejected: obj.rejected || 0,
        total: obj.total || 0
      };
    }
    stmt.free();
    return summary;
  } catch (e) {
    console.error('[SQLite] Error getting sync queue summary:', e);
    return { pending: 0, completed: 0, failed: 0, rejected: 0, total: 0 };
  }
}

function getFailedSyncQueue(limit = 100) {
  if (!dbInstance) return [];
  try {
    const stmt = dbInstance.prepare(`
      SELECT * FROM sync_queue 
      WHERE status IN ('FAILED', 'REJECTED') 
      ORDER BY id DESC LIMIT ?
    `, [limit]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (e) {
    console.error('[SQLite] Error fetching failed sync queue:', e);
    return [];
  }
}

function retrySyncQueueItem(queueId) {
  if (!dbInstance || !queueId) return { success: false, error: 'Invalid ID' };
  try {
    dbInstance.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0, error_message = NULL WHERE id = ?", [queueId]);
    saveToDisk();
    return { success: true };
  } catch (e) {
    console.error(`[SQLite] Error retrying sync queue item ${queueId}:`, e);
    return { success: false, error: e.message };
  }
}

function retryAllFailedSyncQueue() {
  if (!dbInstance) return { success: false, error: 'Database not initialized' };
  try {
    dbInstance.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0, error_message = NULL WHERE status IN ('FAILED', 'REJECTED')");
    saveToDisk();
    return { success: true };
  } catch (e) {
    console.error('[SQLite] Error retrying all failed sync queue items:', e);
    return { success: false, error: e.message };
  }
}


function getRecordByUuid(tableName, uuid) {
  if (!dbInstance || !tableName || !uuid) return null;
  const allowedTablesMap = {
    'transactions': 'transactions',
    'boulders': 'boulders',
    'sales_units': 'sales_weighment_units',
    'yard': 'yard_weighments',
    'loading_slips': 'loading_slips',
    'first_weighment': 'first_weighments',
    'second_weighment': 'second_weighments'
  };

  const actualTable = allowedTablesMap[tableName] || tableName;
  try {
    const stmt = dbInstance.prepare(`SELECT * FROM ${actualTable} WHERE uuid = ? LIMIT 1`, [uuid]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  } catch (e) {
    console.error(`[SQLite] Error fetching ${actualTable} by uuid ${uuid}:`, e);
    return null;
  }
}

function populateInitialSyncQueue() {
  if (!dbInstance) return;
  // Runs on every sync cycle (every 3s). Only persist when something actually
  // changed — an unconditional saveToDisk() here means a full export() of the
  // image-heavy database every 3 seconds, which stalls the main process.
  let changed = false;
  const tableMapping = [
    { table: 'transactions', source: 'transactions' },
    { table: 'boulders', source: 'boulders' },
    { table: 'sales_weighment_units', source: 'sales_units' },
    { table: 'yard_weighments', source: 'yard' },
    { table: 'first_weighments', source: 'first_weighment' },
    { table: 'second_weighments', source: 'second_weighment' }
  ];

  for (const item of tableMapping) {
    try {
      // Auto-assign UUID to any unsynced row that has missing/null UUID
      const unsyncedStmt = dbInstance.prepare(`SELECT id, uuid FROM ${item.table} WHERE sync_status = 0`);
      const rowsToUpdate = [];
      while (unsyncedStmt.step()) {
        const r = unsyncedStmt.getAsObject();
        if (!r.uuid || r.uuid.trim() === '') {
          rowsToUpdate.push(r.id);
        }
      }
      unsyncedStmt.free();

      for (const rowId of rowsToUpdate) {
        const newUuid = crypto.randomUUID();
        dbInstance.run(`UPDATE ${item.table} SET uuid = ? WHERE id = ?`, [newUuid, rowId]);
        changed = true;
      }

      // Query unsynced rows and ensure they are in sync_queue and in PENDING status
      const stmt = dbInstance.prepare(`SELECT uuid FROM ${item.table} WHERE sync_status = 0`);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.uuid) {
          const checkStmt = dbInstance.prepare("SELECT id, status, retry_count FROM sync_queue WHERE record_uuid = ?", [row.uuid]);
          if (checkStmt.step()) {
            const qRow = checkStmt.getAsObject();
            if (qRow.status === 'REJECTED' || (qRow.status === 'FAILED' && qRow.retry_count >= 10) || qRow.status === 'COMPLETED') {
              // If the underlying record is still unsynced (sync_status = 0), reset it to PENDING so it automatically tries again immediately
              dbInstance.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0, error_message = NULL WHERE id = ?", [qRow.id]);
              changed = true;
            }
          } else {
            dbInstance.run("INSERT INTO sync_queue (table_name, record_uuid, status) VALUES (?, ?, 'PENDING')", [item.source, row.uuid]);
            changed = true;
          }
          checkStmt.free();
        }
      }
      stmt.free();
    } catch (e) {
      // Table may not exist yet or empty
    }
  }
  if (changed) saveToDisk();
}

// --- USER OPERATIONS ---
function loginUser(username, password) {
  if (!username || !password) return null;
  const cleanUsername = String(username).trim();
  const stmt = dbInstance.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)');
  stmt.bind([cleanUsername]);
  const user = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();

  if (!user) return null;

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) return null;

  return {
    username: user.username,
    full_name: user.full_name || user.username,
    role: user.role || 'operator'
  };
}

// --- CAMERA OPERATIONS ---
function getAllCameras() {
  const stmt = dbInstance.prepare('SELECT * FROM cameras');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function addCamera(cam) {
  dbInstance.run(`
    INSERT INTO cameras (name, ip_address, rtsp_port, stream_path, username, password, group_name, group_id, is_active, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    cam.name || '',
    cam.ip_address || '',
    cam.rtsp_port || 554,
    cam.stream_path || '',
    cam.username !== undefined ? cam.username : null,
    cam.password !== undefined ? cam.password : null,
    cam.group_name !== undefined ? cam.group_name : null,
    cam.group_id !== undefined ? cam.group_id : null,
    1,
    'online'
  ]);

  // Get last insert ID
  const stmt = dbInstance.prepare('SELECT last_insert_rowid() AS id');
  const id = stmt.step() ? stmt.getAsObject().id : null;
  stmt.free();

  saveToDisk();
  return { ...cam, id };
}

function updateCamera(cam) {
  dbInstance.run(`
    UPDATE cameras 
    SET name = ?, ip_address = ?, rtsp_port = ?, stream_path = ?, username = ?, password = ?, group_name = ?, group_id = ?, is_active = ?, status = ?
    WHERE id = ?
  `, [
    cam.name || '',
    cam.ip_address || '',
    cam.rtsp_port || 554,
    cam.stream_path || '',
    cam.username !== undefined ? cam.username : null,
    cam.password !== undefined ? cam.password : null,
    cam.group_name !== undefined ? cam.group_name : null,
    cam.group_id !== undefined ? cam.group_id : null,
    cam.is_active !== undefined ? cam.is_active : 1,
    cam.status || 'online',
    cam.id
  ]);
  saveToDisk(); ``
  return cam;
}

function deleteCamera(id) {
  dbInstance.run('DELETE FROM cameras WHERE id = ?', [id]);
  saveToDisk();
  return true;
}

function updateCameraStatus(id, status) {
  dbInstance.run('UPDATE cameras SET status = ?, last_checked = ? WHERE id = ?', [
    status, new Date().toISOString(), id
  ]);
  saveToDisk();
  return true;
}

// Helper function to compress base64 image (targeting 640px max width for crisp ~25-30 KB target)
function compressImage(base64Image) {
  if (!base64Image || typeof base64Image !== 'string' || base64Image.trim() === '') return '';
  try {
    const { nativeImage } = require('electron');
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    if (!img.isEmpty()) {
      const size = img.getSize();
      let targetImg = img;
      if (size.width > 640) {
        const scale = 640 / size.width;
        targetImg = img.resize({
          width: 640,
          height: Math.round(size.height * scale),
          quality: 'better'
        });
      }
      const compressedBuffer = targetImg.toJPEG(60);
      return `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
    }
  } catch (err) {
    console.error('[SQLite] Error compressing base64 image:', err);
  }
  return base64Image;
}

// Helper function to save Base64 CCTV image snapshot to disk
function saveImageSnapshot(uuid, base64Image) {
  if (!base64Image || typeof base64Image !== 'string' || base64Image.trim() === '') return null;
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    let buffer = Buffer.from(cleanBase64, 'base64');
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromBuffer(buffer);
      if (!img.isEmpty()) {
        const size = img.getSize();
        let targetImg = img;
        if (size.width > 640) {
          const scale = 640 / size.width;
          targetImg = img.resize({
            width: 640,
            height: Math.round(size.height * scale),
            quality: 'better'
          });
        }
        buffer = targetImg.toJPEG(60);
      }
    } catch (compressErr) {
      console.error('[SQLite] nativeImage compression failed on save, using original buffer:', compressErr);
    }
    const filename = `${uuid}.jpg`;
    const imagePath = path.join(imagesDir, filename);
    // Written synchronously: the row now stores ONLY this path, so the record
    // must never reference a file that failed to appear. A compressed snapshot
    // is ~30 KB, so the write costs a fraction of a millisecond — nothing next
    // to the full-database export this change removes.
    fs.writeFileSync(imagePath, buffer);
    return imagePath;
  } catch (err) {
    console.error('[SQLite] Error saving snapshot image:', err);
    return null;
  }
}

// --- IMAGE STORAGE ----------------------------------------------------------
// Snapshots live as .jpg files in weighbridge_images and are referenced by
// image_path. They are deliberately NOT also embedded as base64 in the
// database: sql.js re-serialises the ENTIRE database on every write, so a few
// hundred MB of duplicated photos froze the whole application on every save,
// delete or table clear.
//
// Readers are unaffected — every getter below still hands back image_base64 as
// a ready-to-render data URL, rebuilt from the file on demand.

function readImageAsDataUrl(imagePath) {
  if (!imagePath) return '';
  try {
    if (!fs.existsSync(imagePath)) return '';
    return `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}`;
  } catch (err) {
    console.error('[SQLite] Could not read snapshot from disk:', imagePath, err.message);
    return '';
  }
}

function hydrateRowImages(row) {
  if (!row || typeof row !== 'object') return row;
  if (!row.image_base64 && row.image_path) row.image_base64 = readImageAsDataUrl(row.image_path);
  if (!row.image_base64_2 && row.image_path_2) row.image_base64_2 = readImageAsDataUrl(row.image_path_2);
  return row;
}

function hydrateImages(result) {
  if (Array.isArray(result)) {
    for (const row of result) hydrateRowImages(row);
    return result;
  }
  return hydrateRowImages(result);
}

/**
 * A server edit can carry a fresh photo. Write it to a .jpg like a locally
 * captured snapshot so the database keeps holding only the path. Base64 is
 * retained only when the file could not be written, so a photo is never lost.
 */
function externalizeIncomingImages(uuid, tx, existing) {
  const out = {
    image_path: tx.image_path || (existing ? existing.image_path : null),
    image_base64: '',
    image_path_2: tx.image_path_2 || (existing ? existing.image_path_2 : null),
    image_base64_2: ''
  };

  if (tx.image_base64) {
    const saved = saveImageSnapshot(uuid, tx.image_base64);
    if (saved) out.image_path = saved;
    else out.image_base64 = tx.image_base64;
  } else if (existing && existing.image_base64) {
    out.image_base64 = existing.image_base64; // legacy row still holding its photo
  }

  if (tx.image_base64_2) {
    const saved = saveImageSnapshot(`${uuid}_2`, tx.image_base64_2);
    if (saved) out.image_path_2 = saved;
    else out.image_base64_2 = tx.image_base64_2;
  } else if (existing && existing.image_base64_2) {
    out.image_base64_2 = existing.image_base64_2;
  }

  return out;
}

/**
 * One-time migration: pull every base64 photo still sitting in the database out
 * to a .jpg file and blank the column. Rows whose file is already on disk just
 * lose the duplicate. Runs in batches so a huge database never loads all of its
 * photos into memory at once.
 */
function externalizeStoredImages() {
  const tables = [
    'transactions', 'boulders', 'sales_weighment_units', 'yard_weighments',
    'loading_slips', 'first_weighments', 'second_weighments'
  ];

  let alreadyDone = false;
  try {
    const check = dbInstance.prepare("SELECT value FROM settings WHERE key = 'images_externalized_v1'");
    alreadyDone = check.step() ? check.getAsObject().value === 'true' : false;
    check.free();
  } catch (_) { }
  if (alreadyDone) return;

  console.log('[SQLite] Migrating embedded snapshots out of the database (one time)...');
  let moved = 0;

  for (const table of tables) {
    for (; ;) {
      let batch = [];
      try {
        const stmt = dbInstance.prepare(`
          SELECT id, uuid, image_path, image_base64, image_path_2, image_base64_2
          FROM ${table}
          WHERE (image_base64 IS NOT NULL AND image_base64 != '')
             OR (image_base64_2 IS NOT NULL AND image_base64_2 != '')
          LIMIT 100
        `);
        while (stmt.step()) batch.push(stmt.getAsObject());
        stmt.free();
      } catch (_) {
        break; // table or columns not present on this database
      }
      if (batch.length === 0) break;

      for (const row of batch) {
        const uuid = row.uuid || `row${row.id}`;
        let path1 = row.image_path;
        let path2 = row.image_path_2;

        if (row.image_base64) {
          const existsOnDisk = path1 && fs.existsSync(path1);
          if (!existsOnDisk) path1 = saveImageSnapshot(uuid, row.image_base64) || path1;
        }
        if (row.image_base64_2) {
          const existsOnDisk = path2 && fs.existsSync(path2);
          if (!existsOnDisk) path2 = saveImageSnapshot(`${uuid}_2`, row.image_base64_2) || path2;
        }

        // Only drop the base64 once the file it points at is really there,
        // otherwise the photo would be lost.
        const keep1 = row.image_base64 && !(path1 && fs.existsSync(path1));
        const keep2 = row.image_base64_2 && !(path2 && fs.existsSync(path2));

        dbInstance.run(
          `UPDATE ${table} SET image_path = ?, image_base64 = ?, image_path_2 = ?, image_base64_2 = ? WHERE id = ?`,
          [
            path1 || null,
            keep1 ? row.image_base64 : '',
            path2 || null,
            keep2 ? row.image_base64_2 : '',
            row.id
          ]
        );
        moved += 1;
      }
      console.log(`[SQLite] ...${table}: ${moved} snapshots moved so far`);
    }
  }

  try { dbInstance.run('VACUUM;'); } catch (e) {
    console.error('[SQLite] VACUUM after image migration failed (non-fatal):', e.message);
  }
  dbInstance.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('images_externalized_v1', 'true')");
  saveToDiskSync();
  console.log(`[SQLite] Snapshot migration complete — ${moved} rows externalised.`);
}

// --- TRANSACTION OPERATIONS ---
function getAllTransactions() {
  const stmt = dbInstance.prepare('SELECT * FROM transactions ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function addTransaction(tx, base64Image) {
  const uuid = tx.uuid || crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imagePath = saveImageSnapshot(uuid, img1);
  const imagePath2 = saveImageSnapshot(`${uuid}_2`, img2);

  const officialDc = getAndAssignDc(tx.bill_type || tx.billType || 'NON-GST', 'DC-', 'sales');
  tx.dc_num = officialDc;
  tx.dcNum = officialDc;

  dbInstance.run(`
    INSERT INTO transactions (
      uuid, date_time, vehicle_no, party, product, gross, tare, net, operator, card, vehicle_type, token, image_path, image_base64, image_path_2, image_base64_2, sync_status,
      dc_num, contractor, quarry, material, driver, transporter, destination, bill_type, tare_date, tare_time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uuid,
    tx.date_time,
    tx.vehicle_no,
    tx.party || 'OTHERS',
    tx.product || 'STONE AGGREGATE',
    Number(tx.gross || 0),
    Number(tx.tare || 0),
    Number(tx.net || 0),
    tx.operator || 'Admin',
    tx.card || '',
    tx.vehicle_type || '6-Wheel Truck',
    tx.token || `TK-${Math.floor(1000 + Math.random() * 9000)}`,
    imagePath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imagePath ? '' : (img1 || ''),
    imagePath2,
    imagePath2 ? '' : (img2 || ''),
    tx.dc_num,
    tx.contractor || '',
    tx.quarry || '',
    tx.material || '',
    tx.driver || '',
    tx.transporter || '',
    tx.destination || '',
    tx.bill_type || tx.billType || 'NON-GST',
    tx.tare_date || tx.tareDate || '',
    tx.tare_time || tx.tareTime || ''
  ]);

  const stmt = dbInstance.prepare('SELECT last_insert_rowid() AS id');
  const id = stmt.step() ? stmt.getAsObject().id : null;
  stmt.free();

  pushToSyncQueue('transactions', uuid);
  saveToDisk();
  return { id, uuid, ...tx };
}


function getUnsyncedTransactions() {
  const stmt = dbInstance.prepare('SELECT * FROM transactions WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markTransactionSynced(uuid) {
  dbInstance.run('UPDATE transactions SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}

// --- SETTINGS OPERATIONS ---
function getSettings() {
  const stmt = dbInstance.prepare('SELECT * FROM settings');
  const settingsObj = {};
  while (stmt.step()) {
    const row = stmt.getAsObject();
    settingsObj[row.key] = row.value;
  }
  stmt.free();
  return settingsObj;
}

function saveSetting(key, value) {
  dbInstance.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  saveToDisk();
  return true;
}

// Helper to identify if status or record is inactive or deleted
function isInactiveStatus(status, item) {
  if (item && typeof item === 'object') {
    if (item.deleted === true || item.deleted === 1 || item.deleted === '1' || item.deleted === 'true') return true;
    if (item.is_deleted === true || item.is_deleted === 1 || item.is_deleted === '1' || item.is_deleted === 'true') return true;
    if (item.is_active === false || item.is_active === 0 || item.is_active === '0' || item.is_active === 'false') return true;
    if (item.active === false || item.active === 0 || item.active === '0' || item.active === 'false') return true;
    if (item.action === 'delete' || item.action === 'deleted' || item.action === 'remove' || item.action === 'removed') return true;
    if (item._deleted === true || item._deleted === 1) return true;
  }
  if (status === undefined || status === null) return false;
  if (typeof status === 'boolean') return !status;
  if (typeof status === 'number') return status === 0;
  const s = String(status).trim().toLowerCase();
  return (
    s === 'inactive' ||
    s === 'deleted' ||
    s === 'delete' ||
    s === 'disabled' ||
    s === 'deactive' ||
    s === '0' ||
    s === 'false' ||
    s === 'remove' ||
    s === 'removed' ||
    s === 'trash'
  );
}

// --- MASTER DATA SYNC OPERATIONS ---
// ONLY master data records (debitors, materials, destinations, transporters, contractors, contractor_materials, sources)
// are updated or deleted here based on server pending data. Transaction tables (sales, boulders, yard, etc.) are never modified by master sync.
function savePendingData(data) {
  if (!dbInstance) return false;

  let insertedCount = 0;
  let deletedCount = 0;

  // Process debitors
  if (data.debitors && Array.isArray(data.debitors)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO debitors (id, party, creditLimit, site, vendorName, gstin, address, status, online, billingType, gstSale, phone, contact, email, pan, ledgerId, ledgerType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of data.debitors) {
      if (isInactiveStatus(d.status, d)) {
        dbInstance.run('DELETE FROM debitors WHERE id = ?', [d.id]);
        dbInstance.run('DELETE FROM materials WHERE debitorId = ?', [d.id]);
        dbInstance.run('DELETE FROM destinations WHERE debitorId = ?', [d.id]);
        deletedCount++;
      } else {
        const gstSaleVal = d.gstSale !== undefined && d.gstSale !== null
          ? (d.gstSale === true || String(d.gstSale).toLowerCase() === 'true' || d.gstSale === 1 ? 1 : 0)
          : null;
        const phoneVal = d.phone ?? d.phoneNumber ?? d.mobile ?? d.contact_number ?? null;
        insertStmt.run([
          d.id,
          d.party ?? null,
          d.creditLimit ?? null,
          d.site ?? null,
          d.vendorName ?? null,
          d.gstin ?? null,
          d.address ?? null,
          d.status ?? null,
          d.online ?? null,
          d.billingType ?? d.billing_type ?? null,
          gstSaleVal,
          phoneVal,
          d.contact ?? null,
          d.email ?? null,
          d.pan ?? null,
          d.ledgerId ?? null,
          d.ledgerType ?? null
        ]);
        insertedCount++;
      }
    }
    insertStmt.free();
  }

  // Process materials
  if (data.materials && Array.isArray(data.materials)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO materials (id, debitorId, party, material, measurement, rate, status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of data.materials) {
      if (isInactiveStatus(m.status, m)) {
        dbInstance.run('DELETE FROM materials WHERE id = ?', [m.id]);
        deletedCount++;
      } else {
        insertStmt.run([
          m.id,
          m.debitorId ?? null,
          m.party ?? null,
          m.material ?? null,
          m.measurement ?? null,
          m.rate ?? 0,
          m.status ?? null,
          m.online ?? null
        ]);
        insertedCount++;
      }
    }
    insertStmt.free();
  }

  // Process destinations
  if (data.destinations && Array.isArray(data.destinations)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO destinations (id, debitorId, party, destination, measurement, rate, status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ds of data.destinations) {
      if (isInactiveStatus(ds.status, ds)) {
        dbInstance.run('DELETE FROM destinations WHERE id = ?', [ds.id]);
        deletedCount++;
      } else {
        insertStmt.run([
          ds.id,
          ds.debitorId ?? null,
          ds.party ?? null,
          ds.destination ?? null,
          ds.measurement ?? null,
          ds.rate ?? 0,
          ds.status ?? null,
          ds.online ?? null
        ]);
        insertedCount++;
      }
    }
    insertStmt.free();
  }

  // Process transporters
  if (data.transporters && Array.isArray(data.transporters)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO transporters (id, transporterName, destination, measurement, rate, status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of data.transporters) {
      if (isInactiveStatus(t.status, t)) {
        dbInstance.run('DELETE FROM transporters WHERE id = ?', [t.id]);
        dbInstance.run('DELETE FROM transporters WHERE id LIKE ?', [`${t.id}_%`]);
        deletedCount++;
      } else {
        const dests = (t.destinations && Array.isArray(t.destinations) && t.destinations.length > 0)
          ? t.destinations
          : ((t.transporterDestinations && Array.isArray(t.transporterDestinations) && t.transporterDestinations.length > 0)
            ? t.transporterDestinations
            : null);

        if (dests) {
          for (let i = 0; i < dests.length; i++) {
            const d = dests[i];
            if (isInactiveStatus(d.status, d)) {
              if (d.id) dbInstance.run('DELETE FROM transporters WHERE id = ?', [d.id]);
              deletedCount++;
            } else {
              insertStmt.run([
                d.id || `${t.id}_${i}`,
                t.transporterName ?? d.transporterName ?? null,
                d.destination ?? t.destination ?? null,
                d.measurement ?? t.measurement ?? null,
                d.rate !== undefined && d.rate !== null ? d.rate : (t.rate ?? 0),
                d.status ?? t.status ?? null,
                d.online ?? t.online ?? null
              ]);
              insertedCount++;
            }
          }
        } else {
          insertStmt.run([
            t.id,
            t.transporterName ?? null,
            t.destination ?? null,
            t.measurement ?? null,
            t.rate ?? 0,
            t.status ?? null,
            t.online ?? null
          ]);
          insertedCount++;
        }
      }
    }
    insertStmt.free();
  }

  // Process contractors
  if (data.contractors && Array.isArray(data.contractors)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO contractors (id, contractorName, quarryName, ton, rate, gstin, phone, status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of data.contractors) {
      if (isInactiveStatus(c.status, c)) {
        dbInstance.run('DELETE FROM contractors WHERE id = ?', [c.id]);
        dbInstance.run('DELETE FROM contractor_materials WHERE contractorId = ?', [c.id]);
        deletedCount++;
      } else {
        const rateVal = c.rate !== undefined && c.rate !== null ? c.rate : (c.ton !== undefined && c.ton !== null ? c.ton : null);
        const tonVal = c.ton !== undefined && c.ton !== null ? c.ton : (c.rate !== undefined && c.rate !== null ? c.rate : null);
        insertStmt.run([
          c.id,
          c.contractorName ?? null,
          c.quarryName ?? null,
          tonVal,
          rateVal,
          c.gstin ?? null,
          c.phone ?? null,
          c.status ?? null,
          c.online ?? null
        ]);
        insertedCount++;
      }
    }
    insertStmt.free();
  }

  // Process contractor_materials
  const rawContractorMaterials = data.contractor_materials || data.contractorMaterials;
  if (rawContractorMaterials && Array.isArray(rawContractorMaterials)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO contractor_materials (id, contractorId, contractorName, quarryName, materialId, material, measurement, rate, status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cm of rawContractorMaterials) {
      if (isInactiveStatus(cm.status, cm)) {
        dbInstance.run('DELETE FROM contractor_materials WHERE id = ?', [cm.id]);
        deletedCount++;
      } else {
        insertStmt.run([
          cm.id,
          cm.contractorId ?? null,
          cm.contractorName ?? null,
          cm.quarryName ?? null,
          cm.materialId ?? null,
          cm.material ?? null,
          cm.measurement ?? null,
          cm.rate !== undefined && cm.rate !== null ? cm.rate : 0,
          cm.status ?? null,
          cm.online ?? null
        ]);
        insertedCount++;
      }
    }
    insertStmt.free();
  }

  // Process sources
  if (data.sources && Array.isArray(data.sources)) {
    const insertStmt = dbInstance.prepare(`
      INSERT OR REPLACE INTO sources (id, sourceName, status, online)
      VALUES (?, ?, ?, ?)
    `);
    for (const s of data.sources) {
      if (isInactiveStatus(s.status, s)) {
        dbInstance.run('DELETE FROM sources WHERE id = ?', [s.id]);
        deletedCount++;
      } else {
        insertStmt.run([
          s.id,
          s.sourceName ?? null,
          s.status ?? null,
          s.online ?? null
        ]);
        insertedCount++;
      }
    }
    insertStmt.free();
  }

  // Purge any lingering inactive records and orphans across all master tables
  try {
    const inactiveCleanFilter = "LOWER(TRIM(COALESCE(status, ''))) IN ('inactive', 'deleted', 'delete', 'disabled', 'deactive', '0', 'false', 'remove', 'removed', 'trash') OR status = 0 OR status = '0'";
    dbInstance.run(`DELETE FROM debitors WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM materials WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM destinations WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM transporters WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM contractors WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM contractor_materials WHERE ${inactiveCleanFilter}`);
    dbInstance.run(`DELETE FROM sources WHERE ${inactiveCleanFilter}`);

    // Cleanup orphaned records where parent debitor/contractor no longer exists
    dbInstance.run("DELETE FROM materials WHERE debitorId IS NOT NULL AND debitorId NOT IN (SELECT id FROM debitors)");
    dbInstance.run("DELETE FROM destinations WHERE debitorId IS NOT NULL AND debitorId NOT IN (SELECT id FROM debitors)");
    dbInstance.run("DELETE FROM contractor_materials WHERE contractorId IS NOT NULL AND contractorId NOT IN (SELECT id FROM contractors)");
  } catch (cleanErr) {
    console.error('[SQLite] Error during inactive/orphan master data cleanup:', cleanErr.message);
  }

  console.log(`[SQLite] Master data processed: ${insertedCount} inserted/updated, ${deletedCount} deleted.`);
  saveToDisk();
  return true;
}

const MASTER_ACTIVE_FILTER = "(status IS NULL OR (LOWER(TRIM(status)) NOT IN ('inactive', 'deleted', 'delete', 'disabled', 'deactive', '0', 'false', 'remove', 'removed', 'trash') AND status != 0 AND status != '0'))";

function getDebitors() {
  const stmt = dbInstance.prepare(`SELECT * FROM debitors WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getMaterials() {
  const stmt = dbInstance.prepare(`SELECT * FROM materials WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getDestinations() {
  const stmt = dbInstance.prepare(`SELECT * FROM destinations WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getTransporters() {
  const stmt = dbInstance.prepare(`SELECT * FROM transporters WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getContractors() {
  const stmt = dbInstance.prepare(`SELECT * FROM contractors WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getContractorMaterials() {
  const stmt = dbInstance.prepare(`SELECT * FROM contractor_materials WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getSources() {
  const stmt = dbInstance.prepare(`SELECT * FROM sources WHERE ${MASTER_ACTIVE_FILTER}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getVehicleTares() {
  const stmt = dbInstance.prepare('SELECT * FROM vehicle_tares ORDER BY id DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function saveVehicleTare(data) {
  if (!data || !data.vehicle) return false;
  const cleanVeh = data.vehicle.trim().toUpperCase();

  const stmt = dbInstance.prepare('SELECT id FROM vehicle_tares WHERE UPPER(REPLACE(vehicle, " ", "")) = UPPER(REPLACE(?, " ", ""))');
  stmt.bind([cleanVeh]);
  const existing = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();

  const numWeight = typeof data.weight === 'string' ? parseFloat(data.weight.replace(/,/g, '')) || 0 : (data.weight || 0);

  if (existing) {
    dbInstance.run(`
      UPDATE vehicle_tares
      SET vehicle = ?, vehicleType = ?, material = ?, ownership = ?, weight = ?, date = ?, time = ?, token = ?
      WHERE id = ?
    `, [
      cleanVeh,
      data.vehicleType || '6-Wheel Truck',
      data.material || '',
      data.ownership || 'OTHERS',
      numWeight,
      data.date,
      data.time,
      data.token,
      existing.id
    ]);
  } else {
    dbInstance.run(`
      INSERT INTO vehicle_tares (vehicle, vehicleType, material, ownership, weight, date, time, token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cleanVeh,
      data.vehicleType || '6-Wheel Truck',
      data.material || '',
      data.ownership || 'OTHERS',
      numWeight,
      data.date,
      data.time,
      data.token
    ]);
  }
  saveToDisk();
  return true;
}

function deleteVehicleTare(id) {
  dbInstance.run('DELETE FROM vehicle_tares WHERE id = ?', [id]);
  saveToDisk();
  return true;
}

function deleteVehicleTareByNumber(vehicleNo) {
  if (!dbInstance || !vehicleNo) return false;
  const cleanVeh = vehicleNo.toString().trim().replace(/\s+/g, '').toUpperCase();
  dbInstance.run('DELETE FROM vehicle_tares WHERE UPPER(REPLACE(vehicle, " ", "")) = ?', [cleanVeh]);
  saveToDisk();
  return true;
}

function getRfidCards() {
  if (!dbInstance) return [];
  try {
    const stmt = dbInstance.prepare('SELECT * FROM rfid_cards ORDER BY id DESC');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (e) {
    console.error('[SQLite] Error getting rfid_cards:', e);
    return [];
  }
}

function getRfidCardByNumber(cardNumber) {
  if (!dbInstance || !cardNumber) return null;
  try {
    const cleanCard = String(cardNumber).trim();
    const stmt = dbInstance.prepare('SELECT * FROM rfid_cards WHERE LOWER(TRIM(card_number)) = LOWER(?)');
    stmt.bind([cleanCard]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  } catch (e) {
    console.error('[SQLite] Error querying rfid_card by number:', e);
    return null;
  }
}

function saveRfidCard(data) {
  if (!dbInstance || !data || !data.cardNumber || !data.vehicle) return false;
  try {
    const cleanCard = String(data.cardNumber).trim();
    const cleanVeh = String(data.vehicle).trim().toUpperCase();
    const material = data.material || 'BOULDERS';
    const contractor = data.contractor || '';

    const stmt = dbInstance.prepare('SELECT id FROM rfid_cards WHERE LOWER(TRIM(card_number)) = LOWER(?)');
    stmt.bind([cleanCard]);
    const existing = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    if (existing) {
      dbInstance.run(`
        UPDATE rfid_cards
        SET vehicle = ?, material = ?, contractor = ?
        WHERE id = ?
      `, [cleanVeh, material, contractor, existing.id]);
    } else {
      dbInstance.run(`
        INSERT INTO rfid_cards (card_number, vehicle, material, contractor)
        VALUES (?, ?, ?, ?)
      `, [cleanCard, cleanVeh, material, contractor]);
    }
    saveToDisk();
    return true;
  } catch (e) {
    console.error('[SQLite] Error saving rfid_card:', e);
    return false;
  }
}

function deleteRfidCard(id) {
  if (!dbInstance || !id) return false;
  try {
    dbInstance.run('DELETE FROM rfid_cards WHERE id = ?', [id]);
    saveToDisk();
    return true;
  } catch (e) {
    console.error('[SQLite] Error deleting rfid_card:', e);
    return false;
  }
}

function getTransporterVehicles() {
  if (!dbInstance) return [];
  try {
    const stmt = dbInstance.prepare('SELECT id, transporter, vehicle_no AS vehicleNo, capacity, created_at AS createdAt FROM transporter_vehicles ORDER BY id DESC');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (e) {
    console.error('[SQLite] Error getting transporter_vehicles:', e);
    return [];
  }
}

function saveTransporterVehicle(data) {
  if (!dbInstance || !data || !data.transporter || (!data.vehicleNo && !data.vehicle_no && !data.vehicle)) return false;
  try {
    const trans = String(data.transporter).trim();
    const veh = String(data.vehicleNo || data.vehicle_no || data.vehicle).trim().toUpperCase();
    const capacity = String(data.capacity || '').trim();

    const stmt = dbInstance.prepare('SELECT id FROM transporter_vehicles WHERE LOWER(TRIM(vehicle_no)) = LOWER(?)');
    stmt.bind([veh]);
    const existing = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    if (existing) {
      dbInstance.run(`
        UPDATE transporter_vehicles
        SET transporter = ?, capacity = ?
        WHERE id = ?
      `, [trans, capacity, existing.id]);
    } else {
      dbInstance.run(`
        INSERT INTO transporter_vehicles (transporter, vehicle_no, capacity)
        VALUES (?, ?, ?)
      `, [trans, veh, capacity]);
    }
    saveToDisk();
    return true;
  } catch (e) {
    console.error('[SQLite] Error saving transporter_vehicle:', e);
    return false;
  }
}

function deleteTransporterVehicle(id) {
  if (!dbInstance || !id) return false;
  try {
    dbInstance.run('DELETE FROM transporter_vehicles WHERE id = ?', [id]);
    saveToDisk();
    return true;
  } catch (e) {
    console.error('[SQLite] Error deleting transporter_vehicle:', e);
    return false;
  }
}

function getVehicleTareByNumber(vehicleNo) {
  if (!dbInstance || !vehicleNo) return null;
  try {
    const cleanVeh = String(vehicleNo).trim().toUpperCase().replace(/[\s\-\.]/g, '');
    const stmt = dbInstance.prepare('SELECT * FROM vehicle_tares WHERE UPPER(REPLACE(REPLACE(REPLACE(vehicle, " ", ""), "-", ""), ".", "")) = ?');
    stmt.bind([cleanVeh]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  } catch (e) {
    console.error('[SQLite] Error getting vehicle tare by number:', e);
    return null;
  }
}

function addBoulderTransaction(tx, base64Image) {
  const uuid = tx.uuid || crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imgPath = saveImageSnapshot(uuid, img1);
  const imgPath2 = saveImageSnapshot(`${uuid}_2`, img2);

  const officialDc = getAndAssignDc('NON-GST', 'DC-', 'boulders');
  tx.dc_num = officialDc;
  tx.dcNum = officialDc;

  dbInstance.run(`
    INSERT INTO boulders (
      uuid, dc_num, date_time, vehicle_no, contractor, quarry,
      material, gross, tare, net, driver, transporter, destination, operator, image_path, image_base64, image_path_2, image_base64_2, sync_status,
      tare_date, tare_time, rate, amount
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `, [
    uuid,
    officialDc,
    tx.date_time || new Date().toLocaleString(),
    tx.vehicle_no || '',
    tx.contractor || tx.party || '',
    tx.quarry || '',
    tx.material || 'BOULDERS',
    Number(tx.gross || 0),
    Number(tx.tare || 0),
    Number(tx.net || 0),
    tx.driver || '',
    tx.transporter || '',
    tx.destination || '',
    tx.operator || 'Admin',
    imgPath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imgPath ? '' : (img1 || ''),
    imgPath2,
    imgPath2 ? '' : (img2 || ''),
    tx.tare_date || tx.tareDate || '',
    tx.tare_time || tx.tareTime || '',
    tx.rate !== undefined ? Number(tx.rate) : null,
    tx.amount !== undefined ? Number(tx.amount) : null
  ]);

  pushToSyncQueue('boulders', uuid);
  saveToDisk();
  return { uuid, ...tx };
}


function getAllBoulders() {
  const stmt = dbInstance.prepare('SELECT * FROM boulders ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getUnsyncedBoulders() {
  const stmt = dbInstance.prepare('SELECT * FROM boulders WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markBoulderSynced(uuid) {
  dbInstance.run('UPDATE boulders SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}

// --- SALES WEIGHMENT UNITS OPERATIONS ---
function addSalesWeighmentUnits(tx, base64Image) {
  const uuid = tx.uuid || crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imgPath = saveImageSnapshot(uuid, img1);
  const imgPath2 = saveImageSnapshot(`${uuid}_2`, img2);

  const officialDc = getAndAssignDc(tx.bill_type || tx.billType || 'NON-GST', 'DC-', 'sales');
  tx.dc_num = officialDc;
  tx.dcNum = officialDc;

  dbInstance.run(`
    INSERT INTO sales_weighment_units (
      uuid, dc_num, your_dc, date_time, vehicle_no, party, material, unit_type, units_val,
      destination, source, transporter, driver, phone, stationary, po_number, po_date,
      payment, gross, tare, net, rate, amount, bill_type, transport, discount, grand_total,
      cash_amount, upi_amount, credit_amount, operator, image_path, image_base64, image_path_2, image_base64_2, sync_status,
      tare_date, tare_time, party_transport_rate, party_transport_measurement, party_transport_amount,
      transporter_rate, transporter_measurement, transporter_amount, destination_rate, destination_amount,
      royalty_type, royalty_amount
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uuid,
    officialDc,
    tx.your_dc || tx.yourDc || '',
    tx.date_time || new Date().toLocaleString(),
    tx.vehicle_no || tx.vehicle || '',
    tx.party || '',
    tx.material || '',
    tx.unit_type || tx.unitType || 'units',
    Number(tx.units_val || tx.unitsVal || 0),
    tx.destination || '',
    tx.source || '',
    tx.transporter || '',
    tx.driver || '',
    tx.phone || '',
    tx.stationary || '',
    tx.po_number || tx.poNumber || '',
    tx.po_date || tx.poDate || '',
    tx.payment || 'Credit',
    Number(tx.gross || tx.grossVal || 0),
    Number(tx.tare || tx.tareVal || 0),
    Number(tx.net || tx.nettVal || 0),
    Number(tx.rate || 0),
    Number(tx.amount || 0),
    tx.bill_type || tx.billType || 'NON-GST',
    Number(tx.transport || 0),
    Number(tx.discount || 0),
    Number(tx.grand_total || tx.grandTotal || 0),
    String(tx.payment || '').trim().toLowerCase() === 'pending' ? 0 : Number(tx.cash_amount || tx.cashAmount || 0),
    String(tx.payment || '').trim().toLowerCase() === 'pending' ? 0 : Number(tx.upi_amount || tx.upiAmount || 0),
    String(tx.payment || '').trim().toLowerCase() === 'pending' ? 0 : Number(tx.credit_amount || tx.creditAmount || 0),
    tx.operator || 'Admin',
    imgPath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imgPath ? '' : (img1 || ''),
    imgPath2,
    imgPath2 ? '' : (img2 || ''),
    tx.tare_date || tx.tareDate || '',
    tx.tare_time || tx.tareTime || '',
    Number(tx.party_transport_rate || tx.partyTransportRate || 0),
    tx.party_transport_measurement || tx.partyTransportMeasurement || '',
    Number(tx.party_transport_amount || tx.partyTransportAmount || 0),
    Number(tx.transporter_rate || tx.transporterRate || 0),
    tx.transporter_measurement || tx.transporterMeasurement || '',
    Number(tx.transporter_amount || tx.transporterAmount || 0),
    Number(tx.destination_rate || tx.destinationRate || tx.party_transport_rate || tx.partyTransportRate || 0),
    Number(tx.destination_amount || tx.destinationAmount || tx.party_transport_amount || tx.partyTransportAmount || 0),
    tx.royalty_type || tx.royaltyType || 'None',
    Number(tx.royalty_amount || tx.royaltyAmount || 0)
  ]);

  pushToSyncQueue('sales_units', uuid);
  saveToDisk();
  return { uuid, ...tx };
}


function getAllSalesWeighmentUnits() {
  const stmt = dbInstance.prepare('SELECT * FROM sales_weighment_units ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getUnsyncedSalesWeighmentUnits() {
  const stmt = dbInstance.prepare('SELECT * FROM sales_weighment_units WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markSalesWeighmentUnitsSynced(uuid) {
  dbInstance.run('UPDATE sales_weighment_units SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}

// --- YARD WEIGHMENTS OPERATIONS ---
function addYardWeighment(tx, base64Image) {
  const uuid = tx.uuid || crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imgPath = saveImageSnapshot(uuid, img1);
  const imgPath2 = saveImageSnapshot(`${uuid}_2`, img2);

  const officialDc = getAndAssignDc('NON-GST', 'DC-', 'yard');
  tx.dc_num = officialDc;
  tx.dcNum = officialDc;

  dbInstance.run(`
    INSERT INTO yard_weighments (
      uuid, dc_num, date_time, vehicle_no, party, material, gross, tare, net,
      card, vehicle_type, destination, source, transporter, driver, operator, image_path, image_base64, image_path_2, image_base64_2, sync_status,
      tare_date, tare_time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `, [
    uuid,
    officialDc,
    tx.date_time || new Date().toLocaleString(),
    tx.vehicle_no || tx.vehicle || '',
    tx.party || 'YARD',
    tx.material || '',
    Number(tx.gross || 0),
    Number(tx.tare || 0),
    Number(tx.net || tx.nett || 0),
    tx.card || tx.token || '',
    tx.vehicle_type || 'Truck',
    tx.destination || 'Yard',
    tx.source || '',
    tx.transporter || '',
    tx.driver || '',
    tx.operator || 'Admin',
    imgPath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imgPath ? '' : (img1 || ''),
    imgPath2,
    imgPath2 ? '' : (img2 || ''),
    tx.tare_date || tx.tareDate || '',
    tx.tare_time || tx.tareTime || ''
  ]);

  pushToSyncQueue('yard', uuid);
  saveToDisk();
  return { uuid, ...tx, dc_num: officialDc, dcNum: officialDc };
}


function getAllYardWeighments() {
  const stmt = dbInstance.prepare('SELECT * FROM yard_weighments ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getUnsyncedYardWeighments() {
  const stmt = dbInstance.prepare('SELECT * FROM yard_weighments WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markYardWeighmentSynced(uuid) {
  dbInstance.run('UPDATE yard_weighments SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}

// --- LOADING SLIPS OPERATIONS ---
function addLoadingSlip(tx, base64Image) {
  const uuid = tx.uuid || crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imgPath = saveImageSnapshot(uuid, img1);
  const imgPath2 = saveImageSnapshot(`${uuid}_2`, img2);

  const officialDc = getAndAssignDc('NON-GST', 'DC-', 'loading');
  tx.dc_num = officialDc;
  tx.dcNum = officialDc;

  dbInstance.run(`
    INSERT INTO loading_slips (
      uuid, dc_num, copy_num, date_time, vehicle_no, party, material,
      destination, source, transporter, payment, phone, weight, operator, image_path, image_base64, image_path_2, image_base64_2, sync_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    uuid,
    officialDc,
    tx.copy_num || tx.copyNum || '',
    tx.date_time || new Date().toLocaleString(),
    tx.vehicle_no || tx.vehicle || '',
    tx.party || '',
    tx.material || '',
    tx.destination || '',
    tx.source || '',
    tx.transporter || '',
    tx.payment || 'Credit',
    tx.phone || '',
    tx.weight || 'Pending',
    tx.operator || 'Admin',
    imgPath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imgPath ? '' : (img1 || ''),
    imgPath2,
    imgPath2 ? '' : (img2 || '')
  ]);

  // Loading slips are kept local-only on desktop and not synced to remote server.
  // Only the completed sales weighment (sales_weighment_units) is synced to the server.
  saveToDisk();
  return { uuid, ...tx };
}

function getAllLoadingSlips() {
  const stmt = dbInstance.prepare("SELECT * FROM loading_slips WHERE status != 'completed' OR status IS NULL ORDER BY created_at DESC");
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getUnsyncedLoadingSlips() {
  const stmt = dbInstance.prepare('SELECT * FROM loading_slips WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markLoadingSlipSynced(uuid) {
  dbInstance.run('UPDATE loading_slips SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}

function fulfillLoadingSlip(identifier, finalWeight) {
  const weightStr = String(finalWeight != null ? finalWeight : 'Completed');
  try {
    dbInstance.run(
      `UPDATE loading_slips 
       SET weight = ?, status = 'completed', sync_status = 0 
       WHERE uuid = ? OR dc_num = ? OR vehicle_no = ?`,
      [weightStr, identifier, identifier, identifier]
    );
    saveToDisk();
    return true;
  } catch (err) {
    console.error('[DB] fulfillLoadingSlip error:', err);
    return false;
  }
}

function deleteLoadingSlip(identifier) {
  try {
    dbInstance.run(
      'DELETE FROM loading_slips WHERE uuid = ? OR dc_num = ? OR vehicle_no = ?',
      [identifier, identifier, identifier]
    );
    saveToDisk();
    return true;
  } catch (err) {
    console.error('[DB] deleteLoadingSlip error:', err);
    return false;
  }
}

// --- FIRST WEIGHMENTS OPERATIONS ---
function addFirstWeighment(tx, base64Image) {
  const uuid = crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imgPath = saveImageSnapshot(uuid, img1);
  const imgPath2 = saveImageSnapshot(`${uuid}_2`, img2);

  dbInstance.run(`
    INSERT INTO first_weighments (
      uuid, dc_num, date_time, vehicle_no, party, material, gross, tare, net,
      destination, source, transporter, driver, phone, operator, image_path, image_base64, image_path_2, image_base64_2, sync_status,
      tare_date, tare_time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `, [
    uuid,
    tx.dc_num || tx.dcNum || '',
    tx.date_time || new Date().toLocaleString(),
    tx.vehicle_no || tx.vehicle || '',
    tx.party || '',
    tx.material || '',
    Number(tx.gross || tx.grossVal || 0),
    Number(tx.tare || tx.tareVal || 0),
    Number(tx.net || tx.nettVal || 0),
    tx.destination || '',
    tx.source || '',
    tx.transporter || '',
    tx.driver || '',
    tx.phone || '',
    tx.operator || 'Admin',
    imgPath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imgPath ? '' : (img1 || ''),
    imgPath2,
    imgPath2 ? '' : (img2 || ''),
    tx.tare_date || tx.tareDate || '',
    tx.tare_time || tx.tareTime || ''
  ]);

  // First weighments are stored in local DB only (no remote server endpoint)
  saveToDisk();
  return { uuid, ...tx };
}


function getAllFirstWeighments() {
  const stmt = dbInstance.prepare('SELECT * FROM first_weighments ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getUnsyncedFirstWeighments() {
  const stmt = dbInstance.prepare('SELECT * FROM first_weighments WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markFirstWeighmentSynced(uuid) {
  dbInstance.run('UPDATE first_weighments SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}

// --- SECOND WEIGHMENTS OPERATIONS ---
function addSecondWeighment(tx, base64Image) {
  const uuid = crypto.randomUUID();
  let img1 = null;
  let img2 = null;
  if (base64Image) {
    if (typeof base64Image === 'object') {
      img1 = base64Image.image_base64 || tx.base64Image || tx.image_base64 || '';
      img2 = base64Image.image_base64_2 || tx.base64Image2 || tx.image_base64_2 || '';
    } else {
      img1 = base64Image;
    }
  } else {
    img1 = tx.base64Image || tx.image_base64 || '';
    img2 = tx.base64Image2 || tx.image_base64_2 || '';
  }

  img1 = compressImage(img1);
  img2 = compressImage(img2);

  const imgPath = saveImageSnapshot(uuid, img1);
  const imgPath2 = saveImageSnapshot(`${uuid}_2`, img2);

  dbInstance.run(`
    INSERT INTO second_weighments (
      uuid, dc_num, first_weighment_id, date_time, vehicle_no, party, material, gross, tare, net,
      destination, source, transporter, driver, phone, operator, image_path, image_base64, image_path_2, image_base64_2, sync_status,
      tare_date, tare_time
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `, [
    uuid,
    tx.dc_num || tx.dcNum || '',
    tx.first_weighment_id || tx.firstWeighmentId || '',
    tx.date_time || new Date().toLocaleString(),
    tx.vehicle_no || tx.vehicle || '',
    tx.party || '',
    tx.material || '',
    Number(tx.gross || tx.grossVal || 0),
    Number(tx.tare || tx.tareVal || 0),
    Number(tx.net || tx.nettVal || 0),
    tx.destination || '',
    tx.source || '',
    tx.transporter || '',
    tx.driver || '',
    tx.phone || '',
    tx.operator || 'Admin',
    imgPath,
    // Photo lives in the .jpg file; base64 is only kept if the file write failed.
    imgPath ? '' : (img1 || ''),
    imgPath2,
    imgPath2 ? '' : (img2 || ''),
    tx.tare_date || tx.tareDate || '',
    tx.tare_time || tx.tareTime || ''
  ]);

  // Push second weighment to sync_queue for real-time dispatch to server API
  pushToSyncQueue('second_weighments', uuid);

  saveToDisk();
  return { uuid, ...tx };
}

function getAllSecondWeighments() {
  const stmt = dbInstance.prepare('SELECT * FROM second_weighments ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getUnsyncedSecondWeighments() {
  const stmt = dbInstance.prepare('SELECT * FROM second_weighments WHERE sync_status = 0');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function markSecondWeighmentSynced(uuid) {
  dbInstance.run('UPDATE second_weighments SET sync_status = 1 WHERE uuid = ?', [uuid]);
  saveToDisk();
  return true;
}


function resetSyncStatus() {
  if (!dbInstance) return false;
  try {
    dbInstance.run("UPDATE boulders SET sync_status = 0;");
    dbInstance.run("UPDATE sales_weighment_units SET sync_status = 0;");
    dbInstance.run("UPDATE yard_weighments SET sync_status = 0;");
    dbInstance.run("UPDATE transactions SET sync_status = 0;");
    dbInstance.run("DELETE FROM sync_queue;");
    populateInitialSyncQueue();
    saveToDisk();
    return true;
  } catch (e) {
    console.error('[SQLite] Error resetting sync status:', e);
    return false;
  }
}

function markMasterDataUpdated() {
  if (!dbInstance) return;
  try {
    dbInstance.run("UPDATE debitors SET online = 'synced' WHERE online = 'wait'");
    dbInstance.run("UPDATE materials SET online = 'synced' WHERE online = 'wait'");
    dbInstance.run("UPDATE destinations SET online = 'synced' WHERE online = 'wait'");
    dbInstance.run("UPDATE transporters SET online = 'synced' WHERE online = 'wait'");
    dbInstance.run("UPDATE contractors SET online = 'synced' WHERE online = 'wait'");
    dbInstance.run("UPDATE contractor_materials SET online = 'synced' WHERE online = 'wait'");
    dbInstance.run("UPDATE sources SET online = 'synced' WHERE online = 'wait'");
    saveToDisk();
    console.log('[SQLite] Marked all local master data as synced');
  } catch (e) {
    console.error('[SQLite] Error updating master data status:', e);
  }
}

function collectImagePathsFromQuery(query, params = []) {
  if (!dbInstance) return [];
  const paths = [];
  try {
    const stmt = dbInstance.prepare(query, params);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.image_path && typeof row.image_path === 'string' && row.image_path.trim() !== '') {
        paths.push(row.image_path.trim());
      }
      if (row.image_path_2 && typeof row.image_path_2 === 'string' && row.image_path_2.trim() !== '') {
        paths.push(row.image_path_2.trim());
      }
    }
    stmt.free();
  } catch (err) {
    console.error('[SQLite] Error collecting image paths:', err.message);
  }
  return paths;
}

function deleteImageFiles(imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return 0;
  let deletedCount = 0;
  const uniquePaths = [...new Set(imagePaths.filter(p => typeof p === 'string' && p.trim() !== ''))];
  for (const rawPath of uniquePaths) {
    try {
      const p = path.isAbsolute(rawPath) ? rawPath : path.join(imagesDir, path.basename(rawPath));
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deletedCount++;
      }
    } catch (err) {
      console.warn('[SQLite] Could not delete image file:', rawPath, err.message);
    }
  }
  return deletedCount;
}

// Scans weighbridge_images and unlinks any .jpg file not referenced by any live SQLite record
function cleanOrphanImages() {
  if (!fs.existsSync(imagesDir)) return 0;
  try {
    const liveFilenames = new Set();
    const sourceTables = [
      'transactions', 'boulders', 'sales_weighment_units', 'yard_weighments',
      'loading_slips', 'first_weighments', 'second_weighments'
    ];
    if (dbInstance) {
      for (const tbl of sourceTables) {
        try {
          const stmt = dbInstance.prepare(`SELECT uuid, image_path, image_path_2 FROM ${tbl}`);
          while (stmt.step()) {
            const row = stmt.getAsObject();
            if (row.uuid) {
              liveFilenames.add(`${row.uuid}.jpg`.toLowerCase());
              liveFilenames.add(`${row.uuid}_2.jpg`.toLowerCase());
            }
            if (row.image_path) {
              liveFilenames.add(path.basename(row.image_path).toLowerCase());
            }
            if (row.image_path_2) {
              liveFilenames.add(path.basename(row.image_path_2).toLowerCase());
            }
          }
          stmt.free();
        } catch (e) { }
      }
    }

    const filesOnDisk = fs.readdirSync(imagesDir);
    let deletedCount = 0;
    for (const file of filesOnDisk) {
      if (!liveFilenames.has(file.toLowerCase())) {
        try {
          fs.unlinkSync(path.join(imagesDir, file));
          deletedCount++;
        } catch (err) {
          console.warn('[SQLite] Failed to delete orphan image:', file, err.message);
        }
      }
    }
    if (deletedCount > 0) {
      console.log(`[SQLite] Cleaned up ${deletedCount} orphaned image file(s) from ${imagesDir}`);
    }
    return deletedCount;
  } catch (err) {
    console.error('[SQLite] Error during orphan image cleanup:', err);
    return 0;
  }
}

function clearTable(tableName) {
  if (!dbInstance) return { success: false, error: 'Database not initialized' };

  const validTables = {
    'boulders': 'boulders',
    'sales_weighment_units': 'sales_weighment_units',
    'yard_weighments': 'yard_weighments',
    'first_weighments': 'first_weighments',
    'second_weighments': 'second_weighments',
    'loading_slips': 'loading_slips',
    'transactions': 'transactions',
    'all': 'all'
  };

  const target = validTables[tableName];
  if (!target) return { success: false, error: 'Invalid table name' };

  const sizeBefore = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  console.log(`[SQLite] Clearing '${tableName}' — database is currently ${(sizeBefore / 1048576).toFixed(1)} MB`);

  try {
    const imagesToDelete = [];

    if (target === 'all') {
      const allTables = ['boulders', 'sales_weighment_units', 'yard_weighments', 'first_weighments', 'second_weighments', 'loading_slips', 'transactions'];
      for (const tbl of allTables) {
        imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM ${tbl}`));
        try { dbInstance.run(`DELETE FROM ${tbl};`); } catch (e) {
          console.error(`[SQLite] DELETE FROM ${tbl} failed during Reset All:`, e.message);
        }
      }
    } else if (target === 'yard_weighments') {
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM yard_weighments`));
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM transactions WHERE UPPER(destination) = 'YARD' OR UPPER(party) = 'YARD'`));
      dbInstance.run(`DELETE FROM yard_weighments;`);
      try {
        dbInstance.run(`DELETE FROM transactions WHERE UPPER(destination) = 'YARD' OR UPPER(party) = 'YARD';`);
      } catch (e) {
        console.error('[SQLite] Mirrored yard rows in transactions were not deleted:', e.message);
      }
    } else if (target === 'boulders') {
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM boulders`));
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM transactions WHERE UPPER(material) LIKE '%BOULDER%' OR UPPER(product) LIKE '%BOULDER%' OR UPPER(card) = 'BOULDERS'`));
      dbInstance.run(`DELETE FROM boulders;`);
      try {
        dbInstance.run(`DELETE FROM transactions WHERE UPPER(material) LIKE '%BOULDER%' OR UPPER(product) LIKE '%BOULDER%' OR UPPER(card) = 'BOULDERS';`);
      } catch (e) {
        console.error('[SQLite] Mirrored boulder rows in transactions were not deleted:', e.message);
      }
    } else if (target === 'sales_weighment_units') {
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM sales_weighment_units`));
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM transactions WHERE UPPER(destination) != 'YARD' AND UPPER(party) != 'YARD' AND UPPER(card) != 'BOULDERS'`));
      dbInstance.run(`DELETE FROM sales_weighment_units;`);
      try {
        dbInstance.run(`DELETE FROM transactions WHERE UPPER(destination) != 'YARD' AND UPPER(party) != 'YARD' AND UPPER(card) != 'BOULDERS';`);
      } catch (e) {
        console.error('[SQLite] Mirrored sales rows in transactions were not deleted:', e.message);
      }
    } else {
      imagesToDelete.push(...collectImagePathsFromQuery(`SELECT image_path, image_path_2 FROM ${target}`));
      dbInstance.run(`DELETE FROM ${target};`);
    }

    // Automatically delete associated image files from disk
    const unlinkedCount = deleteImageFiles(imagesToDelete);
    if (unlinkedCount > 0) {
      console.log(`[SQLite] Deleted ${unlinkedCount} associated image file(s) for cleared '${tableName}'`);
    }

    // Clean up any remaining orphaned image files
    cleanOrphanImages();

    // Drop sync_queue rows whose record no longer exists. Without this the sync
    // service keeps re-reading a queue full of orphans every 3s, and each pass
    // re-exports the whole database on the main process (UI freeze).
    dropOrphanSyncQueueRows();

    // DELETE alone does not shrink the SQLite pages, so every later export()
    // would still serialise the old (image-heavy) size. VACUUM reclaims it.
    try { dbInstance.run('VACUUM;'); } catch (e) {
      console.error('[SQLite] VACUUM after clear failed (non-fatal):', e.message);
    }

    // Write synchronously so the IPC reply lands after the disk write is done,
    // instead of a debounced export blocking the main process 100ms later while
    // the renderer is showing its confirmation dialog.
    saveToDiskSync();

    const sizeAfter = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    console.log(`[SQLite] Cleared '${tableName}' — database went from ${(sizeBefore / 1048576).toFixed(1)} MB to ${(sizeAfter / 1048576).toFixed(1)} MB`);

    return { success: true, message: `Successfully cleared data for ${tableName}` };
  } catch (err) {
    console.error('[SQLite] Error clearing table:', err);
    return { success: false, error: err.message };
  }
}

// Removes sync_queue entries pointing at records that are gone (e.g. after a
// Memory Clear). Safe to call at any time.
function dropOrphanSyncQueueRows() {
  if (!dbInstance) return;
  const sourceTables = [
    'transactions', 'boulders', 'sales_weighment_units', 'yard_weighments',
    'loading_slips', 'first_weighments', 'second_weighments'
  ];
  try {
    const liveUuids = sourceTables
      .map(t => `SELECT uuid FROM ${t} WHERE uuid IS NOT NULL AND uuid != ''`)
      .join(' UNION ');
    dbInstance.run(`DELETE FROM sync_queue WHERE record_uuid NOT IN (${liveUuids});`);
  } catch (e) {
    console.error('[SQLite] Error pruning orphan sync_queue rows:', e.message);
  }
}

function clearPreTare(bouldersDelete, salesDelete) {
  if (!dbInstance) return { success: false, error: 'Database not initialized' };
  try {
    if (bouldersDelete) {
      dbInstance.run(`DELETE FROM vehicle_tares WHERE UPPER(ownership) IN ('OWN', 'QUARRY');`);
    }
    if (salesDelete) {
      dbInstance.run(`DELETE FROM vehicle_tares WHERE UPPER(ownership) = 'OTHERS' OR ownership IS NULL OR ownership = '';`);
    }
    saveToDiskSync();
    return { success: true, message: 'PreTare records updated/purged successfully' };
  } catch (err) {
    console.error('[SQLite] Error clearing pre-tare:', err);
    return { success: false, error: err.message };
  }
}

// --- AUTO DATA CLEANUP & RETENTION ---
let isPurgingActive = false;

function purgeOldRecords({ days = 1, tables = 'all' } = {}) {
  if (!dbInstance) return { success: false, error: 'Database not initialized' };
  if (isPurgingActive) {
    return { success: false, error: 'A cleanup operation is already in progress' };
  }

  isPurgingActive = true;
  const numDays = Math.max(1, parseInt(days, 10) || 1);

  const validTables = {
    'boulders': 'boulders',
    'sales_weighment_units': 'sales_weighment_units',
    'yard_weighments': 'yard_weighments',
    'first_weighments': 'first_weighments',
    'second_weighments': 'second_weighments',
    'loading_slips': 'loading_slips',
    'transactions': 'transactions'
  };

  const targetTableList = (tables === 'all' || !tables)
    ? Object.keys(validTables)
    : (Array.isArray(tables) ? tables.filter(t => validTables[t]) : [validTables[tables]].filter(Boolean));

  if (targetTableList.length === 0) {
    isPurgingActive = false;
    return { success: false, error: 'No valid target tables specified for cleanup' };
  }

  const sizeBefore = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const deletedCountByTable = {};
  let totalDeleted = 0;
  const timestamp = new Date().toISOString();

  try {
    for (const tbl of targetTableList) {
      try {
        // Safety rules:
        // 1. Must be older than retention period (created_at < datetime('now', '-' || ? || ' days'))
        // 2. Must be confirmed synced (sync_status = 1)
        // 3. Must not have an active pending or in-progress entry in sync_queue (status != 'COMPLETED')
        const matchingClause = `
          FROM ${tbl}
          WHERE created_at IS NOT NULL
            AND created_at < datetime('now', '-' || ? || ' days')
            AND sync_status = 1
            AND (uuid IS NULL OR uuid = '' OR uuid NOT IN (
              SELECT record_uuid FROM sync_queue WHERE record_uuid IS NOT NULL AND record_uuid != '' AND status != 'COMPLETED'
            ))
        `;

        let toDeleteCount = 0;
        const countStmt = dbInstance.prepare(`SELECT COUNT(*) as cnt ${matchingClause}`);
        countStmt.bind([numDays]);
        if (countStmt.step()) {
          toDeleteCount = countStmt.getAsObject().cnt || 0;
        }
        countStmt.free();

        if (toDeleteCount > 0) {
          // 1. Collect image paths for matching records before deleting rows
          const imagesToDelete = collectImagePathsFromQuery(`SELECT image_path, image_path_2 ${matchingClause}`, [numDays]);

          // 2. Delete database records
          dbInstance.run(`DELETE ${matchingClause}`, [numDays]);

          // 3. Delete associated image files from disk
          const unlinkedCount = deleteImageFiles(imagesToDelete);
          if (unlinkedCount > 0) {
            console.log(`[SQLite] Purged ${unlinkedCount} image file(s) for table '${tbl}'`);
          }
        }

        deletedCountByTable[tbl] = toDeleteCount;
        totalDeleted += toDeleteCount;
      } catch (tableErr) {
        console.error(`[SQLite] Error purging old records from ${tbl}:`, tableErr.message);
        deletedCountByTable[tbl] = 0;
      }
    }

    // Clean up only genuinely orphaned sync_queue rows
    dropOrphanSyncQueueRows();

    // Clean up any orphaned image files
    cleanOrphanImages();

    // Reclaim storage via VACUUM if records were removed
    if (totalDeleted > 0) {
      try {
        dbInstance.run('VACUUM;');
      } catch (vacuumErr) {
        console.error('[SQLite] VACUUM after auto-purge failed (non-fatal):', vacuumErr.message);
      }
    }

    // Persist synchronously to disk
    saveToDiskSync();

    const sizeAfter = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const reclaimedBytes = Math.max(0, sizeBefore - sizeAfter);
    const reclaimedFormatted = reclaimedBytes > 1048576
      ? `${(reclaimedBytes / 1048576).toFixed(2)} MB`
      : `${(reclaimedBytes / 1024).toFixed(1)} KB`;

    const result = {
      success: true,
      deletedCountByTable,
      totalDeleted,
      sizeBefore,
      sizeAfter,
      reclaimedBytes,
      reclaimedFormatted,
      timestamp
    };

    // Save cleanup metadata in settings table
    try {
      saveSetting('auto_cleanup_last_run', timestamp);
      saveSetting('auto_cleanup_last_result', JSON.stringify(result));
    } catch (e) { }

    console.log(`[SQLite] Purged ${totalDeleted} old records (>= ${numDays} day(s)) — Database: ${(sizeBefore / 1048576).toFixed(2)} MB -> ${(sizeAfter / 1048576).toFixed(2)} MB (Reclaimed ${reclaimedFormatted})`);

    isPurgingActive = false;
    return result;
  } catch (err) {
    isPurgingActive = false;
    console.error('[SQLite] Fatal error during purgeOldRecords:', err);
    return { success: false, error: err.message };
  }
}

function getCleanupConfig() {
  const settings = getSettings();
  return {
    enabled: settings['auto_cleanup_enabled'] !== 'false',
    days: Number(settings['auto_cleanup_days']) || 1,
    tables: settings['auto_cleanup_tables'] || 'all',
    lastRun: settings['auto_cleanup_last_run'] || null,
    lastResult: settings['auto_cleanup_last_result'] ? JSON.parse(settings['auto_cleanup_last_result']) : null
  };
}

function setCleanupConfig(config = {}) {
  if (config.enabled !== undefined) saveSetting('auto_cleanup_enabled', String(config.enabled));
  if (config.days !== undefined) saveSetting('auto_cleanup_days', String(config.days));
  if (config.tables !== undefined) saveSetting('auto_cleanup_tables', String(config.tables));
  return { success: true, config: getCleanupConfig() };
}

function getCleanupStatus() {
  return {
    isPurgingActive,
    config: getCleanupConfig()
  };
}

// Applies one server-side edit to the local database.
//
// options.allowInsertWhenMissing decides ONLY what happens when the uuid is not
// present locally: today's records may be created, older ones are skipped so we
// never fabricate a ghost row for a record this machine never had.
//
// Returns { applied, action, reason } — the caller must ACK only when
// applied === true. Never returns a bare success for a write that did not run.
function updateRecordFromPending(tableName, tx, options = {}) {
  const allowInsertWhenMissing = options.allowInsertWhenMissing !== false;

  if (!dbInstance) return { applied: false, action: 'failed', reason: 'database not initialized' };
  if (!tx || !tx.uuid) return { applied: false, action: 'failed', reason: 'payload has no uuid' };
  if (tableName !== 'boulders' && tableName !== 'sales_weighment_units') {
    return { applied: false, action: 'failed', reason: `unsupported table '${tableName}'` };
  }

  const uuid = tx.uuid;

  if (tableName === 'boulders') {
    // 1. Check if record exists
    let existing = null;
    try {
      const stmt = dbInstance.prepare('SELECT * FROM boulders WHERE uuid = ?');
      stmt.bind([uuid]);
      existing = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
    } catch (err) {
      return { applied: false, action: 'failed', reason: `lookup failed: ${err.message}` };
    }

    if (!existing && !allowInsertWhenMissing) {
      return { applied: true, action: 'skipped', reason: 'old record not found locally' };
    }

    // Map fields from pending record, keeping existing values if new values are missing/empty
    const dc_num = tx.dc_no || tx.dcNo || tx.dc_num || tx.dcNum || (existing ? existing.dc_num : '');
    const date_time = tx.date_time || tx.dateTime || (existing ? existing.date_time : new Date().toLocaleString());
    const vehicle_no = tx.vehicle_no || tx.vehicleNo || (existing ? existing.vehicle_no : '');
    const contractor = tx.contractor || tx.party || (existing ? existing.contractor : '');
    const quarry = tx.quarry || (existing ? existing.quarry : '');
    const material = tx.material || (existing ? existing.material : 'BOULDERS');
    const gross = (tx.gross !== undefined && tx.gross !== null && Number(tx.gross) > 0) ? Number(tx.gross) : (existing ? existing.gross : 0);
    const tare = (tx.tare !== undefined && tx.tare !== null && Number(tx.tare) > 0) ? Number(tx.tare) : (existing ? existing.tare : 0);
    const net = (tx.net !== undefined && tx.net !== null && Number(tx.net) > 0) ? Number(tx.net) : (existing ? existing.net : (gross - tare));
    const driver = tx.driver || (existing ? existing.driver : '');
    const transporter = tx.transporter || (existing ? existing.transporter : '');
    const destination = tx.destination || (existing ? existing.destination : '');
    const operator = tx.operator || (existing ? existing.operator : 'Admin');
    const { image_path, image_base64, image_path_2, image_base64_2 } = externalizeIncomingImages(uuid, tx, existing);
    const tare_date = tx.tare_date || tx.tareDate || (existing ? existing.tare_date : '');
    const tare_time = tx.tare_time || tx.tareTime || (existing ? existing.tare_time : '');
    const rate = (tx.rate !== undefined && tx.rate !== null && Number(tx.rate) > 0) ? Number(tx.rate) : (existing ? existing.rate : null);
    const amount = (tx.amount !== undefined && tx.amount !== null && Number(tx.amount) > 0) ? Number(tx.amount) : (existing ? existing.amount : null);

    // Column order shared by the UPDATE and INSERT below (sync_status is literal 1).
    const values = [
      dc_num,
      date_time,
      vehicle_no,
      contractor,
      quarry,
      material,
      gross,
      tare,
      net,
      driver,
      transporter,
      destination,
      operator,
      image_path,
      image_base64,
      image_path_2,
      image_base64_2,
      tare_date,
      tare_time,
      rate,
      amount
    ];

    try {
      if (existing) {
        // UPDATE, not INSERT OR REPLACE: REPLACE deletes the row and re-inserts
        // it, which would reset the local id and created_at.
        dbInstance.run(`
          UPDATE boulders SET
            dc_num = ?, date_time = ?, vehicle_no = ?, contractor = ?, quarry = ?,
            material = ?, gross = ?, tare = ?, net = ?, driver = ?, transporter = ?,
            destination = ?, operator = ?, image_path = ?, image_base64 = ?,
            image_path_2 = ?, image_base64_2 = ?, tare_date = ?, tare_time = ?,
            rate = ?, amount = ?, sync_status = 1
          WHERE uuid = ?
        `, [...values, uuid]);
        saveToDisk();
        return { applied: true, action: 'updated' };
      }

      if (!dc_num && !vehicle_no) {
        return { applied: false, action: 'failed', reason: 'incomplete payload for a new record (no dc_num or vehicle_no)' };
      }

      dbInstance.run(`
        INSERT INTO boulders (
          uuid, dc_num, date_time, vehicle_no, contractor, quarry,
          material, gross, tare, net, driver, transporter, destination, operator,
          image_path, image_base64, image_path_2, image_base64_2,
          tare_date, tare_time, rate, amount, sync_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [uuid, ...values]);
      saveToDisk();
      return { applied: true, action: 'inserted' };
    } catch (err) {
      return { applied: false, action: 'failed', reason: err.message };
    }
  } else if (tableName === 'sales_weighment_units') {
    // 1. Check if record exists
    let existing = null;
    try {
      const stmt = dbInstance.prepare('SELECT * FROM sales_weighment_units WHERE uuid = ?');
      stmt.bind([uuid]);
      existing = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
    } catch (err) {
      return { applied: false, action: 'failed', reason: `lookup failed: ${err.message}` };
    }

    if (!existing && !allowInsertWhenMissing) {
      return { applied: true, action: 'skipped', reason: 'old record not found locally' };
    }

    const dc_num = tx.dc_no || tx.dcNo || tx.dc_num || tx.dcNum || (existing ? existing.dc_num : '');
    const your_dc = tx.your_dc || tx.yourDc || (existing ? existing.your_dc : '');
    const date_time = tx.date_time || tx.dateTime || (existing ? existing.date_time : new Date().toLocaleString());
    const vehicle_no = tx.vehicle_no || tx.vehicle || (existing ? existing.vehicle_no : '');
    const party = tx.party || (existing ? existing.party : '');
    const material = tx.material || (existing ? existing.material : '');
    const unit_type = tx.unit_type || tx.unitType || (existing ? existing.unit_type : 'units');
    const units_val = (tx.units_val !== undefined && tx.units_val !== null) ? Number(tx.units_val) : (existing ? existing.units_val : 0);
    const destination = tx.destination || (existing ? existing.destination : '');
    const source = tx.source || (existing ? existing.source : '');
    const transporter = tx.transporter || (existing ? existing.transporter : '');
    const driver = tx.driver || (existing ? existing.driver : '');
    const phone = tx.phone || (existing ? existing.phone : '');
    const stationary = tx.stationary || (existing ? existing.stationary : '');
    const po_number = tx.po_number || tx.poNumber || (existing ? existing.po_number : '');
    const po_date = tx.po_date || tx.poDate || (existing ? existing.po_date : '');
    const payment = tx.payment || (existing ? existing.payment : 'Credit');
    const gross = (tx.gross !== undefined && tx.gross !== null && Number(tx.gross) > 0) ? Number(tx.gross) : (existing ? existing.gross : 0);
    const tare = (tx.tare !== undefined && tx.tare !== null && Number(tx.tare) > 0) ? Number(tx.tare) : (existing ? existing.tare : 0);
    const net = (tx.net !== undefined && tx.net !== null && Number(tx.net) > 0) ? Number(tx.net) : (existing ? existing.net : (gross - tare));
    const rate = (tx.rate !== undefined && tx.rate !== null && Number(tx.rate) > 0) ? Number(tx.rate) : (existing ? existing.rate : 0);
    const amount = (tx.amount !== undefined && tx.amount !== null && Number(tx.amount) > 0) ? Number(tx.amount) : (existing ? existing.amount : 0);
    const bill_type = tx.bill_type || tx.billType || (existing ? existing.bill_type : 'NON-GST');
    const transport = (tx.transport !== undefined && tx.transport !== null) ? Number(tx.transport) : (existing ? existing.transport : 0);
    const discount = (tx.discount !== undefined && tx.discount !== null) ? Number(tx.discount) : (existing ? existing.discount : 0);
    const grand_total = (tx.grand_total !== undefined && tx.grand_total !== null && Number(tx.grand_total) > 0) ? Number(tx.grand_total) : (existing ? existing.grand_total : (amount + transport - discount));
    const isPendingPayment = String(payment).trim().toLowerCase() === 'pending';
    const cash_amount = isPendingPayment ? 0 : ((tx.cash_amount !== undefined && tx.cash_amount !== null) ? Number(tx.cash_amount) : (existing ? existing.cash_amount : 0));
    const upi_amount = isPendingPayment ? 0 : ((tx.upi_amount !== undefined && tx.upi_amount !== null) ? Number(tx.upi_amount) : (existing ? existing.upi_amount : 0));
    const credit_amount = isPendingPayment ? 0 : ((tx.credit_amount !== undefined && tx.credit_amount !== null) ? Number(tx.credit_amount) : (existing ? existing.credit_amount : 0));
    const operator = tx.operator || (existing ? existing.operator : 'Admin');
    const { image_path, image_base64, image_path_2, image_base64_2 } = externalizeIncomingImages(uuid, tx, existing);
    const tare_date = tx.tare_date || tx.tareDate || (existing ? existing.tare_date : '');
    const tare_time = tx.tare_time || tx.tareTime || (existing ? existing.tare_time : '');

    // Column order shared by the UPDATE and INSERT below (sync_status is literal 1).
    const values = [
      dc_num,
      your_dc,
      date_time,
      vehicle_no,
      party,
      material,
      unit_type,
      units_val,
      destination,
      source,
      transporter,
      driver,
      phone,
      stationary,
      po_number,
      po_date,
      payment,
      gross,
      tare,
      net,
      rate,
      amount,
      bill_type,
      transport,
      discount,
      grand_total,
      cash_amount,
      upi_amount,
      credit_amount,
      operator,
      image_path,
      image_base64,
      image_path_2,
      image_base64_2,
      tare_date,
      tare_time
    ];

    try {
      if (existing) {
        // UPDATE, not INSERT OR REPLACE: REPLACE deletes the row and re-inserts
        // it, which would reset the local id and created_at.
        dbInstance.run(`
          UPDATE sales_weighment_units SET
            dc_num = ?, your_dc = ?, date_time = ?, vehicle_no = ?, party = ?,
            material = ?, unit_type = ?, units_val = ?, destination = ?, source = ?,
            transporter = ?, driver = ?, phone = ?, stationary = ?, po_number = ?,
            po_date = ?, payment = ?, gross = ?, tare = ?, net = ?, rate = ?,
            amount = ?, bill_type = ?, transport = ?, discount = ?, grand_total = ?,
            cash_amount = ?, upi_amount = ?, credit_amount = ?, operator = ?,
            image_path = ?, image_base64 = ?, image_path_2 = ?, image_base64_2 = ?,
            tare_date = ?, tare_time = ?, sync_status = 1
          WHERE uuid = ?
        `, [...values, uuid]);
        saveToDisk();
        return { applied: true, action: 'updated' };
      }

      if (!dc_num && !vehicle_no) {
        return { applied: false, action: 'failed', reason: 'incomplete payload for a new record (no dc_num or vehicle_no)' };
      }

      dbInstance.run(`
        INSERT INTO sales_weighment_units (
          uuid, dc_num, your_dc, date_time, vehicle_no, party, material, unit_type, units_val,
          destination, source, transporter, driver, phone, stationary, po_number, po_date,
          payment, gross, tare, net, rate, amount, bill_type, transport, discount, grand_total,
          cash_amount, upi_amount, credit_amount, operator, image_path, image_base64,
          image_path_2, image_base64_2, tare_date, tare_time, sync_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [uuid, ...values]);
      saveToDisk();
      return { applied: true, action: 'inserted' };
    } catch (err) {
      return { applied: false, action: 'failed', reason: err.message };
    }
  }

  return { applied: false, action: 'failed', reason: `unsupported table '${tableName}'` };
}

// Every getter that returns weighment rows is wrapped so callers keep receiving
// image_base64 as a data URL, even though the database only stores image_path
// now. Doing it here rather than inside each getter means a newly added getter
// cannot silently forget it — add its name to the list and it is covered.
function withHydratedImages(fn) {
  return (...args) => hydrateImages(fn(...args));
}

const IMAGE_BEARING_GETTERS = {
  getAllTransactions,
  getUnsyncedTransactions,
  getAllBoulders,
  getUnsyncedBoulders,
  getAllSalesWeighmentUnits,
  getUnsyncedSalesWeighmentUnits,
  getAllYardWeighments,
  getUnsyncedYardWeighments,
  getAllLoadingSlips,
  getUnsyncedLoadingSlips,
  getAllFirstWeighments,
  getUnsyncedFirstWeighments,
  getAllSecondWeighments,
  getUnsyncedSecondWeighments,
  getRecordByUuid
};

function parseDateString(str) {
  if (!str) return new Date();
  if (str instanceof Date) return str;
  const s = String(str).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const parts = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1;
    const year = parseInt(parts[3], 10);
    return new Date(year, month, day);
  }
  return new Date();
}

function getDcResetShiftHoursAndMinutes() {
  try {
    if (!dbInstance) return { hours: 7, minutes: 0 };
    const settings = getSettings ? getSettings() : {};
    const timeStr = String(settings.dc_reset_time || '07:00').trim();
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return {
      hours: isNaN(hours) ? 7 : Math.min(23, Math.max(0, hours)),
      minutes: isNaN(minutes) ? 0 : Math.min(59, Math.max(0, minutes))
    };
  } catch (_) {
    return { hours: 7, minutes: 0 };
  }
}

function getDcBusinessDayDateStringForDate(dateInput) {
  const d = parseDateString(dateInput);
  const { hours, minutes } = getDcResetShiftHoursAndMinutes();
  d.setHours(d.getHours() - hours, d.getMinutes() - minutes);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDcFinancialYearStringForDate(dateInput) {
  const d = parseDateString(dateInput);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  return `${fyStart}-${fyStart + 1}`;
}

function getDcBusinessDayDateString() {
  const d = new Date();
  const { hours, minutes } = getDcResetShiftHoursAndMinutes();
  d.setHours(d.getHours() - hours, d.getMinutes() - minutes);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDcFinancialYearString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  return `${fyStart}-${fyStart + 1}`;
}

function normalizeDcModule(mod) {
  if (!mod) return 'sales';
  const m = String(mod).trim().toLowerCase();
  if (m === 'boulder' || m === 'boulders') return 'boulders';
  if (m === 'yard' || m === 'yards') return 'yard';
  if (m === 'loading' || m === 'loadingslip' || m === 'loading_slip') return 'loading';
  if (m === 'first' || m === 'firstweighment' || m === 'first_weighment') return 'first_weighment';
  return 'sales';
}

function normalizeDcType(type) {
  const t = String(type || '').toUpperCase();
  return (t.includes('GST') && !t.includes('NON')) ? 'GST' : 'NON-GST';
}

function getMaxExistingDcNumber(normModule, normType, currentCycle) {
  if (!dbInstance) return 0;

  const tables = [];
  if (normModule === 'sales') tables.push('sales_weighment_units', 'transactions');
  else if (normModule === 'boulders') tables.push('boulders');
  else if (normModule === 'yard') tables.push('yard_weighments');
  else if (normModule === 'loading') tables.push('loading_slips', 'transactions');
  else if (normModule === 'first_weighment') tables.push('first_weighments');

  let maxSeq = 0;

  for (const table of tables) {
    try {
      const stmt = dbInstance.prepare(`SELECT dc_num, bill_type, date_time, created_at FROM ${table} WHERE dc_num IS NOT NULL AND dc_num != ''`);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (!row.dc_num) continue;

        const rowType = normalizeDcType(row.bill_type);
        if (rowType !== normType) continue;

        const rowDateStr = row.date_time || row.created_at;
        if (rowDateStr) {
          const rowCycle = normType === 'GST' ? getDcFinancialYearStringForDate(rowDateStr) : getDcBusinessDayDateStringForDate(rowDateStr);
          if (rowCycle !== currentCycle) continue;
        }

        const match = String(row.dc_num).match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
      stmt.free();
    } catch (_) { }
  }

  return maxSeq;
}

/**
 * Read-only preview of next DC number (does NOT increment sequence counter).
 */
function peekNextDcNumber(type = 'NON-GST', prefix = 'DC-', moduleKey = 'sales') {
  if (!dbInstance) return 'DC-1';
  const normModule = normalizeDcModule(moduleKey);
  const normType = normalizeDcType(type);
  const currentCycle = normType === 'GST' ? getDcFinancialYearString() : getDcBusinessDayDateString();
  const pfx = prefix || 'DC-';

  try {
    const stmt = dbInstance.prepare('SELECT seq_value, cycle_value FROM dc_sequences WHERE module_key = ? AND type_key = ?');
    stmt.bind([normModule, normType]);
    let seq = 1;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.cycle_value === currentCycle) {
        seq = Number(row.seq_value) || 1;
      }
    }
    stmt.free();

    const maxExisting = getMaxExistingDcNumber(normModule, normType, currentCycle);
    if (maxExisting > 0 && maxExisting >= seq) {
      seq = maxExisting + 1;
    }

    const seqStr = pfx === 'SN-' ? String(seq).padStart(2, '0') : String(seq);
    return `${pfx}${seqStr}`;
  } catch (err) {
    console.error('[SQLite] Error in peekNextDcNumber:', err);
    return `${pfx}01`;
  }
}

/**
 * Atomic Host DC allocation and increment.
 * Generates next DC number (unpadded DC-1 or padded SN-01), increments sequence counter, and saves DB.
 */
function getAndAssignDc(type = 'NON-GST', prefix = 'DC-', moduleKey = 'sales') {
  if (!dbInstance) return 'DC-1';
  const normModule = normalizeDcModule(moduleKey);
  const normType = normalizeDcType(type);
  const currentCycle = normType === 'GST' ? getDcFinancialYearString() : getDcBusinessDayDateString();
  const pfx = prefix || 'DC-';

  try {
    const stmt = dbInstance.prepare('SELECT seq_value, cycle_value FROM dc_sequences WHERE module_key = ? AND type_key = ?');
    stmt.bind([normModule, normType]);
    let currentSeq = 1;
    let cycleMatched = false;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.cycle_value === currentCycle) {
        currentSeq = Number(row.seq_value) || 1;
        cycleMatched = true;
      }
    }
    stmt.free();

    const maxExisting = getMaxExistingDcNumber(normModule, normType, currentCycle);
    if (maxExisting > 0 && maxExisting >= currentSeq) {
      currentSeq = maxExisting + 1;
      cycleMatched = true;
    }

    const seqStr = pfx === 'SN-' ? String(currentSeq).padStart(2, '0') : String(currentSeq);
    const assignedDc = `${pfx}${seqStr}`;
    const nextSeq = currentSeq + 1;

    dbInstance.run('INSERT OR REPLACE INTO dc_sequences (module_key, type_key, seq_value, cycle_value) VALUES (?, ?, ?, ?)', [normModule, normType, nextSeq, currentCycle]);

    saveToDisk();
    return assignedDc;
  } catch (err) {
    console.error('[SQLite] Error in getAndAssignDc:', err);
    return `${pfx}01`;
  }
}

function setDcSequence(type = 'NON-GST', prefix = 'DC-', moduleKey = 'sales', startingNumber = 1) {
  if (!dbInstance) return { success: false, error: 'Database not initialized' };
  const normModule = normalizeDcModule(moduleKey);
  const normType = normalizeDcType(type);
  const currentCycle = normType === 'GST' ? getDcFinancialYearString() : getDcBusinessDayDateString();
  const num = Math.max(1, parseInt(startingNumber, 10) || 1);
  const pfx = prefix || 'DC-';

  dbInstance.run(
    'INSERT OR REPLACE INTO dc_sequences (module_key, type_key, seq_value, cycle_value) VALUES (?, ?, ?, ?)',
    [normModule, normType, num, currentCycle]
  );
  saveToDisk();
  return { success: true, dcNumber: `${pfx}${num}`, nextSeq: num };
}

function getNextDcSequence(type = 'NON-GST', moduleKey = 'sales', prefix = 'DC-') {
  const dcNum = peekNextDcNumber(type, prefix, moduleKey);
  return {
    success: true,
    formattedDc: dcNum,
    dcNumber: dcNum,
    module: normalizeDcModule(moduleKey),
    type: normalizeDcType(type)
  };
}

function queueOfflineAlert(payload) {
  if (!dbInstance) return false;
  try {
    const jsonStr = JSON.stringify(payload);
    dbInstance.run(
      "INSERT INTO alert_queue (payload_json, status, retries) VALUES (?, 'PENDING', 0)",
      [jsonStr]
    );
    saveToDisk();
    return true;
  } catch (err) {
    console.error('[SQLite] Error queuing offline alert:', err);
    return false;
  }
}

function getPendingOfflineAlerts(limit = 10) {
  if (!dbInstance) return [];
  try {
    const stmt = dbInstance.prepare(
      "SELECT id, payload_json, retries FROM alert_queue WHERE status = 'PENDING' ORDER BY id ASC LIMIT ?"
    );
    stmt.bind([limit]);
    const list = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject());
    }
    stmt.free();
    return list;
  } catch (err) {
    console.error('[SQLite] Error fetching pending offline alerts:', err);
    return [];
  }
}

function markOfflineAlertCompleted(id) {
  if (!dbInstance) return;
  try {
    dbInstance.run("UPDATE alert_queue SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    saveToDisk();
  } catch (err) {
    console.error('[SQLite] Error marking offline alert completed:', err);
  }
}

function incrementOfflineAlertRetry(id, errorMsg) {
  if (!dbInstance) return;
  try {
    dbInstance.run(
      "UPDATE alert_queue SET retries = retries + 1, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [String(errorMsg || ''), id]
    );
    saveToDisk();
  } catch (err) {
    console.error('[SQLite] Error incrementing offline alert retry:', err);
  }
}

function queryRaw(sql, params = []) {
  if (!dbInstance) return [];
  try {
    const stmt = dbInstance.prepare(sql);
    stmt.bind(params);
    const list = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject());
    }
    stmt.free();
    return list;
  } catch (err) {
    return [];
  }
}

const hydratedGetters = {};
for (const [name, fn] of Object.entries(IMAGE_BEARING_GETTERS)) {
  hydratedGetters[name] = withHydratedImages(fn);
}

module.exports = {
  peekNextDcNumber,
  getAndAssignDc,
  setDcSequence,
  getNextDcSequence,
  updateRecordFromPending,
  init,
  loginUser,
  getAllCameras,
  addCamera,
  updateCamera,
  deleteCamera,
  updateCameraStatus,
  getAllTransactions,
  addTransaction,
  markTransactionSynced,
  getUnsyncedTransactions,
  getAllBoulders,
  addBoulderTransaction,
  markBoulderSynced,
  getUnsyncedBoulders,
  getAllSalesWeighmentUnits,
  addSalesWeighmentUnits,
  markSalesWeighmentUnitsSynced,
  getUnsyncedSalesWeighmentUnits,
  getAllYardWeighments,
  addYardWeighment,
  markYardWeighmentSynced,
  getUnsyncedYardWeighments,
  addLoadingSlip,
  getAllLoadingSlips,
  getUnsyncedLoadingSlips,
  markLoadingSlipSynced,
  fulfillLoadingSlip,
  deleteLoadingSlip,
  addFirstWeighment,
  getAllFirstWeighments,
  getUnsyncedFirstWeighments,
  markFirstWeighmentSynced,
  addSecondWeighment,
  getAllSecondWeighments,
  getUnsyncedSecondWeighments,
  markSecondWeighmentSynced,
  getSettings,
  saveSetting,
  savePendingData,
  getDebitors,
  getMaterials,
  getDestinations,
  getTransporters,
  getContractors,
  getContractorMaterials,
  getSources,
  getVehicleTares,
  saveVehicleTare,
  deleteVehicleTare,
  deleteVehicleTareByNumber,
  getRfidCards,
  saveRfidCard,
  deleteRfidCard,
  getRfidCardByNumber,
  getTransporterVehicles,
  saveTransporterVehicle,
  deleteTransporterVehicle,
  getVehicleTareByNumber,
  pushToSyncQueue,
  getPendingSyncQueue,
  updateSyncQueueStatus,
  getSyncQueueSummary,
  getFailedSyncQueue,
  retrySyncQueueItem,
  retryAllFailedSyncQueue,
  getRecordByUuid,
  resetSyncStatus,
  markMasterDataUpdated,
  clearTable,
  clearPreTare,
  purgeOldRecords,
  cleanOrphanImages,
  getCleanupConfig,
  setCleanupConfig,
  getCleanupStatus,
  saveToDiskSync,
  queueOfflineAlert,
  getPendingOfflineAlerts,
  markOfflineAlertCompleted,
  incrementOfflineAlertRetry,
  queryRaw,
  // Spread last so the image-hydrating wrappers replace the raw getters listed
  // above rather than being overwritten by them.
  ...hydratedGetters
};

