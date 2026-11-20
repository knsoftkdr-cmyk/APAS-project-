# Parent assistant feature awareness - how to apply

1. Copy these files into the project (same paths):
   - supabase/functions/_shared/parentFeatureGuide.ts
   - supabase/functions/_shared/featureManifest.generated.ts   (placeholder - regenerated in step 4)
   - tools/generate-feature-manifest.mjs   (UPDATED: it now also reads PARENT_NAV_MODULES. It is a superset of the
     version in the student zip, so it is safe to overwrite that one.)
   - src/test/parentFeatureGuide.test.ts

2. Edge function: if supabase/functions/parent-assistant/index.ts has NOT changed since this work started, copy the
   included file over it. If it HAS changed, apply parent-assistant.diff instead (`patch -p1 < parent-assistant.diff`,
   or make the 5 small edits by hand: one import, one sentence in the video classifier, the "1-4 short sentences"
   wording, the video-mode note, and the new HOW TO EXPLAIN THE APP block that goes just before CURRENT DATA).

3. Chat bubble (ONE small change, needed so the steps show on separate lines). In
   src/components/parent-transport/ParentBusAssistantWidget.tsx change
       <p>{m.text}</p>
   to
       <p className="whitespace-pre-line">{m.text}</p>
   Nothing else in the widget changes.

4. package.json scripts (add these lines if you did not already add them for the student work; do not replace the file):
     "prebuild": "node tools/generate-feature-manifest.mjs",
     "features:generate": "node tools/generate-feature-manifest.mjs",
     "features:check": "node tools/generate-feature-manifest.mjs --check",
   Then regenerate the manifest from YOUR sidebar (this is what makes any page newer than this snapshot known):
     npm run features:generate

5. Verify and deploy:
     npx vitest run src/test/parentFeatureGuide.test.ts
     supabase functions deploy parent-assistant

From now on: add a page to the sidebar -> run `npm run features:generate` (also runs before every build). The assistant
knows the page immediately. Add how-to text in parentFeatureGuide.ts when you can.
