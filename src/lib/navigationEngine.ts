import { navItems, isNavItemAllowedForRole, type NavItem } from "@/components/layout/AppSidebar";

// ---------------------------------------------------------------------------------------------------------------
// Assistant navigation engine: "Open Gamification", "Take me to My Mastery", "Open my timetable" ...
//
// One engine, one set of matching rules, used by every role's assistant (Study Buddy for students, APAS Agent for
// teachers). A role module (studentNavigation.ts, teacherNavigation.ts) only supplies its CONFIG: which role, which
// everyday synonyms, which words mean "another role's page".
//
// This module only DECIDES what a sentence means. It never navigates and never calls the network or an AI model.
//
//  * Destinations are NOT a second copy of the menu: they are built from the sidebar's own `navItems`, filtered by the
//    sidebar's own role rule (`isNavItemAllowedForRole`) - plus, for staff roles, the sidebar's per-school permission
//    check (`canUseModule`). So the assistant can open exactly what that user sees in their sidebar - nothing else.
//  * The only thing added per role is a table of everyday synonyms, keyed by route. A unit test fails if a key stops
//    matching a destination.
//  * A sentence is only treated as navigation when it starts with an explicit "go there" request (open / go to / take
//    me to / navigate to ...). Everything else - including questions like "what's my timetable today?" - returns
//    { kind: "none" } and continues to the role's existing assistant flow, exactly as before.
// ---------------------------------------------------------------------------------------------------------------

export interface NavDestination {
  /** Route exactly as the sidebar links to it (may carry a query string, e.g. "/ai-tutor?mode=career"). */
  path: string;
  /** The label the user sees in the sidebar / on the tab. */
  title: string;
  /** Normalised phrases (as token lists) that identify this destination. */
  phrases: string[][];
}

export type NavResolution =
  /** Not a navigation request - hand the message to the normal assistant flow. */
  | { kind: "none" }
  | { kind: "navigate"; destination: NavDestination; reply: string }
  /** The user is already on that page. */
  | { kind: "already"; destination: NavDestination; reply: string }
  /** More than one page fits (or one near-match): ask, and remember the options for the next message. */
  | { kind: "clarify"; options: NavDestination[]; reply: string }
  /** A real page, but not one in this user's menu (other roles' pages, hidden pages). */
  | { kind: "blocked"; reply: string }
  /** "Open ..." with something that isn't a page in the app. */
  | { kind: "not-found"; reply: string }
  /** "Open it" / "take me somewhere" - no page named. */
  | { kind: "vague"; reply: string }
  /** The user declined the options we offered. */
  | { kind: "cancel"; reply: string };

export interface ResolveContext {
  /** Where the user is now, as pathname + search (e.g. "/ai-tutor?mode=career"). */
  currentPath?: string;
  /** Options offered by the previous clarification, so "the second one" / "virtual classroom" / "yes" can be answered. */
  pending?: NavDestination[] | null;
  /** Override the destination list (tests, or a permission-filtered list). */
  destinations?: NavDestination[];
}

export interface SubDestination {
  path: string;
  parentPath: string;
  title: string;
}

export interface BuildOptions {
  /** The sidebar's per-school permission check for staff roles (`usePermissions().can`). Omit for no permission filter. */
  canUseModule?: (module: string) => boolean;
}

export interface NavigatorConfig {
  /** The sidebar role this navigator serves ("student", "teacher" ...). */
  role: string;
  /** How replies refer to the menu: "student menu" -> "That page isn't available from your student menu". */
  menuName: string;
  /** Extra ways of saying each page, keyed by route. Titles come from the sidebar. */
  extraPhrases: Record<string, string[]>;
  /** Tabs that are real routes of a sidebar item (its `alsoActiveOn`) but have no row of their own. */
  subDestinations?: SubDestination[];
  /**
   * Routes the sidebar lists for this role but whose route guard in App.tsx does NOT admit it (they would bounce to
   * the dashboard). Never offered as destinations; asking for one gets "not available". A unit test checks this list
   * against App.tsx in both directions.
   */
  excludePaths?: string[];
  /** Words that mean "a page of another role" ("parent dashboard", "admin panel"). */
  roleWords: string[];
  /** Names the user may address the assistant by ("hey study buddy, open ..."), as a regex alternation. */
  assistantNames: string;
  /** Titles to quote in "I can open pages like ..." (only those that exist are used). */
  exampleTitles: string[];
}

