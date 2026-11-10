'use strict';

// One writer for the static-price variation used by admin pricing and repair.
async function createSubscriptionVariation(catalog, {key, cents, planId, idempotencyKey}) {
  if (!['proMonthly','proAnnual','agencyMonthly','agencyAnnual'].includes(key) ||
      !Number.isSafeInteger(cents) || cents <= 0 || typeof planId !== 'string' || !planId ||
      typeof idempotencyKey !== 'string' || !idempotencyKey) throw Error('Invalid subscription variation configuration');
  const name = `BlastyBiz ${key.startsWith('pro') ? 'Pro' : 'Agency'} — $${cents / 100}/${key.endsWith('Annual') ? 'yr' : 'mo'}`;
  const result = await catalog.object.upsert({
    idempotencyKey,
    object: {
      type: 'SUBSCRIPTION_PLAN_VARIATION', id: `#${key}_variation`,
      subscriptionPlanVariationData: {
        name, subscriptionPlanId: planId,
        phases: [{cadence:key.endsWith('Annual') ? 'ANNUAL' : 'MONTHLY', ordinal:BigInt(0),
          pricing:{type:'STATIC', priceMoney:{amount:BigInt(cents), currency:'USD'}}}],
      },
    },
  });
  if (result.errors?.length || result.catalogObject?.type !== 'SUBSCRIPTION_PLAN_VARIATION' || !result.catalogObject.id)
    throw Error('Square did not return a subscription variation');
  return result.catalogObject.id;
}

module.exports = {createSubscriptionVariation};
