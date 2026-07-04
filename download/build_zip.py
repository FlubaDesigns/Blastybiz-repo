#!/usr/bin/env python3
"""
BlastyBiz Zip Builder — canonical zip rebuild + immediate validation.
Run from anywhere:
  python3 download/build_zip.py      (from workspace root)
  python3 build_zip.py               (from inside download/)

What goes in:
  artifacts/api-server/public/  (all static site files)
  functions/                    (Cloud Functions source + package.json)
  firestore.rules
  firebase.json
  firestore.indexes.json

What stays OUT (always):
  download/           (this folder — audit, zip, scripts)
  node_modules/       (large, regenerated via npm ci on deploy)
  .git/               (version control internals)
  __pycache__/        (Python bytecode)
  .DS_Store           (macOS metadata)
"""
import zipfile, pathlib, subprocess, sys, time

# Resolve workspace root relative to this script's location
ROOT          = pathlib.Path(__file__).parent.parent
ZIP_PATH      = ROOT / 'download' / 'BlastyBiz_Site.zip'
INCLUDE_DIRS  = [ROOT / 'artifacts/api-server/public', ROOT / 'functions']
INCLUDE_FILES = [ROOT / 'firestore.rules', ROOT / 'firebase.json', ROOT / 'firestore.indexes.json']
EXCLUDE_PARTS = {'node_modules', 'download', '.git', '__pycache__', '.DS_Store'}

ZIP_PATH.parent.mkdir(exist_ok=True)

files_written = []
with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
    for d in INCLUDE_DIRS:
        for f in sorted(d.rglob('*')):
            if f.is_file() and not any(p in EXCLUDE_PARTS for p in f.parts):
                arcname = f.relative_to(ROOT)
                zf.write(f, arcname)
                files_written.append(str(arcname))
    for p in INCLUDE_FILES:
        if p.exists():
            arcname = p.relative_to(ROOT)
            zf.write(p, arcname)
            files_written.append(str(arcname))

size_kb = ZIP_PATH.stat().st_size // 1024
print(f'📦  Built {ZIP_PATH.relative_to(ROOT)}')
print(f'    {len(files_written)} files  |  {size_kb:,} KB  |  {time.ctime()}')
print()

# Immediately validate
result = subprocess.run(
    [sys.executable, str(ROOT / 'download' / 'check_zip.py')],
    capture_output=True, text=True
)
print(result.stdout)
if result.stderr:
    print(result.stderr)
if result.returncode != 0:
    sys.exit(1)
