// Shared helpers for the Vinyl Library serverless functions.
// Storage: Vercel Blob (all blobs private, accessed via @vercel/blob).
// Auth: scrypt password hashing + signed-out sessions stored as blobs.

const crypto = require("crypto");
const { put, get, del } = require("@vercel/blob");

const SESSION_COOKIE = "vinyl_session";
const SESSION_TTL_MS = 60 * 60 * 24 * 30 * 1000; // 30 days
const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,30}$/;

// ---------- Blob JSON store ----------
async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function readJson(pathname) {
  try {
    const r = await get(pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const text = await streamToText(r.stream);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function deleteBlob(pathname) {
  try { await del(pathname); } catch (e) { /* ignore */ }
}

async function streamToText(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

// ---------- Password hashing (scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  try {
    const h = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
  } catch (e) {
    return false;
  }
}

// ---------- Sessions ----------
function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function createSession(res, username) {
  const token = newToken();
  await writeJson(`sessions/${token}.json`, {
    username,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(res, token);
  return token;
}

async function destroySession(res, token) {
  if (token) await deleteBlob(`sessions/${token}.json`);
  clearSessionCookie(res);
}

// ---------- Cookies ----------
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------- Auth helpers ----------
async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const sess = await readJson(`sessions/${token}.json`);
  if (!sess || !sess.username) return null;
  if (sess.expiresAt && Date.now() > sess.expiresAt) return null;
  const user = await readJson(`users/${sess.username}.json`);
  if (!user) return null;
  return { username: user.username, email: user.email || "", provider: user.provider || "local" };
}

async function getUser(username) {
  return readJson(`users/${username}.json`);
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return req.body;
}

function json(res, status, obj) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(obj);
}

function validUsername(u) {
  return typeof u === "string" && USERNAME_RE.test(u);
}

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}`;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  USERNAME_RE,
  writeJson,
  readJson,
  deleteBlob,
  hashPassword,
  verifyPassword,
  newToken,
  createSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  getUser,
  getBody,
  json,
  validUsername,
  baseUrl,
};
