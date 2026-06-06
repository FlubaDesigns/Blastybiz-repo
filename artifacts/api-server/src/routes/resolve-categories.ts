import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

router.post("/resolveCategories", async (req, res) => {
  try {
    const { description, platformCatLists } = req.body;

    if (!description) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return;
    }

    const client = new Anthropic({ apiKey });

    const catLines = Object.entries(platformCatLists || {})
      .map(([id, cats]) => `${id}: ${(cats as string[]).join(", ")}`)
      .join("\n");

    const prompt = `Given this business: "${description}"
Pick the best matching category for each platform from the lists provided.
Return ONLY valid JSON, no markdown: { "categories": { "platformId": "category name" } }

${catLines}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (response.content[0] as { text: string }).text;
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    res.json(parsed);
  } catch (err) {
    req.log.error(err, "resolveCategories error");
    res.status(500).json({ error: "Category resolution failed" });
  }
});

export default router;
