#!/usr/bin/env python3
"""Generate BlastyBiz platform landing pages from structured copy data."""
import os, html, textwrap, json, subprocess
from pathlib import Path

OUT = 'artifacts/api-server/public'
CSS_V   = '1785802864721'
MENU_V  = '5'

# ── Platform data ──────────────────────────────────────────────────────────────
PLATFORMS = [
  {
    'slug': 'google',
    'meta': 'BlastyBiz writes and auto-posts to your Google Business Profile. AI-written, local-search-optimized updates in minutes.',
    'h1': 'Post to Google Business Profile Automatically — AI-Written for Local Search',
    'kw': 'Automatic Google Business Profile posts for local businesses',
    'opening': 'Every Google Business Profile update is a chance to show up when someone nearby searches for exactly what you do. BlastyBiz writes it, you approve it, Google gets it — automatically.',
    'snapshot': [
      'Google favors short, direct, service-based updates — roughly 150–300 words performs best; longer posts get truncated in search results.',
      'Local, specific language outperforms generic marketing copy here: neighborhood names, service area terms, and what you actually offer beat broad brand language.',
      'A clear call-to-action button (Call, Book, Order, Learn More) matters more on Google than almost any other platform.',
    ],
    'look_for': [
      'Clear and local — no keyword-stuffing, no generic filler',
      'Service-based language that matches how customers actually search',
      'A specific, single call-to-action rather than several competing ones',
    ],
    'sample': '&ldquo;Now booking fall tune-ups at Mike&rsquo;s Auto Repair in Naples. Same-day appointments available this week &mdash; call or book online.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Google-optimized version. Review it, schedule it, and it posts automatically — no copy-paste required.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': '',
  },
  {
    'slug': 'facebook',
    'note': 'Confirmed auto: BlastyBiz connects via the Facebook Pages API (pages_manage_posts scope) and publishes to your business Page feed.',
    'meta': 'BlastyBiz writes Facebook Page posts in the warm, conversational tone that earns real engagement — and auto-publishes them for you.',
    'h1': 'Facebook Posts, Written the Way Facebook Actually Works',
    'kw': 'AI-written Facebook Page posts for local businesses, automatically published',
    'opening': 'Facebook rewards warmth, not sales pitches. BlastyBiz writes your Page updates like a real conversation with your community — and posts them automatically.',
    'snapshot': [
      'Facebook favors a more conversational tone than Google or LinkedIn — posts that read like a person talking, not an ad, get more engagement.',
      'Shorter posts (under ~80 characters) tend to get the most engagement, though longer storytelling posts still have a place for announcements.',
      'Native formatting matters: natural line breaks and a genuine voice outperform corporate-sounding copy.',
    ],
    'look_for': [
      'A conversational, community-first tone',
      'Natural formatting rather than a wall of text',
      'A specific reason for a follower to comment, share, or visit',
    ],
    'sample': '&ldquo;Big shoutout to everyone who came out for our weekend sale &mdash; you kept us hopping! Same deal continues through Sunday if you missed it.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Facebook-optimized version. Review it, schedule it, and it posts automatically to your Page.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': '',
  },
  {
    'slug': 'fbmarket',
    'meta': 'BlastyBiz writes your Facebook Marketplace listings in the direct, buyer-ready language that gets results — copy-ready in seconds.',
    'h1': 'Facebook Marketplace Listings — AI-Written, Copy-Ready in Seconds',
    'kw': 'AI-written Facebook Marketplace listings for local businesses',
    'opening': 'Marketplace buyers are ready to act — they just need the right listing. BlastyBiz writes it in the direct, plain language Marketplace rewards, and hands it to you ready to paste.',
    'snapshot': [
      'Marketplace rewards clarity over cleverness: what it is, what it costs, where to get it.',
      'Direct, plain language outperforms marketing flourishes — buyers on Marketplace are ready to act, not to be persuaded.',
      'A price or clear offer detail near the top of the listing performs best.',
    ],
    'look_for': [
      'Direct, no-nonsense listing language',
      'Clear pricing or offer details up front',
      'Local pickup/service information stated plainly',
    ],
    'sample': '&ldquo;Fresh-baked sourdough loaves, $8 each. Available for pickup Thursday&ndash;Saturday at our Naples bakery &mdash; message to reserve yours.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Marketplace-optimized listing. Copy the text, switch to Facebook Marketplace, create a new listing, paste, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to facebook.com/marketplace &rarr; Create listing &rarr; paste your text.',
  },
  {
    'slug': 'instagram',
    'meta': 'BlastyBiz writes Instagram captions built to earn the tap — first 125 characters first — and auto-posts them for you.',
    'h1': 'Instagram Captions That Actually Get Read — Written and Posted Automatically',
    'kw': 'AI-written Instagram posts for local businesses, automatically published',
    'opening': 'Instagram is a scroll-fast platform. BlastyBiz writes captions built to earn the tap that expands them — and posts them for you automatically.',
    'snapshot': [
      'The first ~125 characters matter most — that\'s what shows before "more" truncates the caption.',
      'Shorter, punchier captions paired with a strong image consistently outperform long-form storytelling here.',
      'Hashtags should stay relevant and local rather than generic — 3–8 well-chosen tags typically beat 30 broad ones.',
    ],
    'look_for': [
      'A strong opening line built to survive truncation',
      'Image-first thinking — the caption supports the photo, not the other way around',
      'A small, relevant set of hashtags rather than a wall of them',
    ],
    'sample': '&ldquo;Fresh flowers just dropped 🌸 Come grab your Friday bouquet before we sell out &mdash; link in bio for same-day delivery.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Instagram-optimized caption and prepares the image. Review, schedule, and it posts automatically.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': '',
  },
  {
    'slug': 'yelp',
    'meta': 'BlastyBiz writes Yelp updates in the authentic, owner-forward voice Yelp rewards — copy-ready to paste in seconds.',
    'h1': 'Keep Your Yelp Presence Fresh — AI-Written, Copy-Ready in Seconds',
    'kw': 'AI-written Yelp business updates for local businesses',
    'opening': "Yelp doesn't currently offer a public way to auto-post — so BlastyBiz does the next best thing: writes it perfectly and hands it to you ready to paste.",
    'snapshot': [
      'Yelp updates read best when they sound like an owner speaking directly to potential customers, not an ad.',
      'Specific, checkable details (what\'s new, what\'s changed, what to expect) build more trust here than broad claims.',
      'A photo update paired with the post performs noticeably better than text alone.',
    ],
    'look_for': [
      'An authentic, ownership-forward voice',
      'Specific, concrete details a real customer would find useful',
      'A photo-ready pairing, not just text',
    ],
    'sample': '&ldquo;We just added three new gluten-free options to the menu &mdash; swing by and let us know what you think!&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Yelp-optimized version and prepares an image. Copy the text, switch to Yelp, paste, upload the image, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to biz.yelp.com &rarr; sign in &rarr; edit your business info or post an update &rarr; paste your text.',
  },
  {
    'slug': 'craigslist',
    'meta': 'BlastyBiz writes Craigslist listings in the direct, classified-style language that drives local leads — copy-ready in seconds.',
    'h1': 'Craigslist Listings Written Like Craigslist — Copy, Paste, Done',
    'kw': 'AI-written Craigslist business listings for local services',
    'opening': "Craigslist has its own voice — direct, classified-style, no fluff. BlastyBiz writes it that way, every time, ready to paste.",
    'snapshot': [
      'Classified-style brevity outperforms marketing language — Craigslist readers want the facts fast.',
      'A clear category fit and specific service area drive real local leads.',
      'Direct-response wording (what to do next) matters more here than brand voice.',
    ],
    'look_for': [
      'Classified-style directness',
      'Specific local service-area language',
      'A clear, immediate next step for the reader',
    ],
    'sample': '&ldquo;Reliable lawn care, Naples &amp; surrounding areas. Weekly or bi-weekly service, free estimates. Call or text to schedule.&rdquo;',
    'workflow': "Create one campaign. BlastyBiz writes the Craigslist-optimized version. Copy the text, switch to Craigslist, paste into your city's Services section, publish.",
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to craigslist.org &rarr; your city &rarr; Services &rarr; paste your listing.',
  },
  {
    'slug': 'nextdoor',
    'meta': "BlastyBiz writes Nextdoor posts that sound like a real neighbor, not an ad — copy-ready to build local trust in seconds.",
    'h1': 'Build Neighborhood Trust on Nextdoor — AI-Written, Copy-Ready',
    'kw': 'AI-written Nextdoor posts for local businesses',
    'opening': "Nextdoor rewards businesses that sound like actual neighbors, not advertisers. BlastyBiz writes it that way and hands it to you ready to post.",
    'snapshot': [
      'Community-first language outperforms sales language by a wide margin on Nextdoor.',
      'Mentioning the specific neighborhood or area builds the local trust this platform runs on.',
      'Recommendation-style phrasing works better than direct promotion.',
    ],
    'look_for': [
      'A neighborly, trust-first tone',
      'Specific neighborhood or area references',
      'Recommendation-style phrasing over direct sales language',
    ],
    'sample': '&ldquo;Hi neighbors! We&rsquo;ve been serving the area for 8 years and wanted to let you know about our new weekend hours &mdash; stop in and say hi.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Nextdoor-optimized version. Copy the text, switch to Nextdoor, paste, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to nextdoor.com &rarr; Post &rarr; For Sale &amp; Free &rarr; paste your listing.',
  },
  {
    'slug': 'linkedin',
    'meta': 'BlastyBiz writes LinkedIn posts with the professional, authority-building tone this platform rewards — copy-ready to paste in seconds.',
    'h1': 'LinkedIn Copy That Builds Authority — AI-Written, Copy-Ready',
    'kw': 'AI-written LinkedIn posts for local and B2B businesses',
    'opening': "LinkedIn is where B2B trust gets built. BlastyBiz writes with the professional tone this platform expects, ready to paste in seconds.",
    'snapshot': [
      'A more professional, authoritative tone consistently outperforms casual language here.',
      'Framing around expertise, results, or industry insight performs better than direct promotion.',
      'Slightly longer, thoughtful posts have more room to work on LinkedIn than on Instagram or Facebook.',
    ],
    'look_for': [
      'A professional, credibility-building tone',
      'B2B-appropriate framing',
      'Language that builds authority rather than just announcing a sale',
    ],
    'sample': '&ldquo;Proud to have helped 40+ local businesses streamline their books this tax season. If your small business needs a hand next year, we&rsquo;d love to talk.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the LinkedIn-optimized version. Copy the text, switch to LinkedIn, paste, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to linkedin.com &rarr; sign in &rarr; create a post from your business page &rarr; paste your text.',
  },
  {
    'slug': 'pinterest',
    'meta': 'BlastyBiz writes Pinterest descriptions built for discovery — evergreen, visual, search-friendly — copy-ready in seconds.',
    'h1': 'Pinterest Descriptions Built for Discovery — AI-Written, Copy-Ready',
    'kw': 'AI-written Pinterest pin descriptions for local businesses',
    'opening': "Pinterest is a search engine as much as a social platform. BlastyBiz writes descriptions people find months later, not just the day you post.",
    'snapshot': [
      'Pinterest rewards evergreen, search-friendly descriptions over time-sensitive promotional language.',
      'Visual-first, descriptive language performs better than direct calls-to-action.',
      "Keyword-natural phrasing (how someone would search for this) matters more here than almost anywhere else.",
    ],
    'look_for': [
      'Evergreen, non-time-sensitive phrasing',
      'Descriptive, visual-storytelling language',
      'Natural, search-friendly wording',
    ],
    'sample': '&ldquo;Cozy fall wreaths handmade with dried florals &mdash; perfect for a front porch that welcomes the season.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Pinterest-optimized description and prepares the image. Copy the text, switch to Pinterest, paste, upload the image, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to pinterest.com &rarr; sign in &rarr; create a pin &rarr; paste your text.',
  },
  {
    'slug': 'x',
    'meta': 'BlastyBiz writes tight, quotable X (Twitter) posts that fit the platform\'s pace — copy-ready in seconds.',
    'h1': 'Short, Sharp Posts for X — AI-Written, Copy-Ready',
    'kw': 'AI-written X Twitter posts for local businesses',
    'opening': "X rewards brevity and personality. BlastyBiz writes tight, quotable copy that fits the platform's pace — ready to paste.",
    'snapshot': [
      'Short, punchy phrasing outperforms longer posts — brevity is the format here.',
      'A distinct voice or point of view earns more engagement than a plain announcement.',
      'One clear idea per post performs better than trying to fit several messages in.',
    ],
    'look_for': [
      'Tight, punchy phrasing',
      'A distinct voice, not a generic announcement',
      'One clear idea per post',
    ],
    'sample': '&ldquo;Monday deserves donuts. $1 off a dozen today only. See you at the counter.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the X-optimized version. Copy the text, switch to X, paste, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to x.com &rarr; sign in &rarr; compose a new post &rarr; paste your text.',
  },
  {
    'slug': 'bing',
    'meta': 'BlastyBiz writes Bing Places updates in the clear, local language that drives search traffic — copy-ready to paste in seconds.',
    'h1': 'Keep Bing Places Updated Too — AI-Written, Copy-Ready',
    'kw': 'AI-written Bing Places business listing updates',
    'opening': "Bing still drives real local search traffic. BlastyBiz makes sure your Bing Places listing stays as fresh as your Google one.",
    'snapshot': [
      "Bing rewards the same clear, local, service-based language Google does — consistency between the two builds trust with anyone who finds you through search.",
      'Straightforward business-update language performs better than promotional copy.',
    ],
    'look_for': [
      "Clear, local, service-based phrasing consistent with your Google presence",
      'Straightforward, factual business updates',
    ],
    'sample': '&ldquo;Now offering extended weekend hours at our Naples location &mdash; stop by Saturday or Sunday!&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Bing-optimized version. Copy the text, go to bingplaces.com, sign in, edit your listing, and paste.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to bingplaces.com &rarr; sign in &rarr; add or edit listing &rarr; paste your text.',
  },
  {
    'slug': 'applemaps',
    'meta': 'BlastyBiz writes concise, factual Apple Maps business descriptions that keep your listing accurate and current — copy-ready in seconds.',
    'h1': 'Show Up Accurately on Apple Maps — AI-Written, Copy-Ready',
    'kw': 'AI-written Apple Maps business listing updates',
    'opening': "Apple Maps is how a growing share of customers find you first. BlastyBiz keeps your listing copy sharp and current.",
    'snapshot': [
      'Apple Maps favors concise, factual business descriptions over promotional copy.',
      'Consistency with your Google and Bing listings builds trust across every map a customer might check.',
    ],
    'look_for': [
      'Concise, factual descriptions',
      'Consistency with other local listing platforms',
    ],
    'sample': '&ldquo;Family-owned hardware store serving Naples since 2009 &mdash; open 7 days a week.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Apple Maps-optimized version. Copy the text and update your Apple Business Connect listing.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to mapsconnect.apple.com &rarr; sign in &rarr; add or edit your business &rarr; paste your text.',
  },
  {
    'slug': 'alignable',
    'meta': 'BlastyBiz writes Alignable updates that read like a trustworthy local business neighbor, not an ad — copy-ready in seconds.',
    'h1': 'Build B2B Referrals on Alignable — AI-Written, Copy-Ready',
    'kw': 'AI-written Alignable updates for local business networking',
    'opening': "Alignable runs on local business relationships. BlastyBiz writes updates that read like a trustworthy neighbor in business, not an ad.",
    'snapshot': [
      'Alignable rewards genuine, relationship-first language over direct sales pitches.',
      'Framing around collaboration or local business support outperforms generic promotion.',
    ],
    'look_for': [
      'Genuine, relationship-building tone',
      'Local business community framing',
    ],
    'sample': '&ldquo;Always happy to send referrals to other local businesses in the Naples network &mdash; let&rsquo;s support each other this season.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Alignable-optimized version. Copy the text, switch to Alignable, paste, publish.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to alignable.com &rarr; sign in &rarr; Post an Update &rarr; paste your text.',
  },
  {
    'slug': 'thumbtack',
    'meta': 'BlastyBiz writes Thumbtack profile copy built to win the lead comparison — direct, credible, specific — copy-ready in seconds.',
    'h1': 'Win More Leads on Thumbtack — AI-Written, Copy-Ready',
    'kw': 'AI-written Thumbtack profile copy for local service businesses',
    'opening': "Thumbtack customers are comparing providers right now. BlastyBiz writes copy built to win the comparison.",
    'snapshot': [
      "Direct-response, credibility-forward language performs best — customers are actively deciding who to hire.",
      'Specificity about services and turnaround builds more trust than general claims.',
    ],
    'look_for': [
      'Direct, credibility-building language',
      'Specific service and turnaround details',
    ],
    'sample': '&ldquo;Same-week appointments available for plumbing repairs &mdash; licensed, insured, and rated 5 stars by 120+ local customers.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Thumbtack-optimized version. Copy the text into your profile or a new response template.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to thumbtack.com/pro &rarr; sign in &rarr; edit your profile or services &rarr; paste your text.',
  },
  {
    'slug': 'angi',
    'meta': 'BlastyBiz writes Angi profile copy that builds customer confidence fast — trust-forward, credential-clear — copy-ready in seconds.',
    'h1': 'Stand Out on Angi — AI-Written, Copy-Ready',
    'kw': 'AI-written Angi profile copy for home service businesses',
    'opening': "Angi customers want confidence they're hiring the right pro. BlastyBiz writes copy that builds that confidence fast.",
    'snapshot': [
      'Trust and credential language (licensed, insured, experienced) performs well on Angi.',
      'Clear service descriptions outperform vague marketing language for home-service searches.',
    ],
    'look_for': [
      'Trust and credential-forward language',
      'Clear, specific service descriptions',
    ],
    'sample': '&ldquo;Licensed HVAC technicians serving the Naples area for over 15 years &mdash; free estimates on new installs.&rdquo;',
    'workflow': 'Create one campaign. BlastyBiz writes the Angi-optimized version. Copy the text into your profile or listing update.',
    'cta_href': 'BlastyBiz-Plan-Pro.html',
    'cta_text': 'Start Free Trial &mdash; Pro &rarr;',
    'manual_steps': 'Go to pro.angi.com &rarr; sign in &rarr; edit your business profile &rarr; paste your text.',
  },
]

