const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  const stmt = db.prepare("SELECT * FROM boulders WHERE uuid = '5d23df14-1501-5478-b18c-e0e1f9a01f8c'");
  if (stmt.step()) {
    console.log(stmt.getAsObject());
  }
});
