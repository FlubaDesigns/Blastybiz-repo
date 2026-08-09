---
name: Auto-post capability is a server-owned promise
description: Any UI that sells or promises auto-posting must derive capability from the server map, never from client platform metadata.
---

# Auto-post capability must come from the server

Whether BlastyBiz can publish to a platform without the owner pasting is decided by
the server-side capability map in `functions/lib/shared.js`. The publishing path is
the only thing that actually creates auto vs manual jobs, and it reads that map.

**The rule:** any surface that *promises* auto-posting to an owner — the plan step,
upgrade prompts, the publish page's per-platform labels — must derive its claim from
the server, not from the client-side platform metadata module.

**Why:** the client metadata is display data and is merged with admin overrides from
the `config/platforms` Firestore doc. An admin flipping a capability there would make
the app advertise (and charge for) auto-posting that the publishing path still forces
to copy-paste. Before this was fixed, the publish page computed auto-posting purely
from its own metadata with no plan awareness at all, and told free-plan owners that
three platforms "will auto-post" when the server was creating manual jobs for all of
them.

**Also plan-dependent, not just capability-dependent:** on the free plan the server
forces *every* platform to manual regardless of what it is capable of. Capability
alone is never enough to label a row — always combine capability with the owner's
current plan.

**How to apply:** when adding a new screen that mentions auto-posting, get the
authoritative slug list from the plan-options endpoint (it returns the derived list)
rather than reading capability off the client metadata. Keep the client metadata for
names, icons and ordering only.
