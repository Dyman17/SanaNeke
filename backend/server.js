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

    // Ensure reviews table exists even if db was already initialized earlier
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        psych_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating      INTEGER     NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment     TEXT        NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (psych_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_psych ON reviews(psych_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_user  ON reviews(user_id);
    `);

    // ── Migration: psychologist verification + certificates ──
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified     BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS certificates    TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS achievements    TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS education       TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS experience_years INTEGER DEFAULT 0;
    `);

    // ── Migration: transparent finance calculator fields ──
    await pool.query(`
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS region           TEXT;
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS pm_value         INTEGER;
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS children_planned INTEGER DEFAULT 0;
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS housing          TEXT;
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS rent_amount      BIGINT DEFAULT 0;
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS debt_monthly     BIGINT DEFAULT 0;
      ALTER TABLE test_results ADD COLUMN IF NOT EXISTS fin_detail       JSONB;
    `);

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

// POST /api/auth/register — Public self-registration directs to WhatsApp
app.post('/api/auth/register', async (req, res) => {
  return res.status(403).json({
    error: 'Платформаға тіркелу ақылы. Аккаунт ашу үшін WhatsApp-қа жазыңыз: +77751841434',
    whatsapp: '+77751841434'
  });
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

// PUT /api/users/profile — psychologist can edit certs/achievements (verification stays with admin)
app.put('/api/users/profile', auth, async (req, res) => {
  try {
    const { specialization, bio, price, certificates, achievements, education, experience_years } = req.body;
    const result = await pool.query(
      `UPDATE users SET specialization=$1, bio=$2, price=$3,
        certificates=$4, achievements=$5, education=$6, experience_years=$7
       WHERE id=$8 RETURNING *`,
      [
        specialization?.trim() || null,
        bio?.trim() || null,
        parseInt(price) || 0,
        certificates?.trim() || null,
        achievements?.trim() || null,
        education?.trim() || null,
        Math.max(0, parseInt(experience_years) || 0),
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

// GET /api/psychologists — Includes verification, certs + OLX-style rating.
// Regular users see ONLY verified psychologists; psych/admin see all (for moderation).
app.get('/api/psychologists', auth, async (req, res) => {
  try {
    const onlyVerified = req.userRole === 'user';
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.specialization, u.bio, u.price, u.created_at,
              u.is_verified, u.certificates, u.achievements, u.education, u.experience_years,
              COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::float AS avg_rating,
              COUNT(r.id)::int AS review_count
       FROM users u
       LEFT JOIN reviews r ON r.psych_id = u.id
       WHERE u.role = 'psychologist' ${onlyVerified ? "AND u.is_verified = TRUE" : ""}
       GROUP BY u.id
       ORDER BY u.is_verified DESC, avg_rating DESC, u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('get psychologists error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// GET /api/psychologists/:id/reviews — Fetch reviews for a psychologist
app.get('/api/psychologists/:id/reviews', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT r.id, r.psych_id, r.user_id, r.rating, r.comment, r.created_at,
              u.name AS user_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.psych_id = $1
       ORDER BY r.created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('get reviews error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// POST /api/psychologists/:id/reviews — User submits review (1-5 stars & comment)
app.post('/api/psychologists/:id/reviews', auth, requireRole('user'), async (req, res) => {
  try {
    const { id: psych_id } = req.params;
    const { rating, comment } = req.body;
    const numRating = parseInt(rating);

    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'Баға 1 мен 5 жұлдыз аралығында болуы керек' });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Пікір мәтінін жазыңыз' });
    }

    // Verify interaction (user has sent a request to this psychologist)
    const reqRow = await pool.query(
      'SELECT id FROM requests WHERE user_id = $1 AND psych_id = $2',
      [req.userId, psych_id]
    );
    if (!reqRow.rows.length) {
      return res.status(403).json({ error: 'Пікір қалдыру үшін алдымен осы психологқа сұрау жіберу қажет' });
    }

    const result = await pool.query(
      `INSERT INTO reviews (psych_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (psych_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = NOW()
       RETURNING *`,
      [psych_id, req.userId, numRating, comment.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('post review error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

/* ═══════════════════════════════════════════════════════
   TEST RESULTS
═══════════════════════════════════════════════════════ */

// POST /api/results — saves transparent finance breakdown (region/PM/children/housing/rent/debts)
app.post('/api/results', auth, async (req, res) => {
  try {
    const { scores, total, calc_bonus, income, expense,
            region, pm_value, children_planned, housing,
            rent_amount, debt_monthly, fin_detail } = req.body;
    if (!scores || total === undefined) {
      return res.status(400).json({ error: 'scores және total қажет' });
    }

    const result = await pool.query(
      `INSERT INTO test_results (user_id, scores, total, calc_bonus, income, expense,
                                 region, pm_value, children_planned, housing,
                                 rent_amount, debt_monthly, fin_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.userId, JSON.stringify(scores), total, calc_bonus || null, income || null, expense || null,
       region || null, pm_value ? parseInt(pm_value) : null,
       Math.max(0, parseInt(children_planned) || 0),
       (housing === 'rent' || housing === 'own') ? housing : null,
       Math.max(0, parseInt(rent_amount) || 0),
       Math.max(0, parseInt(debt_monthly) || 0),
       fin_detail ? JSON.stringify(fin_detail) : null]
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
                tr.scores, tr.total, tr.calc_bonus, tr.income, tr.expense,
                tr.region, tr.pm_value, tr.children_planned, tr.housing,
                tr.rent_amount, tr.debt_monthly, tr.fin_detail
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

// POST /api/admin/users — Admin creates account AFTER manual check (psychologists start as UNVERIFIED)
app.post('/api/admin/users', auth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, specialization, bio, price,
            certificates, achievements, education, experience_years, is_verified } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Аты, email және пароль міндетті' });
    }
    const userRole = role === 'psychologist' ? 'psychologist' : 'user';

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Бұл email тіркелген' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, specialization, bio, price,
                          certificates, achievements, education, experience_years, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        hash,
        userRole,
        specialization?.trim() || null,
        bio?.trim() || null,
        parseInt(price) || 0,
        certificates?.trim() || null,
        achievements?.trim() || null,
        education?.trim() || null,
        Math.max(0, parseInt(experience_years) || 0),
        // Psychologists are UNVERIFIED by default until admin checks certs; users → verified
        userRole === 'psychologist' ? !!is_verified : true,
      ]
    );

    res.status(201).json(safeUser(result.rows[0]));
  } catch (err) {
    console.error('admin create user error:', err);
    res.status(500).json({ error: 'Сервер қатесі: ' + err.message });
  }
});

// PUT /api/admin/users/:id — Admin edits psychologist card + verifies/unverifies
app.put('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, specialization, bio, price, certificates, achievements,
            education, experience_years, is_verified } = req.body;
    const result = await pool.query(
      `UPDATE users SET
         name             = COALESCE($1, name),
         specialization   = COALESCE($2, specialization),
         bio              = COALESCE($3, bio),
         price            = COALESCE($4, price),
         certificates     = COALESCE($5, certificates),
         achievements     = COALESCE($6, achievements),
         education        = COALESCE($7, education),
         experience_years = COALESCE($8, experience_years),
         is_verified      = COALESCE($9, is_verified)
       WHERE id = $10 RETURNING *`,
      [
        name?.trim() || null,
        specialization?.trim() || null,
        bio?.trim() || null,
        price !== undefined ? parseInt(price) || 0 : null,
        certificates?.trim() || null,
        achievements?.trim() || null,
        education?.trim() || null,
        experience_years !== undefined ? Math.max(0, parseInt(experience_years) || 0) : null,
        typeof is_verified === 'boolean' ? is_verified : null,
        id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Пайдаланушы табылмады' });
    res.json(safeUser(result.rows[0]));
  } catch (err) {
    console.error('admin update user error:', err);
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// GET /api/admin/data — Fetch all db contents including reviews
app.get('/api/admin/data', auth, requireAdmin, async (req, res) => {
  try {
    const users = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    const requests = await pool.query('SELECT * FROM requests ORDER BY created_at DESC');
    const results = await pool.query('SELECT * FROM test_results ORDER BY created_at DESC');
    const responses = await pool.query('SELECT * FROM responses ORDER BY created_at DESC');
    const reviews = await pool.query(`
      SELECT r.*, u.name AS user_name, p.name AS psych_name
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      JOIN users p ON p.id = r.psych_id
      ORDER BY r.created_at DESC
    `);
    res.json({
      users: users.rows,
      requests: requests.rows,
      results: results.rows,
      responses: responses.rows,
      reviews: reviews.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Сервер қатесі' });
  }
});

// DELETE /api/admin/:table/:id — Generic delete
app.delete('/api/admin/:table/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { table, id } = req.params;
    const allowedTables = ['users', 'requests', 'test_results', 'responses', 'reviews'];
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
