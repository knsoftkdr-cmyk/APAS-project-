# Feature knowledge base (how the Study Buddy learns about new features)

The Study Buddy explains APAS features from a **knowledge base** that is rebuilt from the application code. Adding or
changing a feature updates what the Buddy says, with no prompt editing and no model training. Gemini is unchanged:
it still writes every answer. What changes is the *information it is given*.

```
 application code ──► generate ──► docs/feature-kb/student.features.json  ──► sync ──► app_feature_docs (Postgres)
 (sidebar, App.tsx,    (build time,    (committed; reviewed in PRs;                    pgvector + pg_trgm
  screens, help,        no AI)          student.features.md is the readable copy)            │
  hand-written guide)                                                                        ▼
                                                  student question ─► embed ─► hybrid search ─► top 1-3 docs ─► Gemini
```

## What is automatic and what is not

| Need | How it is met |
|---|---|
| New menu page appears | Detected from the sidebar. Documented from the screen's real text (tabs, buttons, headings, fields, messages). |
| New profile tab | Read from the tab strip (name + its one-line hint). |
| Screen changed | Detected (hash of the screen's facts). The hand-written text for it is flagged for re-review. |
| Feature removed | Detected. The row is retired and never explained again. |
| Feature renamed / moved | Detected. The old name is kept as an alias, so students who still use it are understood. |
| *Why* a feature exists, step-by-step use | **Cannot be read reliably from code.** Taken, in order of trust, from: your hand-written guide, the page-help registry, a descriptive screen comment/subtitle. If none exists the feature is marked `needs review` and the Buddy is told to say what is visible and not to guess. |

Nothing is ever invented. There is no LLM in the generator.

## Sources, strongest first (a stronger source always wins)

1. **Hand-written guide**: `supabase/functions/_shared/studentFeatureGuide.ts`. Your words are kept exactly.
2. **Page-help registry**: `src/components/help/pageHelp*.ts` (already verified against the code by its own tests).
3. **Extracted facts**: tabs, buttons, headings, field labels/placeholders, empty-state messages, a leading comment.
   Sentences containing run-time values (`{count}`) are dropped rather than shown half-finished. Strings that look
   like emails, phone numbers, ids or links are dropped. Comments that talk about tables, hooks or RLS are not used.

Each document carries `confidence` (high = a person or the help registry wrote it; medium = read from a screen comment
or tab hint; low = only labels were found) and `needsReview`.

## Day-to-day workflow

```bash
npm run features:generate        # after adding/changing a feature; prints ADDED / MODIFIED / RENAMED / REMOVED / NEEDS REVIEW
git diff docs/feature-kb         # review what the Buddy will now say
npm run features:sync            # load into the database (needs the env vars below)
npm run features:check           # CI: fails if the committed docs are stale
npm run features:check -- --strict   # CI (optional): also fails while anything needs review
npm run features:accept -- nav:/my-exams   # you re-checked the written doc after a screen change   (or: -- --all)
```

`npm run build` runs `features:generate` first (`prebuild`).

When a feature is **flagged**: open `docs/feature-kb/student.features.md` (the list is at the top), add or fix the entry in
`studentFeatureGuide.ts`, run `features:generate`. Until then the Buddy still answers from the screen text and says it
has no further details.

## One-time setup

1. `npm i -D esbuild` (the tools import it directly; today it is only a transitive dependency of Vite).
2. Add to `package.json` `scripts`:
   ```json
   "prebuild": "npm run features:generate",
   "features:generate": "node tools/generate-feature-manifest.mjs && node tools/generate-feature-docs.mjs",
   "features:check": "node tools/generate-feature-manifest.mjs --check && node tools/generate-feature-docs.mjs --check",
   "features:accept": "node tools/generate-feature-docs.mjs",
   "features:sync": "node tools/sync-feature-kb.mjs"
   ```
3. Apply the migration `supabase/migrations/20261118000000_app_feature_knowledge_base.sql` (`supabase db push`).
4. `npm run features:generate` (this reads **your** current sidebar and screens, so features newer than this
   delivery, such as My Doubts, are picked up here).
5. Sync, with these environment variables (never commit them):
   ```bash
   export SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  GEMINI_API_KEY=...
   npm run features:sync -- --dry-run   # look first
   npm run features:sync
   ```
6. `supabase functions deploy student-self-assistant`.

The edge function needs **no new secrets**: it already holds the Gemini keys, and it reads the table with the
student's own session.

**Make sync part of every deploy** (this is what makes it hands-off). Example GitHub Actions step, after tests:
```yaml
- run: npm run features:check
- run: npm run features:sync
  env: { SUPABASE_URL: "${{ secrets.SUPABASE_URL }}", SUPABASE_SERVICE_ROLE_KEY: "${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}", GEMINI_API_KEY: "${{ secrets.GEMINI_API_KEY }}" }
```
A feature reaches the Buddy when the sync runs. The edge function does not need redeploying for content changes.

## How the Buddy uses it (per question)

1. The follow-up resolver adds the feature named in the last turns to a short question ("how do I use it?").
2. A text/typo search runs in the database while the question is embedded in parallel. An exact name needs no embedding.
3. Otherwise a meaning (vector) search is added, so "something to help me remember before exams" finds Daily Review.
4. The result is judged **strong** (the whole name/alias is in the question, typo-tolerant, or the meaning clearly
   matches), **weak** (offered as "maybe", the Buddy asks), or **none** (the Buddy is told to say it has no details).
5. Gemini gets a names-only list of every feature plus the full text of **at most 3** matching docs, not the whole guide.
6. Any failure (empty table, database error, embeddings down, 4.5 s timeout) falls back to the built-in guide, so the
   Buddy is never worse than before.

## Security

* The table holds help text only. No student data. A privacy check rejects emails, long numbers and links at generation.
* RLS: a signed-in user reads **only active docs for their own role** (`get_user_role(auth.uid())`), enforced in the
  database, so a student cannot read teacher docs even by calling the search function with `p_role = 'teacher'`.
  Only the service role writes. Anonymous users get nothing.
* The role used by the Buddy comes from the verified profile, never from the request body.
* The Gemini key is sent in a header, not in a URL. Logs hold only source / level / matched feature names.

## Tuning

Vector thresholds are starting values, not measured ones (they depend on the embedding model). Watch the
`[student-self-assistant] feature-kb` log lines (`source`, `level`, `matched`) on real questions, then adjust with the
function secrets `FEATURE_KB_VECTOR_STRONG` (default 0.70) and `FEATURE_KB_VECTOR_WEAK` (default 0.55).
`FEATURE_KB_EMBED_MODEL` (default `gemini-embedding-001`, 768 dimensions) changes the model; re-run `features:sync` after
changing it (the sync re-embeds when the model differs).

## Tests

```bash
npx vitest run src/test/featureDocsPipeline.test.ts src/test/featureRetrieval.test.ts
# SQL (plain Postgres + pgvector; on a real Supabase project skip the shim):
psql -v ON_ERROR_STOP=1 -f supabase/tests/_local_supabase_shim.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261118000000_app_feature_knowledge_base.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/app_feature_docs.test.sql
```

## Limits (be aware)

* A feature with no written purpose is explained only from its visible labels (flagged for you).
* Only changes to what a user **sees** (labels, tabs, messages, routes, roles) count as a change. Pure logic changes do not.
* Labels built from run-time values are skipped on purpose; some real buttons will not be listed.
* Extending to parent and teacher: add an entry to `tools/feature-docs/config.mjs` (their guides already exist) and
  call `retrieveFeatureKnowledge` with their role in their edge function.
