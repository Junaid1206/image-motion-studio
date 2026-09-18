import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useState } from "react";
import {
  KeyRound,
  Loader2,
  Server,
  Trash2,
  Check,
  Copy,
} from "lucide-react";

type WorkerState = {
  online?: boolean;
  status?: string;
  gpuName?: string;
  vramGb?: number;
  loadedModel?: string;
  message?: string;
  lastSeenAt?: number;
  workerVersion?: string;
};

export default function Settings() {
  const settings = useQuery(api.settings.getSettings) as
    | { workerTokenIssued: boolean; worker: WorkerState | null }
    | undefined;
  const issueWorkerToken = useMutation(api.settings.issueWorkerToken);
  const revokeWorkerToken = useMutation(api.settings.revokeWorkerToken);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const issue = async () => {
    setIssuing(true);
    try {
      const res = (await issueWorkerToken()) as { token: string };
      setNewToken(res.token);
      toast(
        "Token issued. Copy it now — it is shown only once and never stored in plaintext.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not issue token.");
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async () => {
    try {
      await revokeWorkerToken();
      setNewToken(null);
      toast("Token revoked. The worker can no longer authenticate.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed.");
    }
  };

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const convexHttpUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined)
    ?.replace(".cloud", ".site") // convex http actions live on the .site domain
    ?.replace("https://", "https://") ?? "(your convex deployment URL)";

  const worker = settings?.worker ?? null;
  const online = !!worker?.online;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect your personal Google Colab GPU worker. Everything stays $0 — no paid
          APIs or video-generation keys are required anywhere in this studio.
        </p>
      </div>

      {/* Worker status */}
      <section className="mt-8 flex flex-col gap-3 rounded-lg border border-border/70 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">GPU worker</h2>
          </div>
          <span
            className={`flex items-center gap-2 rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
              online ? "bg-emerald-950 text-emerald-300" : "bg-zinc-900 text-zinc-400"
            }`}
          >
            {online ? worker?.status ?? "online" : "offline"}
          </span>
        </div>
        {worker ? (
          <div className="grid gap-1 text-xs text-muted-foreground">
            <span>GPU: {worker.gpuName ?? "—"}</span>
            <span>VRAM: {worker.vramGb ? `${worker.vramGb} GB` : "—"}</span>
            <span>Model: {worker.loadedModel ?? "—"}</span>
            <span>Worker version: {worker.workerVersion ?? "—"}</span>
            <span>
              Last heartbeat:{" "}
              {worker.lastSeenAt
                ? `${Math.max(0, Math.round((Date.now() - worker.lastSeenAt) / 1000))}s ago`
                : "never"}
            </span>
            {worker.message && <span className="font-mono">{worker.message}</span>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No worker has ever connected. Follow the Colab setup below.
          </p>
        )}
      </section>

      {/* Token */}
      <section className="mt-6 flex flex-col gap-3 rounded-lg border border-border/70 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">Worker token</h2>
          </div>
          <Badge variant="outline" className="font-normal">
            {settings?.workerTokenIssued ? "issued" : "not issued"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          The raw token is shown once at issue time and pasted into the Colab notebook.
          The server stores only its SHA-256 hash — the raw token is never stored,
          logged, or shown again. Never commit it anywhere.
        </p>
        {newToken && (
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-accent/30 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{newToken}</code>
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={() => {
                void navigator.clipboard.writeText(newToken);
                toast("Token copied.");
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" className="cursor-pointer" disabled={issuing} onClick={() => void issue()}>
            {issuing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <KeyRound className="mr-2 size-4" />}
            {settings?.workerTokenIssued ? "Regenerate token" : "Generate token"}
          </Button>
          {settings?.workerTokenIssued && (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer gap-1"
              onClick={() => void revoke()}
            >
              <Trash2 className="size-4" /> Revoke
            </Button>
          )}
        </div>
      </section>

      {/* Colab setup */}
      <section className="mt-6 flex flex-col gap-3 rounded-lg border border-border/70 p-5">
        <h2 className="text-sm font-semibold tracking-tight">Colab worker setup</h2>
        <p className="text-xs text-muted-foreground">
          One-time setup. After this, generating a video is just: upload an image →
          click Generate.
        </p>
        <ol className="flex flex-col gap-3 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1.</span> Generate a token above
            and copy it.
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span> Open the
            <span className="font-medium text-foreground"> ims-worker.ipynb </span>
            notebook (in this project's <code className="font-mono text-xs">worker/</code>{" "}
            folder) in Google Colab — free tier is enough.
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> Paste the two values
            below into the notebook's first cell:
          </li>
        </ol>
        <div className="flex flex-col gap-2">
          <CopyRow label="Convex HTTP base" value={convexHttpUrl} />
          <CopyRow label="App URL (informational)" value={appUrl} />
          <CopyRow label="Worker token" value={newToken ?? "(paste the token you generated)"} />
        </div>
        <ol start={4} className="flex flex-col gap-3 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">4.</span> Run all cells. The
            worker verifies the GPU, installs dependencies, loads WAN 2.2 TI2V-5B and
            starts polling this app for queued jobs.
          </li>
          <li>
            <span className="font-medium text-foreground">5.</span> When this page shows
            the worker <span className="font-mono text-xs">online</span>, queue a job from
            the Generate page.
          </li>
          <li>
            <span className="font-medium text-foreground">6.</span> Keep the Colab tab
            open while rendering. Free Colab disconnects on idle — jobs stay queued if it
            goes offline, and stuck jobs are cleaned up automatically.
          </li>
        </ol>
        <Separator className="my-1" />
        <p className="text-[11px] text-muted-foreground">
          No API keys, no paid services: generation runs entirely on your own free Colab
          GPU with the open-source WAN 2.2 TI2V-5B model.
        </p>
      </section>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2">
      <span className="w-44 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 cursor-pointer px-1.5"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast("Copied.");
        }}
      >
        <Check className="size-3.5" />
      </Button>
    </div>
  );
}
