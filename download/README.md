# BlastyBiz — Site Package

This zip contains the complete BlastyBiz static site and supporting documentation.

## Live Site
**https://blastybiz-9523e.web.app**

## Contents

### 📄 Documentation (this folder)
| File | What it is |
|------|-----------|
| `README.md` | This file |
| `BlastyBiz_Audit.md` | Full bug fix and change log — every fix, date, file, and description |
| `BlastyBiz_Blasty_README.md` | Complete Blasty mascot reference — SVG anatomy, mood states, animations, OB1 step flow, JS API, Cloud Functions |
| `BlastyBiz_Runbooks.md` | Operational runbooks — deploy steps, Cloud Function management, Firestore rules |

### 🌐 Site Files
All HTML, CSS, and JS files for the static site. Deploy to Firebase Hosting:
```
npx firebase-tools deploy --only hosting
```

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
| `BlastyBiz-Home.html` | Public landing page |
| `BlastyBiz-Login.html` | Sign in / sign up |
| `BlastyBiz-Trial.html` | Magic-link free trial signup |
| `BlastyBiz.html` | Main app dashboard |
| `BlastyBiz-Onboard2.html` | OB1 — Blasty Wizard onboarding |
| `BlastyBiz-CreateBiz.html` | OB2 — Quick Form onboarding |
| `BlastyBiz-Admin-OnboardSteps.html` | Admin — edit OB1/OB2 text and Blasty animations |
| `BlastyBiz-Admin.html` | Admin dashboard |
