# GPU Worker (Google Colab)

`ims-worker.ipynb` turns a free Google Colab session into the studio's GPU worker. It performs **real** WAN 2.2 TI2V-5B image-to-video inference — no placeholders, no sample output, no fake progress.

## What it does

1. Authenticates against the studio's worker API with your personal token
2. Reports GPU + model status (heartbeat every 60 s → Settings page)
3. Claims queued jobs (`POST /worker_api/claim`)
4. Downloads the source image from Convex storage
5. Runs diffusion inference on the Colab GPU (WAN 2.2 TI2V-5B via diffusers)
6. Encodes a real MP4 (libx264, yuv420p, faststart)
7. Uploads the MP4 directly to Convex storage (bytes never pass through a Convex function)
8. Reports progress during the render (live in the studio UI)
9. Completes the job (`/worker_api/complete`) → the clip lands in your Library
10. Reports failures (`/worker_api/fail`) with the actual error text
11. Checks `/worker_api/job-status` before and after each render — cancelled jobs are discarded, never completed
12. Survives transient network drops (retries; heartbeats resume on reconnect)

## Setup (5 minutes)

1. **Issue a worker token**: studio → Settings → *Worker token* → **Issue token**. Copy it immediately — it is shown only once.
2. **Open the notebook in Colab**: go to [colab.research.google.com](https://colab.research.google.com) → *File → Upload notebook* → upload `worker/ims-worker.ipynb`.
3. **Select a GPU**: *Runtime → Change runtime type → T4 GPU* (free tier is fine).
4. **Fill in cell 1**:
   - `CONVEX_HTTP_BASE` — copy from Settings → *Colab worker setup* (your `.convex.site` URL)
   - `WORKER_TOKEN` — the token from step 1
   - Leave `MODEL_ID = "wan2.2-ti2v-5b"` unless you know you have A100-class VRAM
5. **Run all cells** (Runtime → Run all). First run installs dependencies and loads the model (~6–9 minutes total); subsequent jobs skip straight to rendering.
6. When cell 5 prints `worker running — claim/heartbeat loop started`, the studio Settings page should show the worker **online** with your GPU name.

## Rendering a video

1. In the studio: Generate → upload an image → motion prompt → Queue generation
2. The notebook claims it within ~15 seconds and prints progress per diffusion step
3. Expect **~5–10 minutes per 5-second clip** on a free T4 (20 diffusion steps + encode)
4. The finished MP4 appears in the Library automatically

## Runtime notes and limits

- **Free Colab is on-demand**: sessions disconnect on idle or after ~hours of use. Jobs you queued while the worker was offline simply start when you next run the notebook — nothing is lost.
- **One job at a time**: the worker claims the oldest queued job first.
- **Keep the tab open** while rendering. If Colab dies mid-render, the job stays in an active state; cancel it from the Jobs page and re-queue.
- **Model sizing**: WAN 2.2 TI2V-5B (~8 GB VRAM with tiled VAE) fits a free T4. The A14B/14B models in the registry need 16–24+ GB — they are listed for completeness but will OOM on free tier.
- **Cancellation**: clicking Cancel in the studio sets the job to `cancelled`; the worker notices at its next job-status check and skips/discards the render.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Cell 1 `401` | Wrong or revoked token — re-issue in Settings and paste the new one |
| Cell 1 connection error | Wrong `CONVEX_HTTP_BASE` — must be the `.convex.site` URL, not `.cloud` |
| Cell 2 raises "No GPU" | Runtime type is CPU — switch to T4 GPU and re-run |
| OOM in cell 5 | Too high resolution or a 14B-class model — use 480p + the 5B model |
| Studio shows worker offline | Notebook cell 5 not running (or Colab disconnected) — restart from cell 2 |
| Job stuck "connecting" | The claim happened but the render died with the tab — cancel and re-queue |
| "Invalid job status" in a fail report | The job was cancelled or completed before the worker reported — this is expected and ignored |
