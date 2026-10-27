# student-tutor-chat end-to-end check (Deno)

Runs the real `supabase/functions/student-tutor-chat/index.ts` with a fake Supabase and a fake Gemini
(no network, no keys, no cost) and checks: typed chat unchanged, photo/document requests, auth
(anonymous / other student's token), file validation, vision-only routing, history injection, and the 503 message.

    cd supabase/tests/student-tutor-chat
    deno run --allow-env --allow-net --allow-read --import-map=importmap.json --node-modules-dir=auto \
      attachments_e2e.ts "$(cd ../../.. && pwd)"

Expect: `RESULT pass=14 fail=0`.
It does NOT call a real AI model - see the notes in the project report for what still needs a live check.
