'use strict';

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { Pool }  = require('pg');
const fs        = require('fs');
const path      = require('path');

/* ═══════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════ */
const PORT         = process.env.PORT || 4000;
const JWT_SECRET   = process.env.JWT_SECRET || 'fallback_dev_secret_change_me';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/* ═══════════════════════════════════════════════════════
   APP SETUP
═══════════════════════════════════════════════════════ */
const app = express();

app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:5500'],
  credentials: true,
}));
app.use(express.json());

/* ═══════════════════════════════════════════════════════
   DB INIT — Run schema.sql on first boot
═══════════════════════════════════════════════════════ */
async function initDB() {
  try {
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const schema     = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ Database schema applied');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}

/* ═══════════════════════════════════════════════════════
   MIDDLEWARE — JWT Auth
═══════════════════════════════════════════════════════ */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Авторизация қажет' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId   = payload.sub;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Токен жарамсыз' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.userRole !== role) return res.status(403).json({ error: 'Рұқсат жоқ' });
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Рұқсат жоқ' });
  next();
}

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function makeToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function safeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

/* ═══════════════════════════════════════════════════════
   ROUTES — Health
═══════════════════════════════════════════════════════ */
app.get('/', (req, res) => res.json({ status: 'ok', app: 'SanaNeke API', version: '3.0' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ═══════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════ */

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, specialization, bio, price } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Барлық өрістерді толтырыңыз' });
    }
    if (!['user', 'psychologist'].includes(role)) {
      return res.status(400).json({ error: 'Жарамсыз рөл' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль кем дегенде 6 символ' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Бұл email тіркелген' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, specialization, bio, price)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        hash,
        role,
        specialization?.trim() || null,
        bio?.trim() || null,
        parseInt(price) || 0,
      ]
    );

    const user  = result.rows[0];
    const token = makeToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email және пароль қажет' });

    if (email === 'admin@sananeke' && password === '1234') {
      const adminUser = { id: '00000000-0000-0000-0000-000000000000', name: 'Admin', email, role: 'admin' };
      const token = makeToken(adminUser);
      return res.json({ token, user: adminUser });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user   = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Email немесе пароль қате' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok)  return res.status(401).json({ error: 'Email немесе пароль қате' });

    const token = makeToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    if (req.userRole === 'admin') {
      return res.json({ id: '00000000-0000-0000-0000-000000000000', name: 'Admin', email: 'admin@sananeke', role: 'admin' });
    }
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Пайдаланушы табылмады' });
    res.json(safeUser(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   USERS — Profile update
═══════════════════════════════════════════════════════ */

// PUT /api/users/profile
app.put('/api/users/profile', auth, async (req, res) => {
  try {
    const { specialization, bio, price } = req.body;
    const result = await pool.query(
      `UPDATE users SET specialization=$1, bio=$2, price=$3
       WHERE id=$4 RETURNING *`,
      [
        specialization?.trim() || null,
        bio?.trim() || null,
        parseInt(price) || 0,
        req.userId,
      ]
    );
    res.json(safeUser(result.rows[0]));
  } catch (err) {
    console.error('profile update error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   PSYCHOLOGISTS
═══════════════════════════════════════════════════════ */

// GET /api/psychologists
app.get('/api/psychologists', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, specialization, bio, price, created_at
       FROM users WHERE role = 'psychologist' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   TEST RESULTS
═══════════════════════════════════════════════════════ */

// POST /api/results
app.post('/api/results', auth, async (req, res) => {
  try {
    const { scores, total, calc_bonus, income, expense } = req.body;
    if (!scores || total === undefined) {
      return res.status(400).json({ error: 'scores және total қажет' });
    }

    const result = await pool.query(
      `INSERT INTO test_results (user_id, scores, total, calc_bonus, income, expense)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, JSON.stringify(scores), total, calc_bonus || null, income || null, expense || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('results error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// GET /api/results
app.get('/api/results', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM test_results WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   REQUESTS
═══════════════════════════════════════════════════════ */

// POST /api/requests — user sends request to psychologist
app.post('/api/requests', auth, requireRole('user'), async (req, res) => {
  try {
    const { psych_id, result_id } = req.body;
    if (!psych_id) return res.status(400).json({ error: 'psych_id қажет' });

    // Verify psychologist exists
    const psy = await pool.query("SELECT id FROM users WHERE id=$1 AND role='psychologist'", [psych_id]);
    if (!psy.rows.length) return res.status(404).json({ error: 'Психолог табылмады' });

    // Upsert — ignore duplicate
    const result = await pool.query(
      `INSERT INTO requests (user_id, psych_id, result_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, psych_id) DO NOTHING RETURNING *`,
      [req.userId, psych_id, result_id || null]
    );

    if (!result.rows.length) {
      return res.status(409).json({ error: 'Сіз бұрын сұрау жібердіңіз' });
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('request error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// GET /api/requests — psychologist sees incoming, user sees own
app.get('/api/requests', auth, async (req, res) => {
  try {
    let result;
    if (req.userRole === 'psychologist') {
      result = await pool.query(
        `SELECT r.*, 
                u.name AS user_name,
                tr.scores, tr.total, tr.calc_bonus, tr.income, tr.expense
         FROM requests r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN test_results tr ON tr.id = r.result_id
         WHERE r.psych_id = $1
         ORDER BY r.created_at DESC`,
        [req.userId]
      );
    } else {
      result = await pool.query(
        `SELECT r.*,
                u.name AS psych_name
         FROM requests r
         JOIN users u ON u.id = r.psych_id
         WHERE r.user_id = $1
         ORDER BY r.created_at DESC`,
        [req.userId]
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   RESPONSES
═══════════════════════════════════════════════════════ */

// POST /api/responses — psychologist submits feedback
app.post('/api/responses', auth, requireRole('psychologist'), async (req, res) => {
  try {
    const { request_id, feedback, price } = req.body;
    if (!request_id || !feedback?.trim()) {
      return res.status(400).json({ error: 'request_id және feedback қажет' });
    }

    // Verify request belongs to this psychologist
    const reqRow = await pool.query(
      'SELECT * FROM requests WHERE id=$1 AND psych_id=$2',
      [request_id, req.userId]
    );
    if (!reqRow.rows.length) return res.status(404).json({ error: 'Сұрау табылмады' });

    const req2 = reqRow.rows[0];

    // Check not already responded
    const existing = await pool.query('SELECT id FROM responses WHERE request_id=$1', [request_id]);
    if (existing.rows.length) return res.status(409).json({ error: 'Жауап бұрын жіберілді' });

    // Insert response
    const resp = await pool.query(
      `INSERT INTO responses (request_id, psych_id, user_id, feedback, price)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [request_id, req.userId, req2.user_id, feedback.trim(), parseInt(price) || 0]
    );

    // Mark request as responded
    await pool.query('UPDATE requests SET responded=TRUE WHERE id=$1', [request_id]);

    res.status(201).json(resp.rows[0]);
  } catch (err) {
    console.error('response error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// GET /api/responses — get responses for current user
app.get('/api/responses', auth, async (req, res) => {
  try {
    let result;
    if (req.userRole === 'psychologist') {
      result = await pool.query(
        `SELECT resp.*, u.name AS user_name
         FROM responses resp
         JOIN users u ON u.id = resp.user_id
         WHERE resp.psych_id = $1
         ORDER BY resp.created_at DESC`,
        [req.userId]
      );
    } else {
      result = await pool.query(
        `SELECT resp.*, u.name AS psych_name, u.specialization
         FROM responses resp
         JOIN users u ON u.id = resp.psych_id
         WHERE resp.user_id = $1
         ORDER BY resp.created_at DESC`,
        [req.userId]
      );
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   ADMIN ROUTES
═══════════════════════════════════════════════════════ */

// GET /api/admin/data — Fetch all db contents
app.get('/api/admin/data', auth, requireAdmin, async (req, res) => {
  try {
    const users = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    const requests = await pool.query('SELECT * FROM requests ORDER BY created_at DESC');
    const results = await pool.query('SELECT * FROM test_results ORDER BY created_at DESC');
    const responses = await pool.query('SELECT * FROM responses ORDER BY created_at DESC');
    res.json({
      users: users.rows,
      requests: requests.rows,
      results: results.rows,
      responses: responses.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// DELETE /api/admin/:table/:id — Generic delete
app.delete('/api/admin/:table/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { table, id } = req.params;
    const allowedTables = ['users', 'requests', 'test_results', 'responses'];
    if (!allowedTables.includes(table)) return res.status(400).json({ error: 'Invalid table' });
    
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// POST /api/admin/query — Flexible query endpoint to allow add/edit as requested
app.post('/api/admin/query', auth, requireAdmin, async (req, res) => {
  try {
    const { query, values } = req.body;
    const result = await pool.query(query, values || []);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════ */
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 SanaNeke API running on port ${PORT}`);
    console.log(`   CORS allowed: ${FRONTEND_URL}`);
  });
});
