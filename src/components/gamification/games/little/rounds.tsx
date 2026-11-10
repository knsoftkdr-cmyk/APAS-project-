import { useEffect, useRef, useState, type ReactNode } from "react";
import { playSelectSound, playFlipSound, playMatchSound, playWrongSound } from "../../sounds";
import { P, FR, COL, LET, SY, SH, AN, PC, ART, BASKETS, BASKET_ITEMS, basketCategory } from "./data";
import { rnd, pick, shuf, uniq, type Ctx, type Q, type RoundDef } from "./util";

/* ───────────────────────── shared: "pick one of these" round ───────────────────────── */
interface Opt { node: ReactNode; ok: boolean; say?: string }
function Choices({ c, header, opts }: { c: Ctx; header?: ReactNode | ((fin: boolean) => ReactNode); opts: Opt[] }) {
  const [wob, setWob] = useState(-1), [miss, setMiss] = useState(0), [fin, setFin] = useState(false);
  return (
    <div className="ll-stage">
      {typeof header === "function" ? header(fin) : header}
      <div className="ll-row">
        {opts.map((o, i) => (
          <button key={i} type="button" disabled={fin} aria-label={`option ${i + 1}`}
            className={`ll-pic ${wob === i ? "ll-wob" : ""} ${miss >= 2 && o.ok && !fin ? "ll-glow" : ""}`}
            onClick={() => {
              if (!c.alive() || fin) return;
              if (o.ok) { setFin(true); c.ok(o.say); }
              else { setWob(i); setTimeout(() => setWob(-1), 420); setMiss(m => m + 1); c.wrong(); }
            }}>{o.node}</button>
        ))}
      </div>
    </div>
  );
}
const Big = ({ children, size = 100 }: { children: ReactNode; size?: number }) => <div className="ll-big" style={{ fontSize: size, fontWeight: 900 }}>{children}</div>;
const choice = (prompt: string, header: ReactNode | ((f: boolean) => ReactNode), opts: Opt[]): Q => ({ prompt, view: c => <Choices c={c} header={header} opts={opts} /> });
/** A list kept in a ref as well as state, so several quick taps (or fingers) in one moment never overwrite each other. */
function useList<T>(init: T[] = []) {
  const ref = useRef<T[]>(init); const [, force] = useState(0);
  return {
    get: () => ref.current,
    add: (x: T) => { ref.current = [...ref.current, x]; force(n => n + 1); return ref.current; },
    set: (a: T[]) => { ref.current = a; force(n => n + 1); },
  };
}
const idx = (n: number, k: number) => shuf([...Array(n).keys()].filter(i => i !== k));

/* ───────────────────────── 1. Pop the Balloons ───────────────────────── */
interface Balloon { col: string; txt: string; hit: boolean }
function Balloons({ c, list, hits }: { c: Ctx; list: Balloon[]; hits: number }) {
  const goneL = useList<number>(), gone = goneL.get(), [wob, setWob] = useState(-1), [miss, setMiss] = useState(0);
  const hint = miss >= 2 ? list.findIndex((b, i) => b.hit && !gone.includes(i)) : -1;
  return (
    <div className="ll-stage"><div className="ll-row" style={{ gap: 26, paddingTop: 10 }}>
      {list.map((b, i) => (
        <button key={i} type="button" aria-label="balloon" className={`ll-balloon ${gone.includes(i) ? "ll-popped" : ""} ${wob === i ? "ll-wob" : ""} ${hint === i ? "ll-glow" : ""}`}
          style={{ background: b.col, animationDelay: `${i * 0.3}s` }}
          onClick={() => {
            if (!c.alive() || goneL.get().includes(i)) return;
            if (b.hit) { playSelectSound(); const g = goneL.add(i); if (g.filter(x => list[x].hit).length === hits) c.ok(); }
            else { setWob(i); setTimeout(() => setWob(-1), 420); setMiss(m => m + 1); c.wrong(); }
          }}>{b.txt}</button>
      ))}
    </div></div>
  );
}
const balloons: RoundDef = { rounds: 5, make: l => {
  const n = l ? 6 : 5, hits = 2 + rnd(2), NU = l === 1 ? [1, 2, 3, 4, 5] : l === 2 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3];
  type T = { k: "c" | "n" | "l"; v: string | number; col?: string };
  const pool: T[] = [...COL.map(x => ({ k: "c" as const, v: x[1], col: x[0] })), ...NU.map(v => ({ k: "n" as const, v })), ...(l === 2 ? LET.map(v => ({ k: "l" as const, v })) : [])];
  const t = uniq("b" + l, pool, x => x.k + x.v);
  const list: Balloon[] = [];
  for (let i = 0; i < hits; i++) list.push(t.k === "c" ? { col: t.col!, txt: "", hit: true } : { col: pick(COL)[0], txt: String(t.v), hit: true });
  while (list.length < n) {
    if (t.k === "c") { const o = pick(COL); if (o[1] !== t.v) list.push({ col: o[0], txt: "", hit: false }); }
    else { const o = pick<string | number>(t.k === "n" ? NU : LET); if (o !== t.v) list.push({ col: pick(COL)[0], txt: String(o), hit: false }); }
  }
  const prompt = t.k === "c" ? `Pop the ${t.v} balloons!` : t.k === "n" ? `Pop number ${t.v}!` : `Pop the letter ${t.v}!`;
  const shuffled = shuf(list);
  return { prompt, view: c => <Balloons c={c} list={shuffled} hits={hits} /> };
} };

