"""Dev tool: append synthetic training records to a JSONL file on an interval, so
the live-tail path can be demonstrated without a real training run.

    python scripts/fake_live.py [path] [--interval 1.0]

Default path: demo_runs/live_demo/training_log.jsonl. Point LuthiScope's
LUTHISCOPE_RUNS_DIR at the parent (demo_runs) and select the "live_demo" stream to
watch it update. NOT part of the product — purely a demo/testing aid.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

DEFAULT = Path("demo_runs/live_demo/training_log.jsonl")


def make_record(step: int, t0: float) -> dict:
    # plausible, monotone-ish trajectory; deep block on a coarse cadence
    decay = math.exp(-step / 400.0)
    loss = 2.0 + 2.8 * decay + 0.05 * math.sin(step / 7.0)
    rec = {
        "step": step,
        "modality": "text",
        "loss": round(loss, 5),
        "l_pred": round(loss - 0.3, 5),
        "l_sigreg": round(2.6 + 0.2 * math.sin(step / 5.0), 5),
        "tokens_consumed": {"text": step * 256, "audio": 0, "vision": 0},
        "elapsed_seconds": round(time.monotonic() - t0, 3),
        "light": {
            "online_std_p5": round(0.95 - 0.02 * decay, 5),
            "online_std_p50": round(1.13 + 0.01 * math.sin(step / 9.0), 5),
            "online_std_p95": round(1.32, 5),
            "online_std_below_0.1": 0,
            "online_std_below_0.5": 0,
            "mean_abs_off_diag_correlation": round(0.14 + 0.005 * math.sin(step / 11.0), 5),
            "sigreg": round(2.6 + 0.2 * math.sin(step / 5.0), 5),
            "predictor_trivial_cosine_mean": round(min(0.95, 0.2 + 0.6 * (1 - decay)), 5),
            "predictor_trivial_cosine_std": 0.05,
            "predictor_output_std_p50": round(0.6 * decay + 0.3, 5),
        },
        "substrate": {
            "pred_frob": round(0.03 + 0.4 * (1 - decay), 5),
            "err_acc": round(0.2 * decay + 0.01, 5),
        },
    }
    if step % 20 == 0:
        rec["deep"] = {
            "effective_rank": round(28 + 6 * (1 - decay), 4),
            "stable_rank": round(3.5 + 2 * (1 - decay), 4),
            "sv_index_at_90pct": 25,
            "sv_index_at_99pct": 45,
            "log_sv_max": 2.29,
            "log_sv_min": -5.8,
            "log_sv_range": 8.1,
        }
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", default=str(DEFAULT))
    ap.add_argument("--interval", type=float, default=1.0)
    ap.add_argument("--start", type=int, default=5)
    ap.add_argument("--stride", type=int, default=5)
    args = ap.parse_args()

    path = Path(args.path)
    path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    step = args.start
    print(f"appending to {path} every {args.interval}s — Ctrl-C to stop")
    try:
        while True:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(make_record(step, t0)) + "\n")
            print(f"  step {step}")
            step += args.stride
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
