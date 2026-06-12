import {
  Menu, Bell, ChevronDown, User, Settings, LogOut,
  Info, CheckCircle, XCircle, AlertTriangle, BellOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useLocation, useNavigate } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";

// ─── Page titles ──────────────────────────────────────────────────────────────

const pageTitles: Record<string, string> = {
  "/dashboard": "Home",
  "/diagnostic": "Diagnostic Phase",
  "/curative": "Curative Phase",
  "/analytics": "Learning Analytics & Insights",
  "/teacher": "Teacher Panel",
  "/settings": "Settings",
  "/alerts": "Alerts",
  "/requests": "Diagnostic Requests",
};

// ─── Per-type icon + colour config ───────────────────────────────────────────

const typeConfig = {
  info: {
    icon: <Info className="h-4 w-4" />,
    dot: "bg-blue-500",
    iconBg: "bg-blue-50 text-blue-500",
  },
  success: {
    icon: <CheckCircle className="h-4 w-4" />,
    dot: "bg-green-500",
    iconBg: "bg-green-50 text-green-500",
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" />,
    dot: "bg-yellow-500",
    iconBg: "bg-yellow-50 text-yellow-600",
  },
  error: {
    icon: <XCircle className="h-4 w-4" />,
    dot: "bg-red-500",
    iconBg: "bg-red-50 text-red-500",
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { profile, signOut } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const pageTitle = pageTitles[location.pathname] || "APAS";

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node))
        setBellOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/login");
  };

  const handleNotificationClick = (id: string, link?: string) => {
    markAsRead(id);
    if (link) {
      setBellOpen(false);
      navigate(link);
    }
  };

  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center border-b border-border bg-card px-4 shadow-card">
      {/* Sidebar toggle (mobile) */}
      <button
        onClick={onToggleSidebar}
        className="mr-3 rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h2 className="text-lg font-semibold text-foreground">{pageTitle}</h2>
      <div className="flex-1" />

      <div className="flex items-center gap-2">

        {/* ── Bell ─────────────────────────────────────────────────────────── */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen((v) => !v)}
            className="relative rounded-button p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full mt-2 w-[380px] rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">

              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-foreground" />
                  <span className="text-sm font-semibold text-foreground">
                    Notifications
                  </span>
                  {unreadCount > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <button
                  onClick={markAllAsRead}
                  disabled={unreadCount === 0}
                  className="text-xs font-medium text-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:text-muted-foreground transition-colors"
                >
                  Mark all read
                </button>
              </div>

              {/* Notification list */}
              <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <BellOff className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        All caught up
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        No notifications yet
                      </p>
                    </div>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const cfg = typeConfig[n.type] ?? typeConfig.info;
                    return (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n.id, n.link)}
                        className={`w-full text-left flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 ${
                          !n.is_read ? "bg-blue-50/60 dark:bg-blue-950/20" : ""
                        }`}
                      >
                        {/* Coloured icon */}
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.iconBg}`}
                        >
                          {cfg.icon}
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-snug">
                            {n.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                            {n.message}
                          </p>
                          <p className="text-[11px] text-muted-foreground/60 mt-1">
                            {formatDistanceToNow(new Date(n.created_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>

                        {/* Unread dot */}
                        {!n.is_read && (
                          <span
                            className={`mt-2 h-2 w-2 shrink-0 rounded-full ${cfg.dot}`}
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── User dropdown ─────────────────────────────────────────────────── */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-button px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile?.full_name || "User"}
                className="h-7 w-7 rounded-full object-cover"
              />
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
                <User className="h-4 w-4 text-muted-foreground" />
                Profile
              </button>
              <button
                onClick={() => { setMenuOpen(false); navigate("/settings"); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                Settings
              </button>
              <div className="my-1 border-t border-border" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-secondary"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}