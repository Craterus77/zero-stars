// Smoke / integration test — boots the real server against a throwaway DB and
// exercises the API surface end to end. Runs under Node's built-in test runner:
//   node --test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.TEST_PORT || "4399";
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let dataDir;

function waitFor(url, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error("server did not start in time"));
      setTimeout(poll, 150);
    })();
  });
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "zerostars-test-"));
  server = spawn(process.execPath, ["--no-warnings", "server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT, DATA_DIR: dataDir },
    stdio: "ignore"
  });
  await waitFor(`${BASE}/healthz`);
});

after(() => {
  if (server) server.kill();
  if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }
});

test("health check responds", async () => {
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
});

test("meta returns seeded register stats", async () => {
  const j = await (await fetch(`${BASE}/api/meta`)).json();
  assert.ok(j.total > 0, "expected seeded complaints");
  assert.ok(j.businesses > 0, "expected seeded businesses");
  assert.ok(Array.isArray(j.categories) && j.categories.length > 0);
});

test("complaints list and filters work", async () => {
  const all = await (await fetch(`${BASE}/api/complaints`)).json();
  assert.ok(all.complaints.length > 0);
  const filtered = await (await fetch(`${BASE}/api/complaints?status=responded`)).json();
  assert.ok(filtered.complaints.every(c => c.status === "responded"));
});

test("filing a complaint requires auth", async () => {
  const r = await fetch(`${BASE}/api/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business: "X", title: "y", body: "z".repeat(25) })
  });
  assert.equal(r.status, 401);
});

test("register → file complaint → appears on business dossier", async () => {
  // register (captures session cookie)
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ci@zerostars.test", password: "ci-pass-123" })
  });
  assert.equal(reg.status, 200);
  const cookie = (reg.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  assert.ok(cookie.includes("zs_session="), "expected a session cookie");

  // file a complaint
  const file = await fetch(`${BASE}/api/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      business: "CI Test Co",
      cat: "Other",
      loc: "Sydney, NSW",
      severity: 4,
      title: "Automated test complaint",
      body: "This complaint is filed by the CI smoke test to prove persistence."
    })
  });
  assert.equal(file.status, 200);
  const { slug, publicId } = await file.json();
  assert.ok(slug && publicId);

  // it should show up on the dossier
  const dossier = await (await fetch(`${BASE}/api/businesses/${slug}`)).json();
  assert.equal(dossier.business.slug, slug);
  assert.ok(dossier.complaints.some(c => c.id === publicId));
  assert.equal(dossier.stats.total, 1);
});

/* ---------- moderation / disputes ---------- */
function cookieOf(res) {
  return (res.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
}
async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return { res: r, body: await r.json(), cookie: cookieOf(r) };
}

test("seeded moderator can read the queue; non-moderators cannot", async () => {
  const mod = await login("moderator@zerostars.test", "zerostars-mod");
  assert.equal(mod.res.status, 200);
  assert.equal(mod.body.user.isModerator, true);

  const q = await fetch(`${BASE}/api/moderation/queue`, { headers: { Cookie: mod.cookie } });
  assert.equal(q.status, 200);
  const { counts } = await q.json();
  assert.ok(counts.open >= 1, "expected the seeded open dispute");

  // a plain registered user is forbidden
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nonmod@zerostars.test", password: "nonmod-123" })
  });
  const forbidden = await fetch(`${BASE}/api/moderation/queue`, { headers: { Cookie: cookieOf(reg) } });
  assert.equal(forbidden.status, 403);
});

test("dispute → moderator remove hides the complaint from public view", async () => {
  // a user disputes an existing seed complaint
  const user = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "disputer@zerostars.test", password: "disp-1234" })
  });
  const userCookie = cookieOf(user);
  const disp = await fetch(`${BASE}/api/complaints/ZS-0912/dispute`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: userCookie },
    body: JSON.stringify({ reason: "Factually inaccurate", detail: "We have documentary proof the clause was disclosed." })
  });
  assert.equal(disp.status, 200);

  // it now shows as disputed publicly
  let list = await (await fetch(`${BASE}/api/complaints`)).json();
  const disputed = list.complaints.find(c => c.id === "ZS-0912");
  assert.equal(disputed.modState, "disputed");

  // moderator finds that dispute and removes the complaint
  const mod = await login("moderator@zerostars.test", "zerostars-mod");
  const queue = await (await fetch(`${BASE}/api/moderation/queue`, { headers: { Cookie: mod.cookie } })).json();
  const target = queue.disputes.find(d => d.complaintId === "ZS-0912");
  assert.ok(target, "dispute should be in the open queue");
  const resolve = await fetch(`${BASE}/api/moderation/disputes/${target.disputeId}/resolve`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: mod.cookie },
    body: JSON.stringify({ action: "remove", note: "Removed pending evidence." })
  });
  assert.equal(resolve.status, 200);

  // gone from public listing
  list = await (await fetch(`${BASE}/api/complaints`)).json();
  assert.ok(!list.complaints.some(c => c.id === "ZS-0912"), "removed complaint must not be public");
});

