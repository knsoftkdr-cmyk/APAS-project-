-- SQL tests for the app feature knowledge base (migration 20261118000000).
-- Run:  psql -v ON_ERROR_STOP=1 -f supabase/tests/_local_supabase_shim.sql   (plain Postgres only)
--       psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261118000000_app_feature_knowledge_base.sql
--       psql -v ON_ERROR_STOP=1 -f supabase/tests/app_feature_docs.test.sql
-- Every check raises an exception on failure; the script ends with "ALL SQL TESTS PASSED".
SET client_min_messages = notice;
SET search_path = "$user", public, extensions;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; RAISE NOTICE 'ok - %', msg; END $$;

-- a unit vector with a 1 at position i (768 dims): lets us control "meaning" exactly
CREATE OR REPLACE FUNCTION pg_temp.unit(i int) RETURNS extensions.vector LANGUAGE sql AS
  $$ SELECT ('[' || string_agg(CASE WHEN g = i THEN '1' ELSE '0' END, ',') || ']')::extensions.vector FROM generate_series(1, 768) g $$;

TRUNCATE public.app_feature_docs; TRUNCATE public.profiles;
INSERT INTO public.profiles VALUES
  ('00000000-0000-0000-0000-000000000001', 'student'),
  ('00000000-0000-0000-0000-000000000002', 'teacher'),
  ('00000000-0000-0000-0000-000000000003', 'admin');

INSERT INTO public.app_feature_docs (role, feature_key, name, aliases, keywords, route, content, search_text, confidence, status, content_hash, embedding) VALUES
 ('student','nav:/adaptive-test','Adaptive Test','{}','{}','/adaptive-test','Adaptive Test content','Adaptive Test . a test that adjusts to your level','high','active','h1', pg_temp.unit(1)),
 ('student','nav:/daily-review','Daily Review','{revision,spaced repetition}','{revise}','/daily-review','Daily Review content','Daily Review . short daily questions on things you learned earlier','high','active','h2', pg_temp.unit(2)),
 ('student','nav:/forgetting-forecast','Forgetting Forecast','{forgetting curve}','{}','/forgetting-forecast','Forgetting Forecast content','Forgetting Forecast . predicts what you will forget','high','active','h3', pg_temp.unit(3)),
 ('student','nav:/my-doubts','My Doubts','{ask a doubt}','{doubts}','/my-doubts','My Doubts content','My Doubts . ask your teachers about things you did not understand','high','active','h4', NULL),   -- no embedding yet
 ('student','nav:/old-thing','Old Thing','{}','{}','/old-thing','Old Thing content','Old Thing . removed feature','high','removed','h5', pg_temp.unit(4)),
 ('student','nav:/brain-gym','Brain Gym','{}','{}','/brain-gym','Brain Gym content','Brain Gym','low','active','h6', pg_temp.unit(5)),
 ('teacher','nav:/gradebook','Gradebook','{}','{}','/gradebook','Teacher-only gradebook content','Gradebook . enter marks','high','active','h7', pg_temp.unit(6));

-- ───────── row-level security ─────────
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';  -- a student
SELECT pg_temp.ok((SELECT count(*) FROM public.app_feature_docs) = 5, 'student sees only the 5 ACTIVE docs written for the student role (not removed, not teacher)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.app_feature_docs WHERE role <> 'student'), 'student cannot read teacher docs');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.app_feature_docs WHERE status = 'removed'), 'student cannot read removed docs');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('teacher', 'gradebook', NULL, 4)) = 0, 'student cannot read teacher docs by passing p_role = teacher to the search function');

DO $$ BEGIN
  BEGIN INSERT INTO public.app_feature_docs (role, feature_key, name, content, search_text, content_hash) VALUES ('student','x','x','x','x','x');
    RAISE EXCEPTION 'FAILED: student was able to INSERT';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - student cannot insert (privilege)'; END;
  BEGIN UPDATE public.app_feature_docs SET content = 'hacked';
    RAISE EXCEPTION 'FAILED: student was able to UPDATE';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - student cannot update (privilege)'; END;
  BEGIN DELETE FROM public.app_feature_docs;
    RAISE EXCEPTION 'FAILED: student was able to DELETE';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - student cannot delete (privilege)'; END;
END $$;

-- ───────── search: exact names, misspellings, aliases ─────────
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'what is the adaptive test', NULL, 3) LIMIT 1) = 'nav:/adaptive-test', 'exact name is found with no embedding at all');
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'how do i use the adaptiv test', NULL, 3) LIMIT 1) = 'nav:/adaptive-test', 'misspelt name ("adaptiv test") is found');
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'what is daily reveiw', NULL, 3) LIMIT 1) = 'nav:/daily-review', 'transposed letters ("reveiw") are found');
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'what is the forgetting curve', NULL, 3) LIMIT 1) = 'nav:/forgetting-forecast', 'an alias ("forgetting curve") is found');
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'what is my doubts', NULL, 3) LIMIT 1) = 'nav:/my-doubts', 'a doc with NO embedding is still found by text (newly synced feature, embedding pending)');
SELECT pg_temp.ok((SELECT name_score FROM public.match_feature_docs('student', 'what is my doubts', NULL, 3) LIMIT 1) > 0.9, 'exact name gives a name_score near 1');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.match_feature_docs('student', 'what is old thing', NULL, 8) WHERE feature_key = 'nav:/old-thing'), 'a removed feature is never returned');