# ── Shared copy blocks ─────────────────────────────────────────────────────────
MEMORY_MODULE = """\
<section class="plat-section reveal">
  <div class="row"><div class="plat-body">
    <div class="plat-memory-box">
      <p class="plat-memory-label">The AI Behind Your Copy</p>
      <h2>The Secret Behind <span>Better Marketing</span></h2>
      <p>Most AI marketing tools start every conversation from scratch. BlastyBiz remembers instead — through two layers that work together.</p>
      <div class="plat-memory-grid">
        <div class="plat-memory-card">
          <div class="plat-memory-card-title">Global Business Memory</div>
          <p>This is your business&rsquo;s permanent memory. Teach it your products and services, brand voice, target audience, service area, what makes you different, and how you like to sound — and the AI carries that forward into everything it writes.</p>
        </div>
        <div class="plat-memory-card">
          <div class="plat-memory-card-title">Campaign Memory</div>
          <p>Every campaign also has its own working memory — the current promotion, pricing, seasonal timing, and the goal of this specific push. The AI builds on what it already knows instead of starting over each time.</p>
        </div>
      </div>
      <p style="font-size:14px;color:var(--muted,#888);margin-top:16px;">Global Memory remembers your business. Campaign Memory remembers what you&rsquo;re working on today. That&rsquo;s what keeps your marketing consistent across every platform, without repeating yourself.</p>
    </div>
  </div></div>
</section>"""

