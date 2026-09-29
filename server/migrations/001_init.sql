-- TripFund initial schema
-- All money columns are BIGINT in the currency's minor unit (paise, cents, øre).
-- Every financial record carries trip_id, and composite foreign keys make sure
-- that every member it points to belongs to the SAME trip.

-- ---------------------------------------------------------------------------
-- Users and sessions
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email         text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  csrf_token   text NOT NULL,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Currencies
-- ---------------------------------------------------------------------------
CREATE TABLE currencies (
  code        char(3) PRIMARY KEY,
  symbol      text NOT NULL,
  name        text NOT NULL,
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4)
);
INSERT INTO currencies (code, symbol, name, minor_units) VALUES
  ('INR', '₹', 'Indian Rupee', 2),
  ('USD', '$', 'US Dollar', 2),
  ('EUR', '€', 'Euro', 2),
  ('GBP', '£', 'British Pound', 2),
  ('DKK', 'kr', 'Danish Krone', 2),
  ('AED', 'د.إ', 'UAE Dirham', 2);

-- ---------------------------------------------------------------------------
-- Trips and members
-- ---------------------------------------------------------------------------
CREATE TABLE trips (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by            uuid NOT NULL REFERENCES users (id),
  name                  text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  destination           text CHECK (length(destination) <= 120),
  description           text CHECK (length(description) <= 2000),
  start_date            date,
  end_date              date,
  currency              char(3) NOT NULL REFERENCES currencies (code),
  fund_holder_member_id uuid,
  -- 'own'  : members may edit/delete records they created
  -- 'none' : only owners may edit/delete records
  member_edit_policy    text NOT NULL DEFAULT 'own' CHECK (member_edit_policy IN ('own', 'none')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE trip_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  name       text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email      text CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  joined_on  date,
  left_on    date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, id),
  CHECK (left_on IS NULL OR joined_on IS NULL OR left_on >= joined_on)
);
CREATE UNIQUE INDEX trip_members_name_key ON trip_members (trip_id, lower(name));
CREATE UNIQUE INDEX trip_members_user_key ON trip_members (trip_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX trip_members_email_key ON trip_members (trip_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX trip_members_user_idx ON trip_members (user_id);
CREATE INDEX trip_members_email_idx ON trip_members (lower(email)) WHERE user_id IS NULL AND email IS NOT NULL;

ALTER TABLE trips
  ADD CONSTRAINT trips_fund_holder_fk FOREIGN KEY (id, fund_holder_member_id)
  REFERENCES trip_members (trip_id, id) DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Categories: rows with trip_id NULL are the built-in defaults.
-- ---------------------------------------------------------------------------
CREATE TABLE expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid REFERENCES trips (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  icon       text CHECK (length(icon) <= 16),
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_categories_default_key ON expense_categories (lower(name)) WHERE trip_id IS NULL;
CREATE UNIQUE INDEX expense_categories_trip_key ON expense_categories (trip_id, lower(name)) WHERE trip_id IS NOT NULL;

INSERT INTO expense_categories (name, icon, sort_order) VALUES
  ('Hotel', '🏨', 1),
  ('Food', '🍲', 2),
  ('Restaurant', '🍽️', 3),
  ('Transport', '🚐', 4),
  ('Flights', '✈️', 5),
  ('Train', '🚆', 6),
  ('Bus', '🚌', 7),
  ('Taxi', '🚕', 8),
  ('Fuel', '⛽', 9),
  ('Activities', '🎯', 10),
  ('Tickets', '🎟️', 11),
  ('Shopping', '🛍️', 12),
  ('Drinks', '🍹', 13),
  ('Parking', '🅿️', 14),
  ('Travel Insurance', '🛡️', 15),
  ('Other', '📦', 99);

-- ---------------------------------------------------------------------------
-- Contributions: money a member gives to another member (normally the fund
-- holder) for the trip.
-- ---------------------------------------------------------------------------
CREATE TABLE contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  member_id             uuid NOT NULL,
  received_by_member_id uuid NOT NULL,
  amount                bigint NOT NULL CHECK (amount > 0),
  contributed_on        date NOT NULL DEFAULT CURRENT_DATE,
  payment_method        text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'bank_transfer', 'upi', 'credit_card', 'debit_card', 'other')),
  notes                 text CHECK (length(notes) <= 1000),
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, member_id) REFERENCES trip_members (trip_id, id),
  FOREIGN KEY (trip_id, received_by_member_id) REFERENCES trip_members (trip_id, id)
);
CREATE INDEX contributions_trip_idx ON contributions (trip_id, contributed_on);
CREATE INDEX contributions_member_idx ON contributions (trip_id, member_id);

-- ---------------------------------------------------------------------------
-- Expenses (kind = 'refund' for money received back, e.g. a cancelled booking)
-- ---------------------------------------------------------------------------
CREATE TABLE expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  kind              text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'refund')),
  title             text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  category_id       uuid REFERENCES expense_categories (id),
  amount            bigint NOT NULL CHECK (amount > 0),
  paid_by_member_id uuid NOT NULL,
  split_method      text NOT NULL CHECK (split_method IN ('equal', 'exact', 'percentage', 'shares')),
  spent_on          date NOT NULL DEFAULT CURRENT_DATE,
  spent_at          time,
  location          text CHECK (length(location) <= 200),
  notes             text CHECK (length(notes) <= 2000),
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, id),
  FOREIGN KEY (trip_id, paid_by_member_id) REFERENCES trip_members (trip_id, id)
);
CREATE INDEX expenses_trip_date_idx ON expenses (trip_id, spent_on DESC, spent_at DESC);
CREATE INDEX expenses_trip_payer_idx ON expenses (trip_id, paid_by_member_id);
CREATE INDEX expenses_trip_category_idx ON expenses (trip_id, category_id);

