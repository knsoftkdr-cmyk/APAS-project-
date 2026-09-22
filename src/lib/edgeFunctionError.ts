// src/lib/edgeFunctionError.ts
//
// supabase-js's default `error.message` for a non-2xx edge function response
// is just "Edge Function returned a non-2xx status code" — the function's own
// { error: "...", code?: "..." } JSON body (with the real reason) is on
// error.context, the raw Response object. This unwraps it so the person sees
// the actual cause instead of a generic message.
//
// Mirrors the inline version in src/hooks/useAdmissionDocuments.ts.

export async function unwrapFunctionError(error: unknown, fallback = "Something went wrong."): Promise<{ message: string; code?: string }> {
  const err = error as { message?: string; context?: Response } | null;
  let message = err?.message ?? fallback;
  let code: string | undefined;
  const context = err?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // context wasn't JSON; fall back to the generic message above
    }
  }
  return { message, code };
}