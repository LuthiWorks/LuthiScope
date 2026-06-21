# PyInstaller spec — build a single-file windowed LuthiScope.exe with the logo icon.
#   pyinstaller LuthiScope.spec
# Output: dist/LuthiScope.exe
from PyInstaller.utils.hooks import collect_submodules, collect_all

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("websockets")
    + ["luthiscope.server.app", "luthiscope.desktop"]
)

# pywebview (native window) + its .NET bridge on Windows. Best-effort: if a package
# isn't present at build time, the desktop launcher falls back to the browser, so a
# missing piece never breaks the app.
extra_datas, extra_bins, extra_hidden = [], [], []
for _pkg in ("webview", "clr_loader", "pythonnet", "proxy_tools", "bottle"):
    try:
        _d, _b, _h = collect_all(_pkg)
        extra_datas += _d; extra_bins += _b; extra_hidden += _h
    except Exception:
        pass

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
