import json, subprocess, os, sys
os.makedirs("out", exist_ok=True)
lines = json.load(open("narration.json"))
for v in ["priyamvada", "pratham", "rohan"]:
    model = f"hi_IN-{v}-medium.onnx"
    if not os.path.exists(model): print("missing", model); continue
    os.makedirs(f"out/{v}", exist_ok=True)
    for l in lines:
        p = subprocess.run([sys.executable, "-m", "piper", "-m", model, "-f", f"out/{v}/{l['id']}.wav", "--length-scale", "1.05", "--sentence-silence", "0.25"],
                           input=l["hi"].encode(), capture_output=True)
        print(v, l["id"], p.returncode, p.stderr.decode()[-300:] if p.returncode else "")
