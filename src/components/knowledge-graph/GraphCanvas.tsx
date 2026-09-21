import { useMemo, useState } from "react";
import type { GraphNode, GraphEdge } from "@/hooks/useKnowledgeGraph";
import { cn } from "@/lib/utils";

const COL_WIDTH = 220;
const ROW_HEIGHT = 64;
const NODE_W = 180;
const NODE_H = 44;
const PADDING = 24;

interface LaidOutNode extends GraphNode {
  layer: number;
  row: number;
  x: number;
  y: number;
}

/** Longest-path layering (Kahn's algorithm) so every edge points strictly left-to-right. */
function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): { laid: LaidOutNode[]; width: number; height: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<number, number[]>(); // node -> prerequisite ids
  nodes.forEach((n) => incoming.set(n.id, []));
  edges.forEach((e) => {
    if (byId.has(e.to) && byId.has(e.from)) incoming.get(e.to)?.push(e.from);
  });

  const layer = new Map<number, number>();
  const resolve = (id: number, guard = new Set<number>()): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (guard.has(id)) return 0; // safety net against any unexpected cycle
    guard.add(id);
    const prereqs = incoming.get(id) ?? [];
    const l = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => resolve(p, guard)));
    layer.set(id, l);
    return l;
  };
  nodes.forEach((n) => resolve(n.id));

  const layerGroups = new Map<number, GraphNode[]>();
  nodes.forEach((n) => {
    const l = layer.get(n.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(n);
  });

  const laid: LaidOutNode[] = [];
  let maxRows = 0;
  layerGroups.forEach((group, l) => {
    group.forEach((n, row) => {
      laid.push({ ...n, layer: l, row, x: PADDING + l * COL_WIDTH, y: PADDING + row * ROW_HEIGHT });
    });
    maxRows = Math.max(maxRows, group.length);
  });

  const numLayers = layerGroups.size || 1;
  return {
    laid,
    width: PADDING * 2 + numLayers * COL_WIDTH,
    height: PADDING * 2 + maxRows * ROW_HEIGHT,
  };
}

function strengthColor(strength: number) {
  if (strength >= 0.8) return "hsl(var(--destructive))";
  if (strength >= 0.5) return "hsl(var(--primary))";
  return "hsl(var(--muted-foreground))";
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  atRiskIds,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  atRiskIds?: Set<number>;
}) {
  const { laid, width, height } = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const byId = useMemo(() => new Map(laid.map((n) => [n.id, n])), [laid]);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">No graph data to show yet.</p>;
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
    <div className="w-full overflow-auto border rounded-lg bg-muted/20">
      <svg width={width} height={height} className="min-w-full">
        <defs>
          <marker id="kg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--muted-foreground))" />
          </marker>
        </defs>

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
            />
          );
        })}

        {laid.map((n) => {
          const isSelected = selectedId === n.id;
          const isAtRisk = atRiskIds?.has(n.id);
          const dimmed = hoveredId != null && !highlighted.has(n.id);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect?.(n.id)}
              className={cn(onSelect && "cursor-pointer")}
              opacity={dimmed ? 0.35 : 1}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={isSelected ? "hsl(var(--primary))" : n.is_external ? "hsl(var(--muted))" : "hsl(var(--card))"}
                stroke={isAtRisk ? "hsl(var(--destructive))" : "hsl(var(--border))"}
                strokeWidth={isAtRisk ? 2 : 1}
              />
              <text
                x={10}
                y={NODE_H / 2 + 4}
                fontSize={12}
                fill={isSelected ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"}
                className="select-none"
              >
                {n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name}
              </text>
              {isAtRisk && <circle cx={NODE_W - 10} cy={10} r={4} fill="hsl(var(--destructive))" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
