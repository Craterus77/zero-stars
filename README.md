# Zero Stars — full-stack prototype

A complaints-only public register. Node + Express API, built-in `node:sqlite` database,
real password-hashed accounts and session cookies, and the same front-end design as the
static prototype (now fetching from the API).

## Run it

```bash
npm install      # once
npm start        # serves http://localhost:4317
```

The database (`zerostars.db`) and seed data are created automatically on first start.

- `npm run seed` re-seeds with `--reseed` (wipes complaints/businesses, re-inserts the samples).
- Delete `zerostars.db*` for a completely fresh start (also clears accounts).

## What's real here (vs the static prototype)

| Concern        | Implementation                                                        |
|----------------|-----------------------------------------------------------------------|
| Database       | SQLite via `node:sqlite` — `users`, `sessions`, `businesses`, `complaints`, `replies` |
| Auth           | Register / login with email + password; scrypt-hashed, `timingSafeEqual` check |
| Sessions       | Random token in an `HttpOnly; SameSite=Lax` cookie                     |
| Persistence    | Filed complaints and business replies are written to the DB and survive restarts |
| Authorization  | Filing a complaint / posting a reply requires a valid session (401 otherwise) |
| Right of reply | `POST /api/complaints/:id/reply` adds a response and flips the case to `responded` |

## API

| Method | Path                              | Auth | Purpose                          |
|--------|-----------------------------------|------|----------------------------------|
| GET    | `/api/meta`                       | —    | Categories + register-wide stats |
| POST   | `/api/auth/register`              | —    | Create account, start session    |
| POST   | `/api/auth/login`                 | —    | Sign in                          |
| POST   | `/api/auth/logout`                | ✓    | End session                      |
| GET    | `/api/auth/me`                    | —    | Current user (or null)           |
| GET    | `/api/complaints?q=&cat=&status=&sort=` | — | Search / filter / sort the feed |
| POST   | `/api/complaints`                 | ✓    | File a complaint                 |
| POST   | `/api/complaints/:publicId/reply` | ✓    | Business right of reply          |
| GET    | `/api/businesses/:slug`           | —    | Dossier: business + complaints + stats |

## Notes / next steps

- All seeded businesses, complaints and responses are **fictional**, for demonstration only.
- Prototype scope: "respond as the business" is open to any signed-in user. Production would
  verify ownership of a listing before allowing a reply, and add a moderation/dispute workflow.
- No email is actually sent; there is no password reset flow yet.
- To make it shareable/deployable, swap `node:sqlite` for hosted Postgres (e.g. Supabase) and
  put it behind HTTPS; the API surface stays the same.

## Deploy to Railway

The repo is prepped for Railway (Nixpacks). Config lives in `railway.json`,
Node is pinned to 24 (`engines` + `.nvmrc`), the server binds `0.0.0.0` and
respects `PORT`, and there's a `/healthz` endpoint for the health check.

**Steps**
1. Push this repo to GitHub.
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo →** pick `zero-stars`.
3. Railway auto-detects Node 24, runs `npm install`, then `npm start`. It assigns a
   public URL under **Settings → Networking → Generate Domain**.

**Make the data persist (optional but recommended)**
By default the SQLite file lives on the container's ephemeral disk, so it resets to
seed data on every redeploy/restart. To keep data:
1. Add a **Volume** to the service (e.g. mounted at `/data`).
2. Set an env var so the DB is written there:
   - `DATA_DIR=/data`  (or `DB_PATH=/data/zerostars.db`)

`db.js` reads `DB_PATH` / `DATA_DIR` and falls back to the app folder locally.

**Note on scale:** `node:sqlite` is single-writer and file-based — perfect for a
prototype and light testing. For real traffic or multiple instances, move to hosted
Postgres; the API surface stays the same.

## Moderation & disputes

Businesses can challenge a complaint, and moderators adjudicate — the safeguard against
false or defamatory entries.

**Flow**
1. Any signed-in user clicks **Dispute this complaint**, picks a ground (factually inaccurate,
   already resolved, not a genuine customer, abusive/defamatory, duplicate/spam, other) and
   explains. The complaint is flagged **Disputed — under review** publicly and queued.
2. A **moderator** opens the **Moderation queue** (nav button with an open-count badge) and, per
   dispute, chooses:
   - **Keep** — rejects the dispute; the complaint stays public.
   - **Remove** — hides the complaint from the register (soft delete; row and audit trail kept).
   - **Resolve** — keeps it but marks it answered.
   Every decision is written to `moderation_log` with the moderator and an optional note.

**Being a moderator**
- A demo moderator is seeded: **`moderator@zerostars.test` / `zerostars-mod`** (local prototype
  credentials — change before any real use).
- Promote real accounts by setting `MOD_EMAILS` (comma-separated) and signing in, e.g.
  `MOD_EMAILS="you@example.com"`.

**API**
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/complaints/:publicId/dispute` | user | Raise a dispute (flags complaint) |
| GET  | `/api/moderation/queue?state=open\|upheld\|rejected` | moderator | Review disputes + counts |
| POST | `/api/moderation/disputes/:id/resolve` | moderator | `{action: keep\|remove\|resolve, note}` |

Removed complaints are excluded from all public endpoints (`/api/complaints`, dossiers, `/api/meta`).
