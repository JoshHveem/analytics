// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3020);
// Create one shared pool for the whole process
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If you're using a managed DB or TLS, you might need:
  // ssl: { rejectUnauthorized: true }
});

(async () => {
  const app = express();

  // Trust proxy since you're behind nginx
  app.set('trust proxy', true);

  // Parse JSON & form data
  app.use(bodyParser.json({ limit: '2mb' }));
  app.use(bodyParser.urlencoded({ extended: false }));

  // Static files (optional UI)
  app.use(express.static('public'));

  // Public health endpoint (no auth)
  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, dbState: 1 });
    } catch (e) {
      res.status(500).json({ ok: false, dbState: 0, error: 'db_unreachable' });
    }
  });

  // --- Auth middleware (reads headers set by nginx/oauth2-proxy) ---
  app.use(async (req, res, next) => {
    try {
      // Never trust client-sent headers unless nginx/oauth2-proxy is stripping/setting them.
      const emailRaw = req.get('X-Email') || '';
      const email = emailRaw.trim().toLowerCase();

      if (!email) {
        return res.status(401).json({ error: 'Unauthorized: missing X-Email header' });
      }
      if (!email.endsWith('@btech.edu')) {
        return res.status(403).json({ error: 'Forbidden: must be @btech.edu' });
      }

      // Look up provisioned account
      // NOTE: auth.user must be quoted because "user" is reserved.
      const { rows } = await pool.query(
        `
        SELECT sis_user_id, email, display_name, is_active, is_admin
        FROM auth."user"
        WHERE lower(email) = $1
        LIMIT 1
        `,
        [email]
      );

      if (rows.length === 0) {
        return res.status(403).json({
          error: 'Access not provisioned',
          message:
            'Your account is not enabled for analytics. Contact isd@btech.edu to request access.',
        });
      }

      const u = rows[0];

      if (!u.is_active) {
        return res.status(403).json({
          error: 'Account disabled',
          message: 'Your analytics account is disabled. Contact isd@btech.edu.',
        });
      }

      // Optional: update last_login_at (comment out if you want API DB user to be SELECT-only)
      await pool.query(
        `UPDATE auth."user" SET last_login_at = now() WHERE sis_user_id = $1`,
        [u.sis_user_id]
      );

      // Attach auth context for routes
      req.auth = {
        sis_user_id: u.sis_user_id,
        email: u.email,
        display_name: u.display_name,
        is_admin: u.is_admin,
      };

      next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Example protected endpoint
  app.get('/me', (req, res) => {
    res.json({ ok: true, user: req.auth });
  });

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

  app.listen(PORT, () => console.log(`Analytics server listening on ${PORT}`));
})().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

