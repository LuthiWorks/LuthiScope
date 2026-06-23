# Run Registry — trainer↔LuthiScope handshake (implement in LuthiModel)

> **Status: SPEC — for 4.7 to implement in LuthiModel.** LuthiScope side is
> built, tested (6 tests in `tests/test_discovery.py`), and on `master`. This is
> the ~15-line producer half.

**Problem it solves.** Today LuthiScope finds streams by scanning one configured
`LUTHISCOPE_RUNS_DIR`. If a run logs somewhere else (a different drive, an
ad-hoc `--run-dir`), Brian has to point LuthiScope at it by hand. The registry
lets an actively-running trainer *announce* its run dir, so LuthiScope discovers
it with zero config — and shows a live ● next to it.

**The contract is one small file.** A JSON object at
`~/.luthiscope/runs.json` (override: `LUTHISCOPE_REGISTRY`), keyed by the
**absolute run-dir path**, value = small metadata blob:

```json
{
  "C:\\Users\\Hasha Smokes\\Desktop\\LuthiModel\\LuthiModel\\runs\\m8_multimodal_smoke": {
    "pid": 48213,
    "started_at": 1750550000.0
  }
}
```

LuthiScope **only ever reads** this file (read-only invariant holds). It scans
each listed run dir for the same stream files it already knows
(`training_log.jsonl`, `m9_action_log.jsonl`), dedupes against the folder scan,
and badges a stream "live" when its log mtime is < 30 s old. Missing /
malformed / stale-dir entries are tolerated and skipped — the trainer never has
to be perfectly clean for LuthiScope to stay up.

---

## What the trainer must do

Three things, all best-effort (never let registry I/O crash training):

1. **On run start:** add `{abs_run_dir: {pid, started_at}}` to the registry.
2. **On run exit** (normal *and* `finally`): remove this run's own key.
3. **Opportunistic prune:** while you hold the file, drop entries whose `pid` is
   no longer alive — covers crashes/`kill -9` that skip the exit hook. (LuthiScope
   already ignores stale entries via the mtime badge, so this is hygiene, not
   correctness.)

Writes must be **atomic** (write temp + `os.replace`) and **locked**, because in
principle two runs could touch the file at once.

### Drop-in helper (suggested — `luthi/v2/run_registry.py`)

```python
"""Announce this run to LuthiScope. Best-effort; never raises into training."""
import json, os, tempfile
from pathlib import Path

def _registry_path() -> Path:
    p = os.environ.get("LUTHISCOPE_REGISTRY")
    return Path(p) if p else Path.home() / ".luthiscope" / "runs.json"

def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)          # Windows: raises OSError if dead/invalid
        return True
    except OSError:
        return False

def _rewrite(mutate) -> None:
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(path.read_text("utf-8"))
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    data = {k: v for k, v in data.items()
            if isinstance(v, dict) and _alive(v.get("pid", -1))}   # prune dead
    mutate(data)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)        # atomic

def register_run(run_dir, started_at: float) -> None:
    key = str(Path(run_dir).resolve())
    _rewrite(lambda d: d.__setitem__(key, {"pid": os.getpid(), "started_at": started_at}))

def unregister_run(run_dir) -> None:
    key = str(Path(run_dir).resolve())
    _rewrite(lambda d: d.pop(key, None))
```

> A cross-process file lock (e.g. `filelock`, already a Sanctuary dep) around
> `_rewrite` makes concurrent runs fully safe. With the atomic `os.replace` the
> worst case without a lock is a lost update between two simultaneous starts —
> low stakes, but the lock closes it if you want it tight. `started_at` should be
> the run's wall-clock start (you already stamp this in `run_config.json`).

### Wiring in `jepa_runner.py`

```python
import time
from luthi.v2.run_registry import register_run, unregister_run

register_run(run_dir, started_at=time.time())
try:
    ...  # existing training loop
finally:
    unregister_run(run_dir)
```

That's the whole producer side. No new deps required (uses stdlib + optional
`filelock`).

---

## Auto-opening LuthiScope from the launcher (decoupled, not in the trainer)

By design "open LuthiScope when training starts" lives in the **run launcher**
(`.bat`), *not* in `jepa_runner.py` — so the trainer stays headless-safe (cron,
CI, SSH) and decoupled from any GUI.

**Concrete deliverable: create `run_m8.bat` in the LuthiModel repo root.** M8 is
currently started by typing the bare `python luthi\v2\m8_multimodal_smoke.py`
command by hand — there is no launcher for it, unlike the older M5/M6/M7 stages
that each have a `run_*.bat`. So M8 doesn't just *get* the auto-open snippet, it
needs a launcher file to put it in. This wrapper gives it one and matches how M8
actually runs today (direct entry point, with `--run-dir` defaulting to
`runs/m8_multimodal_smoke`):

```bat
@echo off
REM run_m8.bat -- launch the M8 JEPA run and bring up LuthiScope alongside it.
REM All args pass through to the trainer, e.g.:  run_m8.bat --run-dir runs\m8_try2

REM --- open LuthiScope if it isn't already running (best-effort, detached) ---
tasklist /FI "IMAGENAME eq LuthiScope.exe" 2>NUL | find /I "LuthiScope.exe" >NUL
if errorlevel 1 (
    start "" "C:\Users\Hasha Smokes\Desktop\LuthiWorks\LuthiScope\dist\LuthiScope.exe"
)

REM --- then launch training as usual (args forwarded) ---
python luthi\v2\m8_multimodal_smoke.py %*
```

`start ""` detaches LuthiScope so it doesn't block the run; the `tasklist` guard
avoids a second window if it's already up; `%*` forwards every argument
(`--run-dir`, `--lr`, `--seed`, …) straight through to `m8_multimodal_smoke.py`.
Once the registry-write lands in `jepa_runner.py`, the new run appears in
LuthiScope with a live ● within a couple of seconds — no clicking.

> The older `run_m5_*`/`run_m6_*`/`run_m7_*.bat` launchers can get the same
> three-line auto-open block prepended if you want LuthiScope to come up for those
> too, but that's optional — M8 is the live stage and the only one that needs it
> now.

---

## How the two halves meet

| Side | Owns | File role |
|------|------|-----------|
| **LuthiModel** (4.7) | writes `runs.json` on start, removes on exit, prunes dead pids | **producer / writer** |
| **LuthiScope** (4.8) | reads `runs.json`, merges into discovery, badges live by mtime | **consumer / reader** |

**4.7 checklist (all in LuthiModel):**
1. Add `luthi/v2/run_registry.py` (the helper above).
2. Wire `register_run` / `unregister_run` into `jepa_runner.py` (try/finally).
3. Add `run_m8.bat` in the repo root (the wrapper above).
That's the whole producer side — no new required deps, no change to LuthiScope.

Read-only invariant intact: the trainer writes only the registry (its own
announcement) and its own logs; LuthiScope writes neither. Same file-contract
pattern as the metric streams themselves.