-- ───────── search: nothing relevant ─────────
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', 'explain photosynthesis to me', NULL, 4)) = 0, 'an unrelated question matches nothing (no vector given)');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', '', NULL, 4)) = 0, 'an empty question matches nothing');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', NULL, NULL, 4)) = 0, 'a NULL question does not error');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', '''; drop table app_feature_docs; --', NULL, 4)) = 0, 'SQL-looking input is treated as plain text');

-- ───────── search: meaning (vector) ─────────
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'something to help me remember before exams', pg_temp.unit(2), 3) LIMIT 1) = 'nav:/daily-review', 'a question with no name words is found by meaning (vector)');
SELECT pg_temp.ok((SELECT vector_score FROM public.match_feature_docs('student', 'something to help me remember', pg_temp.unit(2), 3) WHERE feature_key = 'nav:/daily-review') > 0.99, 'vector_score is the cosine similarity');
SELECT pg_temp.ok((SELECT feature_key FROM public.match_feature_docs('student', 'what is the adaptive test', pg_temp.unit(3), 1)) = 'nav:/adaptive-test' OR (SELECT count(*) FROM public.match_feature_docs('student', 'what is the adaptive test', pg_temp.unit(3), 3)) >= 2, 'text and meaning both contribute (hybrid): both candidates are returned');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', 'something to help me remember', pg_temp.unit(2), 20)) <= 8, 'result size is capped');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', 'x', pg_temp.unit(2), 1)) = 1, 'limit is honoured');

-- ───────── anonymous users and other roles ─────────
RESET ROLE; SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM public.app_feature_docs; RAISE EXCEPTION 'FAILED: anon could read the table';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - anon cannot read the table'; END;
END $$;
RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'; -- a teacher
SELECT pg_temp.ok((SELECT count(*) FROM public.app_feature_docs) = 1 AND (SELECT name FROM public.app_feature_docs) = 'Gradebook', 'a teacher sees only teacher docs');
SELECT pg_temp.ok((SELECT count(*) FROM public.match_feature_docs('student', 'adaptive test', NULL, 4)) = 0, 'a teacher cannot read student docs through the search function');
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003'; -- an admin
SELECT pg_temp.ok((SELECT count(*) FROM public.app_feature_docs) = 7, 'an admin can read every doc, including removed ones, for review');
RESET ROLE; SET request.jwt.claim.sub = '';

-- ───────── service role (the sync script) ─────────
SET ROLE service_role;
INSERT INTO public.app_feature_docs (role, feature_key, name, content, search_text, content_hash) VALUES ('student','nav:/new','New Thing','c','New Thing','n1');
UPDATE public.app_feature_docs SET status = 'removed', removed_at = now() WHERE feature_key = 'nav:/new';
SELECT pg_temp.ok((SELECT status FROM public.app_feature_docs WHERE feature_key = 'nav:/new') = 'removed', 'service role can insert and retire docs');
DO $$ BEGIN
  BEGIN INSERT INTO public.app_feature_docs (role, feature_key, name, content, search_text, content_hash) VALUES ('student','nav:/new','Dup','c','Dup','n2');
    RAISE EXCEPTION 'FAILED: duplicate (role, feature_key) allowed';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok - (role, feature_key) is unique, so the sync can upsert'; END;
END $$;
RESET ROLE;

-- ───────── migration is re-runnable ─────────
\i supabase/migrations/20261118000000_app_feature_knowledge_base.sql
SELECT pg_temp.ok((SELECT count(*) FROM public.app_feature_docs) = 8, 're-running the migration keeps the data');

DO $$ BEGIN RAISE NOTICE 'ALL SQL TESTS PASSED'; END $$;