PLAN_BLOCK = """\
<section class="plat-section reveal">
  <div class="row"><div class="plat-body">
    <h2>Pick the Plan That <span>Fits Your Roster</span></h2>
    <div class="plat-plan-grid">
      <div class="plat-plan-card">
        <div class="plat-plan-name">Free</div>
        <p>Learn the platform workflow, generate campaigns, and preview AI-generated copy. Limited usage — perfect for trying it out.</p>
        <a href="BlastyBiz-Plan-Free.html" class="plat-plan-link">See Free Plan &rarr;</a>
      </div>
      <div class="plat-plan-card plat-plan-card--featured">
        <div class="plat-plan-name">Pro <span style="font-size:11px;font-weight:400;color:var(--muted,#888);">Most Popular</span></div>
        <p>Platform-specific optimized copy, prepared images, scheduling, and automatic publishing on supported platforms.</p>
        <a href="BlastyBiz-Plan-Pro.html" class="plat-plan-link">Start Free Trial &rarr;</a>
      </div>
      <div class="plat-plan-card">
        <div class="plat-plan-name">Agency</div>
        <p>Everything in Pro, multiple businesses, agency workflow, larger campaign limits, and advanced management tools.</p>
        <a href="BlastyBiz-Plan-Agency.html" class="plat-plan-link">See Agency Plan &rarr;</a>
      </div>
    </div>
  </div></div>
</section>"""

