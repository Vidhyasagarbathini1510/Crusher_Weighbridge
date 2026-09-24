const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  const stmt = db.prepare("SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status");
  console.log("SYNC QUEUE SUMMARY BY STATUS:");
  while (stmt.step()) {
    console.log(stmt.getAsObject());
  }

  const stmt2 = db.prepare("SELECT id, table_name, record_uuid, status FROM sync_queue WHERE status = 'PENDING' LIMIT 15");
  console.log("\nFIRST 15 PENDING ITEMS IN QUEUE:");
  while (stmt2.step()) {
    console.log(stmt2.getAsObject());
  }
});
