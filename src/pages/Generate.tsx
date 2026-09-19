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
import { Client, handle_file } from "@gradio/client";
import {
  Ban,
  CheckCircle2,
  Clapperboard,
  Loader2,
  Upload,
  X,
} from "lucide-react";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  connecting: "Connecting to GPU",
  loading_model: "Loading GPU model",
  generating: "Generating",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const ACTIVE = ["queued", "connecting", "loading_model", "generating", "processing"];
const WORKER_MODEL = "wan2.2-ti2v-5b";

export default function Generate() {
  const config = useQuery(api.videos.getStudioConfig);
  const jobs = useQuery(api.jobs.listMyJobs) ?? [];
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const createJob = useMutation(api.jobs.createJob);
  const markHostedJobRunning = useMutation(api.jobs.markHostedJobRunning);
  const failHostedJob = useMutation(api.jobs.failHostedJob);
  const completeHostedJob = useMutation(api.videos.completeHostedJob);
  const cancelJob = useMutation(api.jobs.cancelJob);

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

  const workerOnline = true;
  const activeJob = jobs.find((j) => ACTIVE.includes(j.status)) ?? null;
  const latestCompleted = jobs.find((j) => j.status === "completed" && j.videoId) ?? null;

  const canSubmit =
    !!config &&
    prompt.trim().length > 0 &&
    !!imageFile &&
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
    let jobId: Id<"jobs"> | null = null;

    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": imageFile!.type },
        body: imageFile,
      });
      if (!res.ok) throw new Error(`Image upload failed (${res.status}).`);
      const { storageId } = (await res.json()) as { storageId: string };

      jobId = await createJob({
        type: "image",
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        inputImageId: storageId as Id<"_storage">,
        provider: "hosted",
        model: WORKER_MODEL,
        durationSeconds: Number(duration),
        aspectRatio: aspect,
        resolution,
        seed: seed.trim() ? Number(seed) : undefined,
      });

      await markHostedJobRunning({ id: jobId });
      toast.info("GPU generation started…");

      const client = await Client.connect("alexcheng0072/wan27-free-video-generator");
      const ratio =
        aspect === "16:9" ? "832x480" :
        aspect === "1:1" ? "640x640" :
        "480x832";

      // Gradio JS client's current API exposes predict() as the blocking call.
      // submit() returns an async iterator, so awaiting submission.result() is invalid.
      const result = await client.predict("/generate_video", {
        input_image: handle_file(imageFile!),
        prompt: prompt.trim(),
        aspect_ratio: ratio,
        duration_seconds: Number(duration),
      });

      const output = (result.data as unknown[])[0] as
        | { url?: string; path?: string }
        | string;

      const videoUrl = typeof output === "string" ? output : output?.url;
      if (!videoUrl) throw new Error("Hosted GPU returned no video file.");

      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        throw new Error(`Generated video download failed (${videoRes.status}).`);
      }

      const videoBlob = await videoRes.blob();
      const videoUploadUrl = await generateUploadUrl();
      const videoUpload = await fetch(videoUploadUrl, {
        method: "POST",
        headers: { "Content-Type": "video/mp4" },
        body: videoBlob,
      });

      if (!videoUpload.ok) {
        throw new Error(`Video upload failed (${videoUpload.status}).`);
      }

      const { storageId: videoStorageId } =
        (await videoUpload.json()) as { storageId: string };

      await completeHostedJob({
        jobId,
        videoStorageId: videoStorageId as Id<"_storage">,
      });

      toast.success("Video generated and saved to Library.");
      setPrompt("");
      setNegativePrompt("");
      setSeed("");
      clearImage();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed.";
      if (jobId) {
        try {
          await failHostedJob({ id: jobId, message });
        } catch {
          // Preserve the original generation error in the UI.
        }
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJob) return;
    try {
      await cancelJob({ id: activeJob._id });
      toast.info("Generation cancelled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to cancel job.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5" />
            <h1 className="text-2xl font-semibold">Image to Video</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn one image into a real video using the hosted WAN 2.2 GPU pipeline.
          </p>
        </div>
        <Badge variant={workerOnline ? "default" : "secondary"}>
          {workerOnline ? "Hosted GPU online" : "Hosted GPU offline"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-5 rounded-xl border p-5">
          <div>
            <Label>Source image</Label>
            <div
              className="mt-2 flex min-h-72 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/20"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files?.[0]);
              }}
            >
              {imagePreview ? (
                <div className="relative h-full w-full">
                  <img src={imagePreview} alt="Source preview" className="max-h-96 w-full object-contain" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-2 top-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearImage();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">Upload an image</p>
                  <p className="mt-1 text-xs text-muted-foreground">JPG, PNG or WEBP · max 8 MB</p>
                </div>
              )}
            </div>
            <Input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Motion prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe how the image should move, e.g. cinematic camera push-in, subtle wind and natural motion"
              rows={5}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="negative">Negative prompt (optional)</Label>
            <Textarea
              id="negative"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="blurry, distorted, flicker, warped anatomy"
              rows={3}
            />
          </div>
        </section>

        <section className="space-y-5 rounded-xl border p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 seconds</SelectItem>
                  <SelectItem value="3">3 seconds</SelectItem>
                  <SelectItem value="5">5 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Aspect ratio</Label>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16</SelectItem>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="1:1">1:1</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Resolution</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="480p">480p</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seed">Seed (optional)</Label>
              <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Random" />
            </div>
          </div>

          <Separator />

          <div className="rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Model</span>
              <Badge variant="outline">WAN 2.2 TI2V-5B</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Hosted GPU generation. No Colab, notebook, or local GPU is required.
            </p>
          </div>

          {activeJob && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between text-sm">
                <span>{STATUS_LABEL[activeJob.status] ?? activeJob.status}</span>
                <span>{activeJob.progress ?? 0}%</span>
              </div>
              <Progress value={activeJob.progress ?? 0} />
              <Button variant="outline" className="w-full" onClick={handleCancel}>
                <Ban className="mr-2 h-4 w-4" />
                Cancel generation
              </Button>
            </div>
          )}

          <Button className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Clapperboard className="mr-2 h-4 w-4" />
                Generate video
              </>
            )}
          </Button>

          {latestCompleted && (
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              Latest video is ready in Library.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
