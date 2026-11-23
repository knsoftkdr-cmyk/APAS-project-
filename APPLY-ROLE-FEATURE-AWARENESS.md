# Role feature awareness for Teacher, HOD, Principal, School Admin and Parent assistants

1. Unzip over your project (every file keeps its path; nothing is deleted).
2. `npm run features:generate`  (rewrites the generated files for all roles; the Student docs also refresh if screens changed)
3. `npm run features:sync`      (loads all roles into app_feature_docs; use `-- --role=teacher` for one). No migration is needed:
   the existing table, row-level security and `match_feature_docs` already isolate by role.
4. Redeploy these six edge functions (the sixth, `generate-item-bank`, only gains a vector-backfill action): `generate-item-bank`, `extract-lesson-intent` (teacher), `hod-assistant`, `principal-assistant`,
   `school-admin-assistant`, `parent-assistant`. `student-self-assistant` is unchanged.
5. (If `features:sync` could not embed from your computer) `npm run features:check-embeddings`, or skip it: redeploy `generate-item-bank` and run `npm run features:embed` to create the vectors with the edge functions' own keys.
6. `npx vitest run src/test/roleFeatureAwareness.test.ts src/test/featureRetrieval.test.ts src/test/featureDocsPipeline.test.ts`

No frontend/widget files changed. On every build `npm run features:check` now also verifies the route-role file.
