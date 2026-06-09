const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));  // เสิร์ฟไฟล์จาก root directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// สร้างโฟลเดอร์ uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ===== DATABASE =====
const db = new Database(path.join(__dirname, 'company.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT DEFAULT '',
    department TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    assigned_to TEXT DEFAULT 'all',
    assigned_name TEXT DEFAULT 'ทุกคน',
    created_by TEXT DEFAULT '',
    created_by_name TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    due_date TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (assigned_to) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    file_path TEXT DEFAULT '',
    file_name TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    related_id TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ===== MULTER =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('ไฟล์ประเภทนี้ไม่รองรับ'));
  }
});

// ===== HELPER =====
function addNotification(message, type = 'info', relatedId = '') {
  const notif = {
    id: uuidv4(),
    message,
    type,
    related_id: relatedId,
    is_read: 0
  };
  db.prepare(`INSERT INTO notifications (id, message, type, related_id) VALUES (?, ?, ?, ?)`)
    .run(notif.id, notif.message, notif.type, notif.related_id);
  io.emit('notification', notif);
  return notif;
}

// ===== EMPLOYEES API =====
app.get('/api/employees', (req, res) => {
  const rows = db.prepare('SELECT * FROM employees ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/employees', (req, res) => {
  const { name, position, department } = req.body;
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });
  const id = uuidv4();
  db.prepare('INSERT INTO employees (id, name, position, department) VALUES (?, ?, ?, ?)')
    .run(id, name, position || '', department || '');
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  addNotification(`เพิ่มพนักงานใหม่: ${name}`, 'employee', id);
  io.emit('employee_added', emp);
  res.json(emp);
});

app.put('/api/employees/:id', (req, res) => {
  const { name, position, department } = req.body;
  db.prepare('UPDATE employees SET name=?, position=?, department=? WHERE id=?')
    .run(name, position || '', department || '', req.params.id);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  io.emit('employee_updated', emp);
  res.json(emp);
});

app.delete('/api/employees/:id', (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  if (emp) addNotification(`ลบพนักงาน: ${emp.name}`, 'warning', req.params.id);
  io.emit('employee_deleted', { id: req.params.id });
  res.json({ success: true });
});

// ===== TODOS API =====
app.get('/api/todos', (req, res) => {
  const rows = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/todos', (req, res) => {
  const { title, description, assigned_to, assigned_name, created_by, created_by_name, priority, due_date } = req.body;
  if (!title) return res.status(400).json({ error: 'ต้องระบุหัวข้อ' });
  const id = uuidv4();
  db.prepare(`INSERT INTO todos (id, title, description, assigned_to, assigned_name, created_by, created_by_name, priority, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, title, description || '', assigned_to || 'all', assigned_name || 'ทุกคน',
      created_by || '', created_by_name || '', priority || 'normal', due_date || '');
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  const who = assigned_name || 'ทุกคน';
  addNotification(`มอบหมายงานใหม่ให้ ${who}: ${title}`, 'todo', id);
  io.emit('todo_added', todo);
  res.json(todo);
});

app.put('/api/todos/:id', (req, res) => {
  const { title, description, assigned_to, assigned_name, status, priority, due_date } = req.body;
  const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบ Todo' });

  const completed_at = status === 'completed' && existing.status !== 'completed'
    ? new Date().toISOString() : existing.completed_at;

  db.prepare(`UPDATE todos SET title=?, description=?, assigned_to=?, assigned_name=?,
    status=?, priority=?, due_date=?, completed_at=? WHERE id=?`)
    .run(title || existing.title, description ?? existing.description,
      assigned_to || existing.assigned_to, assigned_name || existing.assigned_name,
      status || existing.status, priority || existing.priority,
      due_date ?? existing.due_date, completed_at, req.params.id);

  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  if (status === 'completed' && existing.status !== 'completed') {
    addNotification(`✅ งานเสร็จแล้ว: ${todo.title}`, 'success', todo.id);
  }
  io.emit('todo_updated', todo);
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
  io.emit('todo_deleted', { id: req.params.id });
  res.json({ success: true });
});

// ===== WORKS API =====
app.get('/api/works', (req, res) => {
  const { employee_id } = req.query;
  let rows;
  if (employee_id) {
    rows = db.prepare('SELECT * FROM works WHERE employee_id = ? ORDER BY created_at DESC').all(employee_id);
  } else {
    rows = db.prepare('SELECT * FROM works ORDER BY created_at DESC').all();
  }
  res.json(rows);
});

app.post('/api/works', upload.single('file'), (req, res) => {
  const { employee_id, employee_name, title, description } = req.body;
  if (!employee_id || !title) return res.status(400).json({ error: 'ต้องระบุพนักงานและหัวข้อ' });
  const id = uuidv4();
  const file_path = req.file ? `/uploads/${req.file.filename}` : '';
  const file_name = req.file ? req.file.originalname : '';
  const file_type = req.file ? req.file.mimetype : '';
  db.prepare(`INSERT INTO works (id, employee_id, employee_name, title, description, file_path, file_name, file_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, employee_id, employee_name, title, description || '', file_path, file_name, file_type);
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(id);
  addNotification(`📎 ${employee_name} อัพโหลดผลงานใหม่: ${title}`, 'work', id);
  io.emit('work_added', work);
  res.json(work);
});

app.delete('/api/works/:id', (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (work && work.file_path) {
    const fullPath = path.join(__dirname, work.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
  db.prepare('DELETE FROM works WHERE id = ?').run(req.params.id);
  io.emit('work_deleted', { id: req.params.id });
  res.json({ success: true });
});

// ===== NOTIFICATIONS API =====
app.get('/api/notifications', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows);
});

app.put('/api/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1').run();
  io.emit('notifications_read');
  res.json({ success: true });
});

app.put('/api/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ===== START =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 ระบบจัดการบริษัท เปิดใช้งานแล้ว!`);
  console.log(`🌐 เปิดเบราว์เซอร์ที่: http://localhost:${PORT}`);
  console.log(`📁 ฐานข้อมูล: company.db\n`);
});
