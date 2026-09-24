const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  const stmt = db.prepare("SELECT id, uuid, dc_num, date_time, vehicle_no, sync_status FROM boulders LIMIT 30");
  console.log("LOCAL SQLite BOULDERS (FIRST 30):");
  while (stmt.step()) {
    console.log(stmt.getAsObject());
  }
});
