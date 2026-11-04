"""Drive real runs through the server API and wait for completion. Usage: run_eval.py <img> <label> [fault]"""
import base64, json, sys, time, urllib.request
from io import BytesIO
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); im.thumbnail((1024, 1024)); b = BytesIO(); im.save(b, "JPEG", quality=88)
url = "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()
body = json.dumps({"image": url, "label": sys.argv[2], "injectFault": len(sys.argv) > 3}).encode()
rid = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:8787/api/run", body, {"content-type": "application/json"})))["id"]
while True:
    time.sleep(3)
    s = json.load(urllib.request.urlopen(f"http://localhost:8787/api/run/{rid}/state"))
    if s["done"]: break
for e in s["events"]:
    if e["status"] != "start": print(f'{e["t"]/1000:6.1f}s {e["status"]:5} {e["step"][:50]:50} {e.get("model") or "":16} ${e.get("cost") or 0:.4f} {(e.get("msg") or "")[:150]}')
print(rid, json.dumps(json.load(open(f"runs/{rid}/summary.json"))))
