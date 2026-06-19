# PyInstaller spec — build a single-file windowed LuthiScope.exe with the logo icon.
#   pyinstaller LuthiScope.spec
# Output: dist/LuthiScope.exe
from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("websockets")
    + ["luthiscope.server.app", "luthiscope.desktop"]
)

a = Analysis(
    ["packaging/entry.py"],
    pathex=["."],
    binaries=[],
    datas=[
        ("frontend", "frontend"),            # index.html, app.js, styles.css, vendor/, assets/
        ("packaging/luthiscope.ico", "packaging"),
    ],
    hiddenimports=hidden,
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
