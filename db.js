// Zero Stars — data layer (built-in node:sqlite, no native deps)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB location is configurable so a Railway (or any host) persistent volume can
// hold the data: set DB_PATH to a full path, or DATA_DIR to a mounted directory.
// Falls back to the app folder for local dev.
const DB_PATH = process.env.DB_PATH
  ? process.env.DB_PATH
  : path.join(process.env.DATA_DIR || __dirname, "zerostars.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const CATEGORIES = [
  "Trades & Construction", "Retail", "Warranty & Insurance",
  "Customer Service", "Professional Services", "Other"
];

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cat TEXT NOT NULL,
      loc TEXT NOT NULL DEFAULT '—',
      kind TEXT NOT NULL DEFAULT 'Business',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY,
      public_id TEXT UNIQUE NOT NULL,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cat TEXT NOT NULL,
      severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
      status TEXT NOT NULL DEFAULT 'unresolved',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_label TEXT NOT NULL DEFAULT 'Registered submitter',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY,
      complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_complaints_biz ON complaints(business_id);
    CREATE INDEX IF NOT EXISTS idx_replies_complaint ON replies(complaint_id);
  `);
}

const SEED_BUSINESSES = [
  { slug: "brightpath-builders", name: "Brightpath Builders", cat: "Trades & Construction", loc: "Sydney, NSW", kind: "Building contractor" },
  { slug: "nimbus-broadband", name: "Nimbus Broadband", cat: "Customer Service", loc: "National, AU", kind: "Internet provider" },
  { slug: "kettle-crumb", name: "Kettle & Crumb Appliances", cat: "Retail", loc: "Melbourne, VIC", kind: "Appliance retailer" },
  { slug: "meridian-cover", name: "Meridian Home Cover", cat: "Warranty & Insurance", loc: "Brisbane, QLD", kind: "Home insurer" },
  { slug: "vale-rowan", name: "Vale & Rowan Solicitors", cat: "Professional Services", loc: "Perth, WA", kind: "Conveyancing firm" },
  { slug: "coastline-movers", name: "Coastline Movers", cat: "Other", loc: "Gold Coast, QLD", kind: "Removals company" },
  { slug: "pixelforge", name: "PixelForge Electronics", cat: "Retail", loc: "Online, AU", kind: "Electronics retailer" },
  { slug: "fjord-motors", name: "Fjord Motors", cat: "Other", loc: "Adelaide, SA", kind: "Car manufacturer" }
];

const SEED_COMPLAINTS = [
  { pid: "ZS-1042", biz: "brightpath-builders", sev: 5, status: "unresolved", author: "Homeowner, Sydney", date: "2026-08-19",
    title: "$240k extension abandoned at first-fix, six months on",
    body: "Paid 70% up front against the schedule. Work stopped in February with the roof open and no watertight cover. Every call for a completion date goes unanswered; the site manager's number is disconnected. I now have water damage to the original structure and no written explanation.",
    reply: null },
  { pid: "ZS-1039", biz: "brightpath-builders", sev: 4, status: "responded", author: "Verified customer", date: "2026-07-30",
    title: "Snagging list ignored past the retention deadline",
    body: "Handover was March. The agreed snagging list — cracked render, two doors that won't close, a leaking ensuite — is still open. The retention was released and now nobody will book the remedial visit.",
    reply: { by: "Brightpath Builders", date: "2026-08-04", text: "We've logged this and a site supervisor will contact you this week to schedule the outstanding items. We apologise for the delay caused by staffing changes over the summer." } },
  { pid: "ZS-1017", biz: "brightpath-builders", sev: 4, status: "ignored", author: "Homeowner, Newcastle NSW", date: "2026-06-11",
    title: "Deposit taken for a job that never started",
    body: "Handed over a $3,500 deposit in April for a garage conversion. Start date came and went three times. No materials ordered, no permit applied for. Emails now bounce.",
    reply: null },

  { pid: "ZS-0994", biz: "nimbus-broadband", sev: 3, status: "ignored", author: "Account holder", date: "2026-08-22",
    title: "Charged for 900Mb, delivered 40Mb, four engineers no-show",
    body: "Sold a gigabit package. Actual line speed has never exceeded 40Mb. Four engineer visits were booked; nobody arrived on any of them. Support closes the ticket each time without contacting me and the credit I was promised never appeared.",
    reply: null },
  { pid: "ZS-0981", biz: "nimbus-broadband", sev: 4, status: "responded", author: "Small business owner", date: "2026-08-02",
    title: "Cancelled my business line by mistake — 9 days offline",
    body: "They cancelled the wrong account during a house-move transfer. My card terminal and phones were dead for nine trading days. I've spent 14 hours on hold across two weeks and still have no reconnection date.",
    reply: { by: "Nimbus Broadband", date: "2026-08-06", text: "This was a provisioning error on our side. A priority reconnection is in progress and a goodwill credit will be applied. A named case handler will stay with your account until it is resolved." } },

  { pid: "ZS-0955", biz: "kettle-crumb", sev: 2, status: "ignored", author: "Customer", date: "2026-08-14",
    title: "Warranty refused on a 5-month-old dishwasher",
    body: "The dishwasher failed at five months. They claim 'misuse' with no inspection and no evidence, and won't escalate. I've supplied the receipt and photos three times.",
    reply: null },
  { pid: "ZS-0940", biz: "kettle-crumb", sev: 3, status: "unresolved", author: "Verified customer", date: "2026-07-21",
    title: "Refund promised in writing, withheld for 11 weeks",
    body: "Returned a faulty oven under the 30-day right. Refund was confirmed by email on 6 May. It's now late July, the money has not arrived, and each chat agent tells me to 'allow 5 working days'.",
    reply: null },

  { pid: "ZS-0912", biz: "meridian-cover", sev: 5, status: "unresolved", author: "Policyholder", date: "2026-08-25",
    title: "Escape-of-water claim denied on a clause never disclosed",
    body: "A burst pipe caused $18k of damage. The claim was denied citing a maintenance exclusion that isn't in the policy summary I was sold. The loss adjuster stopped responding after the first visit and the complaints line loops back to the same denial letter.",
    reply: null },
  { pid: "ZS-0907", biz: "meridian-cover", sev: 3, status: "responded", author: "Customer", date: "2026-07-09",
    title: "Auto-renewed at double the price with no notice",
    body: "Renewed automatically at 214% of last year's premium. No renewal notice ever arrived by post or email, and they refused to honour the cheaper quote still live on their own site that day.",
    reply: { by: "Meridian Home Cover", date: "2026-07-15", text: "We've reviewed the renewal notice delivery and can see it did not reach you. We've cancelled the renewal, refunded the difference, and are correcting the contact record. Thank you for flagging it." } },

  { pid: "ZS-0888", biz: "vale-rowan", sev: 4, status: "ignored", author: "House buyer", date: "2026-08-05",
    title: "Missed exchange deadline, then went silent for 3 weeks",
    body: "Our conveyancer missed the agreed exchange date, which collapsed the chain. Since then, no call has been returned and the client portal shows 'awaiting solicitor' with no movement. We may lose the property and our mortgage offer.",
    reply: null },

  { pid: "ZS-0864", biz: "coastline-movers", sev: 3, status: "unresolved", author: "Customer", date: "2026-07-28",
    title: "Damaged half the load, claim form is a dead link",
    body: "Two wardrobes and a dresser arrived broken. The 'damage claim' link in their confirmation email 404s, the office voicemail is full, and the WhatsApp number was blocked after I sent photos.",
    reply: null },

  { pid: "ZS-0831", biz: "pixelforge", sev: 2, status: "responded", author: "Verified customer", date: "2026-08-11",
    title: "Sent the wrong laptop, then charged a restocking fee to fix it",
    body: "Ordered a 16GB model, received an 8GB one. To correct their own mistake they wanted a 15% restocking fee and two weeks without a machine I'd already paid for.",
    reply: { by: "PixelForge Electronics", date: "2026-08-13", text: "You're right — a restocking fee should never apply to a mis-ship on our part. We've waived it, arranged a free collection, and dispatched the correct unit today. We're sorry for the hassle." } },
  { pid: "ZS-0820", biz: "pixelforge", sev: 3, status: "ignored", author: "Customer", date: "2026-06-30",
    title: "'Next-day' order arrived in 3 weeks, support bot won't escalate",
    body: "Paid for next-day delivery. It took 22 days. Every attempt to reach a human loops back to a chatbot that closes the conversation, and the delivery fee refund was declined automatically.",
    reply: null },

  { pid: "ZS-0788", biz: "fjord-motors", sev: 5, status: "ignored", author: "Owner, verified purchase", date: "2026-08-16",
    title: "New SUV with a string of faults from week one — dealer keeps sending it back 'no fault found'",
    body: "A $52,000 SUV, three months old, with a running list of faults: a transmission that shudders between gears, driver-assist that brakes for nothing on an empty road, water pooling in the passenger footwell, and a dashboard that resets itself while driving. Four dealer visits, four 'no fault found' reports, and now they say it's out of goodwill. The vehicle isn't safe and nobody at Fjord will escalate it.",
    reply: null },
  { pid: "ZS-0781", biz: "fjord-motors", sev: 4, status: "unresolved", author: "Fleet buyer", date: "2026-07-19",
    title: "Open safety recall, parts 'on back-order' for five months while the fault continues",
    body: "Two vehicles under an open safety recall for a faulty fuel-level sensor. Fjord confirmed the recall in writing, but the parts have been 'on back-order' for five months. We're told to keep driving them in the meantime — no loaner, no timeline, no escalation path.",
    reply: null }
];

export function seed({ force = false } = {}) {
  migrate();
  const count = db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n;
  if (count > 0 && !force) return;
  if (force) {
    db.exec("DELETE FROM replies; DELETE FROM complaints; DELETE FROM businesses;");
  }
  const insBiz = db.prepare("INSERT OR IGNORE INTO businesses (slug,name,cat,loc,kind) VALUES (?,?,?,?,?)");
  const bizId = {};
  for (const b of SEED_BUSINESSES) {
    insBiz.run(b.slug, b.name, b.cat, b.loc, b.kind);
    bizId[b.slug] = db.prepare("SELECT id FROM businesses WHERE slug=?").get(b.slug).id;
  }
  const insC = db.prepare(`INSERT INTO complaints
    (public_id,business_id,cat,severity,status,title,body,author_label,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insR = db.prepare("INSERT INTO replies (complaint_id,author_name,body,created_at) VALUES (?,?,?,?)");
  for (const c of SEED_COMPLAINTS) {
    const bcat = SEED_BUSINESSES.find(b => b.slug === c.biz).cat;
    const r = insC.run(c.pid, bizId[c.biz], bcat, c.sev, c.status, c.title, c.body, c.author, c.date + " 09:00:00");
    if (c.reply) insR.run(r.lastInsertRowid, c.reply.by, c.reply.text, c.reply.date + " 10:00:00");
  }
  console.log(`Seeded ${SEED_BUSINESSES.length} businesses and ${SEED_COMPLAINTS.length} complaints.`);
}

// CLI: `node db.js --reseed`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed({ force: process.argv.includes("--reseed") });
  console.log("DB ready at", DB_PATH);
}