CREATE TABLE expense_participants (
  trip_id      uuid NOT NULL,
  expense_id   uuid NOT NULL,
  member_id    uuid NOT NULL,
  -- What the user typed: exact amount (minor units), percent, or number of
  -- shares. NULL for equal splits.
  split_value  numeric(20, 2),
  -- The computed share in minor units. Always sums to the expense amount.
  share_amount bigint NOT NULL CHECK (share_amount >= 0),
  position     smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (expense_id, member_id),
  FOREIGN KEY (trip_id, expense_id) REFERENCES expenses (trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, member_id) REFERENCES trip_members (trip_id, id)
);
CREATE INDEX expense_participants_member_idx ON expense_participants (trip_id, member_id);

-- The category must be a built-in one or belong to the same trip.
CREATE FUNCTION check_expense_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expense_categories c
    WHERE c.id = NEW.category_id AND (c.trip_id IS NULL OR c.trip_id = NEW.trip_id)
  ) THEN
    RAISE EXCEPTION 'Category % does not belong to trip %', NEW.category_id, NEW.trip_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER expenses_category_check
  BEFORE INSERT OR UPDATE OF category_id, trip_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION check_expense_category();

-- Expense amount must equal the sum of its shares. Checked at COMMIT so an
-- expense and its participants can be written in one transaction.
CREATE FUNCTION check_expense_shares() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  expense_amount bigint;
  share_total bigint;
  participant_count integer;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.expense_id;
  ELSE
    target := NEW.expense_id;
  END IF;

  SELECT amount INTO expense_amount FROM expenses WHERE id = target;
  IF NOT FOUND THEN
    RETURN NULL; -- expense was deleted in the same transaction
  END IF;

  SELECT coalesce(sum(share_amount), 0), count(*) INTO share_total, participant_count
  FROM expense_participants WHERE expense_id = target;

  IF participant_count = 0 THEN
    RAISE EXCEPTION 'Expense % has no participants', target USING ERRCODE = 'check_violation';
  END IF;
  IF share_total <> expense_amount THEN
    RAISE EXCEPTION 'Shares of expense % add up to % but the amount is %', target, share_total, expense_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER expenses_shares_check
  AFTER INSERT OR UPDATE ON expenses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_shares();

CREATE CONSTRAINT TRIGGER expense_participants_shares_check
  AFTER INSERT OR UPDATE OR DELETE ON expense_participants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_shares();

-- ---------------------------------------------------------------------------
-- Settlements: direct payments between members ("David paid John ₹2,000").
-- ---------------------------------------------------------------------------
CREATE TABLE settlements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  from_member_id uuid NOT NULL,
  to_member_id   uuid NOT NULL,
  amount         bigint NOT NULL CHECK (amount > 0),
  paid_on        date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'bank_transfer', 'upi', 'credit_card', 'debit_card', 'other')),
  note           text CHECK (length(note) <= 1000),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (from_member_id <> to_member_id),
  FOREIGN KEY (trip_id, from_member_id) REFERENCES trip_members (trip_id, id),
  FOREIGN KEY (trip_id, to_member_id) REFERENCES trip_members (trip_id, id)
);
CREATE INDEX settlements_trip_idx ON settlements (trip_id, paid_on);

-- ---------------------------------------------------------------------------
-- Receipts (upload support comes in a later version; table is ready).
-- ---------------------------------------------------------------------------
CREATE TABLE receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL,
  expense_id   uuid NOT NULL,
  storage_key  text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  ocr_data     jsonb,
  uploaded_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, expense_id) REFERENCES expenses (trip_id, id) ON DELETE CASCADE
);
CREATE INDEX receipts_expense_idx ON receipts (expense_id);

-- ---------------------------------------------------------------------------
-- Notifications and audit log
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trip_id    uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  type       text NOT NULL,
  message    text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Append-only history of every financial change (before/after snapshots).
-- No foreign keys on purpose: entries must survive deletion of the trip or user.
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id     uuid,
  user_id     uuid,
  action      text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity_type text NOT NULL,
  entity_id   uuid,
  before_data jsonb,
  after_data  jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_trip_idx ON audit_logs (trip_id, created_at DESC);

CREATE FUNCTION prevent_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();

-- ---------------------------------------------------------------------------
-- Wallet history: derived from the source records, so it can never drift.
-- ---------------------------------------------------------------------------
CREATE VIEW wallet_transactions AS
  SELECT c.trip_id, c.id AS record_id, 'contribution'::text AS type, c.contributed_on AS occurred_on,
         c.created_at, c.member_id, c.amount AS amount, 'Contribution'::text AS description
  FROM contributions c
  UNION ALL
  SELECT e.trip_id, e.id, e.kind, e.spent_on, e.created_at, e.paid_by_member_id,
         CASE WHEN e.kind = 'refund' THEN e.amount ELSE -e.amount END, e.title
  FROM expenses e;
