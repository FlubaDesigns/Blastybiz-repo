import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const PLATFORM_RULES: Record<string, { maxChars: number; notes: string }> = {
  google:     { maxChars: 1500, notes: "Professional, keyword-rich, include all contact info" },
  facebook:   { maxChars: 2000, notes: "Engaging, emoji welcome, strong call to action" },
  instagram:  { maxChars: 2200, notes: "Caption style, 3-5 hashtags at end" },
  bing:       { maxChars: 1500, notes: "Professional, complete business info, include hours and location" },
  nextdoor:   { maxChars: 1000, notes: "Warm, community-focused, mention neighborhood" },
  fbmarket:   { maxChars: 1000, notes: "Clear title, price prominent, location, contact" },
  craigslist: { maxChars: 1500, notes: "Structured sections, plain text, no emoji" },
  yelp:       { maxChars: 1500, notes: "Descriptive, highlight uniqueness and atmosphere" },
  applemaps:  { maxChars: 500,  notes: "Factual, complete, hours and category accurate" },
  alignable:  { maxChars: 800,  notes: "B2B professional, what you offer other businesses" },
  thumbtack:  { maxChars: 800,  notes: "Service-focused, expertise, reliability" },
  angi:       { maxChars: 800,  notes: "Trade-specific, licensed/insured if applicable" },
};

router.post("/adaptListing", async (req, res) => {
  try {
    const { listing, platforms, tone, platformCats } = req.body;

    if (!listing?.offer) {
      res.status(400).json({ error: "listing.offer is required" });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return;
    }

    const client = new Anthropic({ apiKey });

    const platformList = (platforms || []).map((p: { id: string; name: string; type: string }) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      rules: PLATFORM_RULES[p.id] || {},
    }));

    const prompt = `You are a local business marketing expert. Adapt the following business listing for each platform listed. Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

BUSINESS INFO:
- Name: ${listing.name || "Local Business"}
- Category: ${listing.category || "General"}
- Description: ${listing.offer}
- Price/Range: ${listing.price || "not specified"}
- Phone: ${listing.phone || "not provided"}
- Address: ${listing.address || "not provided"}
- Website: ${listing.website || "none"}
- Hours: ${listing.hours || "not provided"}
- Images attached: ${listing.imageCount > 0 ? listing.imageCount + " photo(s)" : "none"}
- Preferred tone: ${tone || "friendly"}

PLATFORMS TO ADAPT FOR:
${platformList.map((p: { id: string; name: string; type: string; rules: { maxChars?: number; notes?: string } }) =>
  `- ${p.id}: ${p.name} (${p.type === "api" ? "auto-post" : "copy-paste"})${p.rules.maxChars ? ", max " + p.rules.maxChars + " chars" : ""}${p.rules.notes ? ", note: " + p.rules.notes : ""}`
).join("\n")}

Return this exact JSON structure:
{
  "adaptations": {
    "PLATFORM_ID": "adapted text here"
  }
}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (response.content[0] as { text: string }).text;
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    res.json(parsed);
  } catch (err) {
    req.log.error(err, "adaptListing error");
    res.status(500).json({ error: "Adaptation failed" });
  }
});

export default router;
