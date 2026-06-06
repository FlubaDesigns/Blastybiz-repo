---
name: BlastyBiz Firestore rules bug
description: The businesses collection rule must check uid field, not document ID.
---

## The bug
Original rule: `allow read, write: if request.auth.uid == businessId`
This fails because businesses have auto-generated Firestore document IDs, not the user's UID.

## The fix
```
match /businesses/{businessId} {
  allow read, write: if request.auth != null && request.auth.uid == resource.data.uid;
  allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
}
```

**Why:** Every business document has a `uid` field set to the owner's Firebase Auth UID. The document ID is separate and auto-generated.

**How to apply:** Any time Firestore rules are touched for businesses, always check `.uid` field not document ID.
