-- Database constraint tests. Run against a freshly migrated database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/schema.test.sql
-- Everything runs in one transaction that is rolled back at the end.

BEGIN;

CREATE FUNCTION pg_temp.expect_error(statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'Expected SQLSTATE % but got % (%) for: %', expected_state, SQLSTATE, SQLERRM, statement;
    END IF;
    SET CONSTRAINTS ALL DEFERRED;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected an error (%) but the statement succeeded: %', expected_state, statement;
END $$;

-- Fixtures ------------------------------------------------------------------
INSERT INTO users (id, name, email, password_hash) VALUES
  ('00000000-0000-0000-0000-000000000001', 'John', 'john@example.com', 'x');

INSERT INTO trips (id, created_by, name, currency) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Goa Trip 2026', 'INR'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Other trip', 'INR');

INSERT INTO trip_members (id, trip_id, user_id, name, role) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'John', 'owner'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', NULL, 'David', 'member'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', NULL, 'Stranger', 'member');

UPDATE trips SET fund_holder_member_id = '20000000-0000-0000-0000-000000000001'
WHERE id = '10000000-0000-0000-0000-000000000001';

INSERT INTO expense_categories (id, trip_id, name) VALUES
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Other trip category');

-- A valid expense: 4,000.00 split 2,000.00 + 2,000.00
INSERT INTO expenses (id, trip_id, title, amount, paid_by_member_id, split_method, category_id) VALUES
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Hotel', 400000,
   '20000000-0000-0000-0000-000000000001', 'equal', (SELECT id FROM expense_categories WHERE trip_id IS NULL AND name = 'Hotel'));
INSERT INTO expense_participants (trip_id, expense_id, member_id, share_amount) VALUES
  ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200000),
  ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 200000);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Tests ---------------------------------------------------------------------

-- 1. Shares must add up to the expense amount
SELECT pg_temp.expect_error($q$
  UPDATE expense_participants SET share_amount = 150000
  WHERE expense_id = '40000000-0000-0000-0000-000000000001' AND member_id = '20000000-0000-0000-0000-000000000002'
$q$, '23514');

SELECT pg_temp.expect_error($q$
  UPDATE expenses SET amount = 500000 WHERE id = '40000000-0000-0000-0000-000000000001'
$q$, '23514');

-- 2. An expense needs at least one participant
SELECT pg_temp.expect_error($q$
  INSERT INTO expenses (trip_id, title, amount, paid_by_member_id, split_method)
  VALUES ('10000000-0000-0000-0000-000000000001', 'No one', 1000, '20000000-0000-0000-0000-000000000001', 'equal')
$q$, '23514');

-- 3. Members must belong to the same trip
SELECT pg_temp.expect_error($q$
  INSERT INTO contributions (trip_id, member_id, received_by_member_id, amount)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 1000)
$q$, '23503');

SELECT pg_temp.expect_error($q$
  INSERT INTO settlements (trip_id, from_member_id, to_member_id, amount)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', 1000)
$q$, '23503');

SELECT pg_temp.expect_error($q$
  INSERT INTO expense_participants (trip_id, expense_id, member_id, share_amount)
  VALUES ('10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000009', 0)
$q$, '23503');

SELECT pg_temp.expect_error($q$
  UPDATE trips SET fund_holder_member_id = '20000000-0000-0000-0000-000000000009'
  WHERE id = '10000000-0000-0000-0000-000000000001'
$q$, '23503');

-- 4. Category must be built-in or from the same trip
SELECT pg_temp.expect_error($q$
  UPDATE expenses SET category_id = '30000000-0000-0000-0000-000000000002' WHERE id = '40000000-0000-0000-0000-000000000001'
$q$, '23503');

-- 5. Money must be positive
SELECT pg_temp.expect_error($q$
  INSERT INTO contributions (trip_id, member_id, received_by_member_id, amount)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 0)
$q$, '23514');

-- 6. No payments to yourself
SELECT pg_temp.expect_error($q$
  INSERT INTO settlements (trip_id, from_member_id, to_member_id, amount)
  VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 1000)
$q$, '23514');

-- 7. A member with financial records cannot be deleted
SELECT pg_temp.expect_error($q$
  DELETE FROM trip_members WHERE id = '20000000-0000-0000-0000-000000000002'
$q$, '23503');

-- 8. Member names are unique per trip (case-insensitive)
SELECT pg_temp.expect_error($q$
  INSERT INTO trip_members (trip_id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'david')
$q$, '23505');

-- 9. Trip dates must be in order
SELECT pg_temp.expect_error($q$
  UPDATE trips SET start_date = '2026-09-10', end_date = '2026-09-01' WHERE id = '10000000-0000-0000-0000-000000000001'
$q$, '23514');

-- 10. Audit log is append-only
INSERT INTO audit_logs (trip_id, user_id, action, entity_type) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'create', 'expense');
SELECT pg_temp.expect_error($q$ UPDATE audit_logs SET action = 'delete' $q$, 'P0001');

-- 11. Deleting an expense removes its participants; the share check does not block it
DELETE FROM expenses WHERE id = '40000000-0000-0000-0000-000000000001';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM expense_participants WHERE expense_id = '40000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'participants were not deleted';
  END IF;
END $$;

-- 12. Wallet view shows contributions as + and expenses as −
INSERT INTO contributions (trip_id, member_id, received_by_member_id, amount)
VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 1500000);
DO $$ BEGIN
  IF (SELECT sum(amount) FROM wallet_transactions WHERE trip_id = '10000000-0000-0000-0000-000000000001') <> 1500000 THEN
    RAISE EXCEPTION 'wallet view total is wrong';
  END IF;
END $$;

-- 13. Deleting a trip removes everything that belongs to it
DELETE FROM trips WHERE id = '10000000-0000-0000-0000-000000000001';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM trip_members WHERE trip_id = '10000000-0000-0000-0000-000000000001')
     OR EXISTS (SELECT 1 FROM contributions WHERE trip_id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'trip data was not removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE trip_id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'audit log must survive trip deletion';
  END IF;
END $$;
SELECT pg_temp.expect_error($q$ DELETE FROM audit_logs $q$, 'P0001');

SELECT 'ALL SCHEMA TESTS PASSED' AS result;
ROLLBACK;
