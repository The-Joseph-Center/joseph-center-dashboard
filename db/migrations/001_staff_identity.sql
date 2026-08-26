-- Links an Okta account to the Sanity staff card it owns.
--
-- This lives in Turso rather than as a field on the staff document because the
-- Sanity dataset is publicly readable — the frontend queries it from the browser
-- with no token. Putting login addresses there would make them harvestable,
-- which defeats the point: the whole reason this table exists is that the
-- public `email` field is unreliable, partly because some staff deliberately
-- keep their address off the site.
--
-- The public `email` field cannot be the identity key. kisaacs@ appears on both
-- Mona's and Khira's cards (Mona's public contact routes to her assistant), so
-- matching on it would serve Khira the Executive Director's card to edit and
-- leave Mona unable to reach her own.
--
-- The mapping is derived, not authored: scripts/sync-staff-identity.ts can
-- rebuild it from Okta plus Sanity at any time, so moving it elsewhere later is
-- cheap.

CREATE TABLE IF NOT EXISTS staff_identity (
  sanity_staff_id TEXT PRIMARY KEY,
  okta_login      TEXT NOT NULL,
  okta_user_id    TEXT NOT NULL,
  -- 'email' | 'first-name' | 'manual' — how the link was established, so a
  -- weaker match can be reviewed later.
  matched_by      TEXT NOT NULL,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Structural guarantee against the collision above: one Okta account can own at
-- most one staff card. A bad match fails the write instead of silently granting
-- someone edit rights over a colleague's record.
CREATE UNIQUE INDEX IF NOT EXISTS staff_identity_okta_login_idx
  ON staff_identity(okta_login);