CLOSING_CTA = """\
<section class="reveal">
  <div class="row"><div class="plat-body">
    <div class="plat-cta-box">
      <h2>Write Once. <span>Optimized Everywhere.</span></h2>
      <p>Stop rewriting the same marketing message over and over. Create one campaign. Let BlastyBiz intelligently adapt it for every platform you use &mdash; whether it supports automatic publishing or quick copy-and-paste, BlastyBiz dramatically reduces the time required to maintain a professional marketing presence.</p>
      <a class="btn btn__primary" href="BlastyBiz-Login.html">🚀 Start Posting Free</a>
      <p style="margin-top:14px;font-size:13px;color:var(--muted,#888);">No credit card &nbsp;&middot;&nbsp; 2 minute setup &nbsp;&middot;&nbsp; Cancel anytime</p>
    </div>
  </div></div>
</section>"""

PAGE_CSS = """\
<style>
.plat-hero{padding:52px 0 36px}
.plat-hero h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(36px,5.5vw,66px);line-height:1.05;color:#fff;margin:0 0 10px}
.plat-hero h1 span{color:var(--green,#39ff14)}
.plat-kw{font-size:16px;color:var(--muted,#aaa);margin:0 0 18px;font-weight:400}
.plat-lead{font-size:18px;line-height:1.75;color:var(--light,#e8e8e8);max-width:680px;margin-bottom:0}
.plat-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin:0 0 22px}
.plat-badge.auto{background:rgba(57,255,20,.15);color:var(--green,#39ff14);border:1px solid rgba(57,255,20,.3)}
.plat-badge.manual{background:rgba(255,255,255,.07);color:#bbb;border:1px solid rgba(255,255,255,.15)}
.plat-body{max-width:740px;margin:0 auto}
.plat-section{padding:4px 0}
.plat-body h2{font-family:'Bebas Neue',sans-serif;font-size:34px;color:#fff;margin:48px 0 16px}
.plat-body h2 span{color:var(--green,#39ff14)}
.plat-body p{font-size:16px;line-height:1.8;color:var(--text,#ccc);margin:0 0 16px}
.plat-snapshot{list-style:none;padding:0;margin:0 0 8px}
.plat-snapshot li{font-size:15px;line-height:1.7;color:var(--text,#ccc);padding:10px 0 10px 20px;border-bottom:1px solid rgba(255,255,255,.06);position:relative}
.plat-snapshot li:last-child{border-bottom:none}
.plat-snapshot li::before{content:"→";position:absolute;left:0;color:var(--green,#39ff14);font-weight:700}
.plat-look-list{list-style:none;padding:0;margin:0 0 8px}
.plat-look-list li{font-size:15px;line-height:1.7;color:var(--text,#ccc);padding:8px 0 8px 24px;position:relative}
.plat-look-list li::before{content:"✓";position:absolute;left:0;color:var(--green,#39ff14);font-weight:700}
.plat-sample{background:rgba(255,255,255,.04);border-left:3px solid var(--green,#39ff14);border-radius:0 10px 10px 0;padding:18px 20px;margin:24px 0;font-size:16px;font-style:italic;color:var(--light,#e8e8e8);line-height:1.7}
.plat-sample-label{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--muted,#888);margin-bottom:8px}
.plat-workflow{background:rgba(57,255,20,.05);border:1px solid rgba(57,255,20,.15);border-radius:12px;padding:20px 24px;margin:32px 0}
.plat-workflow p{margin:0;font-size:15px;color:var(--light,#e8e8e8)}
.plat-manual-steps{background:rgba(255,255,255,.04);border-radius:10px;padding:14px 18px;margin-top:12px;font-size:13px;color:var(--muted,#aaa)}
.plat-plan-close{font-size:15px;color:var(--muted,#999);margin-top:20px;font-style:italic}
.plat-memory-box{background:rgba(57,255,20,.04);border:1px solid rgba(57,255,20,.15);border-radius:16px;padding:32px}
.plat-memory-label{font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--green,#39ff14);margin:0 0 6px}
.plat-memory-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}
@media(max-width:600px){.plat-memory-grid{grid-template-columns:1fr}}
.plat-memory-card{background:rgba(255,255,255,.04);border-radius:12px;padding:18px 20px}
.plat-memory-card-title{font-weight:700;color:#fff;font-size:14px;margin-bottom:8px}
.plat-plan-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:24px}
@media(max-width:640px){.plat-plan-grid{grid-template-columns:1fr}}
.plat-plan-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:20px}
.plat-plan-card--featured{background:rgba(57,255,20,.06);border-color:rgba(57,255,20,.3)}
.plat-plan-name{font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:8px}
.plat-plan-card p{font-size:14px;color:var(--text,#ccc);margin:0 0 14px}
.plat-plan-link{font-size:13px;font-weight:700;color:var(--green,#39ff14);text-decoration:none}
.plat-plan-link:hover{text-decoration:underline}
.plat-cta-box{background:rgba(57,255,20,.06);border:1px solid rgba(57,255,20,.2);border-radius:16px;padding:40px 36px;margin:48px 0 24px;text-align:center}
.plat-cta-box h2{font-family:'Bebas Neue',sans-serif;font-size:40px;color:#fff;margin:0 0 14px}
.plat-cta-box h2 span{color:var(--green,#39ff14)}
.plat-cta-box p{font-size:16px;color:var(--text,#ccc);margin:0 0 24px;max-width:560px;margin-left:auto;margin-right:auto}
.plat-hub-nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 8px}
.plat-hub-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,.12);color:var(--light,#e8e8e8);background:rgba(255,255,255,.04);transition:border-color .15s}
.plat-hub-pill:hover{border-color:var(--green,#39ff14);color:#fff}
.plat-hub-pill.auto{border-color:rgba(57,255,20,.3);color:var(--green,#39ff14)}
</style>"""

