#!/usr/bin/env python3
"""
BlastyBiz Zip Builder — canonical zip rebuild + immediate validation + SHA-256 checksum.
Run: python3 download/build_zip.py

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
import hashlib, zipfile, pathlib, subprocess, sys, time

ZIP_PATH      = pathlib.Path('download/BlastyBiz_Site.zip')
SHA_PATH      = pathlib.Path('download/BlastyBiz_Site.zip.sha256')
INCLUDE_DIRS  = ['artifacts/api-server/public', 'functions']
INCLUDE_FILES = ['firestore.rules', 'firebase.json', 'firestore.indexes.json']
EXCLUDE_PARTS = {'node_modules', 'download', '.git', '__pycache__', '.DS_Store'}

ZIP_PATH.parent.mkdir(exist_ok=True)

files_written = []
with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
    for d in INCLUDE_DIRS:
        for f in sorted(pathlib.Path(d).rglob('*')):
            if f.is_file() and not any(p in EXCLUDE_PARTS for p in f.parts):
                zf.write(f, f)
                files_written.append(str(f))
    for name in INCLUDE_FILES:
        p = pathlib.Path(name)
        if p.exists():
            zf.write(p, p)
            files_written.append(name)

size_kb = ZIP_PATH.stat().st_size // 1024
print(f'📦  Built {ZIP_PATH}')
print(f'    {len(files_written)} files  |  {size_kb:,} KB  |  {time.ctime()}')

# Generate SHA-256 checksum of the zip
sha256 = hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()
SHA_PATH.write_text(f'{sha256}  BlastyBiz_Site.zip\n')
print(f'🔒  SHA-256: {sha256}')
print(f'    Written to {SHA_PATH}')
print()

# Immediately validate
result = subprocess.run(
    [sys.executable, 'download/check_zip.py'],
    capture_output=True, text=True
)
print(result.stdout)
if result.stderr:
    print(result.stderr)
if result.returncode != 0:
    sys.exit(1)
