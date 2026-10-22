// Fake supabase client: records every call, answers from a scenario callback. Never talks to a network.
export const log: { table: string; ops: [string, any[]][] }[] = [];
export const scenario: { user: any; authError: any; answer: (c: { table: string; ops: [string, any[]][] }) => { data?: any; count?: number; error?: any } } =
  { user: { id: "u1" }, authError: null, answer: () => ({ data: [] }) };
function builder(table: string) {
  const rec = { table, ops: [] as [string, any[]][] }; log.push(rec);
  const b: any = new Proxy({}, { get(_t, prop: string) {
    if (prop === "then") return (res: any, rej: any) => { const a = scenario.answer(rec); return Promise.resolve({ data: a.data ?? null, count: a.count ?? null, error: a.error ?? null }).then(res, rej); };
    return (...args: any[]) => { rec.ops.push([prop, args]); return b; };
  } });
  return b;
}
export function createClient(_u: string, _k: string, _o: any) {
  return {
    auth: { getUser: async () => scenario.authError ? { data: { user: null }, error: scenario.authError } : { data: { user: scenario.user }, error: null } },
    from: (t: string) => builder(t),
    rpc: (name: string) => builder("rpc:" + name),
  };
}
