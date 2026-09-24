const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) {
    console.log('Database not found.');
    return;
  }
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  console.log('Starting global UUID regeneration...');
  
  // 1. Fetch all boulders
  const boulders = [];
  const stmtB = db.prepare("SELECT uuid FROM boulders");
  while (stmtB.step()) {
    boulders.push(stmtB.getAsObject().uuid);
  }
  
  let bCount = 0;
  for (const oldUuid of boulders) {
    const newUuid = crypto.randomUUID();
    db.run("UPDATE boulders SET uuid = ?, sync_status = 0 WHERE uuid = ?", [newUuid, oldUuid]);
    db.run("UPDATE sync_queue SET record_uuid = ?, status = 'PENDING', retry_count = 0 WHERE record_uuid = ? AND table_name = 'boulders'", [newUuid, oldUuid]);
    bCount++;
  }
  console.log(`Regenerated ${bCount} boulder UUIDs.`);

  // 2. Fetch all sales units
  const sales = [];
  const stmtS = db.prepare("SELECT uuid FROM sales_weighment_units");
  while (stmtS.step()) {
    sales.push(stmtS.getAsObject().uuid);
  }
  
  let sCount = 0;
  for (const oldUuid of sales) {
    const newUuid = crypto.randomUUID();
    db.run("UPDATE sales_weighment_units SET uuid = ?, sync_status = 0 WHERE uuid = ?", [newUuid, oldUuid]);
    db.run("UPDATE sync_queue SET record_uuid = ?, status = 'PENDING', retry_count = 0 WHERE record_uuid = ? AND (table_name = 'sales_units' OR table_name = 'sales_weighment_units')", [newUuid, oldUuid]);
    sCount++;
  }
  console.log(`Regenerated ${sCount} sales record UUIDs.`);
  
  // 3. Make sure all sync queue statuses are reset
  db.run("UPDATE sync_queue SET status = 'PENDING', retry_count = 0");
  
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Successfully completed global UUID regeneration and reset all sync statuses!');
});
