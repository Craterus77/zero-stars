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
