"""Run the workspace-lens reader:  python -m luthiscope.lens ...

Two ways to feed it:

  # One reading of any text, right now (no Sanctuary change needed):
  python -m luthiscope.lens --prompt "The creeper hissed behind me, so I"

  # Follow the stand-in's moments as Sanctuary logs them (read-only), reading
  # each new moment as it lands. Ctrl-C to stop; rerun to resume.
  python -m luthiscope.lens --moments path/to/stand_in_moments.jsonl --every 5

Readings go to <LUTHISCOPE_HOME>/lens/<session>/workspace_lens.jsonl, where the
LuthiScope "Workspace" window picks them up live.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


def _parse_layers(s: str | None) -> list[int] | None:
    if not s:
        return None
    return [int(x) for x in s.replace(" ", "").split(",") if x]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m luthiscope.lens",
        description="Read what's on the stand-in's mind with the Jacobian lens "
                    "(a frozen twin of the model; never touches the running one).")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--prompt", help="read one piece of raw text")
    src.add_argument("--prompt-file", help="read one piece of raw text from a file")
    src.add_argument("--moments", help="follow a stand-in moments log (JSONL, read-only)")
    p.add_argument("--chat", action="store_true",
                   help="with --prompt: wrap the text as a user turn in the chat template")
    p.add_argument("--session", help="session name (default: from the moments log's "
                                     "folder, or a timestamp)")
    p.add_argument("--every", type=int, default=1,
                   help="with --moments: read every Nth moment (the twin is slow on CPU)")
    p.add_argument("--once", action="store_true",
                   help="with --moments: read what's there, then exit instead of following")
    p.add_argument("--model", help="Hugging Face id of the twin (default Qwen/Qwen3.5-4B)")
    p.add_argument("--lens-repo")
    p.add_argument("--lens-file")
    p.add_argument("--lens-revision")
    p.add_argument("--device", help="auto | cpu | cuda (ROCm reports as cuda)")
    p.add_argument("--dtype", help="bfloat16 (default) | float16 | float32")
    p.add_argument("--layers", help="comma-separated layer indices to read")
    p.add_argument("--positions", type=int, default=16,
                   help="read the last N token positions of each moment (default 16)")
    p.add_argument("--max-tokens", type=int, default=8192)
    p.add_argument("--thinking", action="store_true",
                   help="render moments with Qwen's thinking turned on (match Sanctuary's --llm-thinking)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        import torch  # noqa: F401
        import jlens  # noqa: F401
        import transformers  # noqa: F401
    except ImportError as e:
        print(f"The lens reader needs its extra packages ({e.name} is missing).\n"
              'Install them with:  pip install -e ".[lens]"', file=sys.stderr)
        return 2

    from luthiscope.__main__ import _load_dotenv
    from luthiscope.config import load_settings
    from luthiscope.lens.reader import ReaderConfig, SessionWriter, WorkspaceReader
    from luthiscope.lens.records import last_moment, moment_messages, moment_number

    _load_dotenv()
    settings = load_settings()
    cfg = ReaderConfig()
    for name, val in (("model", args.model), ("lens_repo", args.lens_repo),
                      ("lens_file", args.lens_file), ("lens_revision", args.lens_revision),
                      ("device", args.device), ("dtype", args.dtype)):
        if val:
            setattr(cfg, name, val)
    cfg.layers = _parse_layers(args.layers)
    cfg.last_positions = args.positions
    cfg.max_tokens = args.max_tokens
    cfg.thinking = args.thinking

    if args.moments:
        moments_path = Path(args.moments).expanduser()
        default_session = moments_path.resolve().parent.name or "moments"
    else:
        default_session = time.strftime("prompt_%Y%m%d_%H%M%S")
    session = args.session or default_session
    writer = SessionWriter(settings.lens_root / session)

    reader = WorkspaceReader(cfg)
    writer.write_meta(reader.session_meta("moments" if args.moments else "prompt"))
    print(f"reading layers {reader.layers}; writing to {writer.path}")

    if not args.moments:
        text = args.prompt if args.prompt is not None else Path(
            args.prompt_file).read_text(encoding="utf-8")
        if args.chat:
            text = reader.render([{"role": "user", "content": text}])
        n = (last_moment(writer.path) or 0) + 1
        rec = {"moment": n, "read_at": time.time(), "source": "prompt", **reader.read(text)}
        writer.append(rec)
        _print_summary(rec)
        return 0

    from luthiscope.ingest.tailer import JsonlFollower

    done = last_moment(writer.path)
    follower = JsonlFollower(moments_path)
    seq = 0
    print(f"following {moments_path} (read-only)"
          + (f"; resuming after moment {done}" if done is not None else ""))
    try:
        while True:
            for line in follower.read_new():
                seq += 1
                m = moment_number(line, seq)
                if done is not None and m <= done:
                    continue
                if args.every > 1 and m % args.every:
                    continue
                msgs = moment_messages(line)
                if msgs is None:
                    continue
                t0 = time.time()
                rec = {"moment": m, "read_at": time.time(), "source": "moments",
                       **reader.read(reader.render(msgs))}
                writer.append(rec)
                done = m
                _print_summary(rec, time.time() - t0)
            if args.once:
                return 0
            time.sleep(1.0)
    except KeyboardInterrupt:
        return 0


def _print_summary(rec: dict, secs: float | None = None) -> None:
    words = ", ".join(c["concept"] for c in rec.get("concepts", [])[:6])
    took = f" ({secs:.1f}s)" if secs is not None else ""
    print(f"moment {rec['moment']}{took}: {words}")


if __name__ == "__main__":
    sys.exit(main())