/* ───────────────────────── 2. Who Says Moo? ───────────────────────── */
const sounds: RoundDef = { rounds: 5, make: l => {
  const t = uniq("s" + l, AN, x => x[0]), opts = shuf([t, ...shuf(AN.filter(x => x !== t)).slice(0, l + 1)]);
  return choice(`Who says ${t[2]}?`, <Big size={90}>🔊</Big>, opts.map(x => ({ node: x[0], ok: x === t, say: x === t ? x[1] : undefined })));
} };

/* ───────────────────────── 3. Feed the Monster ───────────────────────── */
function Monster({ c, n, e, tot }: { c: Ctx; n: number; e: string; tot: number }) {
  const goneL = useList<number>(), gone = goneL.get();
  const k = gone.length, full = k >= n;
  return (
    <div className="ll-stage">
      <div className={`ll-mon ${full ? "ll-yum" : ""}`}>{full ? "😋" : "👾"}</div>
      <div className="ll-count">{k}</div>
      <div className="ll-row">{Array.from({ length: tot }, (_, i) => (
        <button key={i} type="button" aria-label="feed" className={`ll-pic ${gone.includes(i) || full ? "ll-gone" : ""}`} style={{ fontSize: "clamp(40px,10vw,60px)" }}
          onClick={() => {
            if (!c.alive() || goneL.get().length >= n || goneL.get().includes(i)) return;
            playSelectSound(); const g = goneL.add(i); c.say(String(g.length));
            if (g.length === n) setTimeout(() => c.ok(`${n}! Yum`), 400);
          }}>{e}</button>
      ))}</div>
    </div>
  );
}
const monster: RoundDef = { rounds: 5, make: l => {
  const mx = [3, 5, 10][l], cb: { n: number; f: (typeof FR)[number] }[] = [];
  for (let i = 1; i <= mx; i++) FR.forEach(f => cb.push({ n: i, f }));
  const { n, f } = uniq("m" + l, cb, x => x.n + x.f[0]);
  return { prompt: `I want ${n} ${f[1]}${n > 1 ? "s" : ""}! Tap to feed me.`, view: c => <Monster c={c} n={n} e={f[0]} tot={Math.min(10, n + 3)} /> };
} };