export interface Navigator {
  /** Destinations for this role, built from the sidebar menu + visibility rule. */
  buildDestinations: (items?: NavItem[], opts?: BuildOptions) => NavDestination[];
  /** The default (no permission filter) destination list, cached. */
  getDestinations: () => NavDestination[];
  resolve: (text: string, ctx?: ResolveContext) => NavResolution;
}

// ─────────────────────────────────────── text helpers ───────────────────────────────────────
// Speech recognition often splits or respells these.
const SPEECH_FIXES: [RegExp, string][] = [
  [/\btime ?tables?\b/g, "timetable"],
  [/\bleader ?boards?\b/g, "leaderboard"],
  [/\bhome ?works?\b/g, "homework"],
  [/\bwork ?sheets?\b/g, "worksheet"],
  [/\bcalend[ae]rs?\b/g, "calendar"],
  [/\bmarket ?places?\b/g, "marketplace"],
  [/\bgame?ific?ation\b|\bgamif[iy]cation\b|\bgamefication\b/g, "gamification"],
  [/\ba i\b/g, "ai"],
];

function norm(raw: string): string {
  let t = raw.toLowerCase().replace(/[\u2018\u2019']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  for (const [re, to] of SPEECH_FIXES) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2); // branches -> branch, classes -> class
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// Words that carry no page identity ("my", "the", "page", "tab" ...). Stored as stems.
const FILLER = new Set(["my", "the", "a", "an", "our", "your", "page", "tab", "section", "screen", "menu", "option", "module", "area", "now", "please", "again", "for", "me", "to", "up", "thank", "you"]);
const STOP = new Set(["and", "or", "of", "in", "on", "at", "is", "are", "with", "all"]);
const VAGUE = new Set(["it", "that", "this", "there", "here", "something", "anything", "somewhere", "one", "another", "other", "next", "previous", "last", "new", "different", "else"]);

// Words that scope a request to a group of students ("... for class 8", "grade 6", "section B") rather than name a page.
const SCOPE_WORDS = new Set(["class", "grade", "section", "std", "standard"]);

const tokensOf = (normalised: string): string[] =>
  normalised.split(" ").filter(Boolean).map(stem).filter((t) => !FILLER.has(t) && !STOP.has(t));

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Tolerates one (two for long names) mis-heard letters - only for names of 6+ characters. */
function nearlyEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  return len >= 6 && lev(a, b) <= (len >= 9 ? 2 : 1);
}

const phraseTokens = (phrase: string): string[] => tokensOf(norm(phrase));

// ─────────────────────────────────────── matching ───────────────────────────────────────
type Tier = 1 | 2 | 3 | 4;
interface Hit { dest: NavDestination; tier: Tier; plen: number }

function tierOf(tokens: string[], ph: string[], allowExtra: boolean): Tier | null {
  if (!tokens.length || !ph.length) return null;
  const key = tokens.join(" ");
  const pkey = ph.join(" ");
  if (key === pkey) return 1; // the page's exact name
  if (nearlyEqual(key, pkey)) return 2; // ...with a mis-heard letter
  if (tokens.every((t) => ph.includes(t))) return 3; // part of the name ("classroom" -> "Virtual Classroom")
  if (allowExtra && ph.every((p) => tokens.includes(p))) {
    // the name plus a couple of extra words ("timetable for tomorrow", "mastery dashboard") - but not when the extras are
    // a number or a class/grade/section ("class mastery for class 8"): that is a data request for the assistant, not a page name.
    const extras = tokens.filter((t) => !ph.includes(t));
    if (extras.some((t) => /\d/.test(t) || SCOPE_WORDS.has(t))) return null;
    if (tokens.length - ph.length <= (ph.length === 1 ? 1 : 2)) return 4;
  }
  return null;
}

function bestHits(tokens: string[], dests: NavDestination[], allowExtra = true): Hit[] {
  const hits: Hit[] = [];
  for (const dest of dests) {
    let best: Hit | null = null;
    for (const ph of dest.phrases) {
      const tier = tierOf(tokens, ph, allowExtra);
      if (tier && (!best || tier < best.tier || (tier === best.tier && ph.length > best.plen))) {
        best = { dest, tier, plen: ph.length };
      }
    }
    if (best) hits.push(best);
  }
  if (!hits.length) return [];
  const top = Math.min(...hits.map((h) => h.tier));
  let atTop = hits.filter((h) => h.tier === top);
  if (top === 4) {
    const longest = Math.max(...atTop.map((h) => h.plen));
    atTop = atTop.filter((h) => h.plen === longest);
  }
  return atTop;
}

function restrictedMatch(tokens: string[], hasRole: boolean, restricted: string[][]): boolean {
  for (const ph of restricted) {
    const tier = tierOf(tokens, ph, hasRole);
    if (tier && (tier <= 3 || hasRole)) return true;
  }
  return false;
}

/** Closest single page for a slightly-off name, to offer "Did you mean ...?" (strict: a quarter of the letters at most). */
function nearest(tokens: string[], dests: NavDestination[]): NavDestination | null {
  const key = tokens.join(" ");
  if (key.length < 4) return null;
  let best: { dest: NavDestination; d: number; ratio: number } | null = null;
  let tie = false;
  for (const dest of dests) {
    for (const ph of dest.phrases) {
      const pkey = ph.join(" ");
      const d = lev(key, pkey);
      const ratio = d / Math.max(key.length, pkey.length);
      if (!best || d < best.d) { best = { dest, d, ratio }; tie = false; }
      else if (d === best.d && dest !== best.dest) tie = true;
    }
  }
  return best && !tie && best.ratio <= 0.25 ? best.dest : null;
}

// ─────────────────────────────────────── sentence shape ───────────────────────────────────────
// Clear "go there" requests. A target that is not a page is told so ("I couldn't find a page called ...").
const DIRECT = "open up|open|go to|goto|go in to|navigate to|navigate|launch|visit|take me to|bring me to|take us to";
// Looser phrasings. Navigate on a match, otherwise stay out of the way (e.g. "take me through fractions").
const SOFT = "take me|bring me|jump to|head to|switch to|move to|go back to|go(?= home\\b)|back to";
// "Show"-type verbs are mostly data questions ("show my homework"), so they only navigate with an explicit "page/tab/section".
const SHOW = "show me|show|pull up|bring up|display|view|see|look at|check out|check";

const TRAILING_RE = /\s+(?:please|now|thanks|thank you|for me|right now|quickly|again)$/;
const PAGE_WORD_RE = /\b(?:page|tab|section|screen|menu)s?\b/;

// "the second one", "last", "3" ... (a bare number word only counts when it is the whole answer, so "the second one" is 2nd, not 1st)
const ORDINALS: [RegExp, number][] = [
  [/\b(?:first|1st|former)\b|^(?:1|one)$/, 0],
  [/\b(?:second|2nd|latter)\b|^(?:2|two)$/, 1],
  [/\b(?:third|3rd)\b|^(?:3|three)$/, 2],
  [/\b(?:fourth|4th)\b|^(?:4|four)$/, 3],
];

// ─────────────────────────────────────── replies ───────────────────────────────────────
const joinOr = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);

const samePlace = (a: string, b?: string) => {
  if (!b) return false;
  const canon = (p: string) => (p.length > 1 ? p.replace(/\/+(?=\?|$)/, "") : p);
  return canon(a) === canon(b);
};

function go(dest: NavDestination, ctx: ResolveContext): NavResolution {
  if (samePlace(dest.path, ctx.currentPath)) {
    return { kind: "already", destination: dest, reply: `You're already on ${dest.title}.` };
  }
  return { kind: "navigate", destination: dest, reply: `Opening ${dest.title}.` };
}

function stripTrailing(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 3 && TRAILING_RE.test(out); i++) out = out.replace(TRAILING_RE, "").trim();
  return out;
}

