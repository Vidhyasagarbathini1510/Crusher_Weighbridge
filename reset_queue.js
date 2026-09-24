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
  
  db.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0 WHERE error_message LIKE '%path is not defined%';");
  
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Successfully reset failed queue items back to PENDING status!');
  
  const stmt = db.prepare("SELECT id, table_name, status, retry_count, error_message FROM sync_queue WHERE id IN (185, 186, 187)");
  while (stmt.step()) {
    console.log(stmt.getAsObject());
  }
});
