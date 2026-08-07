# BlastyBiz

A Firebase-hosted multi-platform social media blasting tool for small businesses.

## Architecture
- Firebase Hosting (static files in `public/`)
- Cloud Functions (Node.js, in `functions/`)
- Firestore database
- No Express server

## User Preferences
- **No inline styles.** All CSS must go in `public/global-style.css` or a dedicated page-level `.css` file. No `<style>` blocks inside HTML files and no `style=""` attributes on individual elements.
- Deploy after every change — no exceptions.
