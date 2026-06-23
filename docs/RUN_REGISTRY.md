# Run Registry — trainer↔LuthiScope handshake

> **Status: BUILT + REVIEWED, both sides.** LuthiScope side: built, tested
> (6 tests in `tests/test_discovery.py`), on `master`. LuthiModel side: built by
> 4.8 (Brian invited the finish since LuthiScope was 4.8's project end to end) —
> `luthi/v2/run_registry.py`, wired into `m8_multimodal_smoke.py`, `run_m8.bat`,
> tests in `tests/test_run_registry.py`. **Reviewed and landed by 4.7
> (2026-06-22):** verified the never-raise invariant under 11 adversarial inputs,
> confirmed the cross-repo handshake empirically, found 5 non-blocking items
> (2 LOW, 3 NIT). 4.8 took all 5 as a hardening follow-up (LOW-2 — ctypes
> argtypes, the one that could close a wrong handle on 64-bit Windows — being the
> material one); 11 registry tests green. Two design choices changed during the
> build vs. this spec's first draft; both are called out inline below
> (⚠︎ wiring location, ⚠︎ Windows-safe pid check).

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

Writes are **atomic** (write temp + `os.replace`) and **locked** (`filelock`,
already in the lock tree), because in principle two runs could touch the file at
once. The whole module is **best-effort**: every public call wraps its body so a
failure returns quietly rather than escaping into training.

### Implemented: `luthi/v2/run_registry.py`

Built and tested — read the file for the full version. Public API:

```python
register_run(run_dir, started_at: float) -> None   # call once at run start
unregister_run(run_dir) -> None                     # call in a finally
```

Two correctness points worth flagging for review:

> **⚠︎ `_pid_alive` must be read-only — and that rules out `os.kill` on Windows.**
> The spec's first draft used `os.kill(pid, 0)` as the liveness probe. That is
> correct on POSIX (signal 0 is never delivered), but on **Windows `os.kill` with
> any non-CTRL signal calls `TerminateProcess`** — it would *kill the very
> training run it is checking*. The shipped helper therefore branches: POSIX uses
> `os.kill(pid, 0)`; Windows opens a query-only process handle
> (`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetExitCodeProcess`,
> checking `STILL_ACTIVE`) and never signals. This is exactly the kind of latent,
> platform-specific hazard the registry's "never touch the training process"
> invariant exists to prevent. `tests/test_run_registry.py::test_pid_alive_is_readonly_and_correct`
> asserts our own pid reads alive and a dead pid reads gone — and the test itself
> still being alive to assert is the proof nothing was signalled.

> The `filelock` acquire is wrapped: if the lock can't be taken within 5 s (or
> the package is somehow absent) the write proceeds unlocked rather than block
> training. With the atomic `os.replace`, the worst unlocked case is a lost update
> between two simultaneous starts — low stakes; the lock closes it in practice.
> `started_at` is the run's wall-clock start (`time.time()` in `main()`).

### Wiring: `m8_multimodal_smoke.py` `main()` — **⚠︎ not `jepa_runner.py`**

The first draft said wire into `jepa_runner.py` (the shared `JEPATrainer`
chokepoint). Building it surfaced why that's the wrong seat: **`JEPATrainer.__init__`
is constructed by the test suite**, so registering there would make every
trainer-construction test write to the real `~/.luthiscope/runs.json` — a global
side effect in unit tests. `main()` only runs on an actually-launched run, and it
already creates `run_dir`, so that's the correct seat. The wiring (shipped):

```python
def _run_smoke(args, started: float) -> int:
    ...
    args.run_dir.mkdir(parents=True)
    register_run(args.run_dir, started_at=started)   # announce, best-effort
    ...                                              # existing run (unchanged)

def main() -> int:
    args = parse_args()
    started = time.time()
    try:
        return _run_smoke(args, started)
    finally:
        unregister_run(args.run_dir)   # retract on pass/fail/raise; no-ops if never registered
```

The existing `main()` body became `_run_smoke(args, started)` verbatim (only the
`parse_args()` call moved up into the new thin `main()`); behavior is otherwise
unchanged, which is why the emit-batch-1 regression suite stays green. Other
launchers (`m8_smoke.py`, `m5_runner.py`) can get the same two-line treatment if
you want them covered, but M8 is the live stage.

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

**4.7 review checklist — built by 4.8, uncommitted in LuthiModel, yours to land:**
1. `luthi/v2/run_registry.py` — the helper (best-effort, locked, atomic,
   Windows-safe pid check).
2. `luthi/v2/m8_multimodal_smoke.py` — body → `_run_smoke(args, started)`; new
   thin `main()` registers after `mkdir` and unregisters in `finally`.
3. `run_m8.bat` (repo root) — auto-opens LuthiScope, forwards args, runs M8.
4. `tests/test_run_registry.py` — 8 tests (roundtrip, prune, malformed/non-object
   tolerance, never-raises-on-unwritable, read-only pid check). All green;
   emit-batch-1 (14) and no-hardcoded-paths regressions green.

No new required deps (`filelock` already in the lock tree); no change to
LuthiScope. The cross-repo handshake was verified end to end: LuthiModel's
`register_run` writes the registry, LuthiScope's `registry_streams` reads it and
finds the stream.

Read-only invariant intact: the trainer writes only the registry (its own
announcement) and its own logs; LuthiScope writes neither. Same file-contract
pattern as the metric streams themselves.
