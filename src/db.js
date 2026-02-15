const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'vehicleerp.sqlite'));
db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_number TEXT UNIQUE NOT NULL,
      owner_name TEXT,
      rto TEXT,
      registration_date TEXT,
      engine_number TEXT,
      chassis_number TEXT,
      fuel_type TEXT,
      model TEXT,
      manufacture_year INTEGER
    );

    CREATE TABLE IF NOT EXISTS tax_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      tax_type TEXT NOT NULL,
      amount_paid REAL NOT NULL,
      paid_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      receipt_file TEXT,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS insurance_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      insurance_company TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      insurance_file TEXT,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      title TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      file_path TEXT NOT NULL,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS history_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
    );
  `);

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(adminUser);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(adminUser, hash);
  }

  const existingVehicle = db.prepare('SELECT id FROM vehicles LIMIT 1').get();
  if (!existingVehicle) {
    const vehicle = db.prepare(`INSERT INTO vehicles
      (vehicle_number, owner_name, rto, registration_date, engine_number, chassis_number, fuel_type, model, manufacture_year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('TS07AB1234', 'Owner Admin', 'Hyderabad RTO', '2021-05-16', 'ENG99887766', 'CHS4455667788', 'Diesel', 'Mahindra XUV700', 2021);

    db.prepare(`INSERT INTO tax_details (vehicle_id, tax_type, amount_paid, paid_date, expiry_date, receipt_file)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(vehicle.lastInsertRowid, 'yearly', 14500, '2025-01-05', '2026-01-04', null);

    db.prepare(`INSERT INTO insurance_details (vehicle_id, insurance_company, policy_number, start_date, end_date, insurance_file)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(vehicle.lastInsertRowid, 'ABC General Insurance', 'POL-TS07-2025', '2025-01-01', '2025-12-31', null);

    const ins = db.prepare(`INSERT INTO documents (vehicle_id, doc_type, title, issue_date, expiry_date, file_path)
      VALUES (?, ?, ?, ?, ?, ?)`);
    ins.run(vehicle.lastInsertRowid, 'RC', 'Registration Certificate', '2021-05-16', null, '');
    ins.run(vehicle.lastInsertRowid, 'Fitness Certificate', 'FC 2025', '2025-01-01', '2026-01-01', '');

    const log = db.prepare('INSERT INTO history_logs (vehicle_id, event_type, event_date, notes) VALUES (?, ?, ?, ?)');
    log.run(vehicle.lastInsertRowid, 'TAX_PAYMENT', '2025-01-05', 'Paid yearly tax ₹14,500');
    log.run(vehicle.lastInsertRowid, 'INSURANCE_RENEWAL', '2025-01-01', 'Insurance renewed for one year');
    log.run(vehicle.lastInsertRowid, 'FC_RENEWAL', '2025-01-01', 'Fitness certificate renewed');
  }
}

module.exports = { db, initDb };
