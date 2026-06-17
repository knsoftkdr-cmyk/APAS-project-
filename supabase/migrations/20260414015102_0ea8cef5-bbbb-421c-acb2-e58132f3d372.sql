UPDATE auth.users SET encrypted_password = crypt('Excellencia1@112', gen_salt('bf')) WHERE email = 'excellencia1@gmail.com';
UPDATE auth.users SET encrypted_password = crypt('Excellencia2@112', gen_salt('bf')) WHERE email = 'excellencia2@gmail.com';
UPDATE auth.users SET encrypted_password = crypt('Excellencia3@112', gen_salt('bf')) WHERE email = 'excellencia3@gmail.com';