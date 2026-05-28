
UPDATE auth.users 
SET email_confirmed_at = now()
WHERE email LIKE '%@student.apas.local' 
  AND email_confirmed_at IS NULL;
