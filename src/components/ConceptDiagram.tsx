import type { VisualStep } from "@/lib/conceptVisual";

// Draws the steps as numbered boxes joined by arrows (left to right, then back right to left on the next row).
// Pure SVG, no extra library. Text is rendered as plain text, so nothing from the AI can run as code.

const NODE_W = 190;
const NODE_H = 60;
const GAP_X = 44;
const GAP_Y = 44;
const PAD = 16;
const MAX_COLS = 3;
const MAX_CHARS = 20;

function wrapLabel(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= MAX_CHARS || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = `${shown[1]}…`;
  return shown.map((l) => (l.length > MAX_CHARS ? `${l.slice(0, MAX_CHARS - 1)}…` : l));
}

export function ConceptDiagram({ steps, title }: { steps: VisualStep[]; title: string }) {
  if (steps.length === 0) return null;

  const cols = Math.min(MAX_COLS, steps.length);
  const rows = Math.ceil(steps.length / cols);
  const width = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X;
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;

  const nodes = steps.map((step, i) => {
    const row = Math.floor(i / cols);
    const pos = i % cols;
    const col = row % 2 === 0 ? pos : cols - 1 - pos;
    return { step, row, x: PAD + col * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) };
  });

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Diagram of ${title}`}
        className="mx-auto h-auto w-full text-muted-foreground"
        style={{ maxWidth: width }}
      >
        <defs>
          <marker id="concept-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="currentColor" />
          </marker>
        </defs>

        {nodes.slice(0, -1).map((a, i) => {
          const b = nodes[i + 1];
          let x1: number;
          let y1: number;
          let x2: number;
          let y2: number;
          if (a.row === b.row) {
            const dir = b.x > a.x ? 1 : -1;
            x1 = dir === 1 ? a.x + NODE_W : a.x;
            x2 = dir === 1 ? b.x : b.x + NODE_W;
            y1 = a.y + NODE_H / 2;
            y2 = y1;
          } else {
            x1 = a.x + NODE_W / 2;
            x2 = x1;
            y1 = a.y + NODE_H;
            y2 = b.y;
          }
          return (
            <line
              key={`arrow-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth={2}
              markerEnd="url(#concept-arrow)"
            />
          );
        })}

        {nodes.map(({ step, x, y }, i) => {
          const lines = wrapLabel(step.label);
          const cy = y + NODE_H / 2;
          return (
            <g key={`node-${i}`}>
              <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={10} className="fill-muted stroke-border" />
              <circle cx={x + 24} cy={cy} r={13} className="fill-primary" />
              <text
                x={x + 24}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontWeight={600}
                className="fill-primary-foreground"
              >
                {i + 1}
              </text>
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={x + 46}
                  y={cy + 5 + (li - (lines.length - 1) / 2) * 16}
                  fontSize={13}
                  fontWeight={500}
                  className="fill-foreground"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}