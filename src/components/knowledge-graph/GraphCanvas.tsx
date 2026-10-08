import { useMemo, useState } from "react";
import type { GraphNode, GraphEdge } from "@/hooks/useKnowledgeGraph";
import { cn } from "@/lib/utils";

const COL_WIDTH = 220;
const ROW_HEIGHT = 64;
const NODE_W = 180;
const NODE_H = 44;
const PADDING = 24;
const LOOSE_LABEL_H = 40;
const MIN_LOOSE_COLS = 3; // 3 columns fit the topic card without a horizontal scrollbar

interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
}

interface Layout {
  laid: LaidOutNode[];
  width: number;
  height: number;
  looseLabelY: number | null;
  linkedCount: number;
  looseCount: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Left-to-right layered layout.
 *  - Topics that have at least one prerequisite link are layered by longest path (every arrow points right);
 *    rows inside a layer are ordered by the average row of their neighbours, which removes most crossings.
 *  - Topics with no links at all are packed into a grid underneath, instead of one very tall first column.
 *  - Cycle-safe: nodes trapped in an unexpected cycle fall back to the first layer rather than looping forever.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Layout {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  const touched = new Set<number>();
  valid.forEach((e) => { touched.add(e.from); touched.add(e.to); });
  const linked = nodes.filter((n) => touched.has(n.id));
  const loose = nodes.filter((n) => !touched.has(n.id));

  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  linked.forEach((n) => { preds.set(n.id, []); succs.set(n.id, []); indeg.set(n.id, 0); });
  valid.forEach((e) => {
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  });

  // Longest-path layering (Kahn)
  const layer = new Map<number, number>();
  const queue = linked.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  queue.forEach((id) => layer.set(id, 0));
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    for (const v of succs.get(u)!) {
      layer.set(v, Math.max(layer.get(v) ?? 0, layer.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  linked.forEach((n) => { if (!layer.has(n.id)) layer.set(n.id, 0); });

  const numLayers = linked.length ? Math.max(...linked.map((n) => layer.get(n.id)!)) + 1 : 0;
  const groups: GraphNode[][] = Array.from({ length: numLayers }, () => []);
  linked.forEach((n) => groups[layer.get(n.id)!].push(n));

  // Order rows to reduce crossings: one sweep right (by prerequisites), one sweep left (by dependants)
  const row = new Map<number, number>();
  const reindex = () => groups.forEach((g) => g.forEach((n, i) => row.set(n.id, i)));
  reindex();
  const sortBy = (g: GraphNode[], neighbours: Map<number, number[]>) => {
    const key = new Map<number, number>();
    g.forEach((n) => {
      const rs = (neighbours.get(n.id) ?? []).map((id) => row.get(id)).filter((r): r is number => r !== undefined);
      key.set(n.id, rs.length ? mean(rs) : row.get(n.id)!);
    });
    g.sort((a, b) => key.get(a.id)! - key.get(b.id)!); // Array.sort is stable: ties keep curriculum order
  };
  for (let l = 1; l < numLayers; l++) { sortBy(groups[l], preds); reindex(); }
  for (let l = numLayers - 2; l >= 0; l--) { sortBy(groups[l], succs); reindex(); }

  const laid: LaidOutNode[] = [];
  groups.forEach((g, l) => g.forEach((n, r) => laid.push({ ...n, x: PADDING + l * COL_WIDTH, y: PADDING + r * ROW_HEIGHT })));
  const linkedRows = groups.reduce((m, g) => Math.max(m, g.length), 0);
  const linkedHeight = linkedRows * ROW_HEIGHT;

  // Unlinked topics: grid below
  const cols = Math.max(numLayers, MIN_LOOSE_COLS);
  const looseTop = PADDING + (linked.length ? linkedHeight + LOOSE_LABEL_H : 0);
  loose.forEach((n, i) => {
    laid.push({ ...n, x: PADDING + (i % cols) * COL_WIDTH, y: looseTop + Math.floor(i / cols) * ROW_HEIGHT });
  });
  const looseRows = Math.ceil(loose.length / cols);

  const usedCols = Math.max(numLayers, Math.min(cols, loose.length), 1);
  return {
    laid,
    width: PADDING * 2 + usedCols * COL_WIDTH,
    height: loose.length ? looseTop + looseRows * ROW_HEIGHT + PADDING : PADDING * 2 + linkedHeight,
    looseLabelY: linked.length && loose.length ? PADDING + linkedHeight + LOOSE_LABEL_H / 2 : null,
    linkedCount: linked.length,
    looseCount: loose.length,
  };
}

function strengthColor(strength: number) {
  if (strength >= 0.8) return "hsl(var(--destructive))";
  if (strength >= 0.5) return "hsl(var(--primary))";
  return "hsl(var(--muted-foreground))";
}

const LEGEND = [
  { color: "hsl(var(--destructive))", label: "Strong dependency" },
  { color: "hsl(var(--primary))", label: "Moderate" },
  { color: "hsl(var(--muted-foreground))", label: "Weak" },
];

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  atRiskIds,
  emptyMessage = "No graph data to show yet.",
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  atRiskIds?: Set<number>;
  emptyMessage?: string;
}) {
  const { laid, width, height, looseLabelY, linkedCount, looseCount } = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const byId = useMemo(() => new Map(laid.map((n) => [n.id, n])), [laid]);
  const hasExternal = useMemo(() => nodes.some((n) => n.is_external), [nodes]);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">{emptyMessage}</p>;
  }

  const highlighted = new Set<number>();
  if (hoveredId != null) {
    highlighted.add(hoveredId);
    edges.forEach((e) => {
      if (e.from === hoveredId) highlighted.add(e.to);
      if (e.to === hoveredId) highlighted.add(e.from);
    });
  }

  return (
    <div className="space-y-2">
      <div className="w-full overflow-auto border rounded-lg bg-muted/20">
        <svg width={width} height={height} className="min-w-full" role="group" aria-label="Prerequisite graph">
          <defs>
            <marker id="kg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--muted-foreground))" />
            </marker>
          </defs>

          {looseLabelY != null && (
            <text x={PADDING} y={looseLabelY + 4} fontSize={11} fill="hsl(var(--muted-foreground))">
              Not linked to other items yet ({looseCount})
            </text>
          )}

          {edges.map((e, i) => {
            const from = byId.get(e.from);
            const to = byId.get(e.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const midX = (x1 + x2) / 2;
            const dimmed = hoveredId != null && !(highlighted.has(e.from) && highlighted.has(e.to));
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                stroke={strengthColor(e.strength)}
                strokeWidth={1.5}
                opacity={dimmed ? 0.15 : 0.6}
                markerEnd="url(#kg-arrow)"
              >
                <title>{`${from.name} → ${to.name}${e.rationale ? `\n${e.rationale}` : ""}`}</title>
              </path>
            );
          })}

          {laid.map((n) => {
            const isSelected = selectedId === n.id;
            const isAtRisk = atRiskIds?.has(n.id);
            const dimmed = hoveredId != null && !highlighted.has(n.id);
            const interactive = !!onSelect;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(n.id)}
                onBlur={() => setHoveredId(null)}
                onClick={() => onSelect?.(n.id)}
                onKeyDown={(ev) => {
                  if (interactive && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onSelect?.(n.id); }
                }}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? "button" : undefined}
                aria-label={interactive ? n.name : undefined}
                aria-pressed={interactive ? isSelected : undefined}
                className={cn(interactive && "cursor-pointer outline-none focus-visible:[&>rect]:stroke-[hsl(var(--primary))] focus-visible:[&>rect]:stroke-2")}
                opacity={dimmed ? 0.35 : 1}
              >
                <title>{[n.name, n.chapter_name, n.is_external ? `From topic: ${n.topic_name ?? "another topic"}` : null].filter(Boolean).join(" — ")}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={isSelected ? "hsl(var(--primary))" : n.is_external ? "hsl(var(--muted))" : "hsl(var(--card))"}
                  stroke={isAtRisk ? "hsl(var(--destructive))" : "hsl(var(--border))"}
                  strokeWidth={isAtRisk ? 2 : 1}
                  strokeDasharray={n.is_external ? "4 3" : undefined}
                />
                <text
                  x={10}
                  y={NODE_H / 2 + 4}
                  fontSize={12}
                  fill={isSelected ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"}
                  className="select-none"
                >
                  {n.name.length > 24 ? n.name.slice(0, 23) + "…" : n.name}
                </text>
                {isAtRisk && <circle cx={NODE_W - 10} cy={10} r={4} fill="hsl(var(--destructive))" />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Arrow: learn the first item before the second.</span>
        {linkedCount > 0 && LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: l.color }} />{l.label}
          </span>
        ))}
        {hasExternal && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded border border-dashed bg-muted" />From another topic
          </span>
        )}
      </div>
    </div>
  );
}
