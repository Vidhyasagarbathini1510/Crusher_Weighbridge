const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) {
    console.log('Database file not found at:', dbPath);
    return;
  }
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  // 1. Reset sync queue statuses
  db.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0;");
  
  // 2. Reset sync status flags in the business tables
  try { db.run("UPDATE boulders SET sync_status = 0;"); } catch(e) {}
  try { db.run("UPDATE transactions SET sync_status = 0;"); } catch(e) {}
  try { db.run("UPDATE sales_weighment_units SET sync_status = 0;"); } catch(e) {}
  try { db.run("UPDATE yard_weighments SET sync_status = 0;"); } catch(e) {}
  
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Successfully reset all sync queues and local record sync statuses to unsynced!');
});
