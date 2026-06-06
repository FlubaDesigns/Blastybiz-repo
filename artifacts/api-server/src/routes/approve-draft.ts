import { Router } from "express";
import admin from "firebase-admin";

const router = Router();

function getDb() {
  if (!admin.apps.length) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
      });
    } else {
      admin.initializeApp({ projectId: "blastybiz-9523e" });
    }
  }
  return admin.firestore();
}

router.post("/approveDraft", async (req, res) => {
  try {
    const { draftId, businessId, uid, platforms } = req.body;

    if (!draftId || !businessId || !uid || !platforms?.length) {
      res.status(400).json({ error: "draftId, businessId, uid, and platforms are required" });
      return;
    }

    const db = getDb();
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    batch.update(db.collection("listingDrafts").doc(draftId), {
      status: "approved",
      approvedAt: now,
    });

    for (const platform of platforms) {
      const jobRef = db.collection("publishJobs").doc();
      const isManual = ["manual_assisted", "unsupported"].includes(platform.capabilityLevel);
      batch.set(jobRef, {
        jobId: jobRef.id,
        businessId,
        uid,
        draftId,
        platform: platform.id,
        capabilityLevel: platform.capabilityLevel,
        jobType: "publish_listing",
        status: isManual ? "manual_required" : "pending",
        attempts: 0,
        maxAttempts: 3,
        customerLabel: isManual ? "Action needed" : "Waiting to publish",
        customerVisibleMessage: isManual
          ? `Your ${platform.name} listing is ready — you need to post it manually.`
          : `Your ${platform.name} listing is waiting to publish.`,
        manualInstructions: platform.manualInstructions || "",
        adminError: "",
        payload: platform.adaptedContent || {},
        apiResponse: {},
        customerNotified: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();

    res.json({ success: true });
  } catch (err) {
    req.log.error(err, "approveDraft error");
    res.status(500).json({ error: "Approve draft failed" });
  }
});

export default router;
