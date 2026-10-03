# BlastyBiz working instructions

## Standing authorization and releases

Dave's authorization for a task remains valid until that task is complete. For this authorized emergency repair, use Main and the existing Fluba Authorization Engine release path. Do not ask Dave again to authorize routine edits, tests, commits, or deployment within that same scope.

Before asking for access or a sign-in, inspect the existing Authorization Engine capabilities and release evidence. Use its existing identity and isolated authenticated verification. Do not ask Dave to sign in just to repeat checks the engine already supports.

Ask only when genuinely new permission is needed: an action outside the authorized scope, destructive customer-data changes, credential disclosure, secret changes, security weakening, or an explicit tool/permission denial that cannot be resolved within existing authorization. Identify the exact blocked action and reason. Never bypass a denial or broaden permissions silently.

Reuse existing components and the single source of truth. Move controls into their intended tabs; do not build parallel schedulers, duplicate preview/progress logic, or alternate publishing routes. Never send a real blast as a test.

For emergency changes, work directly without sub-agent delegation unless Dave requests it. Run focused checks for the affected behavior and the existing required release gate. Deploy only changed surfaces through the Authorization Engine. Report completion only after verifying the actual release and affected behavior; distinguish fixture checks from authenticated live checks.
