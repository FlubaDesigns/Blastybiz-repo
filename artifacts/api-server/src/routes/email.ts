import { Router } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router = Router();

const ADMIN_EMAILS = new Set(["perceys@gmail.com", "rep-test@blastybiz.com"]);

const SAMPLE = {
  name: "Alex Johnson",
  businessName: "Sunrise Café",
  planName: "Pro",
  platform: "Google Business",
  jobCount: "5",
  platformList: "Google Business, Facebook, Instagram",
  dashboardUrl: "https://blastybiz-9523e.web.app/BlastyBiz-Dashboard.html",
  upgradeUrl: "https://blastybiz-9523e.web.app/BlastyBiz-Dashboard.html#upgrade",
  appUrl: "https://blastybiz-9523e.web.app",
};

function applyMergeTags(str: string, data: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? "");
}

router.post("/admin/send-test-email", async (req, res) => {
  const { subject, html, to } = req.body as {
    subject: string;
    html: string;
    to: string;
  };

  if (!subject?.trim() || !html?.trim()) {
    res.status(400).json({ error: "Missing subject or html" });
    return;
  }
  if (!ADMIN_EMAILS.has(to)) {
    res.status(403).json({ error: "Test emails only send to admin addresses" });
    return;
  }

  const renderedSubject = applyMergeTags(subject, SAMPLE);
  const renderedHtml = applyMergeTags(html, SAMPLE);

  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      body: JSON.stringify({
        from: "BlastyBiz <info@blastybiz.com>",
        to: [to],
        subject: "[TEST] " + renderedSubject,
        html: renderedHtml,
      }),
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      res.json({ success: true });
    } else {
      const body = await response.text();
      req.log.error({ body }, "Resend test email error");
      res.status(500).json({ error: "Failed to send" });
    }
  } catch (err) {
    req.log.error({ err }, "Test email route error");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
