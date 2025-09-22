// server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// -------------------- MongoDB Connection --------------------
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://bellacherry788:SBTMyName1234$@project001.dvvrzh0.mongodb.net/?retryWrites=true&w=majority&appName=project001";

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.error("❌ MongoDB Error:", err));

// -------------------- MongoDB Schemas --------------------
const userSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: String,
  createdAt: String,
});

const submissionSchema = new mongoose.Schema({
  id: String,
  student: String, // student email
  title: String,
  fileName: String,
  originalName: String,
  filePath: String,
  createdAt: String,
  score: Number,
  feedback: String,
  gradedAt: String,
});

const User = mongoose.model("User", userSchema);
const Submission = mongoose.model("Submission", submissionSchema);

// -------------------- MULTER Upload --------------------
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, safe);
  }
});
const upload = multer({ storage });

// -------------------- Ensure Admin Exists --------------------
(async function ensureAdmin() {
  const adminEmail = "adminnsuk001@gmail.com";
  const adminPassword = "admin001";
  const exists = await User.findOne({ email: adminEmail, role: "Admin" });
  if (!exists) {
    await User.create({
      id: uuidv4(),
      name: "Admin",
      email: adminEmail,
      password: adminPassword,
      role: "Admin",
      createdAt: new Date().toISOString(),
    });
    console.log("✅ Admin account created:", adminEmail);
  }
})();

// -------------------- AUTH --------------------
app.post("/api/auth/login", async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ error: "email, password and role required" });

  const user = await User.findOne({ email, password, role });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ user: safeUser });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "name, email and password required" });

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: "Email already registered" });

  const newUser = await User.create({
    id: uuidv4(),
    name,
    email,
    password,
    role: "Student",
    createdAt: new Date().toISOString(),
  });

  return res.json({ message: "Registered", user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } });
});

// -------------------- USERS --------------------
app.get("/api/users", async (req, res) => {
  const users = await User.find({}, { password: 0 });
  res.json(users);
});

app.post("/api/users", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: "name,email,password,role required" });

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: "Email already exists" });

  const newUser = await User.create({
    id: uuidv4(),
    name,
    email,
    password,
    role,
    createdAt: new Date().toISOString(),
  });

  res.json({ message: "User created", user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role } });
});

app.delete("/api/users/:email", async (req, res) => {
  const email = req.params.email;
  const result = await User.deleteOne({ email });
  if (result.deletedCount === 0) return res.status(404).json({ error: "User not found" });
  res.json({ message: "User removed" });
});

// -------------------- SUBMISSIONS --------------------
app.post("/api/submissions", upload.single("file"), async (req, res) => {
  const { student, title } = req.body || {};
  if (!student || !title) {
    if (req.file && req.file.path) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "student and title required" });
  }
  if (!req.file) return res.status(400).json({ error: "file required" });

  const submission = await Submission.create({
    id: uuidv4(),
    student,
    title,
    fileName: req.file.filename,
    originalName: req.file.originalname,
    filePath: `/uploads/${req.file.filename}`,
    createdAt: new Date().toISOString(),
    score: null,
    feedback: null,
  });

  res.json({ message: "Submission saved", submission });
});

app.get("/api/submissions", async (req, res) => {
  const subs = await Submission.find();
  res.json(subs);
});

app.get("/api/submissions/student/:email", async (req, res) => {
  const email = req.params.email;
  const subs = await Submission.find({ student: email });
  res.json(subs);
});

app.post("/api/submissions/:id/grade", async (req, res) => {
  const { score, feedback } = req.body || {};
  if (score == null || feedback == null) return res.status(400).json({ error: "score and feedback required" });

  const sub = await Submission.findOne({ id: req.params.id });
  if (!sub) return res.status(404).json({ error: "submission not found" });

  sub.score = Number(score);
  sub.feedback = String(feedback);
  sub.gradedAt = new Date().toISOString();
  await sub.save();

  res.json({ message: "Graded", submission: sub });
});

// -------------------- DELETE Student Submission (No Email Needed) --------------------
app.delete("/api/submissions/:id", async (req, res) => {
  const { id } = req.params;

  const sub = await Submission.findOne({ id });
  if (!sub) return res.status(404).json({ error: "submission not found" });

  // Delete uploaded file if it exists
  const filePath = path.join(__dirname, sub.filePath);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await Submission.deleteOne({ id });
  res.json({ message: "Submission deleted" });
});

// -------------------- Static Files --------------------
app.use("/uploads", express.static(UPLOAD_DIR));

// -------------------- Health Check --------------------
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date() }));

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
