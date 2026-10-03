// Zero Stars — full-stack prototype server (Express + node:sqlite)
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPostgres } from "./database.js";
import { db, seed, CATEGORIES, DISPUTE_REASONS } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4317;

// Extra emails to grant moderator rights (comma-separated), e.g. MOD_EMAILS="you@x.com".
const MOD_EMAILS = new Set(
  (process.env.MOD_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);
async function applyModPromotion(email, userId) {
  if (MOD_EMAILS.has(email)) (await db.prepare("UPDATE users SET is_moderator = 1 WHERE id = ?").run(userId));
}

// Migrate + seed on first run. SEED_FORCE=1 wipes and re-seeds on boot
// (used once to populate demo data on a persistent volume — unset it afterwards,
// or it will reset data on every restart).
if (!isPostgres) await seed({ force: process.env.SEED_FORCE === "1" });

export const app = express();
const asyncHandler = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
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
    `zs_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${process.env.VERCEL ? "; Secure" : ""}`);
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
async function currentUser(req) {
  const token = parseCookies(req).zs_session;
  if (!token) return null;
  const row = (await db.prepare(
    "SELECT u.id, u.email, u.display_name, u.is_moderator FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.created_at > ?"
  ).get(token, new Date(Date.now()-30*86400000).toISOString().slice(0,19).replace("T"," ")));
  return row || null;
}
async function requireAuth(req, res, next) {
  const u = (await currentUser(req));
  if (!u) return res.status(401).json({ error: "Sign in to do that." });
  req.user = u;
  next();
}
async function requireModerator(req, res, next) {
  const u = (await currentUser(req));
  if (!u) return res.status(401).json({ error: "Sign in to do that." });
  if (!u.is_moderator) return res.status(403).json({ error: "Moderators only." });
  req.user = u;
  next();
}

/* ---------- serialization ---------- */
async function shapeComplaint(row, userId = null) {
  const replies = (await db.prepare(
    "SELECT author_name AS by, body AS text, created_at AS date FROM replies WHERE complaint_id = ? ORDER BY created_at ASC"
  ).all(row.id));
  const openDispute = (await db.prepare(
    "SELECT reason FROM disputes WHERE complaint_id = ? AND state = 'open' ORDER BY created_at DESC LIMIT 1"
  ).get(row.id));
  const downvotes = (await db.prepare("SELECT COUNT(*) n FROM votes WHERE complaint_id = ?").get(row.id)).n;
  const commentCount = (await db.prepare("SELECT COUNT(*) n FROM comments WHERE complaint_id = ?").get(row.id)).n;
  const votedByMe = userId
    ? !!(await db.prepare("SELECT 1 FROM votes WHERE complaint_id = ? AND user_id = ?").get(row.id, userId))
    : false;
  return {
    id: row.public_id,
    biz: row.slug,
    bizName: row.name,
    cat: row.cat,
    loc: row.loc,
    sev: row.severity,
    status: row.status,
    modState: row.mod_state || "published",
    disputeReason: openDispute ? openDispute.reason : null,
    title: row.title,
    body: row.body,
    author: row.author_label,
    authorId: row.user_id || null,
    date: (row.created_at || "").slice(0, 10),
    reply: replies[0] ? { by: replies[0].by, text: replies[0].text, date: (replies[0].date || "").slice(0, 10) } : null,
    replyCount: replies.length,
    downvotes,
    commentCount,
    votedByMe
  };
}
const COMPLAINT_SELECT = `
  SELECT c.*, b.slug, b.name, b.loc
  FROM complaints c JOIN businesses b ON b.id = c.business_id`;

