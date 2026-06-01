import { Menu, Bell, ChevronDown, User, Settings, LogOut, FileText, CheckCircle, XCircle, ClipboardList, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useGovernanceNotifications } from "@/contexts/GovernanceNotificationContext";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDistanceToNow } from "date-fns";

const pageTitles: Record<string, string> = {
  "/dashboard": "Home",
  "/diagnostic": "Diagnostic Phase",
  "/curative": "Curative Phase",
  "/analytics": "Learning Analytics & Insights",
  "/teacher": "Teacher Panel",
  "/settings": "Settings",
  "/alerts": "Alerts",
};

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

const eventIcon = (type: string) => {
  if (type.includes("submitted")) return <FileText className="h-4 w-4 text-accent" />;
  if (type.includes("approved")) return <CheckCircle className="h-4 w-4 text-success" />;
  if (type.includes("rejected")) return <XCircle className="h-4 w-4 text-danger" />;
  if (type.includes("assigned")) return <ClipboardList className="h-4 w-4 text-primary" />;
  if (type.includes("completed")) return <CheckCircle className="h-4 w-4 text-success" />;
  return <AlertTriangle className="h-4 w-4 text-warning" />;
};

export function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { profile, signOut } = useAuth();
  const { alerts, unreadCount: alertUnread, markAsRead: markAlertRead } = useNotifications();
  const { notifications, unreadCount: govUnread, markAsRead: markGovRead } = useGovernanceNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellTab, setBellTab] = useState<"governance" | "alerts">("governance");
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const totalUnread = alertUnread + govUnread;
  const pageTitle = pageTitles[location.pathname] || "APAS";

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/login");
  };

  const recentAlerts = alerts.slice(0, 5);
  const recentGov = notifications.slice(0, 8);

  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center border-b border-border bg-card px-4 shadow-card">
      <button
        onClick={onToggleSidebar}
        className="mr-3 rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h2 className="text-lg font-semibold text-foreground">{pageTitle}</h2>
      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen(!bellOpen)}
            className="relative rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
            {totalUnread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-danger-foreground">
                {totalUnread > 9 ? "9+" : totalUnread}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full mt-1 w-96 rounded-card border border-border bg-card shadow-elevated z-50">
              {/* Tabs */}
              <div className="flex border-b border-border">
                <button
                  onClick={() => setBellTab("governance")}
                  className={`flex-1 px-3 py-2.5 text-xs font-semibold transition-colors ${bellTab === "governance" ? "text-accent border-b-2 border-accent" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Governance {govUnread > 0 && <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] text-accent-foreground">{govUnread}</span>}
                </button>
                <button
                  onClick={() => setBellTab("alerts")}
                  className={`flex-1 px-3 py-2.5 text-xs font-semibold transition-colors ${bellTab === "alerts" ? "text-accent border-b-2 border-accent" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Mismatch Alerts {alertUnread > 0 && <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] text-danger-foreground">{alertUnread}</span>}
                </button>
              </div>

              {bellTab === "governance" ? (
                <div className="max-h-80 overflow-y-auto">
                  {recentGov.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">No governance notifications</p>
                  ) : (
                    recentGov.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => { markGovRead(n.id); setBellOpen(false); }}
                        className={`flex items-start gap-3 w-full text-left border-b border-border px-4 py-3 transition-colors hover:bg-muted/50 last:border-0 ${!n.is_read ? "bg-accent/5" : ""}`}
                      >
                        <div className="mt-0.5">{eventIcon(n.event_type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        {!n.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {recentAlerts.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">No alerts yet</p>
                  ) : (
                    recentAlerts.map((a) => (
                      <Link
                        key={a.id}
                        to="/alerts"
                        onClick={() => { markAlertRead(a.id); setBellOpen(false); }}
                        className="flex items-start gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/50 last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {a.student_group || "Alert"} — {a.lesson_type || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <StatusBadge variant={a.status === "flagged" ? "danger" : "success"}>
                          {a.status}
                        </StatusBadge>
                      </Link>
                    ))
                  )}
                </div>
              )}

              <div className="border-t border-border px-4 py-2 text-center">
                <Link
                  to="/alerts"
                  onClick={() => setBellOpen(false)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  View All Notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-button px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={profile?.full_name || "User"} className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                {(profile?.full_name || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="hidden font-medium text-foreground sm:inline">
              {profile?.full_name || "User"}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-card border border-border bg-card py-1 shadow-elevated z-50">
              <button
                onClick={() => { setMenuOpen(false); navigate("/settings"); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <User className="h-4 w-4 text-muted-foreground" /> Profile
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate("/settings"); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Settings className="h-4 w-4 text-muted-foreground" /> Settings
              </button>
              <div className="my-1 border-t border-border" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-secondary"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
