import subprocess, sys, os, time, concurrent.futures

SCRIPT = r"D:/Program Files/WorkBuddy/resources/app.asar.unpacked/resources/builtin-skills/buddy-multimodal-generation/scripts/buddy-cloud.py"
PY = r"C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"
TOKEN = "tk_GQ6GLriA9NlNwrcAHMer4wV0IJDNg0T4"

# 仅编排未被手动任务占用的 6 个（pistol_body / rifle_body 已在手动跑）
jobs = [
    ("pistol_bolt",  "低多边形风格手枪套筒滑套，独立单个零件，游戏资产，居中，无背景", 40000),
    ("rifle_bolt",   "低多边形风格步枪枪机框组件，独立单个零件，游戏资产，居中，无背景", 40000),
    ("shotgun_body", "低多边形风格泵动霰弹枪枪身，双枪管、木质枪托与机匣，不含前护木，游戏资产，居中，无背景", 60000),
    ("shotgun_bolt", "低多边形风格霰弹枪泵动前护木，独立单个零件，游戏资产，居中，无背景", 40000),
    ("sniper_body",  "低多边形风格狙击步枪枪身，长枪管、枪托与瞄准镜，不含枪机，游戏资产，居中，无背景", 60000),
    ("sniper_bolt",  "低多边形风格旋转后拉式狙击枪机含机柄，独立单个零件，游戏资产，居中，无背景", 40000),
]

def run(job):
    name, prompt, fc = job
    import tempfile
    log = os.path.join(tempfile.gettempdir(), f"gen_{name}.log")
    args = [PY, SCRIPT, "3d", prompt,
            "--generate-type", "LowPoly", "--model", "3.0",
            "--face-count", str(fc), "--token-stdin"]
    done = False
    for attempt in range(80):  # 最多 ~40min 等待槽位
        try:
            with open(log, "w", encoding="utf-8") as f:
                p = subprocess.run(args, input=TOKEN + "\n",
                                   stdout=f, stderr=subprocess.STDOUT,
                                   text=True, timeout=1500)
                f.flush()
                f.seek(0); content = f.read()
                if p.returncode == 0 and "result_url" in content:
                    f.write(f"\n[ORCH] {name} DONE (attempt {attempt})\n")
                    done = True
                    break
                if "concurrency" in content or "429" in content:
                    f.write(f"\n[ORCH] {name} slot full, retry {attempt} in 30s\n")
                else:
                    f.write(f"\n[ORCH] {name} NON429 error rc={p.returncode}, retry {attempt} in 30s\n")
        except Exception as e:
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"\n[ORCH] {name} EXCEPTION {e}, retry {attempt} in 30s\n")
        time.sleep(30)
    return name, "DONE" if done else "FAILED"

if __name__ == "__main__":
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futs = {ex.submit(run, j): j[0] for j in jobs}
        for fut in concurrent.futures.as_completed(futs):
            n, st = fut.result()
            results[n] = st
            print(f"[ORCH] finished {n} -> {st}", flush=True)
    print("[ORCH] ALL DONE:", results, flush=True)
