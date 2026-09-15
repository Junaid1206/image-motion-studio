import { Link } from "react-router";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const PIPELINE: { step: string; label: string; detail: string }[] = [
  {
    step: "01",
    label: "Source image",
    detail: "One upload. JPG, PNG or WEBP, up to 8 MB.",
  },
  {
    step: "02",
    label: "Motion prompt",
    detail:
      "Camera move, atmosphere, and an explicit instruction to keep the subject unchanged.",
  },
  {
    step: "03",
    label: "Settings",
    detail: "Duration in seconds and output aspect ratio. Defaults are sane.",
  },
  {
    step: "04",
    label: "Model queue",
    detail:
      "Submitted to the WAN 2.2 5B image-to-video model on fal.ai. The model renders every frame — no templates, no stock clips, no CSS animation.",
  },
  {
    step: "05",
    label: "MP4 output",
    detail:
      "The finished file is linked back to your dashboard for preview and download. Failed jobs say so plainly.",
  },
];

const SPECS: { key: string; value: string }[] = [
  { key: "Model", value: "fal-ai/wan/v2.2-5b/image-to-video" },
  { key: "Output", value: "MP4 · 720p · 24 fps" },
  { key: "Durations", value: "5 / 10 / 15 / 25 s" },
  { key: "Aspect ratios", value: "9:16 · 16:9 · 1:1" },
  { key: "Access", value: "Private · single user" },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold tracking-tight">
              Image Motion Studio
            </span>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">
              image → video
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/dashboard">
                Open studio
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-20 pt-24 sm:pt-32">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Personal image-to-video generator
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              One still frame in.
              <br />
              One cinematic clip out.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              Upload a single image, write a motion prompt, and the WAN 2.2
              image-to-video model renders a real MP4 — camera movement,
              lighting, and subtle fabric motion while the original subject
              stays exactly what you uploaded.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link to="/dashboard">
                  Open the studio
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="text-muted-foreground">
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
          </motion.div>
        </section>

        {/* Pipeline */}
        <section className="border-t border-border/70">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium tracking-tight">
                The actual pipeline
              </h2>
              <p className="font-mono text-[11px] text-muted-foreground">
                every step below is real code, not a diagram
              </p>
            </div>
            <div className="mt-8 divide-y divide-border/70 border-y border-border/70">
              {PIPELINE.map((row, i) => (
                <motion.div
                  key={row.step}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="grid grid-cols-[3rem_9rem_1fr] items-baseline gap-4 py-5 sm:grid-cols-[4rem_11rem_1fr]"
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {row.step}
                  </span>
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {row.detail}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Spec sheet */}
        <section className="border-t border-border/70">
          <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 sm:py-20 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                Configuration
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                The model is a configuration value, not a hard-coded dependency.
                Point <code className="font-mono text-[12px] text-foreground/80">VIDEO_MODEL</code>{" "}
                at any fal.ai image-to-video endpoint and the studio follows —
                same upload, same prompt, same output path.
              </p>
            </div>
            <dl className="divide-y divide-border/70 border-y border-border/70">
              {SPECS.map((s) => (
                <div
                  key={s.key}
                  className="flex items-baseline justify-between gap-6 py-3"
                >
                  <dt className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {s.key}
                  </dt>
                  <dd className="font-mono text-xs text-foreground/90">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Ready when you are.
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in and the composer is one click away.
              </p>
            </div>
            <Button asChild size="lg" className="gap-2">
              <Link to="/dashboard">
                Open the studio
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
          <span className="text-[11px] text-muted-foreground">
            Image Motion Studio — a private, single-user tool.
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/70">
            v1 · 5 s clips
          </span>
        </div>
      </footer>
    </div>
  );
}
