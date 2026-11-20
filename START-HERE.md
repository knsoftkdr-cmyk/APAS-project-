# Study Buddy: self-updating feature knowledge (RAG)

Read `docs/feature-kb/README.md` first: it has the architecture, the setup steps and the deployment order.

Quick order:
1. Copy these files into the project (same paths). Do NOT overwrite package.json - add the scripts listed in the README.
2. `npm i -D esbuild`
3. `supabase db push`   (applies supabase/migrations/20261118000000_app_feature_knowledge_base.sql)
4. `npm run features:generate`   (reads YOUR sidebar/screens, so features newer than this delivery are included)
5. `npm run features:sync -- --dry-run`, then `npm run features:sync`   (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY)
6. `supabase functions deploy student-self-assistant`
7. `npx vitest run src/test/featureDocsPipeline.test.ts src/test/featureRetrieval.test.ts`

If your supabase/functions/student-self-assistant/index.ts has changed since the previous delivery, apply
`student-self-assistant.diff` instead of copying the file (`patch -p1 < student-self-assistant.diff`).
The two committed files docs/feature-kb/student.features.* are produced from MY copy of the project; step 4 regenerates them from yours.
