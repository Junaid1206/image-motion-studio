#@title 1 · Configuration — paste your two studio values here

# From the studio Settings page → "Colab worker setup":
CONVEX_HTTP_BASE = "https://YOUR-DEPLOYMENT.convex.site"  #@param {type:"string"}
WORKER_TOKEN = "paste-your-worker-token-here"             #@param {type:"string"}

# Model to load. Leave as-is for the recommended free-Colab model.
# This is the only WAN image-to-video model that fits a free T4 when loaded
# 4-bit (cell 4). A14B/14B models are blocked — they need A100-class VRAM.
MODEL_ID = "wan2.2-ti2v-5b"

assert CONVEX_HTTP_BASE.startswith("https://"), "Set CONVEX_HTTP_BASE to your .convex.site URL"
assert len(WORKER_TOKEN) >= 16, "Paste the token issued in Settings (32+ chars)"

import requests, json, time

def api(path, payload):
    r = requests.post(f"{CONVEX_HTTP_BASE}/worker_api/{path}", json={"token": WORKER_TOKEN, **payload}, timeout=120)
    r.raise_for_status()
    return r.json()

# First contact — wrong token or wrong URL fails here, loudly.
health = api("health", {"status": "online", "message": "Colab worker starting"})
print("✓ authenticated —", CONVEX_HTTP_BASE, json.dumps(health))