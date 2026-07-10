---
name: BlastyBiz Firestore rules
description: Current ownership model for businesses collection — nested under users/{uid}, not a uid field.
---

## Current architecture (as of the nested-subcollection migration)
`businesses` live at `users/{userId}/businesses/{bizId}`, not as a top-level collection.
Ownership is verified via the **path segment**, not a `uid` field on the document:
```
match /users/{userId} {
  match /businesses/{bizId} {
    allow read, create, update, delete: if request.auth.uid == userId || isAdmin();
    ...
  }
}
```

## Superseded bug (historical only — do not reapply)
Before the migration, `businesses` was top-level and the rule mistakenly compared
`request.auth.uid == businessId` (the document ID) instead of a `uid` field, which
could never match since document IDs are auto-generated. That was fixed by checking
`resource.data.uid`, and later the whole collection was moved under `users/{uid}` and
ownership switched to the path-segment check above.

**Why this note exists:** an older version of this memory file described the
top-level/`uid`-field version as if it were still current. That caused confusion in
later sessions/reviews that compared it against the live (already-migrated) rules
file and incorrectly flagged a mismatch. Always diff against the live
`firestore.rules` file, not this memory, before assuming rules are stale.

## Known residue from the migration
Stray top-level `businesses/{id}` documents can still exist from before the
migration (no `uid`, no real business data — just leftover subfields like an old
`postingSchedule`). These are orphaned and safe to delete once confirmed empty of
real data; they can crash collection-group queries that assume every business doc
has sibling data reachable via a `uid` field (e.g. `scheduledPostingCheck`).

**How to apply:** Any time Firestore rules are touched for `businesses`, confirm
against the live rules file whether the collection is still nested under `users/`
before making assumptions from memory.
