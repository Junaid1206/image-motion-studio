#@title 2 · GPU + system RAM check
import torch, psutil

if not torch.cuda.is_available():
    raise RuntimeError("No GPU. Runtime → Change runtime type → select a GPU (free T4 is fine).")

GPU_NAME = torch.cuda.get_device_name(0)
FREE, TOTAL = torch.cuda.mem_get_info()
VRAM_GB = round(TOTAL / 1024**3, 1)
RAM_TOTAL_GB = round(psutil.virtual_memory().total / 1024**3, 1)
print(f"GPU: {GPU_NAME} · {VRAM_GB} GB VRAM · {round(FREE/1024**3,1)} GB free")
print(f"System RAM: {RAM_TOTAL_GB} GB")

api("health", {"status": "online", "gpuName": GPU_NAME, "vramGb": VRAM_GB, "message": "GPU ready"})
print("✓ GPU reported to the studio")