/* ---------- API: meta ---------- */
app.get("/api/meta", asyncHandler(async (req, res) => {
  // Public stats exclude moderator-removed complaints.
  const total = (await db.prepare("SELECT COUNT(*) n FROM complaints WHERE mod_state != 'removed'").get()).n;
  const unresolved = (await db.prepare("SELECT COUNT(*) n FROM complaints WHERE mod_state != 'removed' AND status != 'resolved'").get()).n;
  const avg = (await db.prepare("SELECT AVG(severity) a FROM complaints WHERE mod_state != 'removed'").get()).a || 0;
  const businesses = (await db.prepare("SELECT COUNT(*) n FROM businesses").get()).n;
  res.json({ categories: CATEGORIES, disputeReasons: DISPUTE_REASONS, total, unresolved, avgSeverity: avg, businesses });
}));

/* ---------- API: auth ---------- */
// Bound authentication attempts per warm instance; persisted high-entropy recovery codes
// remain the recovery credential across instances. Never log passwords or recovery codes.
const authAttempts=new Map();
function limitAuth(req,res,next){const key=String(req.headers["x-forwarded-for"]||req.ip).split(",")[0];const now=Date.now();const entry=authAttempts.get(key)||{count:0,until:now+60000};if(now>entry.until){entry.count=0;entry.until=now+60000;}entry.count++;authAttempts.set(key,entry);if(authAttempts.size>10000)for(const [k,v] of authAttempts)if(v.until<now)authAttempts.delete(k);if(entry.count>20)return res.status(429).json({error:"Too many attempts. Please wait a minute and try again."});next();}
app.use("/api/auth",limitAuth);
app.post("/api/auth/recover",asyncHandler(async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),code=String(req.body.recoveryCode||"").trim(),password=String(req.body.password||"");
 if(password.length<6||password.length>256)return res.status(400).json({error:"Use a password of 6–256 characters."});
 const u=await db.prepare("SELECT id,recovery_hash FROM users WHERE email = ?").get(email);
 const candidate=crypto.createHash("sha256").update(code).digest("hex");
 if(!u?.recovery_hash||!crypto.timingSafeEqual(Buffer.from(candidate,"hex"),Buffer.from(u.recovery_hash,"hex")))return res.status(401).json({error:"Email or recovery code is incorrect."});
 const recoveryCode=crypto.randomBytes(24).toString("hex"),recoveryHash=crypto.createHash("sha256").update(recoveryCode).digest("hex"),{hash,salt}=hashPassword(password);
 // A conditional write makes each recovery code single-use, even under concurrent requests.
 const result=await db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, recovery_hash = ? WHERE id = ? AND recovery_hash = ?").run(hash,salt,recoveryHash,u.id,u.recovery_hash);
 if(!result.changes)return res.status(401).json({error:"This recovery code has already been used."});
 await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);clearSessionCookie(res);res.json({ok:true,recoveryCode});
}));
app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (password.length < 6 || password.length > 256) return res.status(400).json({ error: "Use a password of 6–256 characters." });
  const exists = (await db.prepare("SELECT id FROM users WHERE email = ?").get(email));
  if (exists) return res.status(409).json({ error: "That email already has an account — sign in instead." });
  const { hash, salt } = hashPassword(password);
  const displayName = String(req.body.displayName || "Member").trim();
  if (displayName.length < 2 || displayName.length > 40 || displayName.includes("@")) return res.status(400).json({error:"Choose a public name of 2–40 characters without an email address."});
  const recoveryCode = crypto.randomBytes(24).toString("hex");
  const recoveryHash = crypto.createHash("sha256").update(recoveryCode).digest("hex");
  const r = (await db.prepare("INSERT INTO users (email, pass_hash, pass_salt, display_name, recovery_hash) VALUES (?,?,?,?,?)").run(email, hash, salt, displayName, recoveryHash));
  (await applyModPromotion(email, r.lastInsertRowid));
  const token = crypto.randomBytes(24).toString("hex");
  (await db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, r.lastInsertRowid));
  setSessionCookie(res, token);
  const isMod = !!(await db.prepare("SELECT is_moderator FROM users WHERE id = ?").get(r.lastInsertRowid)).is_moderator;
  res.json({ user: { id: r.lastInsertRowid, email, displayName, isModerator: isMod }, recoveryCode });
}));
app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const u = (await db.prepare("SELECT * FROM users WHERE email = ?").get(email));
  if (!u || !verifyPassword(password, u.pass_salt, u.pass_hash))
    return res.status(401).json({ error: "Wrong email or password." });
  (await applyModPromotion(email, u.id));
  const token = crypto.randomBytes(24).toString("hex");
  (await db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, u.id));
  setSessionCookie(res, token);
  const isMod = !!(await db.prepare("SELECT is_moderator FROM users WHERE id = ?").get(u.id)).is_moderator;
  res.json({ user: { id: u.id, email: u.email, displayName:u.display_name||"Member", isModerator: isMod } });
}));
app.post("/api/auth/settings",asyncHandler(requireAuth),asyncHandler(async(req,res)=>{
 const name=String(req.body.displayName||"").trim(),password=String(req.body.password||"");
 if(name.length<2||name.length>40||name.includes("@"))return res.status(400).json({error:"Choose a public name of 2–40 characters without an email address."});
 const u=await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
 if(!verifyPassword(password,u.pass_salt,u.pass_hash))return res.status(401).json({error:"Enter your current password to save these settings."});
 const recoveryCode=crypto.randomBytes(24).toString("hex"),hash=crypto.createHash("sha256").update(recoveryCode).digest("hex");
 await db.prepare("UPDATE users SET display_name = ?, recovery_hash = ? WHERE id = ?").run(name,hash,u.id);
 res.json({user:{id:u.id,email:u.email,displayName:name,isModerator:!!u.is_moderator},recoveryCode});
}));
app.post("/api/auth/logout", asyncHandler(async (req, res) => {
  const token = parseCookies(req).zs_session;
  if (token) (await db.prepare("DELETE FROM sessions WHERE token = ?").run(token));
  clearSessionCookie(res);
  res.json({ ok: true });
}));
app.get("/api/auth/me", asyncHandler(async (req, res) => {
  const u = (await currentUser(req));
  res.json({ user: u ? { id: u.id, email: u.email, displayName:u.display_name||"Member", isModerator: !!u.is_moderator } : null });
}));

