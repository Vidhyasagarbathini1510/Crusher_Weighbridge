const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const stmt = db.prepare("SELECT error_message FROM sync_queue WHERE status = 'REJECTED' ORDER BY id DESC LIMIT 1");
  if (stmt.step()) {
    console.log('LATEST REJECTED ERROR:');
    console.log(stmt.getAsObject().error_message);
  }
});
