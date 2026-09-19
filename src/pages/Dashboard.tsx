import { Link } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Database,
  Film,
  ListChecks,
  Loader2,
  Server,
  XCircle,
} from "lucide-react";

const ACTIVE = ["queued", "connecting", "loading_model", "generating", "processing"];

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Dashboard() {
  const config = useQuery(api.videos.getStudioConfig);
  const videos = useQuery(api.videos.listMyVideos);
  const jobs = useQuery(api.jobs.listMyJobs);
  const datasets = useQuery(api.datasets.listDatasets);

  const workerOnline = true;
  const activeJob = jobs?.find((j) => ACTIVE.includes(j.status)) ?? null;
  const completedCount = videos?.filter((v) => v.status === "completed").length ?? 0;
  const failedCount = videos?.filter((v) => v.status === "failed").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground">
          Your personal AI video lab — generate image→video clips through a hosted GPU.
        </p>
      </div>

      {/* Status strip */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatusCard
          icon={<Server className="size-4" />}
          label="Hosted GPU"
          value={workerOnline ? (config?.worker?.status ?? "online") : "offline"}
          tone={workerOnline ? "ok" : "muted"}
          sub={
            config?.worker?.gpuName
              ? `${config.worker.gpuName}${config.worker.vramGb ? ` · ${config.worker.vramGb} GB` : ""}`
              : "Hosted WAN GPU service"
          }
        />
        <StatusCard
          icon={<Film className="size-4" />}
          label="Library"
          value={videos === undefined ? "…" : `${completedCount}`}
          tone="default"
          sub={`${failedCount} failed · ${datasets?.length ?? 0} datasets`}
        />
        <StatusCard
          icon={<ListChecks className="size-4" />}
          label="Jobs"
          value={jobs === undefined ? "…" : activeJob ? "1 active" : "idle"}
          tone={activeJob ? "warn" : "default"}
          sub={activeJob ? activeJob.status.replace("_", " ") : "nothing in the queue"}
        />
      </div>

      {/* Active job */}
      {activeJob && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border/70 px-4 py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-sm">{activeJob.prompt}</p>
          <Badge variant="outline" className="font-normal">
            {activeJob.status}
          </Badge>
          <Button asChild variant="ghost" size="sm" className="cursor-pointer gap-1">
            <Link to="/generate">
              Open <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <QuickLink
          to="/generate"
          icon={<Clapperboard className="size-5" />}
          title="Generate"
          desc="Upload an image, describe the motion, and generate a real video on the hosted GPU."
        />
        <QuickLink
          to="/library"
          icon={<Film className="size-5" />}
          title="Library"
          desc="Play, download, tag and organize every finished clip."
        />
        <QuickLink
          to="/datasets"
          icon={<Database className="size-5" />}
          title="Dataset"
          desc="Curate clips with captions and metadata for future LoRA training."
        />
        <QuickLink
          to="/settings"
          icon={<Server className="size-5" />}
          title="Settings"
          desc="Hosted GPU generation is ready — no notebook, token, or local GPU setup."
        />
      </div>

      {/* Recent activity */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Recent activity</h2>
          <Button asChild variant="ghost" size="sm" className="cursor-pointer gap-1 text-muted-foreground">
            <Link to="/jobs">
              All jobs <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        <Separator className="my-3" />
        {jobs === undefined ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> loading…
          </div>
        ) : jobs.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No jobs yet — queue your first render from Generate.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {jobs.slice(0, 6).map((j) => (
              <div key={j._id} className="flex items-center gap-3 py-3">
                {j.status === "completed" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                ) : j.status === "failed" || j.status === "cancelled" ? (
                  <XCircle className="size-4 shrink-0 text-destructive" />
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                <p className="min-w-0 flex-1 truncate text-sm">{j.prompt}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {timeAgo(j.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "default" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/70 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-widest">{label}</span>
      </div>
      <span className={`text-lg font-semibold capitalize tracking-tight ${toneClass}`}>
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group flex cursor-pointer items-start gap-4 rounded-lg border border-border/70 p-4 transition-colors hover:bg-accent/40"
    >
      <div className="mt-0.5 text-muted-foreground group-hover:text-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium tracking-tight">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </Link>
  );
}
