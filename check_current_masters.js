'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const initSqlJs = require('./node_modules/sql.js');

async function showCurrentMasters() {
  const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');
  if (!fs.existsSync(dbPath)) {
    console.log('Database not found at:', dbPath);
    return;
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  console.log('==============================================');
  console.log('  CURRENT LOCAL DESKTOP MASTER DATA (SQLITE)');
  console.log('==============================================');

  console.log('\n--- CONTRACTORS (Quarry) ---');
  let stmt = db.prepare("SELECT id, contractorName, quarryName, status FROM contractors WHERE status IS NULL OR LOWER(TRIM(status)) != 'inactive'");
  let count = 0;
  while (stmt.step()) {
    count++;
    const row = stmt.getAsObject();
    console.log(` ${count}. Name: "${row.contractorName}", Quarry: "${row.quarryName}", Status: ${row.status}`);
  }
  stmt.free();
  if (count === 0) console.log('  (No contractors found)');

  console.log('\n--- DEBITORS (Parties) ---');
  stmt = db.prepare("SELECT id, party, status FROM debitors WHERE status IS NULL OR LOWER(TRIM(status)) != 'inactive'");
  count = 0;
  while (stmt.step()) {
    count++;
    const row = stmt.getAsObject();
    console.log(` ${count}. Party: "${row.party}", Status: ${row.status}`);
  }
  stmt.free();
  if (count === 0) console.log('  (No debitors found)');

  console.log('\n--- MATERIALS ---');
  stmt = db.prepare("SELECT id, party, material, rate, status FROM materials WHERE status IS NULL OR LOWER(TRIM(status)) != 'inactive'");
  count = 0;
  while (stmt.step()) {
    count++;
    const row = stmt.getAsObject();
    console.log(` ${count}. Material: "${row.material}", Party: "${row.party}", Rate: ${row.rate}`);
  }
  stmt.free();
  if (count === 0) console.log('  (No materials found)');

  console.log('\n==============================================');
}

showCurrentMasters().catch(console.error);
