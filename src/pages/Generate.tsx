import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useRef, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Clapperboard,
  Loader2,
  Sparkles,
  Upload,
  X,
  AlertTriangle,
} from "lucide-react";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued — waiting for a worker",
  connecting: "Connecting to worker",
  loading_model: "Model loading",
  generating: "Generating",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const ACTIVE = ["queued", "connecting", "loading_model", "generating", "processing"];

type ModelInfo = {
  id: string;
  label: string;
  type: "text" | "image";
  repo: string;
  note: string;
};

export default function Generate() {
  const config = useQuery(api.videos.getStudioConfig);
  const jobs = useQuery(api.jobs.listMyJobs) ?? [];
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const createJob = useMutation(api.jobs.createJob);
  const cancelJob = useMutation(api.jobs.cancelJob);

  const [mode, setMode] = useState<"text" | "image">("text");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [duration, setDuration] = useState("5");
  const [aspect, setAspect] = useState("9:16");
  const [resolution, setResolution] = useState("480p");
  const [seed, setSeed] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const models: ModelInfo[] = config?.models ?? [];
  const visibleModels = models.filter((m) => m.type === mode);
  const [modelId, setModelId] = useState<string>("");
  const effectiveModel =
    modelId && visibleModels.some((m) => m.id === modelId)
      ? modelId
      : (visibleModels[0]?.id ?? "");

  const workerOnline = config?.worker?.online ?? false;
  const activeJob = jobs.find((j) => ACTIVE.includes(j.status)) ?? null;
  const latestCompleted = jobs.find((j) => j.status === "completed" && j.videoId) ?? null;

  const canSubmit =
    !!config &&
    prompt.trim().length > 0 &&
    effectiveModel !== "" &&
    (mode === "text" || !!imageFile) &&
    !submitting &&
    !activeJob;

  const pickFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Unsupported file. Use JPG, PNG or WEBP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image is too large. Maximum size is 8 MB.");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let inputImageId: Id<"_storage"> | undefined;
      if (mode === "image" && imageFile) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": imageFile.type },
          body: imageFile,
        });
        if (!res.ok) throw new Error(`Image upload failed (${res.status}).`);
        const { storageId } = (await res.json()) as { storageId: string };
        inputImageId = storageId as Id<"_storage">;
      }

      await createJob({
        type: mode,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        inputImageId,
        model: effectiveModel,
        durationSeconds: Number(duration),
        aspectRatio: aspect,
        resolution,
        seed: seed.trim() ? Number(seed) : undefined,
      });
      toast.success(
        workerOnline
          ? "Job queued — the worker will pick it up within seconds."
          : "Job queued. It will start when your Colab worker connects.",
      );
      setPrompt("");
      setNegativePrompt("");
      setSeed("");
      clearImage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create the job.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: Id<"jobs">) => {
    try {
      await cancelJob({ id });
      toast("Job cancelled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Generate</h1>
        <p className="text-sm text-muted-foreground">
          One prompt or one image in — one rendered clip out. Nothing here is simulated.
        </p>
      </div>

      {/* Worker status bar */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border/70 px-4 py-3">
        <span
          className={
            workerOnline
              ? "h-2 w-2 rounded-full bg-emerald-500"
              : "h-2 w-2 rounded-full bg-zinc-600"
          }
        />
        <span className="text-sm">
          {workerOnline
            ? `Worker online${config?.worker?.gpuName ? ` · ${config.worker.gpuName}` : ""}`
            : "No GPU worker connected — jobs stay queued until you start the Colab worker"}
        </span>
        {config?.worker?.loadedModel && (
          <Badge variant="outline" className="font-normal">
            loaded: {config.worker.loadedModel}
          </Badge>
        )}
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[440px_1fr]">
        {/* Composer */}
        <section className="flex flex-col gap-5">
          {/* Mode tabs */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === "text" ? "default" : "outline"}
              size="sm"
              className="cursor-pointer"
              onClick={() => setMode("text")}
            >
              <Sparkles className="mr-2 size-4" /> Text → Video
            </Button>
            <Button
              variant={mode === "image" ? "default" : "outline"}
              size="sm"
              className="cursor-pointer"
              onClick={() => setMode("image")}
            >
              <Upload className="mr-2 size-4" /> Image → Video
            </Button>
          </div>

          {/* Image upload */}
          {mode === "image" && (
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Source image
              </Label>
              {imagePreview ? (
                <div className="group relative overflow-hidden rounded-lg border border-border/70">
                  <img src={imagePreview} alt="Source" className="max-h-56 w-full object-contain" />
                  <button
                    onClick={clearImage}
                    className="absolute right-2 top-2 rounded-md border border-border/70 bg-background/90 p-1.5 text-muted-foreground hover:text-foreground"
                    aria-label="Remove image"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                >
                  <Upload className="size-5" />
                  Click to upload (JPG / PNG / WEBP, max 8 MB)
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          )}

          {/* Prompt */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              {mode === "text" ? "Prompt" : "Motion prompt"}
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder={
                mode === "text"
                  ? "A cinematic drone shot flying over a futuristic city at night, volumetric fog, realistic lighting, slow camera movement"
                  : "Slow cinematic push-in. Keep the subject exactly the same. Subtle fabric movement, dramatic soft lighting, premium dark background."
              }
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground">
              {prompt.length}/2000
            </p>
          </div>

          {/* Negative prompt */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Negative prompt (optional)
            </Label>
            <Textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="deformed, distorted, extra limbs, flickering, scene change…"
              className="resize-none"
            />
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Model
              </Label>
              <Select value={effectiveModel} onValueChange={setModelId}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {visibleModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="cursor-pointer">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Duration
              </Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(config?.durations ?? [5]).map((d) => (
                    <SelectItem key={d} value={String(d)} className="cursor-pointer">
                      {d}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Aspect ratio
              </Label>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(config?.aspectRatios ?? ["9:16", "16:9", "1:1"]).map((a) => (
                    <SelectItem key={a} value={a} className="cursor-pointer">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Resolution
              </Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(config?.resolutions ?? ["480p", "720p"]).map((r) => (
                    <SelectItem key={r} value={r} className="cursor-pointer">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Seed */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">
              Seed (optional)
            </Label>
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Leave empty for a random seed"
              inputMode="numeric"
            />
          </div>

          <Button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="w-full cursor-pointer gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Creating job…
              </>
            ) : (
              <>
                <Clapperboard className="size-4" /> Queue generation
              </>
            )}
          </Button>
          {!workerOnline && (
            <p className="text-center text-[11px] text-muted-foreground">
              You can still queue jobs while the worker is offline — open Settings to
              start the Colab worker.
            </p>
          )}
        </section>

        {/* Output / status */}
        <section className="flex flex-col gap-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Job status</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real backend state — updated live from the database.
            </p>
          </div>

          {activeJob ? (
            <div className="rounded-lg border border-border/70 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {activeJob.status === "queued" ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {STATUS_LABEL[activeJob.status] ?? activeJob.status}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void cancel(activeJob._id)}
                  className="cursor-pointer gap-2 text-muted-foreground"
                >
                  <Ban className="size-4" /> Cancel
                </Button>
              </div>
              <Separator className="my-4" />
              <p className="line-clamp-2 text-sm text-muted-foreground">
                “{activeJob.prompt}”
              </p>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="font-normal">
                    {activeJob.type === "text" ? "text→video" : "image→video"}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {activeJob.model}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {activeJob.settings.durationSeconds}s · {activeJob.settings.aspectRatio} ·{" "}
                    {activeJob.settings.resolution}
                  </Badge>
                  {activeJob.settings.seed !== undefined && (
                    <Badge variant="outline" className="font-normal">
                      seed {activeJob.settings.seed}
                    </Badge>
                  )}
                </div>
              </div>
              {activeJob.progress !== undefined && (
                <Progress value={activeJob.progress} className="mt-4" />
              )}
              {activeJob.workerStatus && (
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  worker: {activeJob.workerStatus}
                </p>
              )}
            </div>
          ) : (
            <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
              No active job. Queued jobs wait here for the worker.
            </div>
          )}

          {/* Latest completed */}
          {latestCompleted?.videoId && (
            <LatestCompletedVideo videoId={latestCompleted.videoId} />
          )}
        </section>
      </div>
    </div>
  );
}

function LatestCompletedVideo({ videoId }: { videoId: Id<"videos"> }) {
  const video = useQuery(api.videos.getVideo, { id: videoId });
  if (!video) return null;
  const src = video.videoUrl ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium tracking-tight">Latest clip</h3>
        <Badge variant="outline" className="gap-1 font-normal">
          <CheckCircle2 className="size-3" /> completed
        </Badge>
      </div>
      {src ? (
        <video
          key={video._id}
          src={src}
          controls
          loop
          muted
          playsInline
          className="w-full rounded-lg border border-border/70"
        />
      ) : (
        <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
          Preview available in the Library.
        </div>
      )}
    </div>
  );
}
