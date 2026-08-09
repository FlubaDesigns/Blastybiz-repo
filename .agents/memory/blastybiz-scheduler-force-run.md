---
name: BlastyBiz scheduled CF verification
description: How to verify/force-run scheduled Cloud Functions and check their logs from Replit.
---

## Force-running a scheduled function
Scheduled CFs are backed by Cloud Scheduler jobs named `firebase-schedule-<fnName>-us-central1`.
Force an immediate run with `POST https://cloudscheduler.googleapis.com/v1/projects/blastybiz-9523e/locations/us-central1/jobs/<job>:run` using the firebase-tools refreshed access token (see blastybiz-firestore-rest.md). Much faster than waiting for the next cron tick.

## Checking run outcomes
Cloud Logging REST: `POST https://logging.googleapis.com/v2/entries:list` with filter
`resource.labels.service_name="<lowercased fn name>"`. A run is a 200 httpRequest entry plus function console output; failures show 500 + ERROR textPayload.

## Index exemption lag
**Why:** Deploying a `fieldOverrides` exemption in firestore.indexes.json is not instant — the single-field index must build. Runs kept failing FAILED_PRECONDITION for hours after deploy even though `firebase deploy` succeeded.
**How to apply:** After deploying index changes, confirm state READY via
`GET https://firestore.googleapis.com/v1/projects/blastybiz-9523e/databases/(default)/collectionGroups/<cg>/fields/<field>` before trusting that dependent queries work, then force-run the scheduler job to verify end-to-end.
