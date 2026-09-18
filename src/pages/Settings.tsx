import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Server } from "lucide-react";

export default function Settings() {
  const config = useQuery(api.videos.getStudioConfig);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Image Motion Studio uses a hosted GPU for real video generation. No Colab,
          notebook, worker token, local GPU, or client-side setup is required.
        </p>
      </div>

      <section className="mt-8 flex flex-col gap-4 rounded-lg border border-border/70 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight">Hosted GPU</h2>
          </div>
          <Badge variant="outline" className="font-normal">ready</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Generation runs through the hosted WAN 2.2 TI2V-5B service. The app sends
          the source image and motion prompt, waits for the real MP4 result, then
          saves it automatically to your Library.
        </p>
        <div className="grid gap-2 text-xs text-muted-foreground">
          <span>Model: {config?.models?.[0]?.label ?? "WAN 2.2 TI2V-5B"}</span>
          <span>Durations: {(config?.durations ?? [2, 3, 5]).join("s, ")}</span>
          <span>Aspect ratios: {(config?.aspectRatios ?? ["9:16", "16:9", "1:1"]).join(" · ")}</span>
          <span>Local worker: not required</span>
          <span>Colab: not required</span>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border/70 p-5">
        <h2 className="text-sm font-semibold tracking-tight">How it works</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload image → enter motion prompt → Generate → hosted GPU renders the clip
          → MP4 is stored in Library. If the hosted service is temporarily busy,
          the job fails with a readable message instead of pretending that a video exists.
        </p>
      </section>
    </div>
  );
}
