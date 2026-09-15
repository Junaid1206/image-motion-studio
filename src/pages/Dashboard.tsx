import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clapperboard,
  Clock,
  Download,
  Film,
  Loader2,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAction, useMutation, useQuery } from "convex/react";

type VideoJob = {
  _id: Id<"videos">;
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: string;
  sourceImageId?: Id<"_storage">;
  provider: string;
  model: string;
  providerJobId?: string;
  status: string;
  errorMessage?: string;
  videoUrl?: string;
  seed?: number;
  createdAt: number;
  updatedAt: number;
};

const DURATIONS = [5, 10, 15, 25] as const;
const ASPECTS = ["9:16", "16:9", "1:1"] as const;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

function formatElapsed(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const videos = useQuery(api.videos.listMyVideos) ?? [];
  const modelConfig = useQuery(api.videos.getModelConfig);
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const createJob = useMutation(api.videos.createJob);
  const markFailed = useMutation(api.videos.markFailed);
  const removeVideo = useMutation(api.videos.removeVideo);
  const submitGeneration = useAction(api.generation.submitGeneration);
  const pollGeneration = useAction(api.generation.pollGeneration);
  const cancelGeneration = useAction(api.generation.cancelGeneration);

  // Composer state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<string>("5");
  const [aspect, setAspect] = useState<string>("9:16");
  const [submitting, setSubmitting] = useState(false);

  const [now, setNow] = useState(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<string | null>(null);

  // Ticking clock while any job is active
  const hasActive = videos.some(
    (v) => v.status === "pending" || v.status === "processing",
  );
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasActive]);

  // Client-side polling loop: drives every active job once per 5 seconds.
  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    const tick = async () => {
      for (const v of videos) {
        if (v.status !== "processing" || !v.providerJobId) continue;
        if (pollingRef.current === v._id) continue;
        pollingRef.current = v._id;
        try {
          await pollGeneration({ jobId: v._id });
        } catch {
          // Errors are persisted server-side; reactive query re-renders state.
        } finally {
          pollingRef.current = null;
        }
        if (cancelled) return;
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [hasActive, videos, pollGeneration]);

  // Note: `videos` in deps causes the interval to reset on each poll result,
  // which is fine — the effect re-runs and re-schedules cleanly.

  const onPickFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Unsupported file. Use JPG, JPEG, PNG or WEBP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image is too large. Maximum size is 8 MB.");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }, []);

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canGenerate =
    !!imageFile && prompt.trim().length > 0 && !submitting && !hasActive;

  const handleGenerate = async () => {
    if (!imageFile || !prompt.trim()) return;
    setSubmitting(true);
    try {
      // 1. Upload the source image to Convex storage.
      const uploadUrl = await generateUploadUrl();
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": imageFile.type },
        body: imageFile,
      });
      if (!uploadRes.ok) {
        throw new Error(`Image upload failed (${uploadRes.status}).`);
      }
      const { storageId } = (await uploadRes.json()) as { storageId: string };

      // 2. Create the job row.
      const jobId = await createJob({
        prompt: prompt.trim(),
        durationSeconds: Number(duration),
        aspectRatio: aspect,
        sourceImageId: storageId as Id<"_storage">,
      });

      // 3. Submit to the fal.ai queue (marks job processing with request id).
      await submitGeneration({ jobId });

      toast.success("Generation submitted to the model queue.");
      clearImage();
      setPrompt("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed.";
      toast.error(msg);
      // The job row keeps the failure server-side; nothing fake to clean up.
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: Id<"videos">) => {
    try {
      await cancelGeneration({ jobId: id });
      toast("Generation cancelled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed.");
    }
  };

  const handleGiveUp = async (v: VideoJob) => {
    await markFailed({ id: v._id, errorMessage: "Gave up waiting (client)." });
  };

  const handleDownload = async (v: VideoJob) => {
    if (!v.videoUrl) return;
    try {
      const res = await fetch(v.videoUrl);
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `image-motion-${v._id.slice(-8)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(v.videoUrl, "_blank");
    }
  };

  const handleDelete = async (id: Id<"videos">) => {
    await removeVideo({ id });
    toast("Removed from history.");
  };

  const activeJob = useMemo(
    () =>
      videos.find(
        (v) => v.status === "pending" || v.status === "processing",
      ) ?? null,
    [videos],
  );
  const latestCompleted = useMemo(
    () => videos.find((v) => v.status === "completed" && v.videoUrl) ?? null,
    [videos],
  );
  const history = useMemo(
    () =>
      videos.filter(
        (v) =>
          v.status !== "pending" &&
          v.status !== "processing" &&
          v !== latestCompleted,
      ),
    [videos, latestCompleted],
  );

  const keyOk = modelConfig?.keyConfigured ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Clapperboard className="size-5" strokeWidth={1.5} />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">
                Image Motion Studio
              </p>
              <p className="text-[11px] text-muted-foreground">
                {modelConfig ? (
                  <>
                    {modelConfig.model}{" "}
                    <span className={keyOk ? "text-foreground/60" : "text-destructive"}>
                      · FAL_KEY {keyOk ? "configured" : "missing"}
                    </span>
                  </>
                ) : (
                  "loading model config…"
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {user?.email ?? "signed in"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              className="gap-2 text-muted-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="grid gap-10 lg:grid-cols-[420px_1fr]">
          {/* ------------------------------------------------ Composer */}
          <section className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Composer</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                One image, one motion prompt, one clip.
              </p>
            </div>

            {/* Upload zone */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Source image
              </Label>
              {imagePreview ? (
                <div className="group relative overflow-hidden rounded-lg border border-border/70">
                  <img
                    src={imagePreview}
                    alt="Source"
                    className="max-h-64 w-full object-contain"
                  />
                  <button
                    onClick={clearImage}
                    className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove image"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <Upload className="size-5" strokeWidth={1.5} />
                  <span className="text-sm">Click to upload</span>
                  <span className="text-[11px]">
                    JPG · PNG · WEBP — max 8 MB
                  </span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="prompt"
                className="text-xs uppercase tracking-widest text-muted-foreground"
              >
                Motion prompt
              </Label>
              <Textarea
                id="prompt"
                placeholder="Slow cinematic push-in. Keep the subject exactly the same. Subtle natural fabric movement, realistic lighting, premium dark background, shallow depth of field."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                Describe camera movement and atmosphere. The model is
                instructed to preserve the subject.
              </p>
            </div>

            {/* Settings */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Duration
                </Label>
                <ToggleGroup
                  type="single"
                  value={duration}
                  onValueChange={(v) => v && setDuration(v)}
                  className="justify-start"
                >
                  {DURATIONS.map((d) => {
                    const overLimit =
                      !!modelConfig &&
                      d > modelConfig.maxDurationSeconds + 0.01;
                    return (
                      <ToggleGroupItem
                        key={d}
                        value={String(d)}
                        disabled={overLimit}
                        aria-label={
                          overLimit
                            ? `${d} seconds exceeds the current model limit`
                            : `${d} seconds`
                        }
                        className="px-4 text-xs"
                      >
                        {d}s{overLimit ? "*" : ""}
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>
                <p className="text-[11px] text-muted-foreground">
                  * beyond the current model's max ({modelConfig?.maxDurationSeconds ?? "–"}s).
                  Swap <code className="text-foreground/70">VIDEO_MODEL</code> to unlock.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Aspect ratio
                </Label>
                <ToggleGroup
                  type="single"
                  value={aspect}
                  onValueChange={(v) => v && setAspect(v)}
                  className="justify-start"
                >
                  {ASPECTS.map((a) => (
                    <ToggleGroupItem
                      key={a}
                      value={a}
                      className="px-4 text-xs"
                    >
                      {a}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <Button
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
              className="w-full gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Uploading & submitting…
                </>
              ) : (
                <>
                  <Film className="size-4" />
                  Generate video
                </>
              )}
            </Button>
            {hasActive && (
              <p className="text-center text-[11px] text-muted-foreground">
                A generation is already running. One at a time.
              </p>
            )}
          </section>

          {/* ------------------------------------------------ Output & status */}
          <section className="flex flex-col gap-8">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Output</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Live status — nothing here is simulated.
              </p>
            </div>

            {/* Active job */}
            {activeJob ? (
              <div className="rounded-lg border border-border/70 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    {activeJob.status === "pending" ? (
                      <Clock className="size-4 text-muted-foreground" />
                    ) : (
                      <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                    )}
                    {activeJob.status === "pending"
                      ? "Queued for submission"
                      : "Generating — model is rendering"}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatElapsed(activeJob.createdAt, now)}
                  </span>
                </div>
                <Separator className="my-4" />
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  “{activeJob.prompt}”
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="font-normal">
                      {activeJob.durationSeconds}s
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      {activeJob.aspectRatio}
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      {activeJob.model.split("/").slice(-2).join("/")}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCancel(activeJob._id)}
                    className="gap-2 text-muted-foreground"
                  >
                    <Ban className="size-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
                No active generation.
              </div>
            )}

            {/* Latest result */}
            {latestCompleted?.videoUrl ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium tracking-tight">
                    Latest clip
                  </h3>
                  <Button
                    size="sm"
                    onClick={() => void handleDownload(latestCompleted)}
                    className="gap-2"
                  >
                    <Download className="size-4" />
                    Download MP4
                  </Button>
                </div>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  key={latestCompleted._id}
                  src={latestCompleted.videoUrl}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full rounded-lg border border-border/70"
                />
                <p className="text-[11px] text-muted-foreground">
                  Seed {latestCompleted.seed ?? "—"} ·{" "}
                  {latestCompleted.durationSeconds}s ·{" "}
                  {latestCompleted.aspectRatio} ·{" "}
                  {latestCompleted.model.split("/").slice(-2).join("/")}
                </p>
              </div>
            ) : (
              !activeJob && (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
                  <Clapperboard className="size-5" strokeWidth={1.5} />
                  Your first generated clip will appear here.
                </div>
              )
            )}

            {/* History */}
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium tracking-tight">
                History{" "}
                <span className="ml-1 font-normal text-muted-foreground">
                  ({history.length})
                </span>
              </h3>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing yet. Generated clips stay here.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {history.map((v) => (
                    <HistoryRow
                      key={v._id}
                      job={v as VideoJob}
                      onDownload={() => void handleDownload(v as VideoJob)}
                      onDelete={() => void handleDelete(v._id)}
                      onGiveUp={() => void handleGiveUp(v as VideoJob)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History row (thumbnail via storage query kept local to avoid N queries —
// we render initials-free minimal rows instead)
// ---------------------------------------------------------------------------

function HistoryRow({
  job,
  onDownload,
  onDelete,
  onGiveUp,
}: {
  job: VideoJob;
  onDownload: () => void;
  onDelete: () => void;
  onGiveUp: () => void;
}) {
  const statusIcon =
    job.status === "completed" ? (
      <CheckCircle2 className="size-4 text-foreground/70" />
    ) : job.status === "failed" ? (
      <AlertTriangle className="size-4 text-destructive" />
    ) : (
      <Clock className="size-4 text-muted-foreground" />
    );

  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex w-8 shrink-0 justify-center">{statusIcon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{job.prompt}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          <span>{timeAgo(job.createdAt)}</span>
          <span>
            {job.durationSeconds}s · {job.aspectRatio}
          </span>
          {job.errorMessage && (
            <span className="text-destructive">{job.errorMessage}</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {job.status === "processing" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onGiveUp}
            className="text-xs text-muted-foreground"
          >
            Give up
          </Button>
        ) : (
          <>
            {job.videoUrl && (
              <Button variant="ghost" size="sm" onClick={onDownload}>
                <Download className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-muted-foreground"
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
