#!/usr/bin/env python3
"""
Rebuilds download/BlastyBiz_Site.zip from artifacts/api-server/public/.
Also bundles backend source files so the package is self-contained.
Run after any HTML/CSS/JS change: python3 download/build_zip.py

Excluded from zip:
  - img/ and images/ subdirectories (large image assets served by Firebase)
  - download/ folder docs (audit log, runbooks, etc. — kept separately)
"""
import zipfile, hashlib, pathlib

SRC  = pathlib.Path('public')
DEST = pathlib.Path('download/BlastyBiz_Site.zip')

# Subdirectory names inside public/ to skip (image asset folders)
SKIP_DIRS = {'img', 'images'}

# Backend source files — included so the package is complete and self-verifiable
_BACKEND_SINGLES = [
    pathlib.Path('functions/index.js'),
    pathlib.Path('functions/package.json'),
    pathlib.Path('firestore.rules'),
    pathlib.Path('storage.rules'),
    pathlib.Path('firebase.json'),
]
# Entire module directories (lib/ and modules/ split from monolithic index.js)
_BACKEND_DIRS = [
    pathlib.Path('functions/lib'),
    pathlib.Path('functions/modules'),
]
BACKEND = _BACKEND_SINGLES + [
    f for d in _BACKEND_DIRS for f in sorted(d.rglob('*.js')) if f.is_file()
]

# Scripts — tooling that aids release quality checks
SCRIPTS = [
    pathlib.Path('scripts/check-release.cjs'),
]

README = """\
# BlastyBiz — Site Package

## Live Site
https://blastybiz-9523e.web.app

## What's in this package
| Folder / File | What it is |
|---------------|-----------|
| `*.html`, `*.js`, `*.css` | Static frontend — deployed to Firebase Hosting |
| `backend/functions/index.js` | Cloud Functions barrel (exports all modules) |
| `backend/functions/lib/shared.js` | Shared helpers, Firestore refs, email utils |
| `backend/functions/modules/*.js` | Cloud Function modules (ai, admin, oauth, publishing, scheduled, …) |
| `backend/functions/package.json` | Cloud Functions dependencies |
| `backend/firestore.rules` | Firestore security rules |
| `backend/storage.rules` | Firebase Storage security rules |
| `backend/firebase.json` | Firebase project configuration |
| `scripts/check-release.cjs` | Release audit script |

Note: img/ and images/ asset folders are excluded — served directly by Firebase Hosting.

## Stack
- Static HTML/CSS/JS (no build step)
- Firebase Hosting — blastybiz-9523e.web.app
- Firebase Auth — Email/Password + Google
- Firestore — primary database (us-east1)
- Cloud Functions — backend/functions/index.js
- Anthropic Claude — AI content adaptation

## Key Pages
| Page | Purpose |
|------|---------|
| BlastyBiz-Home.html | Public landing page |
| BlastyBiz-Login.html | Sign in / sign up |
| BlastyBiz-Trial.html | Magic-link free trial signup |
| BlastyBiz.html | Main app (Create / Blast / Connect tabs) |
| BlastyBiz-Dashboard.html | Command dashboard |
| BlastyBiz-Onboard2.html | OB1 — Blasty Wizard onboarding (canonical) |
| BlastyBiz-CreateBiz.html | OB2 — Quick Form onboarding |
| BlastyBiz-Businesses.html | Multi-business management (pro/agency) |
| BlastyBiz-Admin-OnboardSteps.html | Admin — edit OB1/OB2 text and Blasty animations |
| BlastyBiz-Admin.html | Admin dashboard |

## Retired pages (redirect to Onboard2)
- BlastyBiz-Onboarding.html — old wizard, now redirects
- BlastyBiz-Chat-Onboarding.html — old chat flow, now redirects

## Deploy
npx firebase-tools deploy --only hosting
"""

with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    # Frontend / site files — skip large image asset directories
    for f in sorted(SRC.rglob('*')):
        if f.is_file():
            # Skip any file whose path passes through a SKIP_DIRS folder
            parts = f.relative_to(SRC).parts
            if any(p in SKIP_DIRS for p in parts):
                continue
            zf.write(f, f.relative_to(SRC))
    # Backend source files — nested under backend/ to keep them separate
    for bf in BACKEND:
        if bf.exists():
            zf.write(bf, 'backend/' + str(bf))
    # Scripts — tooling bundled under scripts/ for easy reference
    for sf in SCRIPTS:
        if sf.exists():
            zf.write(sf, str(sf))
    # README generated inline — no separate file needed
    zf.writestr('README.md', README)

sha = hashlib.sha256(DEST.read_bytes()).hexdigest()
DEST.with_suffix('.zip.sha256').write_text(sha + '\n')
print(f'Built {DEST} ({DEST.stat().st_size:,} bytes)  sha256={sha[:16]}…')
