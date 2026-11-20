CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.log (n serial, ok boolean, label text);
CREATE OR REPLACE FUNCTION t.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t.log (ok, label) VALUES (coalesce(p_cond, false), p_label) $$;
-- passes only if the statement raises (optionally with a message fragment)
CREATE OR REPLACE FUNCTION t.raises(p_label text, p_sql text, p_frag text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; PERFORM t.ok(p_label || ' (expected an error, none raised)', false);
EXCEPTION WHEN OTHERS THEN PERFORM t.ok(p_label, sqlerrm ILIKE '%' || p_frag || '%'); END $$;
CREATE OR REPLACE FUNCTION t.as_user(p_uid uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', coalesce(p_uid::text, ''), false) $$;
-- scenarios also log while connected as the app roles (SET ROLE authenticated / anon)
GRANT USAGE ON SCHEMA t TO PUBLIC;
GRANT ALL ON t.log TO PUBLIC;
GRANT USAGE ON SEQUENCE t.log_n_seq TO PUBLIC;
