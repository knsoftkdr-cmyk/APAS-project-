// supabase/functions/_shared/explainerScenes.ts
//
// Content Studio "Animated explainer" video: asks the AI to plan, for every slide, a picture scene
// that animates in step with the narration. The browser draws and animates it
// (src/lib/explainerScene.ts - keep the picture / action names in sync with that file).
// Timing is by narration sentence, split exactly like the browser does (splitSentences).

import { type AiConfig, callAi } from "./aiClient.ts";

export interface SceneSlide {
  title: string;
  narration?: string;
  speaker_notes?: string;
  bullets: string[];
}

/** Same split as src/lib/lessonVideo.ts sentenceTimes(). */
export function splitSentences(text: string): string[] {
  return (text.replace(/\s+/g, " ").trim().match(/[^.!?؟।]+[.!?؟।]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

export const slideNarration = (s: SceneSlide) => s.narration?.trim() || [s.speaker_notes, ...s.bullets].filter(Boolean).join(". ");

const PICTURES = "sun, cloud, rain, plant, flower, tree, leaf, drop, bubble, sugar, earth, moon, star, heart, cell, bulb, battery, magnet, box, text";

const SCENE_RULES = `You plan short animated explainer scenes for a children's lesson video (like a science explainer cartoon).
For EACH slide you get its narration split into numbered sentences [0], [1], ... Plan ONE scene that SHOWS the idea with pictures that move while the teacher speaks. Do not just repeat the text: show the process (things travelling, growing, changing, cause -> effect).

STAGE: 100 x 100 grid. x: 0 left -> 100 right, y: 0 top -> 100 bottom.
- Keep every picture inside x 8..92 and y 14..78. The heading tag covers the top-left corner (x<45, y<14) and subtitles cover y>80.
- background: "outdoor" (sky + ground; the ground line is y=68 - put plant/tree/flower/people/animals ON the ground at y=68 or just above), "plain" (clean light background - best for diagrams, close-ups, maths, grammar), "space" (stars - planets, moon), "water" (under water), "night".
- Spread pictures out; do not overlap them. 3 to 7 elements per scene.

ELEMENTS: {"id": "short_id", "pic": "...", "x": n, "y": n, "size": n, "text": "...", "label": "...", "color": "#hex"}
- pic is one of: ${PICTURES} - or ANY single emoji (e.g. "🧒", "🐄", "🦷", "🍎", "🏠", "🚗", "🧲", "🔥", "🧊", "🌋", "🦋", "🐛", "🥚").
- plant / tree / flower: (x, y) is the BASE on the ground; it can be referenced as "plant.leaf", "plant.roots", "plant.top".
- Any element can be referenced as "id.top", "id.bottom", "id.left", "id.right" or just "id" (centre).
- bubble: a circle with short "text" inside (e.g. "CO₂", "O₂", "H₂O"). sugar: hexagon with "text" (e.g. "Glucose"). box: a card with "text" (a word, a number, a short equation like "3 + 4 = 7"). text: big plain text.
- size = % of the video height (defaults are fine; plant ~45, sun ~18, emoji ~14, drop ~7, bubble ~10, box ~14).
- label: a short name tag (1-3 words) under the picture.

ACTIONS (each has "at" = the sentence number when it starts; 1.5 = halfway through sentence 1):
- {"type":"appear","target":id,"at":n}  pop in. Elements with no appear/grow are visible from the start.
- {"type":"grow","target":id,"at":n}  grow up from the ground (plants, trees, flowers).
- {"type":"fade_out","target":id,"at":n}
- {"type":"move","target":id,"to":ref,"at":n}  ref = element id / "id.part" / [x, y].
- {"type":"flow","pic":"drop|bubble|sugar|star|heart|dot|<emoji>","text":"CO₂","from":ref,"via":[ref...],"to":ref,"at":n,"until":n,"count":4}  a stream of small pictures travelling along a path (water up the stem, air into the lungs, electricity round a circuit, food along a chain).
- {"type":"rays","from":ref,"to":ref,"at":n}  light / heat beams (sun -> leaf, bulb -> room).
- {"type":"arrow","from":ref,"to":ref,"label":"1-2 words","at":n}  cause -> effect, steps, cycles.
- {"type":"label","target":id,"text":"1-4 words","at":n,"side":"top|bottom|left|right"}  a call-out tag.
- {"type":"highlight","target":id,"at":n}  pulsing ring to draw attention.
- {"type":"zoom","target":ref,"scale":1.6,"at":n} / {"type":"zoom_out","at":n}  camera close-up and back.

TIMING: make something happen on EVERY sentence, in the order the narration mentions it. "at" must be below the slide's sentence count. 4 to 12 actions per scene.
WORDS: every text / label / box in the lesson language, very short. Use correct science (e.g. H₂O, CO₂, O₂ with subscripts).

EXAMPLE (narration: [0] A plant needs three things to make food. [1] First, sunlight falls on the leaves. [2] Second, the roots take in water from the soil. [3] Third, the leaves take in carbon dioxide from the air.):
{"background":"outdoor","elements":[{"id":"sun","pic":"sun","x":86,"y":20,"label":"Sunlight"},{"id":"plant","pic":"plant","x":45,"y":68,"size":50},{"id":"water","pic":"drop","x":24,"y":76,"size":8,"label":"Water"},{"id":"co2","pic":"bubble","x":80,"y":48,"size":11,"text":"CO₂","label":"Carbon dioxide","color":"#64748B"}],
"actions":[{"type":"highlight","target":"plant","at":0},{"type":"appear","target":"sun","at":1},{"type":"rays","from":"sun","to":"plant.leaf","at":1.2},{"type":"appear","target":"water","at":2},{"type":"flow","pic":"drop","from":"water","via":["plant.roots",[45,55]],"to":"plant.leaf","at":2.3,"count":5},{"type":"appear","target":"co2","at":3},{"type":"flow","pic":"bubble","text":"CO₂","color":"#64748B","from":[96,40],"via":["co2"],"to":"plant.leaf","at":3.3,"count":4}]}`;

function scenePrompt(slides: SceneSlide[], firstIndex: number, ctx: { language: string; subject: string; classLevel: string; title: string }) {
  const parts = slides.map((s, i) => {
    const sentences = splitSentences(slideNarration(s));
    return `SLIDE ${firstIndex + i + 1}: "${s.title}" (${sentences.length} sentences)\n` + sentences.map((x, k) => `[${k}] ${x}`).join("\n");
  });
  return `${SCENE_RULES}

LESSON: "${ctx.title}"${ctx.subject ? ` - ${ctx.subject}` : ""}${ctx.classLevel ? `, ${ctx.classLevel}` : ""}. Language for all words: ${ctx.language}.

${parts.join("\n\n")}

Return JSON only: {"scenes": [ one scene object per slide above, in the same order ]}`;
}

/** Light server-side check; the browser cleans each scene again before drawing it. */
function validScene(v: unknown): Record<string, unknown> | null {
  // deno-lint-ignore no-explicit-any
  const s = v as any;
  if (!s || typeof s !== "object" || !Array.isArray(s.elements) || s.elements.length === 0) return null;
  return {
    background: typeof s.background === "string" ? s.background : "plain",
    elements: s.elements.slice(0, 14),
    actions: Array.isArray(s.actions) ? s.actions.slice(0, 40) : [],
  };
}

/**
 * Plan a scene for every slide. Slides go to the AI in small groups, in parallel, so a long
 * lesson stays fast; a group that fails just leaves its slides as normal (bullet) slides.
 */
export async function planExplainerScenes(
  cfg: AiConfig,
  slides: SceneSlide[],
  ctx: { language: string; subject: string; classLevel: string; title: string },
  opts: { timeoutMs?: number } = {},
): Promise<(Record<string, unknown> | null)[]> {
  const GROUP = 3;
  const groups: { start: number; slides: SceneSlide[] }[] = [];
  for (let i = 0; i < slides.length; i += GROUP) groups.push({ start: i, slides: slides.slice(i, i + GROUP) });
  const out: (Record<string, unknown> | null)[] = slides.map(() => null);
  const errors: string[] = [];
  await Promise.all(groups.map(async (g) => {
    try {
      const { text } = await callAi(cfg, scenePrompt(g.slides, g.start, ctx), {
        temperature: 0.5,
        maxOutputTokens: 12288,
        timeoutMs: opts.timeoutMs ?? 110_000,
        attemptTimeoutMs: 70_000,
      });
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      const parsed = JSON.parse(cleaned);
      const scenes = Array.isArray(parsed) ? parsed : parsed?.scenes;
      if (!Array.isArray(scenes)) throw new Error("no scenes in the answer");
      g.slides.forEach((_, k) => { out[g.start + k] = validScene(scenes[k]); });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }));
  if (out.every((s) => !s)) throw new Error(`Could not plan the animations${errors.length ? ` (${errors[0].slice(0, 200)})` : ""}`);
  return out;
}