type Single = { kind: "one"; dest: NavDestination } | { kind: "many"; options: NavDestination[] } | { kind: "no" };

const NONE: NavResolution = { kind: "none" };

// ─────────────────────────────────────── the factory ───────────────────────────────────────
export function createNavigator(cfg: NavigatorConfig): Navigator {
  const ROLE_WORDS = new Set(cfg.roleWords);
  const excluded = new Set(cfg.excludePaths ?? []);
  const subDestinations = cfg.subDestinations ?? [];

  const COURTESY =
    "(?:(?:hey|hi|hello|ok|okay|so|now|alright|well)\\s+)?(?:(?:" + cfg.assistantNames + ")\\s+)?(?:please\\s+)?" +
    "(?:(?:can|could|would|will) (?:you|u)\\s+)?(?:please\\s+)?" +
    "(?:(?:i want to|i would like to|id like to|i wanna|i need to|i have to|lets|let us|im trying to|help me|i want you to|i would like you to|id like you to)\\s+)?(?:please\\s+)?";
  const LEAD_RE = new RegExp(`^${COURTESY}(?:(${DIRECT})|(${SOFT})|(${SHOW}))\\s+(.+)$`);
  const BARE_RE = new RegExp(`^${COURTESY}(?:${DIRECT})$`);
  const FOLLOW_UP_RE = new RegExp(`^${COURTESY}(?:(?:${DIRECT}|${SOFT})\\s+)?(.+)$`);

  const hasRoleWord = (tokens: string[]) => tokens.some((t) => ROLE_WORDS.has(t));

  // ── destinations ──
  function buildDestinations(items: NavItem[] = navItems, opts: BuildOptions = {}): NavDestination[] {
    // Several sidebar rows may point at one route (e.g. teacher "Home" and "Homework" both open /dashboard).
    // The first row names it; the others become extra ways of saying it.
    const byPath = new Map<string, { title: string; aliases: string[] }>();
    const add = (path: string, title: string, aliases: string[]) => {
      if (excluded.has(path)) return;
      const hit = byPath.get(path);
      if (hit) hit.aliases.push(title, ...aliases);
      else byPath.set(path, { title, aliases });
    };
    for (const item of items) {
      if (!isNavItemAllowedForRole(item, cfg.role)) continue;
      if (opts.canUseModule && item.module && !opts.canUseModule(item.module)) continue;
      if (excluded.has(item.path)) continue; // its sub-item (e.g. the career coach) goes with it
      add(item.path, item.studentTitle && cfg.role === "student" ? item.studentTitle : item.title, item.studentTitle && cfg.role === "student" ? [item.title] : []);
      if (item.subItem) add(item.subItem.path, item.subItem.title, []);
      for (const sub of subDestinations) {
        if (sub.parentPath === item.path && item.alsoActiveOn?.includes(sub.path)) add(sub.path, sub.title, []);
      }
    }
    return [...byPath.entries()].map(([path, { title, aliases }]) => {
      const seen = new Set<string>();
      const phrases = [title, ...aliases, ...(cfg.extraPhrases[path] ?? [])]
        .map(phraseTokens)
        .filter((p) => p.length > 0 && !seen.has(p.join(" ")) && !!seen.add(p.join(" ")));
      return { path, title, phrases };
    });
  }

  let cachedDestinations: NavDestination[] | null = null;
  const getDestinations = () => (cachedDestinations ??= buildDestinations());

  /** Phrases of menu items this user can NOT open (other roles' pages, hidden pages) - only used to answer "that's not available". */
  const restrictedCache = new WeakMap<NavDestination[], string[][]>();
  function getRestrictedPhrases(dests: NavDestination[]): string[][] {
    const cached = restrictedCache.get(dests);
    if (cached) return cached;
    const own = new Set(dests.map((d) => d.path));
    const seen = new Set<string>();
    const out: string[][] = [];
    const push = (title: string) => {
      const p = phraseTokens(title);
      if (p.length > 0 && !seen.has(p.join(" "))) { seen.add(p.join(" ")); out.push(p); }
    };
    // A page the user can not open is still a REAL page: its title and everyday names are how we recognise "that's not available".
    for (const it of navItems) {
      if (!own.has(it.path)) { push(it.title); for (const x of cfg.extraPhrases[it.path] ?? []) push(x); }
      if (it.subItem && !own.has(it.subItem.path)) { push(it.subItem.title); for (const x of cfg.extraPhrases[it.subItem.path] ?? []) push(x); }
    }
    restrictedCache.set(dests, out);
    return out;
  }

  function examples(dests: NavDestination[]): string {
    const titles = cfg.exampleTitles.filter((p) => dests.some((d) => d.title === p));
    for (const d of dests) if (titles.length < 3 && !titles.includes(d.title)) titles.push(d.title);
    return joinOr(titles.slice(0, 3));
  }

  function ask(options: NavDestination[], lead = "Which one do you mean"): NavResolution {
    const shown = options.slice(0, 4);
    return { kind: "clarify", options: shown, reply: `${lead}: ${joinOr(shown.map((o) => o.title))}? Just say the name.` };
  }

  function matchPage(tokens: string[], dests: NavDestination[]): Single {
    const hits = bestHits(tokens, dests, !hasRoleWord(tokens));
    if (hits.length === 1) return { kind: "one", dest: hits[0].dest };
    if (hits.length > 1) return { kind: "many", options: hits.map((h) => h.dest) };
    return { kind: "no" };
  }

  function resolveFollowUp(n: string, pending: NavDestination[], ctx: ResolveContext): NavResolution | null {
    const words = n.split(" ").length;
    if (words <= 4 && /^(?:no|nope|nah|none|neither|cancel|never ?mind|nevermind|forget it|stay here|dont|do not)(?:\s|$)/.test(n)) {
      return { kind: "cancel", reply: "No problem - I'll stay here. What would you like to do?" };
    }
    if (pending.length === 1 && words <= 4 && /^(?:yes|yeah|yep|yup|sure|ok|okay|correct|right|that one|go ahead|do it|open it)(?:\s|$)/.test(n)) {
      return go(pending[0], ctx);
    }
    const m = FOLLOW_UP_RE.exec(n);
    const tokens = m ? tokensOf(stripTrailing(m[1])) : [];
    if (tokens.length) {
      const hits = bestHits(tokens, pending, true);
      if (hits.length === 1) return go(hits[0].dest, ctx);
      if (hits.length > 1) return ask(hits.map((h) => h.dest));
    }
    if (/\blast\b/.test(n)) return go(pending[pending.length - 1], ctx);
    const bare = tokensOf(n).join(" ");
    for (const [re, idx] of ORDINALS) if (idx < pending.length && (re.test(n) || re.test(bare))) return go(pending[idx], ctx);
    return null;
  }

  // ── the resolver ──
  function resolve(text: string, ctx: ResolveContext = {}): NavResolution {
    const dests = ctx.destinations ?? getDestinations();
    const n = norm(text);
    if (!n || n.split(" ").length > 14) return NONE; // empty, or too long to be a "go there" command

    if (ctx.pending?.length) {
      const followUp = resolveFollowUp(n, ctx.pending, ctx);
      if (followUp) return followUp;
    }

    if (BARE_RE.test(n)) {
      return { kind: "vague", reply: `Sure - which page would you like to open? For example: ${examples(dests)}.` };
    }

    const m = LEAD_RE.exec(n);
    if (!m) return NONE; // questions, statements, anything that doesn't start with a "go there" request
    const [, direct, soft, show, restRaw] = m;
    const rest = stripTrailing(restRaw);
    if (show && !PAGE_WORD_RE.test(rest)) return NONE; // "show my homework" is a data question for the assistant

    // "open gamification and timetable" - only when EVERY part is a page; otherwise let the assistant take the whole sentence.
    // ...but never split a page's own name ("Item Bank & Mock Exams" is one page, not two).
    const wholeKey = tokensOf(rest).join(" ");
    const isOnePageName = dests.some((d) => d.phrases.some((ph) => ph.join(" ") === wholeKey));
    const segments = isOnePageName ? [rest] : rest.split(/\s+(?:and|then|also|plus|after that)\s+/).map((s) => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      const resolved: NavDestination[] = [];
      for (const seg of segments) {
        const r = matchPage(tokensOf(seg), dests);
        if (r.kind !== "one") return NONE;
        if (!resolved.includes(r.dest)) resolved.push(r.dest);
      }
      if (resolved.length > 1) return ask(resolved, "I can open one page at a time. Which would you like first");
      return go(resolved[0], ctx);
    }

    const tokens = tokensOf(rest);
    if (tokens.length === 0 || tokens.every((t) => VAGUE.has(t))) {
      return direct || soft
        ? { kind: "vague", reply: `Sure - which page would you like to open? For example: ${examples(dests)}.` }
        : NONE;
    }

    const found = matchPage(tokens, dests);
    if (found.kind === "one") return go(found.dest, ctx);
    if (found.kind === "many") return ask(found.options);

    // "parent dashboard", "admin panel": those belong to other roles. If what is left over names one of this user's own pages,
    // offer it (and remember it so "yes" opens it).
    if (hasRoleWord(tokens)) {
      const rest2 = tokens.filter((t) => !ROLE_WORDS.has(t));
      const alt = rest2.length ? matchPage(rest2, dests) : ({ kind: "no" } as Single);
      if (alt.kind === "one") {
        return { kind: "clarify", options: [alt.dest], reply: `That one isn't available from your ${cfg.menuName}. Did you mean ${alt.dest.title}?` };
      }
      if (alt.kind === "many") return ask(alt.options, `That one isn't available from your ${cfg.menuName}. Did you mean`);
    }

    // Not in this user's menu. Is it a real page they just can't open?
    if (restrictedMatch(tokens, hasRoleWord(tokens), getRestrictedPhrases(dests))) {
      return {
        kind: "blocked",
        reply: `That page isn't available from your ${cfg.menuName}, so I can't open it. I can open pages like ${examples(dests)}.`,
      };
    }

    // A slightly-off name ("did you mean ...?")
    const close = nearest(tokens, dests);
    if (close && (direct || soft)) {
      return { kind: "clarify", options: [close], reply: `I couldn't find that exactly. Did you mean ${close.title}?` };
    }

    // "open attendance for class 5": a real page name at the START, with more after it, is a data request, not an unknown page.
    const namesAPage = dests.some((d) => d.phrases.some((ph) => ph.length > 0 && ph.length < tokens.length && ph.every((t, i) => tokens[i] === t)));
    if (direct && tokens.length <= 3 && !namesAPage) {
      const bare = rest.replace(/^(?:the|my|a|an)\s+/, "");
      const shown = bare.length > 40 ? bare.slice(0, 40) : bare;
      return { kind: "not-found", reply: `I couldn't find a page called "${shown}" in your menu. I can open pages like ${examples(dests)}.` };
    }
    return NONE;
  }

  return { buildDestinations, getDestinations, resolve };
}

/** Normalises a sentence the way the resolver does (exported for role modules' own guards). */
export const normaliseSentence = norm;
