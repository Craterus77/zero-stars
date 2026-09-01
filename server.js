// Zero Stars — full-stack prototype server (Express + node:sqlite)
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, seed, CATEGORIES } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4317;

seed(); // migrate + seed on first run

const app = express();
app.use(express.json({ limit: "64kb" }));

/* ---------- tiny cookie helpers ---------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie",
    `zs_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `zs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/* ---------- auth ---------- */
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function currentUser(req) {
  const token = parseCookies(req).zs_session;
  if (!token) return null;
  const row = db.prepare(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).get(token);
  return row || null;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "Sign in to do that." });
  req.user = u;
  next();
}

/* ---------- serialization ---------- */
function shapeComplaint(row) {
  const replies = db.prepare(
    "SELECT author_name AS by, body AS text, created_at AS date FROM replies WHERE complaint_id = ? ORDER BY created_at ASC"
  ).all(row.id);
  return {
    id: row.public_id,
    biz: row.slug,
    bizName: row.name,
    cat: row.cat,
    loc: row.loc,
    sev: row.severity,
    status: row.status,
    title: row.title,
    body: row.body,
    author: row.author_label,
    date: (row.created_at || "").slice(0, 10),
    reply: replies[0] ? { by: replies[0].by, text: replies[0].text, date: (replies[0].date || "").slice(0, 10) } : null,
    replyCount: replies.length
  };
}
const COMPLAINT_SELECT = `
  SELECT c.*, b.slug, b.name, b.loc
  FROM complaints c JOIN businesses b ON b.id = c.business_id`;

/* ---------- API: meta ---------- */
app.get("/api/meta", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) n FROM complaints").get().n;
  const unresolved = db.prepare("SELECT COUNT(*) n FROM complaints WHERE status != 'responded'").get().n;
  const avg = db.prepare("SELECT AVG(severity) a FROM complaints").get().a || 0;
  const businesses = db.prepare("SELECT COUNT(*) n FROM businesses").get().n;
  res.json({ categories: CATEGORIES, total, unresolved, avgSeverity: avg, businesses });
});

/* ---------- API: auth ---------- */
app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "That email already has an account — sign in instead." });
  const { hash, salt } = hashPassword(password);
  const r = db.prepare("INSERT INTO users (email, pass_hash, pass_salt) VALUES (?,?,?)").run(email, hash, salt);
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, r.lastInsertRowid);
  setSessionCookie(res, token);
  res.json({ user: { email } });
});
app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!u || !verifyPassword(password, u.pass_salt, u.pass_hash))
    return res.status(401).json({ error: "Wrong email or password." });
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, u.id);
  setSessionCookie(res, token);
  res.json({ user: { email: u.email } });
});
app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req).zs_session;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get("/api/auth/me", (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? { email: u.email } : null });
});

/* ---------- API: complaints ---------- */
app.get("/api/complaints", (req, res) => {
  const { q = "", cat = "all", status = "all", sort = "recent" } = req.query;
  let rows = db.prepare(COMPLAINT_SELECT).all().map(shapeComplaint);
  if (cat !== "all") rows = rows.filter(c => c.cat === cat);
  if (status !== "all") rows = rows.filter(c => c.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(c => (c.bizName + " " + c.cat + " " + c.loc + " " + c.title + " " + c.body).toLowerCase().includes(needle));
  }
  if (sort === "severe") rows.sort((a, b) => b.sev - a.sev || b.date.localeCompare(a.date));
  else if (sort === "business") rows.sort((a, b) => a.bizName.localeCompare(b.bizName));
  else rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  res.json({ complaints: rows });
});

app.post("/api/complaints", requireAuth, (req, res) => {
  const bizName = String(req.body.business || "").trim();
  const cat = CATEGORIES.includes(req.body.cat) ? req.body.cat : "Other";
  const loc = String(req.body.loc || "").trim() || "—";
  const sev = Math.min(5, Math.max(1, parseInt(req.body.severity, 10) || 3));
  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();
  if (!bizName) return res.status(400).json({ error: "Who let you down? Name them." });
  if (!title) return res.status(400).json({ error: "Give it a headline — one blunt line." });
  if (body.length < 20) return res.status(400).json({ error: "Tell us what actually happened." });

  const slug = bizName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
  let biz = db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug);
  if (!biz) {
    db.prepare("INSERT INTO businesses (slug,name,cat,loc,kind) VALUES (?,?,?,?,?)")
      .run(slug, bizName, cat, loc, "Business");
    biz = db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug);
  }
  const n = db.prepare("SELECT COUNT(*) c FROM complaints").get().c;
  const publicId = "ZS-" + String(1043 + n);
  const authorLabel = req.user.email.split("@")[0];
  db.prepare(`INSERT INTO complaints (public_id,business_id,user_id,cat,severity,status,title,body,author_label)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(publicId, biz.id, req.user.id, cat, sev, "unresolved", title, body, authorLabel);
  res.json({ ok: true, slug, publicId });
});

/* right of reply */
app.post("/api/complaints/:publicId/reply", requireAuth, (req, res) => {
  const c = db.prepare("SELECT * FROM complaints WHERE public_id = ?").get(req.params.publicId);
  if (!c) return res.status(404).json({ error: "No such complaint." });
  const by = String(req.body.by || "").trim();
  const text = String(req.body.text || "").trim();
  if (!by) return res.status(400).json({ error: "Who is responding? Give a business name." });
  if (text.length < 10) return res.status(400).json({ error: "Add a proper response." });
  db.prepare("INSERT INTO replies (complaint_id, author_name, body) VALUES (?,?,?)").run(c.id, by, text);
  db.prepare("UPDATE complaints SET status = 'responded' WHERE id = ?").run(c.id);
  res.json({ ok: true });
});

/* ---------- API: business dossier ---------- */
app.get("/api/businesses/:slug", (req, res) => {
  const b = db.prepare("SELECT * FROM businesses WHERE slug = ?").get(req.params.slug);
  if (!b) return res.status(404).json({ error: "Business not found." });
  const rows = db.prepare(COMPLAINT_SELECT + " WHERE b.slug = ?").all(req.params.slug)
    .map(shapeComplaint)
    .sort((a, z) => z.date.localeCompare(a.date) || z.id.localeCompare(a.id));
  const avg = rows.length ? rows.reduce((s, c) => s + c.sev, 0) / rows.length : 0;
  res.json({
    business: { slug: b.slug, name: b.name, cat: b.cat, loc: b.loc, kind: b.kind },
    complaints: rows,
    stats: {
      total: rows.length,
      unresolved: rows.filter(c => c.status !== "responded").length,
      ignored: rows.filter(c => c.status === "ignored").length,
      responded: rows.filter(c => c.reply).length,
      avgSeverity: avg
    }
  });
});

/* ---------- static front end ---------- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Zero Stars running at http://localhost:${PORT}`));
