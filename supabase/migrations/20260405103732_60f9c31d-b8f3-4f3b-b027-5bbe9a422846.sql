DELETE FROM students
WHERE id NOT IN (
  SELECT DISTINCT ON (profile_id) id
  FROM students
  ORDER BY profile_id, created_at ASC
);

ALTER TABLE students ADD CONSTRAINT students_profile_id_unique UNIQUE (profile_id);