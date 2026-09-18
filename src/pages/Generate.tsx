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

// The single model the self-hosted Colab T4 worker runs (WAN 2.2 TI2V-5B,
// 4-bit, real image conditioning). The backend rejects everything else.
const WORKER_MODEL = "wan2.2-ti2v-5b";

export default function Generate() {
  const config = useQuery(api.videos.getStudioConfig);
  const jobs = useQuery(api.jobs.listMyJobs) ?? [];
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);
  const createJob = useMutation(api.jobs.createJob);
  const markHostedJobRunning = useMutation(api.jobs.markHostedJobRunning);
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
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": imageFile!.type }, body: imageFile });
      if (!res.ok) throw new Error(`Image upload failed (${res.status}).`);
      const { storageId } = (await res.json()) as { storageId: string };

      jobId = await createJob({
        type: "image", prompt: prompt.trim(), negativePrompt: negativePrompt.trim() || undefined,
        inputImageId: storageId as Id<"_storage">, provider: "hosted", model: WORKER_MODEL,
        durationSeconds: Number(duration), aspectRatio: aspect, resolution, seed: seed.trim() ? Number(seed) : undefined,
      });
      await markHostedJobRunning({ id: jobId });
      toast.info("GPU generation started…");

      const client = await Client.connect("alexcheng0072/wan27-free-video-generator");
      const ratio = aspect === "16:9" ? "832x480" : aspect === "1:1" ? "640x640" : "480x832";
      const submission = await client.submit("/generate_video", {
        input_image: await handle_file(imageFile!),
        prompt: prompt.trim(),
        aspect_ratio: ratio,
        duration_seconds: Number(duration),
      });
      const result = await submission.result();
      const output = (result.data as unknown[])[0] as { url?: string; path?: string } | string;
      const videoUrl = typeof output === "string" ? output : output?.url;
      if (!videoUrl) throw new Error("Hosted GPU returned no video file.");

      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) throw new Error(`Generated video download failed (${videoRes.status}).`);
      const videoBlob = await videoRes.blob();
      const videoUploadUrl = await generateUploadUrl();
      const videoUpload = await fetch(videoUploadUrl, {
        method: "POST", headers: { "Content-Type": "video/mp4" }, body: videoBlob,
      });
      if (!videoUpload.ok) throw new Error(`Video upload failed (${videoUpload.status}).`);
      const { storageId: videoStorageId } = (await videoUpload.json()) as { storageId: string };
      await completeHostedJob({ jobId, videoStorageId: videoStorageId as Id<"_storage"> });
      toast.success("Video generated and saved to Library.");
      setPrompt(""); setNegativePrompt(""); setSeed(""); clearImage();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setSubmitting(false);
    }
  };

