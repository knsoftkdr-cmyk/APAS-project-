// Stand-in for deno.land std `serve`: just remember the handler so the harness can call it.
export function serve(handler: (req: Request) => Promise<Response> | Response) { (globalThis as any).__handler = handler; }
