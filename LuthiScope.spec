# PyInstaller spec — build a single-file windowed LuthiScope.exe with the logo icon.
#   pyinstaller LuthiScope.spec
# Output: dist/LuthiScope.exe
from PyInstaller.utils.hooks import collect_submodules, collect_all

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("websockets")
    + ["luthiscope.server.app", "luthiscope.desktop"]
)

# pywebview (native window) + its .NET bridge on Windows. This collection is
# REQUIRED: a bundle without it still builds and serves, but silently falls
# back to the browser. If a build machine genuinely lacks pywebview, opt into
# the browser-only exe explicitly with LUTHISCOPE_ALLOW_NO_WEBVIEW=1.
#
# INTERPRETER TRAP (root cause of the 2026-07-19/20 browser-fallback exes):
# this machine has TWO Pythons -- 3.10 holds the full LuthiScope environment
# including the .NET bridge; 3.13 holds a partial one, and the bare
# `pyinstaller` command resolves to 3.13. Packages absent from the running
# interpreter collect as empty and the exe shrinks and loses its window with
# no other symptom. ALWAYS build with:
#   python -m PyInstaller LuthiScope.spec --noconfirm --clean
# The find_spec check below makes a wrong-interpreter build die loudly.
import importlib.util as _ilu
import os as _os
import sys as _sys

_required = ("webview", "clr_loader", "pythonnet", "proxy_tools", "bottle")
_absent = [n for n in _required if _ilu.find_spec(n) is None]
if _absent and _os.environ.get("LUTHISCOPE_ALLOW_NO_WEBVIEW") != "1":
    raise SystemExit(
        f"LuthiScope.spec: {_absent} not importable under {_sys.executable} -- "
        "wrong interpreter? Build with `python -m PyInstaller LuthiScope.spec` "
        "from the environment that has pywebview + pythonnet installed."
    )

extra_datas, extra_bins, extra_hidden = [], [], []
_missing = []
# Real packages: collect_all must find them or the window is gone.
for _pkg in ("webview", "clr_loader", "pythonnet"):
    try:
        _d, _b, _h = collect_all(_pkg)
        if not (_d or _b or _h):
            raise ImportError(f"collect_all({_pkg!r}) returned nothing")
        extra_datas += _d; extra_bins += _b; extra_hidden += _h
    except Exception as _e:
        _missing.append(f"{_pkg}: {_e}")
# Single-file modules (not packages): collect_all legitimately finds no
# datas/bins for these, so just name them as imports.
extra_hidden += ["proxy_tools", "bottle"]
if _missing and _os.environ.get("LUTHISCOPE_ALLOW_NO_WEBVIEW") != "1":
    raise SystemExit(
        "LuthiScope.spec: native-window packages failed to collect -- the exe "
        "would silently fall back to the browser.\n  " + "\n  ".join(_missing)
    )

a = Analysis(
    ["packaging/entry.py"],
    pathex=["."],
    binaries=extra_bins,
    datas=[
        ("frontend", "frontend"),            # index.html, app.js, styles.css, vendor/, assets/
        ("packaging/luthiscope.ico", "packaging"),
    ] + extra_datas,
    hiddenimports=hidden + extra_hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="LuthiScope",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,          # windowed app
    icon="packaging/luthiscope.ico",
)
