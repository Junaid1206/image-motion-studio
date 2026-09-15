import { Link, NavLink, Outlet } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Wand2,
  Library,
  Database,
  ListChecks,
  Settings as SettingsIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/generate", label: "Generate", icon: Wand2 },
  { to: "/library", label: "Library", icon: Library },
  { to: "/datasets", label: "Dataset", icon: Database },
  { to: "/jobs", label: "Jobs", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function WorkerStatusPill() {
  const config = useQuery(api.videos.getStudioConfig);
  if (config === undefined) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> worker…
      </div>
    );
  }
  const w = config.worker;
  const online = !!w?.online;
  const label = online
    ? w?.status === "busy"
      ? "worker · busy"
      : "worker · online"
    : "worker · offline";
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          online && w?.status !== "busy" && "bg-emerald-500",
          online && w?.status === "busy" && "bg-amber-500",
          !online && "bg-zinc-600",
        )}
      />
      <span className="font-mono">{label}</span>
    </div>
  );
}

export default function StudioLayout() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border/70 bg-background">
        <div className="flex h-16 items-center border-b border-border/70 px-5">
          <Link to="/dashboard" className="cursor-pointer">
            <div className="text-sm font-bold tracking-tight">Image Motion Studio</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              personal video lab
            </div>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border/70 p-3">
          <WorkerStatusPill />
          <div className="mt-2 flex items-center justify-between gap-2 px-2 pb-1">
            <span className="truncate text-xs text-muted-foreground">
              {user?.email ?? user?.name ?? "anonymous"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 cursor-pointer px-2 text-xs text-muted-foreground"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
