#!/usr/bin/env python3
"""
Rebuilds download/BlastyBiz_Site.zip from artifacts/api-server/public/.
Run after any HTML/CSS/JS change: python3 download/build_zip.py
"""
import zipfile, hashlib, pathlib

SRC  = pathlib.Path('artifacts/api-server/public')
DEST = pathlib.Path('download/BlastyBiz_Site.zip')

# Documentation files to include alongside the site files
DOCS = [
    pathlib.Path('download/BlastyBiz_Audit.md'),
    pathlib.Path('download/AnimEngine.md'),
    pathlib.Path('download/BlastyBiz_Runbooks.md'),
]

README = """\
# BlastyBiz — Site Package

## Live Site
https://blastybiz-9523e.web.app

## Documentation
| File | What it is |
|------|-----------|
| [BlastyBiz_Audit.md](BlastyBiz_Audit.md) | Full change and bug fix log — every fix, date, file, and description |
| [AnimEngine.md](AnimEngine.md) | Animation engine master reference — SVG anatomy, mood states, CSS animations, onboarding step flow, JS API, Cloud Functions |
| [BlastyBiz_Runbooks.md](BlastyBiz_Runbooks.md) | Operational runbooks — deploy steps, Cloud Function management, Firestore rules |

## Stack
- Static HTML/CSS/JS (no build step)
- Firebase Hosting — blastybiz-9523e.web.app
- Firebase Auth — Email/Password + Google
- Firestore — primary database (us-east1)
- Cloud Functions — functions/index.js
- Anthropic Claude — AI content adaptation

## Key Pages
| Page | Purpose |
|------|---------|
| BlastyBiz-Home.html | Public landing page |
| BlastyBiz-Login.html | Sign in / sign up |
| BlastyBiz-Trial.html | Magic-link free trial signup |
| BlastyBiz.html | Main app dashboard |
| BlastyBiz-Onboard2.html | OB1 — Blasty Wizard onboarding |
| BlastyBiz-CreateBiz.html | OB2 — Quick Form onboarding |
| BlastyBiz-Admin-OnboardSteps.html | Admin — edit OB1/OB2 text and Blasty animations |
| BlastyBiz-Admin.html | Admin dashboard |

## Deploy
npx firebase-tools deploy --only hosting
"""

with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    # Site files
    for f in sorted(SRC.rglob('*')):
        if f.is_file():
            zf.write(f, f.relative_to(SRC))
    # Docs
    for doc in DOCS:
        if doc.exists():
            zf.write(doc, doc.name)
    # README generated inline — no separate file needed
    zf.writestr('README.md', README)

sha = hashlib.sha256(DEST.read_bytes()).hexdigest()
DEST.with_suffix('.zip.sha256').write_text(sha + '\n')
print(f'Built {DEST} ({DEST.stat().st_size:,} bytes)  sha256={sha[:16]}…')
