const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  db.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0 WHERE status = 'REJECTED';");
  
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Successfully reset REJECTED items to PENDING status!');
});
