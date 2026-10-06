const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const db = require('./db');

const app = express();

// Allowed origins for CORS
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '207521767849-c0i3umno0438t0vgdvf7u62isup26j86.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.get('/', (req, res) => {
  res.send('EPCST Backend API is up and running!');
});

// --- AUTHENTICATION ROUTES ---

// 1. REGISTER
app.post('/api/auth/register', async (req, res) => {
  const { studentId, fullName, email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim(); // Trim extra space from client input

    const finalStudentId = studentId ? studentId.trim() : `STU-${Date.now().toString().slice(-6)}`;
    const finalFullName = fullName ? fullName.trim() : cleanEmail.split('@')[0];

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    const { rows } = await db.query(
      `INSERT INTO users (student_id, full_name, email, password_hash) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, student_id, full_name, email`,
      [finalStudentId, finalFullName, cleanEmail, hashedPassword]
    );

    res.status(201).json({ message: 'User registered successfully', user: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email or Student ID already exists.' });
    }
    console.error('Registration Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    // Allow login via email or student_id
    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(student_id) = $1',
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'User not found. Please register first.' });
    }

    const user = rows[0];

    if (!user.password_hash || user.password_hash === 'GOOGLE_OAUTH_ACCOUNT') {
      return res.status(400).json({ error: 'Please log in using Google OAuth.' });
    }

    // Verify hash length to protect against PostgreSQL column length truncation
    if (user.password_hash.length < 60) {
      console.error(`Database Error: password_hash column length is too small (${user.password_hash.length} chars). Hash was truncated.`);
      return res.status(500).json({ error: 'Server database error: Stored hash is corrupted or truncated.' });
    }

    const isMatch = await bcrypt.compare(cleanPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials. Check your password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'epcst_secret',
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        student_id: user.student_id,
        username: user.full_name,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GOOGLE OAUTH LOGIN
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'ID Token is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name } = payload;
    const cleanEmail = email.trim().toLowerCase();

    let { rows } = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    let user = rows[0];

    if (!user) {
      const generatedStudentId = `STU-${Date.now().toString().slice(-4)}`;
      const fullName = name || cleanEmail.split('@')[0];

      const newUser = await db.query(
        `INSERT INTO users (student_id, full_name, email, password_hash) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, student_id, full_name, email`,
        [generatedStudentId, fullName, cleanEmail, 'GOOGLE_OAUTH_ACCOUNT']
      );
      user = newUser.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'epcst_secret',
      { expiresIn: '1d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        student_id: user.student_id,
        username: user.full_name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('Google Auth Error:', err);
    return res.status(401).json({ error: 'Invalid or expired Google Token' });
  }
});

// --- DATA ROUTES ---

app.get('/api/merch', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM merchandise');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/billing/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { rows } = await db.query(
      `SELECT u.full_name, u.student_id, b.description, b.amount, b.due_date 
       FROM users u 
       JOIN billing b ON u.id = b.user_id 
       WHERE b.user_id = $1`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});