/* ---------- API: complaints ---------- */
// Brisbane calendar weeks run Monday 00:00 through the following Monday.
function currentWeek(now=new Date()) {
 const local=new Date(now.getTime()+10*3600000);
 const monday=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-((local.getUTCDay()+6)%7));
 const timestamp=ms=>new Date(ms).toISOString().slice(0,19).replace("T"," ");
 return {start:timestamp(monday-10*3600000),end:timestamp(monday+7*86400000-10*3600000),label:new Date(monday).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"})};
}
function rankBusinesses(rows){
 const groups=new Map();for(const row of rows){const item=groups.get(row.slug)||{slug:row.slug,name:row.name,loc:row.loc,count:0,sum:0};item.count++;item.sum+=row.severity;groups.set(row.slug,item);}
 return [...groups.values()].map(({sum,...item})=>({...item,average:sum/item.count})).sort((a,b)=>b.average-a.average||b.count-a.count||a.name.localeCompare(b.name)).map((item,index)=>({...item,rank:index+1}));
}
app.get("/api/shit-list",asyncHandler(async(req,res)=>{
 const week=currentWeek();const rows=await db.prepare(COMPLAINT_SELECT+" WHERE c.mod_state != 'removed' AND c.created_at >= ? AND c.created_at < ?").all(week.start,week.end);
 res.json({week:week.label,timeZone:"Australia/Brisbane",businesses:rankBusinesses(rows)});
}));
app.get("/api/complaints", asyncHandler(async (req, res) => {
  const me = (await currentUser(req));
  const { q = "", cat = "all", status = "all", sort = "recent" } = req.query;
  // Public listing hides moderator-removed complaints.
  const week=currentWeek();
  const source=sort==="shitlist"?await db.prepare(COMPLAINT_SELECT+" WHERE c.mod_state != 'removed' AND c.created_at >= ? AND c.created_at < ?").all(week.start,week.end):await db.prepare(COMPLAINT_SELECT+" WHERE c.mod_state != 'removed'").all();
  const ranking=new Map(rankBusinesses(source).map(item=>[item.slug,item.rank]));
  let rows=await Promise.all(source.map(r=>shapeComplaint(r,me&&me.id)));
  if (cat !== "all") rows = rows.filter(c => c.cat === cat);
  if (status !== "all") rows = rows.filter(c => c.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(c => (c.bizName + " " + c.cat + " " + c.loc + " " + c.title + " " + c.body).toLowerCase().includes(needle));
  }
  if (sort === "shitlist") rows.sort((a,b)=>ranking.get(a.biz)-ranking.get(b.biz)||b.sev-a.sev||b.date.localeCompare(a.date));
  else if (sort === "severe") rows.sort((a, b) => b.sev - a.sev || b.date.localeCompare(a.date));
  else if (sort === "business") rows.sort((a, b) => a.bizName.localeCompare(b.bizName));
  else if (sort === "backed") rows.sort((a, b) => b.downvotes - a.downvotes || b.date.localeCompare(a.date));
  else rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const total=rows.length;
  const limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||20));
  res.json({ complaints: rows.slice(0,limit),total });
}));

