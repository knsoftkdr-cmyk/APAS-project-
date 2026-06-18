CREATE POLICY "Allow authenticated users to list textbooks"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'textbooks');

CREATE POLICY "Allow public read access to textbooks"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'textbooks');