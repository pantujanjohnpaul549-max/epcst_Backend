const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

// Debug check to verify password is being read
console.log('Loaded DB Password:', process.env.DB_PASSWORD ? 'PASSWORD_FOUND' : 'NO_PASSWORD');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 6543,
  ssl: {
    rejectUnauthorized: false
  }
});

// Paste the connection test here:
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};