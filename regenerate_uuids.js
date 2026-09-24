const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const initSqlJs = require('./node_modules/sql.js');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'noris-cctv-desktop', 'weighbridge.db');

const targetUuids = [
  "ecb7e8b3-8ca8-58f4-874f-e306cc16b64b",
  "a1640d94-ca0a-52d7-9f41-ca6132e9aeb4",
  "09467f69-6be8-505a-9986-8a7a13d84136",
  "7f2e64ea-2708-50cc-b4b1-db5ac4afa249",
  "96a583c7-f50b-5ede-8a7a-d1621303248e",
  "1387a0e6-f547-5238-9454-424f38c5b4f9",
  "182a3f58-997b-5f01-92aa-29aea8b4249f",
  "42355c4d-c574-56ba-99c7-8c3a2c4798bb",
  "366ecfa0-1c15-53b5-b3fa-e27b6030eac0",
  "a3ef331e-b48d-5d59-bbcc-57bb3df6662b",
  "7ea5879a-b40b-5963-811d-820299229bd4",
  "87970e6c-029b-57a4-a545-024e5f182ea9",
  "a8db887e-0163-56c3-afd1-1a5767029ff1",
  "d105fb17-2c86-5db5-8ccd-76fba2d19b59",
  "ef79c8e3-dd02-5dc2-8ae0-8e447df6f35d",
  "3a12711b-1b3b-5d8e-884c-d9f458563e3a",
  "c22d140f-6e19-527b-9684-6d2b4714ed9a",
  "64a8194d-4d7f-5bb9-82c1-52dc8f2e2b3c",
  "32f62e3f-0d63-53cf-a4b5-2c915a144b90",
  "93634533-1fec-5fd0-9ae4-dedac0b13b34",
  "4e0876bc-70cb-5d07-b910-e0a705c22325",
  "a5f8ceb8-3771-59ce-9c3b-e6423050328c",
  "f2527bca-709d-5a50-ad82-8d0181c0bcc5",
  "a6b3103c-695b-521c-8a7a-5742c10f7743",
  "63cc416e-6d20-533d-bd27-bcba6f5dd6d0",
  "c6246d54-3589-58f4-b0cb-592d98dcbbf6"
];

initSqlJs().then(SQL => {
  if (!fs.existsSync(dbPath)) return;
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  let updatedCount = 0;
  for (const oldUuid of targetUuids) {
    const newUuid = crypto.randomUUID();
    
    // Update boulders table
    db.run("UPDATE boulders SET uuid = ?, sync_status = 0 WHERE uuid = ?", [newUuid, oldUuid]);
    
    // Update sync_queue table
    db.run("UPDATE sync_queue SET record_uuid = ?, status = 'PENDING', retry_count = 0 WHERE record_uuid = ?", [newUuid, oldUuid]);
    
    updatedCount++;
  }
  
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log(`Successfully updated ${updatedCount} duplicate records with fresh UUIDs and marked them PENDING.`);
});
