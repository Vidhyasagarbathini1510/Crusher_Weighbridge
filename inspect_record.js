const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  const stmt = db.prepare("SELECT record_uuid FROM sync_queue WHERE id = 17301");
  if (stmt.step()) {
    const uuid = stmt.getAsObject().record_uuid;
    const bStmt = db.prepare("SELECT * FROM boulders WHERE uuid = ?", [uuid]);
    if (bStmt.step()) {
      console.log('RECORD FROM BOULDERS TABLE:');
      console.log(bStmt.getAsObject());
    }
  }
});