app.get("/api/businesses",asyncHandler(async(req,res)=>{
 const q=String(req.query.q||"").trim().toLowerCase();
 const businesses=await db.prepare("SELECT slug,name,cat,loc FROM businesses WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 12").all("%"+q+"%");res.json({businesses});
}));
app.get("/api/complaints/:publicId",asyncHandler(async(req,res)=>{
 const row=await db.prepare(COMPLAINT_SELECT+" WHERE c.public_id = ? AND c.mod_state != 'removed'").get(req.params.publicId);
 if(!row)return res.status(404).json({error:"This complaint is unavailable."});const user=await currentUser(req);res.json({complaint:await shapeComplaint(row,user?.id)});
}));
app.post("/api/complaints", asyncHandler(requireAuth), asyncHandler(async (req, res) => {
  const bizName = String(req.body.business || "").trim();
  const cat = CATEGORIES.includes(req.body.cat) ? req.body.cat : "Other";
  const loc = String(req.body.loc || "").trim() || "—";
  const sev = Math.min(5, Math.max(1, parseInt(req.body.severity, 10) || 3));
  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();
  if (!bizName) return res.status(400).json({ error: "Enter the business or tradesperson name." });
  if (bizName.length>120 || title.length>180 || body.length>10000) return res.status(400).json({error:"Business names must be under 120 characters, headlines under 180 and descriptions under 10,000."});
  if (!title) return res.status(400).json({ error: "Add a short headline." });
  if (body.length < 20) return res.status(400).json({ error: "Describe what happened in at least 20 characters." });

  const slug = bizName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
  let biz = (await db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug));
  if (!biz) {
    (await db.prepare("INSERT OR IGNORE INTO businesses (slug,name,cat,loc,kind) VALUES (?,?,?,?,?)")
      .run(slug, bizName, cat, loc, "Business"));
    biz = (await db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug));
  }
  const publicId = "ZS-" + crypto.randomUUID();
  const authorLabel = req.user.display_name || "Member";
  (await db.prepare(`INSERT INTO complaints (public_id,business_id,user_id,cat,severity,status,title,body,author_label)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(publicId, biz.id, req.user.id, cat, sev, "unresolved", title, body, authorLabel));
  res.json({ ok: true, slug, publicId });
}));

/* right of reply */
app.post("/api/complaints/:publicId/reply", asyncHandler(requireAuth), asyncHandler(async (req, res) => {
  const c = (await db.prepare("SELECT * FROM complaints WHERE public_id = ?").get(req.params.publicId));
  if (!c || c.mod_state === "removed") return res.status(404).json({ error: "No such complaint." });
  const by = String(req.body.by || "").trim();
  const text = String(req.body.text || "").trim();
  if (!by) return res.status(400).json({ error: "Who is responding? Give a business name." });
  if (text.length < 10) return res.status(400).json({ error: "Add a proper response." });
  (await db.prepare("INSERT INTO replies (complaint_id, author_name, body) VALUES (?,?,?)").run(c.id, by, text));
  (await db.prepare("UPDATE complaints SET status = CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'responded' END WHERE id = ?").run(c.id));
  res.json({ ok: true });
}));

/* ---------- API: dispute a complaint (business challenge → moderation) ---------- */
app.post("/api/complaints/:publicId/dispute", asyncHandler(requireAuth), asyncHandler(async (req, res) => {
  const c = (await db.prepare("SELECT * FROM complaints WHERE public_id = ?").get(req.params.publicId));
  if (!c) return res.status(404).json({ error: "No such complaint." });
  if (c.mod_state === "removed") return res.status(409).json({ error: "This complaint has already been removed." });
  const reason = DISPUTE_REASONS.includes(req.body.reason) ? req.body.reason : null;
  const detail = String(req.body.detail || "").trim();
  if (!reason) return res.status(400).json({ error: "Pick a reason for the dispute." });
  if (detail.length < 15) return res.status(400).json({ error: "Explain the dispute in a sentence or two." });
  const openOne = (await db.prepare("SELECT id FROM disputes WHERE complaint_id = ? AND state = 'open'").get(c.id));
  if (openOne) return res.status(409).json({ error: "This complaint is already under review." });
  (await db.prepare("INSERT INTO disputes (complaint_id, raised_by, reason, detail) VALUES (?,?,?,?)")
    .run(c.id, req.user.id, reason, detail));
  (await db.prepare("UPDATE complaints SET mod_state = 'disputed' WHERE id = ?").run(c.id));
  res.json({ ok: true });
}));

/* ---------- API: moderation (moderators only) ---------- */
app.get("/api/moderation/queue", asyncHandler(requireModerator), asyncHandler(async (req, res) => {
  const stateFilter = ["open", "upheld", "rejected"].includes(req.query.state) ? req.query.state : "open";
  const rows = (await db.prepare(`
    SELECT d.id AS disputeId, d.reason, d.detail, d.state, d.resolution, d.moderator_note AS moderatorNote,
           d.created_at AS raisedAt, d.resolved_at AS resolvedAt,
           ru.email AS raisedByEmail, mu.email AS moderatorEmail,
           c.public_id AS complaintId, c.title, c.body, c.severity AS sev, c.status, c.mod_state AS modState,
           c.author_label AS author, c.created_at AS complaintDate,
           b.slug AS biz, b.name AS bizName, b.cat, b.loc
    FROM disputes d
    JOIN complaints c ON c.id = d.complaint_id
    JOIN businesses b ON b.id = c.business_id
    LEFT JOIN users ru ON ru.id = d.raised_by
    LEFT JOIN users mu ON mu.id = d.moderator_id
    WHERE d.state = ?
    ORDER BY d.created_at ASC
  `).all(stateFilter)).map(r => ({
    ...r,
    complaintDate: (r.complaintDate || "").slice(0, 10),
    raisedAt: (r.raisedAt || "").slice(0, 10),
    resolvedAt: r.resolvedAt ? r.resolvedAt.slice(0, 10) : null
  }));
  const counts = {
    open: (await db.prepare("SELECT COUNT(*) n FROM disputes WHERE state='open'").get()).n,
    upheld: (await db.prepare("SELECT COUNT(*) n FROM disputes WHERE state='upheld'").get()).n,
    rejected: (await db.prepare("SELECT COUNT(*) n FROM disputes WHERE state='rejected'").get()).n
  };
  res.json({ disputes: rows, counts });
}));

app.post("/api/moderation/disputes/:id/resolve", asyncHandler(requireModerator), asyncHandler(async (req, res) => {
  const d = (await db.prepare("SELECT * FROM disputes WHERE id = ?").get(req.params.id));
  if (!d) return res.status(404).json({ error: "No such dispute." });
  if (d.state !== "open") return res.status(409).json({ error: "This dispute is already resolved." });
  // action: keep (reject dispute, complaint stays), remove (hide complaint), resolve (mark complaint responded/resolved)
  const action = ["keep", "remove", "resolve"].includes(req.body.action) ? req.body.action : null;
  const note = String(req.body.note || "").trim();
  if (!action) return res.status(400).json({ error: "Choose keep, remove, or resolve." });

  const newDisputeState = action === "keep" ? "rejected" : "upheld";
  let newModState = "published";
  if (action === "remove") newModState = "removed";

  (await db.prepare(`UPDATE disputes
    SET state = ?, resolution = ?, moderator_id = ?, moderator_note = ?, resolved_at = datetime('now')
    WHERE id = ?`).run(newDisputeState, action, req.user.id, note, d.id));
  (await db.prepare("UPDATE complaints SET mod_state = ? WHERE id = ?").run(newModState, d.complaint_id));
  if (action === "resolve") (await db.prepare("UPDATE complaints SET status = CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'responded' END WHERE id = ?").run(d.complaint_id));
  (await db.prepare("INSERT INTO moderation_log (dispute_id, complaint_id, moderator_id, action, note) VALUES (?,?,?,?,?)")
    .run(d.id, d.complaint_id, req.user.id, action, note));
  res.json({ ok: true, action });
}));

/* ---------- API: business dossier ---------- */
app.get("/api/businesses/:slug", asyncHandler(async (req, res) => {
  const me = (await currentUser(req));
  const b = (await db.prepare("SELECT * FROM businesses WHERE slug = ?").get(req.params.slug));
  if (!b) return res.status(404).json({ error: "Business not found." });
  const rows = (await Promise.all((await db.prepare(COMPLAINT_SELECT + " WHERE b.slug = ? AND c.mod_state != 'removed'").all(req.params.slug))
    .map(async r => (await shapeComplaint(r, me && me.id)))))
    .sort((a, z) => z.date.localeCompare(a.date) || z.id.localeCompare(a.id));
  const avg = rows.length ? rows.reduce((s, c) => s + c.sev, 0) / rows.length : 0;
  res.json({
    business: { slug: b.slug, name: b.name, cat: b.cat, loc: b.loc, kind: b.kind },
    complaints: rows,
    stats: {
      total: rows.length,
      unresolved: rows.filter(c => c.status !== "resolved").length,
      ignored: rows.filter(c => c.status === "ignored").length,
      responded: rows.filter(c => c.reply).length,
      avgSeverity: avg
    }
  });
}));

/* ---------- API: downvotes ("back this complaint") ---------- */
app.post("/api/complaints/:publicId/vote", asyncHandler(requireAuth), asyncHandler(async (req, res) => {
  const c = (await db.prepare("SELECT * FROM complaints WHERE public_id = ?").get(req.params.publicId));
  if (!c) return res.status(404).json({ error: "No such complaint." });
  const existing = (await db.prepare("SELECT id FROM votes WHERE complaint_id = ? AND user_id = ?").get(c.id, req.user.id));
  let voted;
  if (existing) { (await db.prepare("DELETE FROM votes WHERE id = ?").run(existing.id)); voted = false; }
  else { (await db.prepare("INSERT OR IGNORE INTO votes (complaint_id, user_id) VALUES (?,?)").run(c.id, req.user.id)); voted = true; }
  const downvotes = (await db.prepare("SELECT COUNT(*) n FROM votes WHERE complaint_id = ?").get(c.id)).n;
  res.json({ ok: true, voted, downvotes });
}));

/* ---------- API: comments (threaded, one level of replies) ---------- */
app.get("/api/complaints/:publicId/comments", asyncHandler(async (req, res) => {
  const c = (await db.prepare("SELECT * FROM complaints WHERE public_id = ?").get(req.params.publicId));
  if (!c) return res.status(404).json({ error: "No such complaint." });
  const rows = (await db.prepare(
    "SELECT id, parent_id, user_id AS authorId, author_label AS author, body, created_at FROM comments WHERE complaint_id = ? ORDER BY created_at ASC"
  ).all(c.id));
  const nodes = {};
  rows.forEach(r => { nodes[r.id] = { id: r.id, author: r.author, authorId: r.authorId || null, body: r.body, date: (r.created_at || "").slice(0, 10), replies: [] }; });
  const top = [];
  rows.forEach(r => {
    const n = nodes[r.id];
    if (r.parent_id && nodes[r.parent_id]) nodes[r.parent_id].replies.push(n);
    else top.push(n);
  });
  res.json({ comments: top, count: rows.length });
}));

app.post("/api/complaints/:publicId/comments", asyncHandler(requireAuth), asyncHandler(async (req, res) => {
  const c = (await db.prepare("SELECT * FROM complaints WHERE public_id = ?").get(req.params.publicId));
  if (!c) return res.status(404).json({ error: "No such complaint." });
  const body = String(req.body.body || "").trim();
  if (body.length < 2) return res.status(400).json({ error: "Say something first." });
  if (body.length > 2000) return res.status(400).json({ error: "Keep it under 2000 characters." });
  let parentId = req.body.parentId ? parseInt(req.body.parentId, 10) : null;
  if (parentId) {
    const parent = (await db.prepare("SELECT id, parent_id FROM comments WHERE id = ? AND complaint_id = ?").get(parentId, c.id));
    if (!parent) return res.status(400).json({ error: "That comment no longer exists." });
    parentId = parent.parent_id || parent.id; // keep threads one level deep
  }
  const label = req.user.display_name || "Member";
  (await db.prepare("INSERT INTO comments (complaint_id, user_id, parent_id, author_label, body) VALUES (?,?,?,?,?)")
    .run(c.id, req.user.id, parentId, label, body));
  res.json({ ok: true });
}));

/* ---------- API: user profiles ---------- */
app.get("/api/users/:id", asyncHandler(async (req, res) => {
  const me = (await currentUser(req));
  const u = (await db.prepare("SELECT id, email, display_name, is_moderator, created_at FROM users WHERE id = ?").get(req.params.id));
  if (!u) return res.status(404).json({ error: "No such user." });
  const handle = u.display_name || "Member";
  const filed = (await Promise.all((await db.prepare(COMPLAINT_SELECT + " WHERE c.user_id = ? AND c.mod_state != 'removed'")
    .all(u.id)).map(async r => (await shapeComplaint(r, me && me.id)))))
    .sort((a, z) => z.date.localeCompare(a.date) || z.id.localeCompare(a.id));
  const backed = (await Promise.all((await db.prepare(COMPLAINT_SELECT + " JOIN votes v ON v.complaint_id = c.id WHERE v.user_id = ? AND c.mod_state != 'removed'")
    .all(u.id)).map(async r => (await shapeComplaint(r, me && me.id)))))
    .sort((a, z) => (z.downvotes - a.downvotes) || z.date.localeCompare(a.date));
  const comments = (await db.prepare("SELECT COUNT(*) n FROM comments WHERE user_id = ?").get(u.id)).n;
  const isMe = !!(me && me.id === u.id);
  res.json({
    user: { id: u.id, handle, joined: (u.created_at || "").slice(0, 10), isModerator: !!u.is_moderator, isMe, email: isMe ? u.email : undefined },
    filed, backed,
    stats: { filed: filed.length, backed: backed.length, comments }
  });
}));

/* ---------- health check ---------- */
app.get("/healthz", asyncHandler(async (req, res) => {
  await db.prepare("SELECT 1 AS ready").get();
  res.json({ ok: true, ts: Date.now() });
}));

/* ---------- static front end ---------- */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === "23505") return res.status(409).json({ error: "That entry already exists." });
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
  console.error("Request failed:", error.code || "INTERNAL_ERROR");
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;
if (!process.env.VERCEL && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(PORT, "0.0.0.0", () => console.log(`Zero Stars running on port ${PORT}`));
}
