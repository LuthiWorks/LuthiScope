# Packaging LuthiScope

LuthiScope ships as a single-file Windows executable with the LuthiWorks logo as
its icon. The icon source is `packaging/luthiscope.ico` (generated from the logo);
the favicon / in-app logo is `frontend/assets/logo.png`.

## Build the app

```
pip install pyinstaller
pyinstaller --clean --noconfirm LuthiScope.spec
```

Output: `dist/LuthiScope.exe` (~36 MB; bundles the Python runtime, the server, and
the whole `frontend/`). `build/` and `dist/` are gitignored.

## Run

- **Double-click `LuthiScope.exe`** — starts the local server and opens the UI. If
  [`pywebview`](https://pywebview.flowlib.org/) is installed it opens a native
  window titled "LuthiScope" with the logo icon; otherwise it opens your default
  browser. (`pywebview` is not bundled by default, to keep the build robust; install
  it before building if you want the native-window experience baked in.)
- **From source:** `python -m luthiscope --app` (desktop mode) or
  `python -m luthiscope` (server only).
- **Headless / service:** set `LUTHISCOPE_SERVE_ONLY=1` to serve without opening any
  window (used to verify the bundle in CI).

## Configuration

The packaged app reads the same environment variables as the source
(`LUTHISCOPE_RUNS_DIR`, `LUTHISCOPE_HOME`, `LUTHISCOPE_HOST`, `LUTHISCOPE_PORT` —
see `.env.example`). Point `LUTHISCOPE_RUNS_DIR` at the trainer's runs directory to
monitor real runs.

## Regenerating the icon

```
python - <<'PY'
from PIL import Image
src = Image.open(r"path/to/luthiworks_logo.png").convert("RGBA")
side = max(src.size); c = Image.new("RGBA", (side, side), (0,0,0,0))
c.paste(src, ((side-src.size[0])//2, (side-src.size[1])//2), src)
c.resize((128,128)).save("frontend/assets/logo.png")
c.save("packaging/luthiscope.ico", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
PY
```
