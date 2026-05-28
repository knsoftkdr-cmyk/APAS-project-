
UPDATE auth.users 
SET email_confirmed_at = now()
WHERE email IN ('excellencia4@gmail.com', 'excellencia5@gmail.com', 'excellencia6@gmail.com')
AND email_confirmed_at IS NULL;

UPDATE auth.users 
SET encrypted_password = crypt('Excellencia4@112', gen_salt('bf'))
WHERE email = 'excellencia4@gmail.com';

UPDATE auth.users 
SET encrypted_password = crypt('Excellencia5@112', gen_salt('bf'))
WHERE email = 'excellencia5@gmail.com';

UPDATE auth.users 
SET encrypted_password = crypt('Excellencia6@112', gen_salt('bf'))
WHERE email = 'excellencia6@gmail.com';
