#!/usr/bin/env python3
"""
Rebuilds download/BlastyBiz_Site.zip from artifacts/api-server/public/.
Run after any HTML/CSS/JS change: python3 download/build_zip.py
"""
import zipfile, os, hashlib, pathlib

SRC  = pathlib.Path('artifacts/api-server/public')
DEST = pathlib.Path('download/BlastyBiz_Site.zip')

# Documentation files to include alongside the site files
DOCS = [
    pathlib.Path('download/README.md'),
    pathlib.Path('download/BlastyBiz_Audit.md'),
    pathlib.Path('download/BlastyBiz_Blasty_README.md'),
    pathlib.Path('download/BlastyBiz_Runbooks.md'),
]

with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(SRC.rglob('*')):
        if f.is_file():
            zf.write(f, f.relative_to(SRC))
    for doc in DOCS:
        if doc.exists():
            zf.write(doc, doc.name)

sha = hashlib.sha256(DEST.read_bytes()).hexdigest()
DEST.with_suffix('.zip.sha256').write_text(sha + '\n')
print(f'Built {DEST} ({DEST.stat().st_size:,} bytes)  sha256={sha[:16]}…')
