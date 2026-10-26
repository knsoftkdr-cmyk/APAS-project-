import { useState, type ReactNode } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, Check, CloudOff, GripVertical, Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDashboardLayout, type LayoutSaveState } from "@/hooks/useDashboardLayout";
import type { ResolvedWidget, WidgetDef } from "@/lib/dashboardLayout";

export interface DashboardWidget extends WidgetDef {
  render: () => ReactNode;
}

const SAVE_LABEL: Record<LayoutSaveState, { text: string; icon: ReactNode } | null> = {
  idle: null,
  saving: { text: "Saving...", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  saved: { text: "Saved", icon: <Check className="h-3 w-3" /> },
  "device-only": { text: "Saved on this device", icon: <CloudOff className="h-3 w-3" /> },
  error: { text: "Unable to save to your account (kept on this device)", icon: <CloudOff className="h-3 w-3" /> },
};

function Row({ w, index, count, onMove, onToggle }: {
  w: ResolvedWidget; index: number; count: number;
  onMove: (id: string, dir: -1 | 1) => void; onToggle: (id: string, hidden: boolean) => void;
}) {
  const controls = useDragControls();
  const canHide = w.canHide !== false;
  return (
    <Reorder.Item
      value={w.id}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-2 rounded-lg border bg-card px-2 py-2 select-none"
      data-testid={`widget-row-${w.id}`}
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${w.title}`}
        onPointerDown={(e) => controls.start(e)}
        className="touch-none cursor-grab active:cursor-grabbing rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className={`min-w-0 flex-1 ${w.hidden ? "opacity-50" : ""}`}>
        <p className="truncate text-sm font-medium">{w.title}</p>
        {w.description && <p className="truncate text-xs text-muted-foreground">{w.description}</p>}
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={index === 0} aria-label={`Move ${w.title} up`} onClick={() => onMove(w.id, -1)}>
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={index === count - 1} aria-label={`Move ${w.title} down`} onClick={() => onMove(w.id, 1)}>
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Switch
        checked={!w.hidden}
        disabled={!canHide}
        onCheckedChange={(on) => onToggle(w.id, !on)}
        aria-label={canHide ? `Show ${w.title}` : `${w.title} is always shown`}
        title={canHide ? undefined : "Always shown"}
      />
    </Reorder.Item>
  );
}

/**
 * Renders a dashboard's sections in the user's own order, with a "Customize" panel to reorder, hide/show
 * and reset them. The section markup itself is untouched - each widget just returns its existing JSX.
 */
export function PersonalizedDashboard({ dashboardKey, widgets }: { dashboardKey: string; widgets: DashboardWidget[] }) {
  const [open, setOpen] = useState(false);
  const { widgets: list, move, reorder, setHidden, reset, saveState, customized } = useDashboardLayout(dashboardKey, widgets);
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const visible = list.filter((w) => !w.hidden);
  const status = SAVE_LABEL[saveState];

  return (
    <>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)} data-testid="customize-dashboard">
          <SlidersHorizontal className="h-4 w-4" />
          Customize
        </Button>
      </div>

      {visible.map((w) => (
        <section key={w.id} data-widget={w.id} aria-label={w.title}>
          {byId.get(w.id)?.render()}
        </section>
      ))}

      {visible.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          All sections are hidden. Use <strong>Customize</strong> to show them again.
        </p>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Customize your dashboard</SheetTitle>
            <SheetDescription>Drag a section by its handle (or use the arrows) to reorder it. Use the switch to show or hide it.</SheetDescription>
          </SheetHeader>
          <Reorder.Group axis="y" values={list.map((w) => w.id)} onReorder={reorder} className="flex-1 space-y-2 overflow-y-auto pr-1">
            {list.map((w, i) => (
              <Row key={w.id} w={w} index={i} count={list.length} onMove={move} onToggle={setHidden} />
            ))}
          </Reorder.Group>
          <SheetFooter className="items-center gap-2 sm:justify-between">
            <span role="status" aria-live="polite" className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="layout-status">
              {status?.icon}{status?.text}
            </span>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!customized} onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              Reset to default
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