# ── Template ───────────────────────────────────────────────────────────────────
def render_page(p):
    slug     = p['slug']
    name     = p['name']
    is_auto  = p['is_auto']
    badge_cls  = 'auto' if is_auto else 'manual'
    badge_txt  = 'Blasty Posts It' if is_auto else 'Ready for You to Post'
    note_html  = f'<p style="font-size:13px;background:rgba(57,255,20,.06);border:1px solid rgba(57,255,20,.2);border-radius:8px;padding:10px 14px;color:#aaa;margin-bottom:20px">{p["note"]}</p>\n    ' if p.get('note') else ''

    snapshot_items = ''.join(f'<li>{s}</li>\n        ' for s in p['snapshot'])
    look_items     = ''.join(f'<li>{s}</li>\n        ' for s in p['look_for'])

    manual_html = ''
    if p.get('manual_steps'):
        manual_html = f'<div class="plat-manual-steps">📋 <strong>How to paste it in:</strong> {p["manual_steps"]}</div>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{name} — AI-Written Posts for Local Businesses — BlastyBiz</title>
<meta name="description" content="{p['meta']}"/>
<meta name="robots" content="index, follow"/>
<meta property="og:title" content="{p['h1']}"/>
<meta property="og:description" content="{p['meta']}"/>
<meta property="og:type" content="article"/>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="global-style.css?v={CSS_V}"/>
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "{p['h1']}",
  "description": "{p['meta']}",
  "url": "https://blastybiz-9523e.web.app/BlastyBiz-Platform-{slug}.html",
  "isPartOf": {{ "@type": "WebSite", "name": "BlastyBiz", "url": "https://blastybiz-9523e.web.app" }}
}}
</script>
<script src="blastybiz-menu.js?v={MENU_V}"></script>
{PAGE_CSS}
</head>
<body class="has-site-header">
<div id="header__inject"></div>
<main class="main"><div class="main-inner">

