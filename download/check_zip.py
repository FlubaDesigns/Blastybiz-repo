#!/usr/bin/env python3
"""
BlastyBiz Zip Validator
Run: python3 download/check_zip.py

Checks that BlastyBiz_Site.zip:
  - Contains exactly the right source files
  - Has no files newer than the zip (i.e. zip is current)
  - Does NOT contain: download/, node_modules/, or other large dirs
  - SHA-256 checksum matches BlastyBiz_Site.zip.sha256 (if present)
"""
import hashlib, zipfile, pathlib, time, sys

ZIP_PATH   = pathlib.Path('download/BlastyBiz_Site.zip')
SHA_PATH   = pathlib.Path('download/BlastyBiz_Site.zip.sha256')
INCLUDE_DIRS  = ['artifacts/api-server/public', 'functions']
INCLUDE_FILES = ['firestore.rules', 'firebase.json', 'firestore.indexes.json']
EXCLUDE_PARTS = {'node_modules', 'download', '.git', '__pycache__', '.DS_Store'}

def source_files():
    files = {}
    for d in INCLUDE_DIRS:
        for f in sorted(pathlib.Path(d).rglob('*')):
            if f.is_file() and not any(p in EXCLUDE_PARTS for p in f.parts):
                files[str(f)] = f.stat().st_mtime
    for name in INCLUDE_FILES:
        p = pathlib.Path(name)
        if p.exists():
            files[str(p)] = p.stat().st_mtime
    return files

errors   = []
warnings = []

if not ZIP_PATH.exists():
    print('❌  Zip not found. Run: python3 download/build_zip.py')
    sys.exit(1)

zip_mtime = ZIP_PATH.stat().st_mtime
print(f'📦  {ZIP_PATH}  ({ZIP_PATH.stat().st_size:,} bytes)')
print(f'🕐  Built: {time.ctime(zip_mtime)}')

# Verify SHA-256 checksum
if SHA_PATH.exists():
    stored_line = SHA_PATH.read_text().strip()
    stored_hash = stored_line.split()[0] if stored_line else ''
    actual_hash = hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()
    if stored_hash == actual_hash:
        print(f'🔒  SHA-256: {actual_hash}  ✓')
    else:
        errors.append(f'SHA-256 MISMATCH — stored: {stored_hash[:16]}…  actual: {actual_hash[:16]}…')
        print(f'❌  SHA-256 mismatch!')
else:
    warnings.append(f'No checksum file found at {SHA_PATH} — run build_zip.py to generate one')

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
