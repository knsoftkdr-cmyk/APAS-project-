// supabase/functions/_shared/mergedRouter.ts
//
// Edge Function deployment-limit workaround. Features that used to be their own
// edge functions now live in _shared/handlers/*.ts and are served through an
// already-deployed "anchor" function. The anchor calls routeMerged() first thing
// (after CORS preflight); if the request body's discriminator (`action`, `mode`,
// `item_type` or `job`, depending on the anchor) matches a route, the request is
// forwarded to that handler UNCHANGED - the handler performs its own auth and
// validation exactly as the standalone function did. Anything else returns null
// and the anchor's original code path runs untouched.
//
// The routing key is stripped from the forwarded body; `route.action` (when set)
// is written back as `body.action` for handlers that dispatch on their own action.

export type Handler = (req: Request) => Promise<Response>;
export interface Route { handler: Handler; action?: string }
export type RouteTable = Record<string, Route>;

export async function routeMerged(req: Request, routes: RouteTable, key = "action"): Promise<Response | null> {
  if (req.method !== "POST") return null;

  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(routes, value)) return null;

  const route = routes[value];
  const forwarded: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete forwarded[key];
  if (route.action !== undefined) forwarded.action = route.action;

  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return route.handler(new Request(req.url, { method: "POST", headers, body: JSON.stringify(forwarded) }));
}
