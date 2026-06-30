import { Router } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router = Router();

const ALLOWED_TO = new Set([
  "support@blastybiz.com",
  "info@blastybiz.com",
  "sales@blastybiz.com",
  "billing@blastybiz.com",
]);

router.post("/contact", async (req, res) => {
  const { to, name, email, message } = req.body as {
    to: string;
    name: string;
    email: string;
    message: string;
  };

  if (!ALLOWED_TO.has(to)) {
    res.status(400).json({ error: "Invalid recipient" });
    return;
  }
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }

  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      body: JSON.stringify({
        from: "BlastyBiz <noreply@blastybiz.com>",
        to: [to],
        reply_to: email.trim(),
        subject: `New message from ${name.trim()}`,
        html: `<p><strong>Name:</strong> ${name.trim()}<br><strong>Email:</strong> ${email.trim()}</p><p><strong>Message:</strong><br>${message.trim().replace(/\n/g, "<br>")}</p>`,
      }),
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      res.json({ success: true });
    } else {
      const body = await response.text();
      req.log.error({ body }, "Resend error");
      res.status(500).json({ error: "Failed to send" });
    }
  } catch (err) {
    req.log.error({ err }, "Contact route error");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
