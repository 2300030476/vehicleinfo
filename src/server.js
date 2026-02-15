const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, initDb } = require('./db');

initDb();

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'private-vehicle-erp-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.adminId) return res.redirect('/login');
  next();
}

function toStatus(expiryDate) {
  return new Date(expiryDate) >= new Date() ? 'PAID' : 'EXPIRED';
}

app.get('/', (req, res) => {
  if (!req.session.adminId) return res.redirect('/login');
  return res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid credentials.' });
  }
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  res.redirect('/dashboard');
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const like = `%${q}%`;

  const vehicles = q
    ? db.prepare(`SELECT * FROM vehicles
      WHERE vehicle_number LIKE ?
      OR engine_number LIKE ?
      OR chassis_number LIKE ?
      ORDER BY vehicle_number`).all(like, like, like)
    : db.prepare('SELECT * FROM vehicles ORDER BY vehicle_number LIMIT 20').all();

  const alerts = db.prepare(`
    WITH dates AS (
      SELECT v.id AS vehicle_id, v.vehicle_number, 'Tax' AS alert_type, t.expiry_date AS expiry_date
      FROM vehicles v JOIN tax_details t ON v.id = t.vehicle_id
      UNION ALL
      SELECT v.id, v.vehicle_number, 'Insurance', i.end_date
      FROM vehicles v JOIN insurance_details i ON v.id = i.vehicle_id
      UNION ALL
      SELECT v.id, v.vehicle_number, d.doc_type, d.expiry_date
      FROM vehicles v JOIN documents d ON v.id = d.vehicle_id
      WHERE d.expiry_date IS NOT NULL AND (d.doc_type = 'Fitness Certificate' OR d.doc_type = 'Permit')
    )
    SELECT *, CAST(julianday(expiry_date) - julianday(date('now')) AS INTEGER) AS days_left
    FROM dates
    WHERE days_left BETWEEN 0 AND 30
    ORDER BY days_left ASC
  `).all();

  res.render('dashboard', {
    username: req.session.username,
    q,
    vehicles,
    alerts30: alerts,
    alerts7: alerts.filter((a) => a.days_left <= 7)
  });
});

app.get('/vehicles/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!vehicle) return res.status(404).send('Vehicle not found');

  const taxes = db.prepare('SELECT * FROM tax_details WHERE vehicle_id = ? ORDER BY paid_date DESC').all(id)
    .map((t) => ({ ...t, status: toStatus(t.expiry_date) }));
  const insurances = db.prepare('SELECT * FROM insurance_details WHERE vehicle_id = ? ORDER BY end_date DESC').all(id);
  const docs = db.prepare('SELECT * FROM documents WHERE vehicle_id = ? ORDER BY uploaded_at DESC').all(id);
  const history = db.prepare('SELECT * FROM history_logs WHERE vehicle_id = ? ORDER BY event_date DESC, created_at DESC').all(id);

  res.render('vehicle-details', { vehicle, taxes, insurances, docs, history });
});

app.post('/vehicles/:id/tax', requireAuth, upload.single('receipt'), (req, res) => {
  const id = req.params.id;
  const { tax_type, amount_paid, paid_date, expiry_date } = req.body;
  const receiptPath = req.file ? req.file.filename : null;
  db.prepare('INSERT INTO tax_details (vehicle_id, tax_type, amount_paid, paid_date, expiry_date, receipt_file) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, tax_type, amount_paid, paid_date, expiry_date, receiptPath);
  db.prepare('INSERT INTO history_logs (vehicle_id, event_type, event_date, notes) VALUES (?, ?, ?, ?)')
    .run(id, 'TAX_PAYMENT', paid_date, `Tax ${tax_type} payment ₹${amount_paid}`);
  res.redirect(`/vehicles/${id}`);
});

app.post('/vehicles/:id/insurance', requireAuth, upload.single('insurance_file'), (req, res) => {
  const id = req.params.id;
  const { insurance_company, policy_number, start_date, end_date } = req.body;
  const insuranceFile = req.file ? req.file.filename : null;
  db.prepare('INSERT INTO insurance_details (vehicle_id, insurance_company, policy_number, start_date, end_date, insurance_file) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, insurance_company, policy_number, start_date, end_date, insuranceFile);
  db.prepare('INSERT INTO history_logs (vehicle_id, event_type, event_date, notes) VALUES (?, ?, ?, ?)')
    .run(id, 'INSURANCE_RENEWAL', start_date, `${insurance_company} policy renewed`);
  res.redirect(`/vehicles/${id}`);
});

app.post('/vehicles/:id/document', requireAuth, upload.single('doc_file'), (req, res) => {
  const id = req.params.id;
  const { doc_type, title, issue_date, expiry_date } = req.body;
  if (!req.file) return res.status(400).send('Document file is required.');
  db.prepare('INSERT INTO documents (vehicle_id, doc_type, title, issue_date, expiry_date, file_path) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, doc_type, title, issue_date || null, expiry_date || null, req.file.filename);
  if (doc_type === 'Fitness Certificate') {
    db.prepare('INSERT INTO history_logs (vehicle_id, event_type, event_date, notes) VALUES (?, ?, ?, ?)')
      .run(id, 'FC_RENEWAL', issue_date || new Date().toISOString().slice(0, 10), `${title || 'FC'} renewed`);
  }
  res.redirect(`/vehicles/${id}`);
});

app.get('/files/:name', requireAuth, (req, res) => {
  const filePath = path.join(uploadDir, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`Vehicle ERP running at http://localhost:${PORT}`);
});