<div class="row">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="BlastyBiz-Home.html">Home</a>
    <span class="bc-sep">›</span>
    <a href="BlastyBiz-Platforms.html">Platforms</a>
    <span class="bc-sep">›</span>
    <span class="bc-current">{name}</span>
  </nav>
</div>

<header class="plat-hero">
  <div class="row">
    {note_html}<div class="plat-badge {badge_cls}">{badge_txt}</div>
    <h1>{p['h1']}</h1>
    <p class="plat-kw">{p['kw']}</p>
    <p class="plat-lead">{p['opening']}</p>
  </div>
</header>

<section class="plat-section reveal">
  <div class="row"><div class="plat-body">
    <h2>How <span>{name}</span> Works</h2>
    <ul class="plat-snapshot">
      {snapshot_items.strip()}
    </ul>
    <h2>What Blasty <span>Looks For</span></h2>
    <ul class="plat-look-list">
      {look_items.strip()}
    </ul>
    <h2>Sample <span>Generated Post</span></h2>
    <div class="plat-sample">
      <div class="plat-sample-label">Example — AI-written for {name}</div>
      {p['sample']}
    </div>
    <div class="plat-workflow">
      <p><strong>The workflow:</strong> {p['workflow']}</p>
      {manual_html}
    </div>
    <p class="plat-plan-close">{p['plan_close']}</p>
  </div></div>
