const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  const stmt = db.prepare("SELECT COUNT(*) as total_rows, COUNT(DISTINCT record_uuid) as unique_uuids FROM sync_queue");
  if (stmt.step()) {
    console.log(stmt.getAsObject());
  }

  const stmt2 = db.prepare("SELECT table_name, COUNT(*) as count FROM sync_queue GROUP BY table_name");
  console.log("\nQUEUE COUNT BY TABLE:");
  while (stmt2.step()) {
    console.log(stmt2.getAsObject());
  }
});
