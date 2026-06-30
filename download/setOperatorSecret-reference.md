# setOperatorSecret — How to Set Production Secrets

No in-app UI exists for this. Use curl or Postman with an admin account bearer token.

## Endpoint

```
POST https://us-central1-blastybiz-9523e.cloudfunctions.net/setOperatorSecret
```

## Headers

```
Authorization: Bearer <ID_TOKEN>
Content-Type: application/json
```

The ID token must belong to an admin account (perceys@gmail.com or rep-test@blastybiz.com).

**How to get an ID token:**
1. Open the browser console on any BlastyBiz page while signed in as an admin account
2. Run: `firebase.auth().currentUser.getIdToken().then(t => console.log(t))`
3. Copy the printed token — it's valid for ~1 hour

## Request Body

```json
{ "name": "SECRET_NAME", "value": "the-actual-secret-value" }
```

## Accepted Secret Names

| Secret Name | Used By |
|---|---|
| `ANTHROPIC_API_KEY` | AI adaptation (adaptListing, generateEnrichmentQuestions, etc.) |
| `SQUARE_ACCESS_TOKEN` | Payment checkout, account deletion |
| `SQUARE_LOCATION_ID` | Payment checkout |
| `SQUARE_PRO_PLAN_ID` | Stored for reference (not used in webhook logic) |
| `SQUARE_AGENCY_PLAN_ID` | Stored for reference (not used in webhook logic) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | squareWebhook HMAC verification |
| `GOOGLE_CLIENT_ID` | Google OAuth initiation + callback |
| `GOOGLE_CLIENT_SECRET` | Google OAuth callback token exchange |
| `FACEBOOK_APP_ID` | Facebook OAuth initiation + callback |
| `FACEBOOK_APP_SECRET` | Facebook OAuth callback token exchange |
| `RESEND_API_KEY` | Transactional email (approveDraft, sendTestEmail) |
| `YELP_API_KEY` | Yelp category refresh (refreshYelpCategories, scheduledYelpCategoryRefresh) |

**Note:** YELP_API_KEY is NOT set via `firebase functions:secrets:set` (as the comment at the top of index.js suggests) — it goes through this endpoint like every other secret.

## Example curl

```bash
curl -X POST \
  https://us-central1-blastybiz-9523e.cloudfunctions.net/setOperatorSecret \
  -H "Authorization: Bearer YOUR_ID_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"name":"ANTHROPIC_API_KEY","value":"sk-ant-..."}'
```

## Expected Responses

- `200 { "ok": true }` — secret stored successfully
- `400 { "error": "Unknown secret name" }` — name not in ALLOWED list
- `401` — missing or invalid bearer token
- `403` — valid token but not an admin account
