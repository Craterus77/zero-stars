-- Public identities are independent of private email addresses.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT 'Member';
-- Store only hashes of high-entropy, single-use recovery codes.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_hash TEXT;
