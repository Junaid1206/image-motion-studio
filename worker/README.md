# Studio Workers (Google Colab)

Two notebooks turn a free Google Colab session into the studio's worker — no paid APIs anywhere:

- **`ims-worker.ipynb` — GPU worker**: performs **real** WAN 2.2 TI2V-5B image-to-video inference locally on the free T4 — no placeholders, no sample output, no fake progress.
- **`ims-cpu-worker.ipynb` — CPU worker**: needs **no GPU and no GPU quota**. It runs the same claim/heartbeat loop on a plain CPU runtime and delegates the actual inference to a Hugging Face ZeroGPU Space running WAN image-to-video.

Both use the same worker API, the same token, and land finished MP4s in the same Library.

## GPU worker setup (`ims-worker.ipynb`, 5 minutes)

1. **Generate a worker token**: studio → Settings → *Worker token* → **Generate token**. Copy it immediately — it is shown only once.
2. **Open the notebook in Colab**: go to [colab.research.google.com](https://colab.research.google.com) → *File → Upload notebook* → upload `worker/ims-worker.ipynb`.
3. **Select a GPU**: *Runtime → Change runtime type → T4 GPU* (free tier is fine).
4. **Fill in cell 1**:
   - `CONVEX_HTTP_BASE` — copy from Settings → *Worker setup* (your `.convex.site` URL)
   - `WORKER_TOKEN` — the token from step 1
   - Leave `MODEL_ID = "wan2.2-ti2v-5b"` unless you know you have A100-class VRAM
5. **Run all cells** (Runtime → Run all). First run installs dependencies and loads the model (~6–9 minutes total); subsequent jobs skip straight to rendering.
6. When cell 5 prints `worker running — claim/heartbeat loop started`, the studio Settings page should show the worker **online** with your GPU name.

## CPU worker (`ims-cpu-worker.ipynb`) — no GPU required

For when Colab GPU quota is exhausted or you don't want a GPU runtime at all:

1. Generate/copy the same token and `CONVEX_HTTP_BASE` as above.
2. Upload `worker/ims-cpu-worker.ipynb` to Colab and keep the runtime on **CPU** (default).
3. Fill in cell 1: `CONVEX_HTTP_BASE`, `WORKER_TOKEN`, and `HF_SPACE_ID` — a Hugging Face Space that runs WAN image-to-video, e.g. an official WAN demo Space or your own duplicate (`owner/space-name`). Add `HF_TOKEN` (free `hf_...`) only if the Space is gated.
4. Run all cells. Cell 4 prints the Space's API endpoints — set `SPACE_API_NAME` to the one whose signature is `image, prompt, negative_prompt, num_frames, seed → video`.
5. Keep cell 5 running: the studio shows the worker online and queued jobs are rendered through the Space automatically.

Notes: 480p / ≤81 frames are clamped for Space limits; the Space's own ZeroGPU queue decides render time, and quota errors are reported to the job as readable failures. The CPU worker itself never downloads a model.

## What the worker loop does (both notebooks)

1. Authenticates against the studio's worker API with your personal token
2. Reports worker status (heartbeat every 60 s → Settings page)
3. Claims queued jobs (`POST /worker_api/claim`)
4. Downloads the source image from Convex storage
5. Runs the real inference (GPU notebook: WAN 2.2 TI2V-5B via diffusers · CPU notebook: the HF Space)
6. Produces a real MP4 (GPU notebook encodes libx264, yuv420p, faststart)
7. Uploads the MP4 directly to Convex storage (bytes never pass through a Convex function)
8. Reports progress during the render (live in the studio UI)
9. Completes the job (`/worker_api/complete`) → the clip lands in your Library
10. Reports failures (`/worker_api/fail`) with the actual error text
11. Checks `/worker_api/job-status` before and after each render — cancelled jobs are discarded, never completed
12. Survives transient network drops (retries; heartbeats resume on reconnect)

## Rendering a video

1. In the studio: Generate → upload an image → motion prompt → Generate
2. The notebook claims it within ~15 seconds and prints progress
3. GPU worker: expect **~5–10 minutes per 5-second clip** on a free T4 (20 diffusion steps + encode). CPU worker: the Space's queue decides.
4. The finished MP4 appears in the Library automatically

## Runtime notes and limits

- **Free Colab is on-demand**: sessions disconnect on idle or after ~hours of use. Jobs you queued while the worker was offline simply start when you next run the notebook — nothing is lost.
- **One job at a time**: the worker claims the oldest queued job first.
- **Keep the tab open** while rendering. If Colab dies mid-render, the job is marked failed automatically after 12 minutes without worker updates (no job stays stuck forever) — just re-queue it.
- **Model sizing**: WAN 2.2 TI2V-5B (~8 GB VRAM with tiled VAE) fits a free T4. A14B/14B checkpoints are not offered anywhere in the studio — they need 16–24+ GB VRAM and are rejected at job creation.
- **Resolution**: the GPU worker renders at 480p on the free T4 tier; 720p requests are clamped automatically. The CPU worker clamps to the Space's limits too.
- **Cancellation**: clicking Cancel in the studio sets the job to `cancelled`; the worker notices between diffusion steps and discards the render.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Cell 1 `401` | Wrong or revoked token — generate a new one in Settings and paste it |
| Cell 1 connection error | Wrong `CONVEX_HTTP_BASE` — must be the `.convex.site` URL, not `.cloud` |
| Cell 1 "CONFIG ERROR" | One of the required settings is missing/invalid — the message says exactly which |
| GPU worker cell 2 raises "No GPU" | Runtime type is CPU — switch to T4 GPU and re-run (or use `ims-cpu-worker.ipynb` instead) |
| CPU worker cell 4 "Space … not found / denied" | Wrong `HF_SPACE_ID` or gated Space — check the name and add a free `HF_TOKEN` in cell 1 |
| CPU worker "Access to the inference Space was denied" | Space needs auth — add a free `HF_TOKEN` in cell 1 |
| OOM in GPU worker cell 5 | The worker already clamps to 480p/81 frames; if it still OOMs, restart the runtime and let the model reload fresh |
| Studio shows worker offline | Notebook cell 5 not running (or Colab disconnected) — restart from cell 2 |
| Job marked failed after silence | The worker went silent mid-render (Colab died) — the studio swept it after 12 minutes; restart the worker and re-queue |
| "Invalid job status" in a fail report | The job was cancelled or completed before the worker reported — this is expected and ignored |
