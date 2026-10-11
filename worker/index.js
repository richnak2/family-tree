// Family tree API (Cloudflare Worker + D1).
//
// POST /api/login         {password}            -> {token, expiresAt}
// GET  /api/people                              -> {people: [...]}
// POST /api/people/sync   {upsert: [], delete: []} -> {ok: true}
//
// Everything except /api/login needs `Authorization: Bearer <token>`.
// Tokens are signed with APP_PASSWORD, so changing the password logs everyone out.

const SESSION_SECONDS = 12 * 60 * 60;
const MAX_CHANGES_PER_REQUEST = 40; // D1 free plan allows 50 queries per request
const MAX_FIELDS = 50;
const MAX_FIELD_LENGTH = 5_000;
const MAX_AVATAR_LENGTH = 300_000;
const MAX_RELS = 200;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD_KEY_RE = /^[A-Za-z0-9 _-]{1,100}$/;
const AVATAR_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const UPSERT_SQL = `
  INSERT INTO people (id, data, rels, unknown) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT (id) DO UPDATE SET
    data = excluded.data,
    rels = excluded.rels,
    unknown = excluded.unknown,
    updated_at = datetime('now')`;

const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return json(await route(request, env), 200, cors);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: 'Internal server error' }, 500, cors);
    }
  },
};

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname === '/api/login' && method === 'POST') return login(request, env);

  await requireSession(request, env);
  if (pathname === '/api/people' && method === 'GET') return listPeople(env);
  if (pathname === '/api/people/sync' && method === 'POST') return syncPeople(request, env);

  throw new HttpError(404, 'Not found');
}

// ---------- auth ----------

async function login(request, env) {
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !password) throw new HttpError(400, 'Password is required');

  if (!(await sameSecret(password, appPassword(env)))) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // slow down guessing
    throw new HttpError(401, 'Wrong password');
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return { token: `${exp}.${await sign(`session:${exp}`, env)}`, expiresAt: exp * 1000 };
}

async function requireSession(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [expText, signature] = token.split('.');
  const exp = Number(expText);

  const valid =
    Number.isInteger(exp) &&
    exp > Date.now() / 1000 &&
    typeof signature === 'string' &&
    (await sameSecret(signature, await sign(`session:${exp}`, env)));

  if (!valid) throw new HttpError(401, 'Session expired, please log in again');
}

function appPassword(env) {
  if (!env.APP_PASSWORD) throw new Error('APP_PASSWORD secret is not set');
  return env.APP_PASSWORD;
}

async function sign(message, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appPassword(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Constant-time comparison: hash both sides so lengths always match.
async function sameSecret(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- people ----------

async function listPeople(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, data, rels, unknown FROM people ORDER BY created_at, id',
  ).all();

  return {
    people: results.map((row) => ({
      id: row.id,
      data: JSON.parse(row.data),
      rels: JSON.parse(row.rels),
      ...(row.unknown ? { unknown: true } : {}),
    })),
  };
}

async function syncPeople(request, env) {
  const body = await readJson(request);
  const upsert = body.upsert ?? [];
  const remove = body.delete ?? [];

  if (!Array.isArray(upsert) || !Array.isArray(remove)) {
    throw new HttpError(400, '`upsert` and `delete` must be arrays');
  }
  if (upsert.length + remove.length > MAX_CHANGES_PER_REQUEST) {
    throw new HttpError(400, `At most ${MAX_CHANGES_PER_REQUEST} changes per request`);
  }

  const people = upsert.map(validatePerson);
  remove.forEach((id) => assertId(id, 'delete id'));

  const statements = [
    ...people.map((p) =>
      env.DB.prepare(UPSERT_SQL).bind(p.id, JSON.stringify(p.data), JSON.stringify(p.rels), p.unknown ? 1 : 0),
    ),
    ...remove.map((id) => env.DB.prepare('DELETE FROM people WHERE id = ?1').bind(id)),
  ];
  if (statements.length) await env.DB.batch(statements); // batch = one transaction

  return { ok: true };
}

function validatePerson(person) {
  if (!isPlainObject(person)) throw new HttpError(400, 'Each person must be an object');
  assertId(person.id, 'person id');

  const data = person.data;
  if (!isPlainObject(data)) throw new HttpError(400, `Person ${person.id}: data must be an object`);
  const entries = Object.entries(data);
  if (entries.length > MAX_FIELDS) throw new HttpError(400, `Person ${person.id}: too many fields`);

  for (const [key, value] of entries) {
    if (!FIELD_KEY_RE.test(key)) throw new HttpError(400, `Person ${person.id}: invalid field name`);
    if (typeof value !== 'string') throw new HttpError(400, `Person ${person.id}: "${key}" must be text`);
    if (key === 'avatar') {
      if (value && (value.length > MAX_AVATAR_LENGTH || !AVATAR_RE.test(value))) {
        throw new HttpError(400, `Person ${person.id}: photo must be a JPEG/PNG/WebP under 300 KB`);
      }
    } else if (value.length > MAX_FIELD_LENGTH) {
      throw new HttpError(400, `Person ${person.id}: "${key}" is too long`);
    }
  }
  if (data.gender !== undefined && data.gender !== 'M' && data.gender !== 'F') {
    throw new HttpError(400, `Person ${person.id}: gender must be M or F`);
  }

  const rels = isPlainObject(person.rels) ? person.rels : {};
  const cleanRels = {};
  for (const kind of ['parents', 'spouses', 'children']) {
    const ids = rels[kind] ?? [];
    if (!Array.isArray(ids) || ids.length > MAX_RELS) throw new HttpError(400, `Person ${person.id}: invalid ${kind}`);
    ids.forEach((id) => assertId(id, kind));
    cleanRels[kind] = ids;
  }

  return { id: person.id, data, rels: cleanRels, unknown: person.unknown === true };
}

// ---------- helpers ----------

function assertId(id, what) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, `Invalid ${what}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!isPlainObject(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim());
  const headers = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
