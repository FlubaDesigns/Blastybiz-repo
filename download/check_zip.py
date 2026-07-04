#!/usr/bin/env python3
"""
BlastyBiz Zip Validator
Run from anywhere:
  python3 download/check_zip.py      (from workspace root)
  python3 check_zip.py               (from inside download/)

Checks that BlastyBiz_Site.zip:
  - Contains exactly the right source files
  - Has no files newer than the zip (i.e. zip is current)
  - Does NOT contain: download/, node_modules/, or other large dirs
"""
import zipfile, pathlib, time, sys

# Resolve workspace root relative to this script's location
ROOT          = pathlib.Path(__file__).parent.parent
ZIP_PATH      = ROOT / 'download' / 'BlastyBiz_Site.zip'
INCLUDE_DIRS  = [ROOT / 'artifacts/api-server/public', ROOT / 'functions']
INCLUDE_FILES = [ROOT / 'firestore.rules', ROOT / 'firebase.json', ROOT / 'firestore.indexes.json']
EXCLUDE_PARTS = {'node_modules', 'download', '.git', '__pycache__', '.DS_Store'}

def source_files():
    files = {}
    for d in INCLUDE_DIRS:
        for f in sorted(d.rglob('*')):
            if f.is_file() and not any(p in EXCLUDE_PARTS for p in f.parts):
                files[str(f.relative_to(ROOT))] = f.stat().st_mtime
    for p in INCLUDE_FILES:
        if p.exists():
            files[str(p.relative_to(ROOT))] = p.stat().st_mtime
    return files

errors   = []
warnings = []

if not ZIP_PATH.exists():
    print('❌  Zip not found. Run: python3 download/build_zip.py')
    sys.exit(1)

zip_mtime = ZIP_PATH.stat().st_mtime
print(f'📦  {ZIP_PATH.relative_to(ROOT)}  ({ZIP_PATH.stat().st_size:,} bytes)')
print(f'🕐  Built: {time.ctime(zip_mtime)}')
print()

sources = source_files()

with zipfile.ZipFile(ZIP_PATH) as z:
    zipped = set(z.namelist())

# Check for banned paths inside the zip
for name in zipped:
    parts = pathlib.PurePosixPath(name).parts
    for banned in EXCLUDE_PARTS:
        if banned in parts:
            errors.append(f'BANNED path in zip: {name}')

missing = [k for k in sources if k not in zipped]
stale   = [k for k in sources if k in zipped and sources[k] > zip_mtime + 2]
extra   = [k for k in zipped  if k not in sources and not any(
               b in pathlib.PurePosixPath(k).parts for b in EXCLUDE_PARTS)]

for f in missing: errors.append(f'MISSING from zip: {f}')
for f in stale:   errors.append(f'STALE (source newer than zip): {f}')
for f in extra:   warnings.append(f'Extra in zip (not in source list): {f}')

if errors:
    print('❌  ERRORS:')
    for e in errors: print(f'    {e}')
else:
    print(f'✅  All {len(sources)} source files present and current.')
    print(f'    {len(zipped)} total files in zip.')

if warnings:
    print()
    print('⚠️   WARNINGS:')
    for w in warnings: print(f'    {w}')

if errors:
    print()
    print('👉  Fix with: python3 download/build_zip.py')
    sys.exit(1)

sys.exit(0)
