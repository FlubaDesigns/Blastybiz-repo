import { Router } from "express";

const router = Router();

// Test-email functionality is handled by the adminSendTestEmail Cloud Function,
// which enforces admin authentication server-side. This Express route is removed
// to avoid an unauthenticated surface that could be abused.

export default router;
