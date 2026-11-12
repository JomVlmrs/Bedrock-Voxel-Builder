import { db } from 'hatchable';

export const access = 'public';
export const methods = ['GET', 'POST', 'OPTIONS'];

const ALLOWED_ORIGINS = new Set([
  'https://jomvlmrs.github.io',
  'https://bedrock-structure-lznl.hatchable.site'
]);

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function applyHeaders(req, res) {
  const origin = String(req.headers?.origin || '');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

async function readStats() {
  const result = await db.query(
    `SELECT
      (SELECT COUNT(*)::INTEGER
       FROM site_active_visitors
       WHERE last_seen_at > now() - interval '90 seconds') AS active_visitors,
      COALESCE(
        (SELECT total_visits FROM site_visit_stats WHERE id = 1),
        0
      ) AS total_visits`
  );
  const row = result.rows[0] || {};
  return {
    activeVisitors: Number(row.active_visitors || 0),
    totalVisits: Number(row.total_visits || 0),
    updatedAt: new Date().toISOString()
  };
}

function parseRequestBody(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export default async function (req, res) {
  applyHeaders(req, res);

  const origin = String(req.headers?.origin || '');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'This website origin is not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  try {
    if (req.method === 'GET') {
      return res.json(await readStats());
    }

    const body = parseRequestBody(req.body);
    const sessionId = String(body.sessionId || '').trim();
    const action = String(body.action || '');

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return res.status(400).json({ error: 'A valid visitor session ID is required.' });
    }
    if (!['visit', 'heartbeat'].includes(action)) {
      return res.status(400).json({ error: 'Choose a valid tracker action.' });
    }

    // A visit is counted once per tab session after 30 minutes of inactivity.
    // Heartbeats only refresh presence and never inflate the visit counter.
    const touch = await db.query(
      `WITH prior AS (
         SELECT last_seen_at
         FROM site_active_visitors
         WHERE session_id = $1
       ),
       touched AS (
         INSERT INTO site_active_visitors (session_id, first_seen_at, last_seen_at)
         VALUES ($1, now(), now())
         ON CONFLICT (session_id)
         DO UPDATE SET last_seen_at = now()
         RETURNING session_id
       )
       SELECT COALESCE(
         (SELECT last_seen_at < now() - interval '30 minutes' FROM prior),
         true
       ) AS count_visit`,
      [sessionId]
    );

    if (action === 'visit' && touch.rows[0]?.count_visit === true) {
      await db.query(
        `INSERT INTO site_visit_stats (id, total_visits, updated_at)
         VALUES (1, 1, now())
         ON CONFLICT (id)
         DO UPDATE SET
           total_visits = site_visit_stats.total_visits + 1,
           updated_at = now()`
      );
      await db.query(
        `DELETE FROM site_active_visitors
         WHERE last_seen_at < now() - interval '24 hours'`
      );
    }

    return res.json(await readStats());
  } catch (error) {
    console.error('Visitor tracker request failed', error);
    return res.status(500).json({ error: 'Visitor statistics are temporarily unavailable.' });
  }
}