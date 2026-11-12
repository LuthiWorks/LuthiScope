# Workspace lens — what's on the stand-in's mind

**Added:** 2026-11-11 (Brian: "It should be its own separate window.")
**Status:** built and tested on a tiny stand-in model; not yet run against the
real Qwen3.5-4B (see "Not yet verified").

LuthiScope's **Workspace** window shows which single-word concepts are active in
the stand-in mind's workspace, moment by moment. It uses Anthropic's
[Jacobian lens](https://github.com/anthropics/jacobian-lens) (Apache-2.0), the
companion code to *Verbalizable Representations Form a Global Workspace in
Language Models*, with Neuronpedia's ready-made lens for the model.

## Which model, which lens

The stand-in is **Qwen3.5-4B** (Sanctuary,
`docs/MINECRAFT_FIRST_WORLD_DECISION_2026-11-01.md`; default `llm_model` in
`sanctuary/core/llm_model.py`). The lens is the one jacobian-lens's own
walkthrough loads for that model:

| Setting | Default |
|---|---|
| model | `Qwen/Qwen3.5-4B` |
| lens repo | `neuronpedia/jacobian-lens` |
| lens file | `qwen3.5-4b/jlens/Salesforce-wikitext/Qwen3.5-4B_jacobian_lens_n1000.pt` |
| revision | `qwen-n1000` |

`LUTHISCOPE_LENS_MODEL=Qwen/Qwen3-4B` switches to Qwen3-4B and its lens
(`qwen3-4b/jlens/Salesforce-wikitext/Qwen3-4B_jacobian_lens.pt`). Any other
model needs `LUTHISCOPE_LENS_FILE` (and repo/revision if it's on the Hub). The
twin must be the same model the stand-in runs, or the readings describe a
different mind.

## How it stays read-only

The stand-in runs in llama-server from a GGUF file. Its residual stream can't be
reached from outside, and reaching into a running mind would break LuthiScope's
first rule anyway. So the lens reads a **twin**:

1. The **reader** (`python -m luthiscope.lens`) loads the same weights into its
   own process, freezes every parameter, and runs forward passes only, under
   `torch.inference_mode()`. Forward hooks copy the residual stream out at the
   read positions and return nothing, so they can't change a layer's output.
   A test checks that weights and outputs are bit-identical after reading.
2. It feeds the twin the stand-in's moments exactly as the chat template lays
   them out, ending where the stand-in begins to answer.
3. It writes readings only into LuthiScope's own home:
   `<LUTHISCOPE_HOME>/lens/<session>/workspace_lens.jsonl` and `session.json`.
4. The LuthiScope server only reads those files; the window only shows them.

The twin is the same computation on the same input, so what it holds is what
the stand-in held, up to the GGUF quantization the stand-in runs at. Nothing
ever contacts llama-server.

## The readout

For each read layer `l` (default: every 2nd layer from a quarter of the way up,
which brackets the middle layers where the paper finds the workspace), at the
last 16 token positions of the moment:

    p_l = softmax over word-like tokens of unembed(J_l @ h_l)

A concept's **strength** is `p_l` averaged over the read layers and positions,
with variants of one word (" Rome", "Rome") folded together. It's a relative
strength for comparing concepts within a moment, not a calibrated probability.
"Peak layer" is where it was strongest. Qwen3.5's Chinese/Japanese/Korean
vocabulary entries get jacobian-lens's machine-made English gloss beside them.

Limits worth keeping in view: the lens reads **single-word concepts only**; the
paper's results are on Claude, and the effect is **fainter on a 4B model**; it
**reads** an existing workspace and can't create one.

## The window

Open it with the **◎** button in LuthiScope's top bar. In the desktop app it
opens as its own native window; in a browser it opens as a separate browser
window (or go to `http://127.0.0.1:8800/lens`).

- **Moments** (left): newest first, each with its strongest few concepts.
  Follow (top right) jumps to each new moment as it's read; arrow keys step.
- **On its mind**: the moment's concepts as bars, strongest first. Click one to
  follow it across moments.
- **By depth**: the top words at each read layer, at the moment's last position,
  with the model's own next word ("says") underneath for comparison.
- **Over moments**: one concept's strength across every moment.
- **Where it was**: the end of the moment's text, with the read tokens marked.

## Running the reader

Install once, in a Python environment (not needed for the packaged exe, which
only shows readings):

    pip install -e ".[lens]"

The first run downloads the model (~9 GB) and the lens (~0.4 GB) from Hugging
Face. Then:

    # one reading of any text, now
    python -m luthiscope.lens --prompt "The creeper hissed behind me, so I"
    python -m luthiscope.lens --chat --prompt "What do you see?"   # as a user turn

    # follow the stand-in's moments (read-only), every 5th one
    python -m luthiscope.lens --moments path/to/stand_in_moments.jsonl --every 5

`--moments` resumes where it left off when rerun. `--thinking` matches
Sanctuary's `--llm-thinking`. `--layers`, `--positions`, `--max-tokens`,
`--device`, `--dtype` override the defaults; `.env.example` lists the
environment equivalents.

### First run on Brian's PC (Windows, CPU)

A one-time check that the twin loads and the lens reads. Keep the lens in its
own Python environment so the app's build environment (`.venv`) stays lean.
In PowerShell, in the LuthiScope folder:

1. Get the latest code: `git pull`
2. Make the lens environment: `py -3.10 -m venv .venv-lens`
3. Install the reader (needs git on the PATH for jlens):
   `.venv-lens\Scripts\python -m pip install -e ".[lens]"`
4. Take one reading. The first time it downloads about 9.5 GB and needs
   roughly 11 GB of free RAM:
   `.venv-lens\Scripts\python -m luthiscope.lens --prompt "Fact: The currency used in the country shaped like a boot is"`
5. It prints `moment 1: ...` with the strongest concepts. The lens paper's
   own example: words like Italy, lira or euro in that list mean it's reading.
6. Open LuthiScope, press ◎, and pick the `prompt_...` session. The same
   concepts should be in "On its mind".

If a step fails, the last few lines it printed say why.

### Hardware

bf16 Qwen3.5-4B needs about 9–10 GB of memory wherever it runs.

- **CPU** works anywhere and is the safe default on Windows: slow (roughly
  tens of seconds per moment on a desktop CPU; use `--every`), but it leaves
  the GPU to the stand-in.
- **AMD GPU (RX 7800 XT):** PyTorch's ROCm build is the way in, and **Linux is
  the reliable path**. AMD's PyTorch-on-Windows support list doesn't name the
  7800 XT. On a 16 GB card the twin also competes with llama-server for VRAM.
  `--device auto` uses the GPU only when PyTorch sees one.

## The moments log (Sanctuary side, not yet written)

`--moments` reads a JSONL that Sanctuary does **not** write today. The contract
the reader expects, one line per cycle, written by Sanctuary's `LLMModel.think`:

| Field | Type | Meaning |
|---|---|---|
| `cycle` | int | The cycle number (becomes the window's moment number). |
| `messages` | list | The request's chat messages exactly as sent: `[{role, content}, ...]`. |
| *or* `system`, `user` | str | The two messages separately, if `messages` is absent. |

Other fields (the reply, timing) may be present and are ignored. The reader
opens the file read-only and never writes beside it.

## Record format

See `luthiscope/lens/records.py` for `workspace_lens.jsonl` and `session.json`.
A producer may also write its own `workspace_lens.jsonl` inside a run
directory; the window lists it as `run:<run dir>`.

## Not yet verified

- A run against the real Qwen3.5-4B and its lens. The tests use a tiny random
  Qwen-architecture model with an identity lens, which exercises every step
  except the real weights. Hugging Face wasn't reachable from the build
  machine.
- How readable the concepts are at 4B, how fast the twin reads on Brian's CPU,
  and whether the window's defaults (layers, 16 positions) are the most
  telling. Tune after the first real run.
- The native second window in the packaged exe (pywebview `create_window` after
  start). The browser fallback is the same page.
