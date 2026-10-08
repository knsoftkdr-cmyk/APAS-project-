// supabase/functions/_shared/errorMessage.ts
//
// supabase-js returns database errors as plain objects ({ message, details, hint, code }), not `Error`
// instances. `e instanceof Error ? e.message : "Unknown error"` therefore turned EVERY failed RPC /
// query into the useless text "Unknown error". This pulls the real reason out of either shape and
// adds a plain-language pointer when the cause is a database function that was never created
// (i.e. a migration that has not been applied to this project).

// deno-lint-ignore no-explicit-any
type AnyErr = any;

export function errorMessage(e: unknown, fallback = "Unknown error"): string {
  if (e == null) return fallback;
  if (typeof e === "string") return e || fallback;

  const err = e as AnyErr;
  const base = typeof err.message === "string" && err.message ? err.message : "";
  const details = typeof err.details === "string" && err.details ? err.details : "";
  const hint = typeof err.hint === "string" && err.hint ? err.hint : "";
  const code = typeof err.code === "string" ? err.code : "";

  let msg = base || details || fallback;
  if (base && details && !base.includes(details)) msg += ` (${details})`;

  // 42883 = undefined_function, PGRST202 = PostgREST "function not found in schema cache",
  // 42P01 = undefined_table, PGRST205 = table not found in schema cache.
  const missingFn = code === "42883" || code === "PGRST202" || /could not find the function|function .* does not exist/i.test(msg);
  const missingTable = code === "42P01" || code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(msg);
  if (missingFn || missingTable) {
    msg += " — a database migration has not been applied to this project. Run `supabase db push` (or paste the latest files from supabase/migrations into the SQL editor), then retry.";
  } else if (hint) {
    msg += ` (${hint})`;
  }
  return code && !missingFn && !missingTable ? `${msg} [${code}]` : msg;
}