</section>

{MEMORY_MODULE}

{PLAN_BLOCK}

{CLOSING_CTA}

</div></main>
<div id="site-footer-inject"></div>
<script>fetch('blastybiz-footer.html').then(r=>r.text()).then(function(html){{document.getElementById('site-footer-inject').innerHTML=html;}});</script>
<script>
const observer = new IntersectionObserver((entries) => {{
  entries.forEach(e => {{ if (e.isIntersecting) {{ e.target.classList.add('visible'); observer.unobserve(e.target); }} }});
}}, {{ threshold: 0.1 }});
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
</script>
<script src="header-loader.js?v=1"></script>
</body>
</html>"""


def render_hub():
    pills = ''
    for p in PLATFORMS:
        cls = 'auto' if p['is_auto'] else ''
        pills += f'<a href="BlastyBiz-Platform-{p["slug"]}.html" class="plat-hub-pill {cls}">{p["icon"]} {p["name"]}</a>\n    '

    rows = ''
    for p in PLATFORMS:
        badge = '<span style="font-size:11px;font-weight:700;color:var(--green,#39ff14)">⚡ Auto</span>' if p['is_auto'] else '<span style="font-size:11px;color:#888">📋 Copy-Ready</span>'
        rows += f"""\
      <a href="BlastyBiz-Platform-{p['slug']}.html" class="platform-hub-card" style="display:block;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:20px;text-decoration:none;color:inherit;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(57,255,20,.4)'" onmouseout="this.style.borderColor='rgba(255,255,255,.1)'">
        <div style="font-size:24px;margin-bottom:8px">{p['icon']}</div>
        <div style="font-weight:700;font-size:16px;color:#fff;margin-bottom:4px">{p['name']}</div>
        {badge}
      </a>\n"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>All Platforms — BlastyBiz</title>
