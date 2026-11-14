CREATE TABLE courier_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT NOT NULL DEFAULT 'bicycle',
  city TEXT NOT NULL DEFAULT 'Toshkent',
  online INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE courier_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES courier_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX courier_sessions_expiry ON courier_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE courier_invites (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE courier_memberships (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  courier_id TEXT NOT NULL REFERENCES courier_accounts(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (business_id, courier_id)
);
--> statement-breakpoint
CREATE INDEX courier_memberships_account ON courier_memberships(courier_id);
--> statement-breakpoint
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  order_id INTEGER NOT NULL,
  courier_id TEXT REFERENCES courier_accounts(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','accepted','picked_up','delivered','cancelled')),
  fee INTEGER NOT NULL CHECK(fee>=0),
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  picked_up_at INTEGER,
  delivered_at INTEGER,
  last_issue TEXT NOT NULL DEFAULT '',
  UNIQUE (business_id, order_id)
);
--> statement-breakpoint
CREATE INDEX deliveries_courier_status ON deliveries(courier_id,status);
--> statement-breakpoint
CREATE INDEX deliveries_business_status ON deliveries(business_id,status);
