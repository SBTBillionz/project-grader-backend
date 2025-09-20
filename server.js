// server.js
// Simple Express backend using a JSON file for storage.
// Run: npm install && node server.js

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

// Storage paths
const DATA_FILE = path.join(__dirname, "db.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Initialize DB if missing
if (!fs.existsSync(DATA_FILE)) {
  const init = {
    users: [
      // admin is added below to guarantee fixed admin credentials
    ],
    submissions: []
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// Ensure admin exists with fixed credentials
(function ensureAdmin() {
  const db = readDB();
  const adminEmail = "adminnsuk001@gmail.com";
  const adminPassword = "admin001";
  if (!db.users.some(u => u.email === adminEmail && u.role === "Admin")) {
    db.users.push({
      id: uuidv4(),
      name: "Admin",
      email: adminEmail,
      password: adminPassword,
      role: "Admin",
      createdAt: new Date().toISOString()
    });
    writeDB(db);
    console.log("Admin account created:", adminEmail);
  }
})();

// MULTER config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, safe);
  }
});
const upload = multer({ storage });

// -------------------- AUTH --------------------
// POST /api/auth/login
// body: { email, password, role }
// returns user object (without password) on success
app.post("/api/auth/login", (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ error: "email, password and role required" });

  const db = readDB();
  const user = db.users.find(u => u.email === email && u.password === password && u.role === role);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ user: safeUser });
});

// POST /api/auth/register (student registration)
// body: { name, email, password }
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "name, email and password required" });

  const db = readDB();
  // Don't allow existing email
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: "Email already registered" });

  const newUser = { id: uuidv4(), name, email, password, role: "Student", createdAt: new Date().toISOString() };
  db.users.push(newUser);
  writeDB(db);
  return res.json({ message: "Registered", user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } });
});

// -------------------- USERS (admin) --------------------
// GET /api/users  -> list users (admin only ideally; frontend will trust admin login)
app.get("/api/users", (req, res) => {
  const db = readDB();
  // Return users without passwords
  const out = db.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }));
  res.json(out);
});

// POST /api/users (register instructor) body { name, email, password, role }
// Only admin should call this
app.post("/api/users", (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: "name,email,password,role required" });

  const db = readDB();
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: "Email already exists" });

  const newUser = { id: uuidv4(), name, email, password, role, createdAt: new Date().toISOString() };
  db.users.push(newUser);
  writeDB(db);
  res.json({ message: "User created", user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } });
});

// DELETE /api/users/:email  (delete user by email)
app.delete("/api/users/:email", (req, res) => {
  const email = req.params.email;
  let db = readDB();
  const exists = db.users.some(u => u.email === email);
  if (!exists) return res.status(404).json({ error: "User not found" });

  db.users = db.users.filter(u => u.email !== email);
  writeDB(db);
  res.json({ message: "User removed" });
});

// -------------------- SUBMISSIONS --------------------
// POST /api/submissions  (student submits)
// multipart form-data: file, student, title
app.post("/api/submissions", upload.single("file"), (req, res) => {
  const { student, title } = req.body || {};
  if (!student || !title) {
    // remove uploaded file if present
    if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "student and title required" });
  }
  if (!req.file) return res.status(400).json({ error: "file required" });

  const db = readDB();
  const submission = {
    id: uuidv4(),
    student,
    title,
    fileName: req.file.filename,
    originalName: req.file.originalname,
    filePath: `/uploads/${req.file.filename}`,
    createdAt: new Date().toISOString(),
    score: null,
    feedback: null
  };
  db.submissions.push(submission);
  writeDB(db);
  res.json({ message: "Submission saved", submission });
});

// GET /api/submissions  -> all submissions (admin/instructor)
app.get("/api/submissions", (req, res) => {
  const db = readDB();
  // return full submissions
  res.json(db.submissions);
});

// GET /api/submissions/student/:email  -> submissions for student
app.get("/api/submissions/student/:email", (req, res) => {
  const email = req.params.email;
  const db = readDB();
  const subs = db.submissions.filter(s => s.student === email || s.student === (db.users.find(u => u.email === email)?.name));
  // allow search by either email (student registered) or name
  res.json(subs);
});

// POST /api/submissions/:id/grade  -> grade a submission
// body: { score, feedback, grader } (grader optional)
app.post("/api/submissions/:id/grade", (req, res) => {
  const id = req.params.id;
  const { score, feedback } = req.body || {};
  if (score == null || feedback == null) return res.status(400).json({ error: "score and feedback required" });

  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ error: "submission not found" });

  sub.score = Number(score);
  sub.feedback = String(feedback);
  sub.gradedAt = new Date().toISOString();
  writeDB(db);
  res.json({ message: "Graded", submission: sub });
});

// Static serve uploaded files
app.use("/uploads", express.static(UPLOAD_DIR));

// -------------------- Helper routes --------------------
// GET /api/health
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date() }));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