/* ───────────────────────── 4. What's Missing? ───────────────────────── */
function Missing({ c, shown, gone, opts, look }: { c: Ctx; shown: (typeof P); gone: (typeof P)[number]; opts: Opt[]; look: number }) {
  const [phase, setPhase] = useState<"look" | "guess">("look");
  useEffect(() => { const t = setTimeout(() => { setPhase("guess"); c.prompt("What is missing?"); }, look); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (phase === "look") return <div className="ll-stage"><div className="ll-row">{shown.map((x, i) => <div key={i} className="ll-pic">{x[0]}</div>)}</div></div>;
  return <Choices c={c} opts={opts} header={fin => <div className="ll-row">{shown.map((x, i) => <div key={i} className="ll-pic">{x === gone ? (fin ? gone[0] : "❓") : x[0]}</div>)}</div>} />;
}
const missing: RoundDef = { rounds: 5, make: l => {
  const k = l + 2, gone = uniq("x" + l, P), rest = shuf(P.filter(x => x !== gone)), shown = shuf([gone, ...rest.slice(0, k - 1)]);
  const opts = shuf([gone, ...rest.slice(k - 1, k + 1)]).map(x => ({ node: x[0], ok: x === gone, say: x === gone ? x[1] : undefined }));
  return { prompt: "Look carefully! Remember the pictures.", view: c => <Missing c={c} shown={shown} gone={gone} opts={opts} look={3200 + l * 1200} /> };
} };

/* ───────────────────────── 5. Odd One Out ───────────────────────── */
const odd: RoundDef = { rounds: 5, make: l => {
  const n = l ? 4 : 3, a = uniq("o" + l, P), b = pick(P.filter(x => x !== a)), oi = rnd(n);
  const opts = Array.from({ length: n }, (_, i) => i === oi
    ? { node: l === 2 ? <span style={{ filter: "hue-rotate(150deg)", display: "inline-block" }}>{a[0]}</span> : b[0], ok: true }
    : { node: a[0], ok: false });
  return choice("Which one is different?", null, opts);
} };

/* ───────────────────────── 6. Fill the Basket ───────────────────────── */
const basket: RoundDef = { rounds: 5, make: l => {
  const t = uniq("k" + l, BASKET_ITEMS), ci = basketCategory(P.indexOf(t)), ids = l === 1 ? shuf([ci, pick([0, 1, 2].filter(x => x !== ci))]) : [0, 1, 2];
  return choice(`Where does the ${t[1]} go?`, <Big size={100}>{t[0]}</Big>,
    ids.map(i => ({ node: <span style={{ fontSize: "0.5em" }}>🧺 {BASKETS[i][0]}<br />{BASKETS[i][1]}</span>, ok: i === ci, say: i === ci ? `${t[1]}. ${BASKETS[ci][1]}` : undefined })));
} };

/* ───────────────────────── 7. Pattern Train ───────────────────────── */
const pattern: RoundDef = { rounds: 5, make: l => {
  const T = l === 1 ? ["ABABA", "ABABAB"] : ["AABAAB", "ABCABC", "ABBABB"];
  const cand = Array.from({ length: 14 }, () => ({ ty: pick(T), sy: shuf(SY).slice(0, 3) }));
  const { ty, sy } = uniq("p" + l, cand, x => x.ty + x.sy.join(""));
  const m: Record<string, string> = { A: sy[0], B: sy[1], C: sy[2] }, ans = m[ty[ty.length - 1]];
  const opts = shuf([ans, ...shuf(SY.filter(x => x !== ans)).slice(0, 2)]);
  const small = { minWidth: 0, padding: "10px 12px" };
  return choice("What comes next?", fin => (
    <div className="ll-row">{[...ty.slice(0, -1)].map((ch, i) => <div key={i} className="ll-pic" style={small}>{m[ch]}</div>)}<div className="ll-pic" style={small}>{fin ? ans : "❓"}</div></div>),
  opts.map(x => ({ node: x, ok: x === ans })));
} };

/* ───────────────────────── 8. Letter Sound Hunt ───────────────────────── */
const letters: RoundDef = { rounds: 5, make: l => {
  const t = uniq("l" + l, P), L = t[1][0].toUpperCase(), opts = shuf([t, ...shuf(P.filter(x => x[1][0].toUpperCase() !== L)).slice(0, l + 1)]);
  return choice(`Which picture starts with ${L}?`, <Big>{L}</Big>, opts.map(x => ({ node: x[0], ok: x === t, say: x === t ? `${L} for ${t[1]}` : undefined })));
} };

/* ───────────────────────── 9. Big & Small ───────────────────────── */
const bigsmall: RoundDef = { rounds: 5, make: l => {
  const ask = ["big", "small", ...(l === 2 ? ["middle"] : [])];
  const { x, a } = uniq("g" + l, P.flatMap(p => ask.map(q => ({ x: p, a: q }))), q => q.x[0] + q.a);
  const sizes = shuf(l ? [44, 76, 110] : [44, 110]), want = a === "big" ? 110 : a === "small" ? 44 : 76;
  return choice(`Tap the ${a} ${x[1].toLowerCase()}!`, null, sizes.map(v => ({ node: <span style={{ fontSize: v }}>{x[0]}</span>, ok: v === want })));
} };

/* ───────────────────────── 10. Shape Hunt ───────────────────────── */
const shapes: RoundDef = { rounds: 5, make: l => {
  const t = uniq("h" + l, SH.slice(0, l ? 6 : 4), x => x[0]), opts = shuf([t, ...shuf(SH.filter(x => x !== t)).slice(0, l + 1)]);
  return choice(`Tap the ${t[1]}!`, null, opts.map(x => ({ node: x[0], ok: x === t, say: x === t ? t[1] : undefined })));
} };

/* ───────────────────────── 11. Count & Tap ───────────────────────── */
const count: RoundDef = { rounds: 5, make: l => {
  const mx = [3, 5, 10][l], cb: { n: number; x: (typeof P)[number] }[] = [];
  for (let i = 1; i <= mx; i++) P.forEach(x => cb.push({ n: i, x }));
  const { n, x } = uniq("n" + l, cb, q => q.n + q.x[0]);
  const opts = shuf([n, ...shuf([...Array(mx).keys()].map(i => i + 1).filter(i => i !== n)).slice(0, l + 1)]);
  return choice("How many do you see?",
    <div className="ll-row" style={{ maxWidth: 560 }}>{Array.from({ length: n }, (_, i) => <div key={i} className="ll-pic" style={{ minWidth: 0, fontSize: "clamp(36px,9vw,56px)", padding: "8px 12px" }}>{x[0]}</div>)}</div>,
    opts.map(v => ({ node: v, ok: v === n, say: v === n ? String(n) : undefined })));
} };

/* ───────────────────────── 12. Peekaboo Pairs ───────────────────────── */
function Pairs({ c, cards }: { c: Ctx; cards: (typeof P) }) {
  const openL = useList<number>(), doneL = useList<number>(), open = openL.get(), done = doneL.get(), [bad, setBad] = useState<number[]>([]);
  const lock = useRef(false), timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const tap = (i: number) => {
    if (!c.alive() || lock.current || openL.get().includes(i) || doneL.get().includes(i)) return;
    playFlipSound(); const o = openL.add(i); if (o.length < 2) return;
    const [a, b] = o;
    if (cards[a] === cards[b]) {
      playMatchSound(); const d = [...doneL.get(), a, b]; doneL.set(d); openL.set([]);
      if (d.length === cards.length) c.ok(cards[a][1]); else c.say(cards[a][1]);
    } else {
      lock.current = true; setBad([a, b]); playWrongSound();
      timers.current.push(setTimeout(() => { openL.set([]); setBad([]); lock.current = false; }, 800));
    }
  };
  return <div className="ll-stage"><div className="ll-row" style={{ maxWidth: 520 }}>{cards.map((x, i) => (
    <button key={i} type="button" aria-label="card" className={`ll-pic ${bad.includes(i) ? "ll-wob" : ""}`} style={done.includes(i) ? { background: "#C8F7DC" } : undefined} onClick={() => tap(i)}>
      {open.includes(i) || done.includes(i) ? x[0] : "❔"}</button>))}</div></div>;
}
const pairs: RoundDef = { rounds: 5, make: l => {
  const np = l + 2, a = uniq("r" + l, P), set = [a, ...shuf(P.filter(x => x !== a)).slice(0, np - 1)], cards = shuf([...set, ...set]);
  return { prompt: "Find the matching pairs!", view: c => <Pairs c={c} cards={cards} /> };
} };

/* ───────────────────────── 13. More or Fewer? ───────────────────────── */
const more: RoundDef = { rounds: 5, make: l => {
  const mx = l === 1 ? 5 : 10;
  const cand = Array.from({ length: 16 }, () => { const a = 1 + rnd(mx); let b = 1 + rnd(mx); while (b === a) b = 1 + rnd(mx); return { a, b, e: pick(P)[0], m: l === 1 ? "more" : pick(["more", "fewer"]) }; });
  const q = uniq("q" + l, cand, x => `${x.a}-${x.b}${x.e}${x.m}`), want = q.m === "more" ? Math.max(q.a, q.b) : Math.min(q.a, q.b);
  return choice(`Which group has ${q.m}?`, null, shuf([q.a, q.b]).map(v => ({
    node: <span style={{ fontSize: 30, display: "block", maxWidth: 230, lineHeight: 1.2 }}>{q.e.repeat(v)}</span>, ok: v === want, say: v === want ? String(want) : undefined })));
} };

/* ───────────────────────── 14. Number Neighbours ───────────────────────── */
const nextnum: RoundDef = { rounds: 5, make: l => {
  const mx = l === 1 ? 9 : 19, cand: { k: string; i: number }[] = [];
  for (let i = 1; i <= mx; i++) { cand.push({ k: "after", i }); if (l === 2 && i > 1) cand.push({ k: "before", i }); }
  const { k, i } = uniq("u" + l, cand, x => x.k + x.i), ans = k === "after" ? i + 1 : i - 1;
  const opts = shuf([ans, ...shuf([ans - 2, ans - 1, ans + 1, ans + 2].filter(v => v > 0 && v !== ans && v !== i)).slice(0, 2)]);
  return choice(`What number comes ${k} ${i}?`, <Big>{i}</Big>, opts.map(v => ({ node: v, ok: v === ans, say: v === ans ? String(ans) : undefined })));
} };

/* ───────────────────────── 15. Color Magic (painting) ───────────────────────── */
function Paint({ c, name, parts, pre, pal }: { c: Ctx; name: string; parts: [string, string][]; pre: number; pal: [string, string][] }) {
  const hex = (n: string) => PC.find(x => x[1] === n)![0];
  const [sel, setSel] = useState<string | null>(null), filledL = useList<number>(parts.map((_, i) => i).filter(i => i < pre)), filled = filledL.get();
  const [wob, setWob] = useState(-1), [miss, setMiss] = useState(0), [want, setWant] = useState<string | null>(null), [nudge, setNudge] = useState(false);
  const markup = (ref: boolean) => parts.map((r, i) => r[1].replace(/^<(\w+)/, `<$1 data-r="${i}" fill="${ref || filled.includes(i) ? hex(r[0]) : "#fff"}"`)).join("");
  const click = (e: React.MouseEvent) => {
    const t = (e.target as Element).closest("[data-r]"); if (!t || !c.alive()) return;
    const i = Number(t.getAttribute("data-r")); if (filledL.get().includes(i)) return;
    if (!sel) { c.say("Pick a colour first!"); setNudge(true); setTimeout(() => setNudge(false), 420); return; }
    const need = parts[i][0];
    if (sel === need) { playSelectSound(); const f = filledL.add(i); if (f.length === parts.length) c.ok(`Beautiful ${name}`); }
    else { setWob(i); setTimeout(() => setWob(-1), 420); setMiss(m => m + 1); setWant(need); c.wrong(); }
  };
  return (
    <div className="ll-stage">
      <div className="ll-pw">
        <div>Look 👀<svg viewBox="0 0 200 200" className="ll-art" style={{ width: "min(230px,56vw)", display: "block", margin: "auto" }} dangerouslySetInnerHTML={{ __html: markup(true) }} /></div>
        <div>Your turn 🖌️<svg viewBox="0 0 200 200" className={`ll-art ${wob >= 0 ? "ll-wob" : ""}`} role="img" aria-label={`${name} to paint`} style={{ width: "min(450px,94vw)", display: "block", cursor: "pointer" }} onClick={click} dangerouslySetInnerHTML={{ __html: markup(false) }} /></div>
      </div>
      <div className={`ll-row ${nudge ? "ll-wob" : ""}`}>{pal.map(x => (
        <button key={x[1]} type="button" aria-label={x[1]} className={`ll-sw ${sel === x[1] ? "ll-sel" : ""} ${miss >= 2 && want === x[1] ? "ll-glow" : ""}`} style={{ background: x[0] }}
          onClick={() => { setSel(x[1]); playSelectSound(); c.say(x[1]); }} />))}</div>
    </div>
  );
}
const paint: RoundDef = { rounds: 3, make: l => {
  const pic = uniq("d" + l, ART, x => x[0]);
  const parts = pic[1].map(r => [pick(r[0].split("|")), r[1]] as [string, string]);
  const pre = 0 /* every picture starts completely blank */, need = [...new Set(parts.map(r => r[0]))];
  const extra = shuf(PC.filter(x => !need.includes(x[1]))).slice(0, Math.max(0, (l === 0 ? 6 : l === 1 ? 7 : 9) - need.length)).map(x => x[1]);
  const pal = PC.filter(x => need.includes(x[1]) || extra.includes(x[1]));
  return { prompt: "Look at the picture. Paint it the same!", view: c => <Paint c={c} name={pic[0]} parts={parts} pre={pre} pal={pal} /> };
} };

export const LITTLE_ROUNDS: Record<string, RoundDef> = {
  "little-balloons": balloons, "little-sounds": sounds, "little-monster": monster, "little-missing": missing, "little-odd": odd,
  "little-basket": basket, "little-pattern": pattern, "little-letters": letters, "little-bigsmall": bigsmall, "little-shapes": shapes,
  "little-count": count, "little-pairs": pairs, "little-more": more, "little-nextnum": nextnum, "little-paint": paint,
};