<meta name="description" content="BlastyBiz supports 15 platforms for local business marketing. 3 post automatically. 12 are copy-ready in seconds. One campaign covers all of them."/>
<meta name="robots" content="index, follow"/>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="global-style.css?v={CSS_V}"/>
<script src="blastybiz-menu.js?v={MENU_V}"></script>
{PAGE_CSS}
</head>
<body class="has-site-header">
<div id="header__inject"></div>
<main class="main"><div class="main-inner">

<div class="row">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="BlastyBiz-Home.html">Home</a>
    <span class="bc-sep">›</span>
    <span class="bc-current">All Platforms</span>
  </nav>
</div>

<header class="plat-hero">
  <div class="row">
    <h1>One Campaign. <span>Every Platform.</span></h1>
    <p class="plat-kw">AI-optimized posts for all 15 platforms your local business needs</p>
    <p class="plat-lead">Write your campaign once. BlastyBiz creates platform-specific versions — adapting wording, formatting, length, tone, hashtags, and calls-to-action for each one. Three platforms post automatically. Twelve are copy-ready in seconds.</p>
  </div>
</header>

<section class="reveal">
  <div class="row">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;max-width:900px;margin:0 auto">
{rows}    </div>
  </div>
</section>

<section class="reveal" style="margin-top:40px">
  <div class="row"><div class="plat-body">
    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center;background:rgba(57,255,20,.04);border:1px solid rgba(57,255,20,.15);border-radius:14px;padding:24px 28px">
      <div><span style="font-size:28px;display:block;margin-bottom:4px">⚡</span><strong style="color:var(--green,#39ff14)">Automatic</strong><p style="margin:4px 0 0;font-size:14px;color:var(--muted,#888)">Google, Facebook, Instagram post themselves when you connect the account.</p></div>
      <div style="width:1px;height:60px;background:rgba(255,255,255,.08)"></div>
      <div><span style="font-size:28px;display:block;margin-bottom:4px">📋</span><strong style="color:#ccc">Copy-Ready</strong><p style="margin:4px 0 0;font-size:14px;color:var(--muted,#888)">12 platforms don&rsquo;t allow third-party automation — BlastyBiz writes it perfectly; you paste it in seconds.</p></div>
    </div>
  </div></div>
</section>

{CLOSING_CTA}

</div></main>
<div id="site-footer-inject"></div>
<script>fetch('blastybiz-footer.html').then(r=>r.text()).then(function(html){{document.getElementById('site-footer-inject').innerHTML=html;}});</script>
<script>
const observer = new IntersectionObserver((entries) => {{
  entries.forEach(e => {{ if (e.isIntersecting) {{ e.target.classList.add('visible'); observer.unobserve(e.target); }} }});
}}, {{ threshold: 0.1 }});
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
</script>
<script src="header-loader.js?v=1"></script>
</body>
</html>"""


# Delivery facts are shared with the live server and browser, never editorial overrides.
_ROOT = Path(__file__).resolve().parents[1]
_CANONICAL = json.loads(subprocess.check_output([
    'node', '-e', 'process.stdout.write(JSON.stringify(require("./functions/lib/platforms").records))'
], cwd=_ROOT, text=True))
_BY_ID = {p['id']: p for p in _CANONICAL}
for p in PLATFORMS:
    facts = _BY_ID[p['slug']]
    p.update(name=facts['name'], icon=facts['icon'], is_auto=facts['deliveryMode'] == 'auto')
    p['plan_close'] = ('Available on every plan after you connect your account.'
                       if p['is_auto'] else 'Available on every plan, ready for you to post.')

# ── Write files ────────────────────────────────────────────────────────────────
generated = []
for p in PLATFORMS:
    fname = f"BlastyBiz-Platform-{p['slug']}.html"
    path  = os.path.join(OUT, fname)
    with open(path, 'w') as f:
        f.write(render_page(p))
    generated.append(fname)
    print(f'  wrote {fname}')

hub_path = os.path.join(OUT, 'BlastyBiz-Platforms.html')
with open(hub_path, 'w') as f:
    f.write(render_hub())
print('  wrote BlastyBiz-Platforms.html')
print(f'\n✅ {len(generated)+1} files written to {OUT}/')
