import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { BellOff, CheckCheck, Search, Star, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { typeConfig } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotifications, type Notification } from "@/contexts/NotificationContext";
import { isSafeRoute } from "@/lib/commandBar";
import {
  CATEGORY_META, CATEGORY_ORDER, filterNotifications, inferCategory, isImportant, sortNewest, tabCounts,
  type InboxTab, type NotificationCategory,
} from "@/lib/notificationModel";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;

/**
 * Notification Inbox - every notification the signed-in user has, with All / Unread / Read / Important tabs,
 * search, a category filter, mark read, mark all read and dismiss.
 *
 * It reads the same NotificationContext as the bell, so the two always agree. Which notifications a person can see is
 * decided by the database (governance_notifications rows are readable only by their recipient) and by role-scoped
 * subscriptions in the context; this page only filters what that user already has.
 */
export default function NotificationInbox() {
  const navigate = useNavigate();
  const { notifications, markAsRead, markAllAsRead, dismiss } = useNotifications();
  const [tab, setTab] = useState<InboxTab>("all");
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const sorted = useMemo(() => sortNewest(notifications), [notifications]);
  const counts = useMemo(() => tabCounts(sorted), [sorted]);
  const filtered = useMemo(() => filterNotifications(sorted, { tab, category, query }), [sorted, tab, category, query]);
  const presentCategories = useMemo(() => {
    const have = new Set(sorted.map((n) => inferCategory(n)));
    return CATEGORY_ORDER.filter((c) => have.has(c));
  }, [sorted]);

  const filtersActive = tab !== "all" || category !== "all" || query.trim() !== "";
  const clearFilters = () => { setTab("all"); setCategory("all"); setQuery(""); setVisible(PAGE_SIZE); };

  const open = (n: Notification) => {
    markAsRead(n.id);
    if (isSafeRoute(n.link)) navigate(n.link);
  };

  return (
    <AppLayout>
      <PageHeader
        title="Notifications"
        subtitle="Everything sent to you, in one place."
        action={
          <Button variant="outline" size="sm" onClick={markAllAsRead} disabled={counts.unread === 0} className="gap-2">
            <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all as read
          </Button>
        }
      />

      <div className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as InboxTab); setVisible(PAGE_SIZE); }}>
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            {(["all", "unread", "read", "important"] as InboxTab[]).map((t) => (
              <TabsTrigger key={t} value={t} className="gap-1.5 capitalize">
                {t}
                <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{counts[t]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE); }}
              placeholder="Search notifications"
              aria-label="Search notifications"
              className="pl-9 pr-9"
              maxLength={100}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v as NotificationCategory | "all"); setVisible(PAGE_SIZE); }}>
            <SelectTrigger className="sm:w-56" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {presentCategories.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {filtered.length === 0 ? "No notifications to show" : `Showing ${Math.min(visible, filtered.length)} of ${filtered.length}`}
        </p>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-card px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BellOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {sorted.length === 0 ? "You have no notifications yet" : "No notifications match your filters"}
            </p>
            {filtersActive && sorted.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
            {filtered.slice(0, visible).map((n) => {
              const cfg = typeConfig[n.type] ?? typeConfig.info;
              const cat = inferCategory(n);
              const important = isImportant(n);
              const canOpen = isSafeRoute(n.link);
              return (
                <li key={n.id} className={cn("flex items-start gap-3 px-3 py-3 sm:px-4", !n.is_read && "bg-blue-50/60 dark:bg-blue-950/20")}>
                  <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", cfg.iconBg)}>{cfg.icon}</div>

                  <button
                    type="button"
                    onClick={() => open(n)}
                    className="min-w-0 flex-1 text-left"
                    aria-label={`${n.is_read ? "" : "Unread. "}${n.title}. ${canOpen ? "Opens the related page." : ""}`}
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("text-sm text-foreground", n.is_read ? "font-medium" : "font-semibold")}>{n.title}</span>
                      {important && (
                        <Badge variant="outline" className="gap-1 border-amber-300 px-1.5 py-0 text-[10px] text-amber-700">
                          <Star className="h-2.5 w-2.5" aria-hidden="true" /> Important
                        </Badge>
                      )}
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{CATEGORY_META[cat].label}</Badge>
                    </span>
                    <span className="mt-0.5 block break-words text-xs leading-relaxed text-muted-foreground">{n.message}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      {canOpen && <span className="text-accent"> · Open</span>}
                    </span>
                  </button>

                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                    {!n.is_read && (
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => markAsRead(n.id)} aria-label={`Mark "${n.title}" as read`}>
                        <span className="sm:hidden">Read</span><span className="hidden sm:inline">Mark read</span>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => dismiss(n.id)} aria-label={`Dismiss "${n.title}"`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > visible && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>Show more</Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
