# Zero Stars — full-stack prototype

A complaints-only public register. Node + Express API, Supabase Postgres on Vercel and built-in `node:sqlite` locally,
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
- Hosted deployments use Supabase Postgres behind Vercel HTTPS; local development can
  continue with SQLite using the same API surface.

## Deploy to Vercel with Supabase

Vercel runs the Express backend through `api/index.js`. The frontend remains in
`public/`. Hosted deployments require Supabase Postgres; local SQLite files are
not used on Vercel. Node 24 is pinned in `engines` and `.nvmrc`.

1. Create a dedicated Supabase project. In **Connect**, copy the **transaction
   pooler** Postgres connection string (usually port 6543). Replace the password
   placeholder with the project's database password, URL-encoding special
   characters. This is a database connection string, not a Supabase API key.
2. Import this repository into Vercel. Choose **Other** as the framework, use
   Node 24, and leave build/routing settings to `vercel.json`. Do not set
   `DATABASE_URL` in frontend code or use a public-prefixed variable name.
3. If the Supabase integration already supplies **POSTGRES_URL** or
   **SUPABASE_DB_URL**, the backend accepts either. Otherwise set **DATABASE_URL** securely in Vercel's server environment variables for
   Production (and Preview only if those deployments should use that database).
   Prefer a separate Supabase project for previews to isolate preview writes.
   If the connection requires the project's CA certificate, download its PEM
   from Supabase's database SSL settings and set **SUPABASE_CA_CERT** to the PEM
   contents. Certificate verification stays enabled.
4. The schema is in `supabase/migrations/20261003000000_zero_stars.sql`.
   If Supabase GitHub branching is configured to deploy migrations, confirm that
   this migration succeeds for the database used by Vercel. Simply connecting
   GitHub does not guarantee migration deployment. Alternatively, run the file
   in Supabase's SQL Editor, or initialize once from a trusted terminal with the same
   `DATABASE_URL` (and CA when needed) securely injected:
   ```bash
   npm ci
   npm run db:setup
   ```
   This creates the tables and indexes without demo data or demo accounts. It is
   repeatable. Do this before deploying; schema changes never run automatically
   on serverless cold starts. An existing local SQLite database is not copied to
   Supabase by this command; existing records need a separate data migration.
5. Set **MOD_EMAILS** to your moderator email(s), comma-separated. Register or
   sign in with that address after deployment to receive moderator access.
6. Deploy/redeploy in Vercel. Check `/healthz` for `{ "ok": true }`, open the
   frontend, then register and file a complaint. Confirm the complaint and login
   persist across another deployment. A new hosted database starts with an empty
   register; `/api/meta` will report zero complaints until one is filed.

The existing application's email/password and session authentication stays in
place; Supabase supplies Postgres storage, not Supabase Auth. The backend uses
its trusted database role. Row level security is enabled on all application
tables with no public Data API policies, so browser clients cannot read password
hashes or session tokens using Supabase's anonymous key. Never expose the
connection string, database password, or a service-role key in the browser.

Supabase's Next.js quickstart helpers (`next/headers`, Server Components, and
Next.js middleware) do not apply to this Express app. The Supabase JS and SSR
packages are available, but the current backend uses `pg` and its own session
cookies. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
identify the public Data API project; they cannot replace `DATABASE_URL` or
authorize the backend's database queries. Express does not automatically load
`.env.local`; inject the database connection string into the server process or
Vercel environment settings. Local SQLite remains the default until it is set.

For a disposable demonstration project only, `npm run db:demo` adds the fictional
sample data and documented demo accounts. Do not run it against a real deployment.
`npm run seed` resets local SQLite sample complaints/businesses and is blocked
for hosted Postgres. Vercel deployments never seed automatically.

### Development and validation

Without `DATABASE_URL`, `npm start` retains the local SQLite workflow. With
`DATABASE_URL`, it uses the initialized Supabase database. `DB_PATH` and
`DATA_DIR` apply only to SQLite. Local development does not require Supabase
credentials.

```bash
npm run check
npm test                         # isolated SQLite integration tests
# Set TEST_DATABASE_URL securely to a disposable Postgres database, then:
npm test                         # isolated Postgres integration tests
```

When `TEST_DATABASE_URL` is set, the suite creates and drops a unique schema;
the test role must have permission to create schemas. It never inherits the
application's `DATABASE_URL` or writes to existing application tables. Do not
provide a production database as a test target. For local validation, a Postgres
server on loopback can use non-TLS connections; hosted connections always verify
TLS certificates. Neither tests nor deployments require a compilation step.

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
- Local SQLite (or an explicitly seeded disposable hosted demo) has a moderator: **`moderator@zerostars.test` / `zerostars-mod`** (local prototype
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
