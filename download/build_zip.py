#!/usr/bin/env python3
"""
Rebuilds download/BlastyBiz_Site.zip from artifacts/api-server/public/.
Run after any HTML/CSS/JS change: python3 download/build_zip.py
"""
import zipfile, os, hashlib, pathlib

SRC  = pathlib.Path('artifacts/api-server/public')
DEST = pathlib.Path('download/BlastyBiz_Site.zip')

AUDIT = pathlib.Path('download/BlastyBiz_Audit.md')

with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(SRC.rglob('*')):
        if f.is_file():
            zf.write(f, f.relative_to(SRC))
    if AUDIT.exists():
        zf.write(AUDIT, AUDIT.name)

sha = hashlib.sha256(DEST.read_bytes()).hexdigest()
DEST.with_suffix('.zip.sha256').write_text(sha + '\n')
print(f'Built {DEST} ({DEST.stat().st_size:,} bytes)  sha256={sha[:16]}…')