/* ---------- social: downvotes + comments ---------- */
test("downvote toggles on and off and updates the count", async () => {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "voter@zerostars.test", password: "voter-123" })
  });
  const cookie = cookieOf(reg);
  const before = (await (await fetch(`${BASE}/api/complaints`)).json()).complaints.find(c => c.id === "ZS-1017").downvotes;

  const on = await (await fetch(`${BASE}/api/complaints/ZS-1017/vote`, { method: "POST", headers: { Cookie: cookie } })).json();
  assert.equal(on.voted, true);
  assert.equal(on.downvotes, before + 1);

  const off = await (await fetch(`${BASE}/api/complaints/ZS-1017/vote`, { method: "POST", headers: { Cookie: cookie } })).json();
  assert.equal(off.voted, false);
  assert.equal(off.downvotes, before);
});

test("voting requires auth", async () => {
  const r = await fetch(`${BASE}/api/complaints/ZS-1017/vote`, { method: "POST" });
  assert.equal(r.status, 401);
});

test("comment and threaded reply post and read back", async () => {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "commenter@zerostars.test", password: "comm-123" })
  });
  const cookie = cookieOf(reg);

  const top = await fetch(`${BASE}/api/complaints/ZS-1017/comments`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ body: "Happened to me too — chasing them for weeks." })
  });
  assert.equal(top.status, 200);

  // find the comment id we just made
  let tree = await (await fetch(`${BASE}/api/complaints/ZS-1017/comments`)).json();
  const mine = tree.comments.find(c => c.body.startsWith("Happened to me too"));
  assert.ok(mine, "top-level comment should appear");

  const reply = await fetch(`${BASE}/api/complaints/ZS-1017/comments`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ body: "Same here, lodge it with fair trading.", parentId: mine.id })
  });
  assert.equal(reply.status, 200);

  tree = await (await fetch(`${BASE}/api/complaints/ZS-1017/comments`)).json();
  const parent = tree.comments.find(c => c.id === mine.id);
  assert.ok(parent.replies.some(r => r.body.startsWith("Same here")), "reply should nest under its parent");
});

/* ---------- user profiles ---------- */
test("profile shows what a user filed and backed", async () => {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "profiler@zerostars.test", password: "prof-1234" })
  });
  const body = await reg.json();
  const uid = body.user.id;
  assert.ok(uid, "register should return a user id");
  const cookie = cookieOf(reg);

  // file a complaint
  const file = await (await fetch(`${BASE}/api/complaints`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ business: "Profile Test Co", cat: "Other", loc: "Perth, WA", severity: 3, title: "Profile smoke complaint", body: "Filed by the profile smoke test to verify the profile page." })
  })).json();

  // back an existing seed complaint
  await fetch(`${BASE}/api/complaints/ZS-0994/vote`, { method: "POST", headers: { Cookie: cookie } });

  const prof = await (await fetch(`${BASE}/api/users/${uid}`, { headers: { Cookie: cookie } })).json();
  assert.equal(prof.user.id, uid);
  assert.equal(prof.user.isMe, true);
  assert.ok(prof.filed.some(c => c.id === file.publicId), "filed list should include the new complaint");
  assert.ok(prof.backed.some(c => c.id === "ZS-0994"), "backed list should include the voted complaint");
  assert.equal(prof.stats.filed, 1);
  assert.ok(prof.stats.backed >= 1);
  // the filed complaint should expose authorId for linking
  const listed = (await (await fetch(`${BASE}/api/complaints`)).json()).complaints.find(c => c.id === file.publicId);
  assert.equal(listed.authorId, uid);
});
