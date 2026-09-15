import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
  ListChecks,
  History,
} from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-zinc-800 text-zinc-300",
  connecting: "bg-blue-950 text-blue-300",
  loading_model: "bg-indigo-950 text-indigo-300",
  generating: "bg-indigo-950 text-indigo-200",
  processing: "bg-blue-950 text-blue-200",
  completed: "bg-emerald-950 text-emerald-300",
  failed: "bg-red-950 text-red-300",
  cancelled: "bg-zinc-900 text-zinc-400",
};

type JobRow = {
  _id: Id<"jobs">;
  type: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  settings: { durationSeconds: number; aspectRatio: string; resolution: string; seed?: number };
  status: string;
  progress?: number;
  workerStatus?: string;
  errorMessage?: string;
  videoId?: Id<"videos">;
  createdAt: number;
  updatedAt: number;
};

type EventRow = {
  _id: Id<"workerEvents">;
  level: string;
  state?: string;
  message: string;
  at: number;
};

export default function Jobs() {
  const jobs = useQuery(api.jobs.listMyJobs) as JobRow[] | undefined;
  const cancelJob = useMutation(api.jobs.cancelJob);
  const [openJob, setOpenJob] = useState<Id<"jobs"> | null>(null);

  if (jobs === undefined) {
    return (
      <div className="flex items-center justify-center py-40 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> loading jobs…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Every generation attempt and its real backend state. The worker updates these
          rows through the authenticated API.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="mt-10 flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
          <ListChecks className="size-5" />
          No jobs yet. Queue one from the Generate page.
        </div>
      ) : (
        <div className="mt-8 flex flex-col divide-y divide-border/60 rounded-lg border border-border/70">
          {jobs.map((j) => (
            <div key={j._id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLES[j.status] ?? ""}`}>
                  {j.status}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm">{j.prompt}</p>
                {["queued", "connecting", "loading_model", "generating", "processing"].includes(j.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer gap-1 text-muted-foreground"
                    onClick={() =>
                      void cancelJob({ id: j._id }).then(() => toast("Job cancelled."))
                    }
                  >
                    <Ban className="size-3.5" /> Cancel
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer gap-1 text-muted-foreground"
                  onClick={() => setOpenJob(openJob === j._id ? null : j._id)}
                >
                  <History className="size-3.5" /> Timeline
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{j.type === "text" ? "text→video" : "image→video"}</span>
                <span>{j.model}</span>
                <span>
                  {j.settings.durationSeconds}s · {j.settings.aspectRatio} ·{" "}
                  {j.settings.resolution}
                </span>
                {j.settings.seed !== undefined && <span>seed {j.settings.seed}</span>}
                {j.workerStatus && <span className="font-mono">worker: {j.workerStatus}</span>}
                {j.errorMessage && <span className="text-destructive">{j.errorMessage}</span>}
              </div>
              {openJob === j._id && <JobTimeline jobId={j._id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobTimeline({ jobId }: { jobId: Id<"jobs"> }) {
  const events = useQuery(api.jobs.getJobEvents, { jobId }) as EventRow[] | undefined;
  if (events === undefined) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> loading timeline…
      </div>
    );
  }
  if (events.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">No events recorded.</p>;
  }
  return (
    <div className="rounded-md border border-border/60 bg-accent/20 px-4 py-3">
      <div className="flex flex-col gap-1.5">
        {events.map((ev) => (
          <div key={ev._id} className="flex items-start gap-2 text-xs">
            {ev.level === "error" ? (
              <XCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
            ) : ev.level === "warning" ? (
              <Clock className="mt-0.5 size-3 shrink-0 text-amber-500" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {new Date(ev.at).toLocaleTimeString()}
            </span>
            <span className="text-foreground/80">{ev.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
