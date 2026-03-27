// stutterPlanScheduler.js - Extracted plan scheduling helpers for StutterManager.

stutterPlanScheduler = (() => {
  const V = validator.create('stutterPlanScheduler');

  function assertManagerLike(stutterMgr) {
    const manager = V.requireDefined(stutterMgr, 'stutterMgr');
    const type = typeof manager;
    if (type !== 'object' && type !== 'function') {
      throw new Error('stutterPlanScheduler: stutterMgr must be an object or function');
    }
    return manager;
  }

  function createPlan(stutterMgr, planCfg = {}) {
    assertManagerLike(stutterMgr);
    const id = `plan-${stutterMgr.stutterPlanSchedulerNextPlanId++}`;
    const cfg = /** @type {any} */ (Object.assign({}, planCfg));
    cfg.id = id;
    stutterMgr.plans.set(id, cfg);
    return id;
  }

  function schedulePlan(stutterMgr, planOrCfg = {}) {
    assertManagerLike(stutterMgr);
    const isId = (typeof planOrCfg === 'string' && stutterMgr.plans.has(planOrCfg));
    const planId = isId ? planOrCfg : createPlan(stutterMgr, planOrCfg);
    const plan = /** @type {any} */ (stutterMgr.plans.get(planId));

    const startTick = Number.isFinite(Number(plan.startTick))
      ? Number(plan.startTick)
      : (Number.isFinite(Number(plan.on)) ? Number(plan.on) : Number(beatStartTime));

    const key = m.round(startTick);
    if (key > m.round(beatStartTime)) {
      const arr = stutterMgr.scheduledPlans.get(key) || [];
      arr.push(planId);
      stutterMgr.scheduledPlans.set(key, arr);
      stutterMetrics.incScheduled(1, plan.profile || 'unknown');
      stutterMetrics.incPendingForTick(key, 1);
      return planId;
    }

    runPlan(stutterMgr, planId);
    return planId;
  }

  function runPlan(stutterMgr, planIdOrCfg = {}) {
    assertManagerLike(stutterMgr);
    const plan = /** @type {any} */ ((typeof planIdOrCfg === 'string') ? stutterMgr.plans.get(planIdOrCfg) : planIdOrCfg);
    V.assertObject(plan, 'plan');
    return executePlan(stutterMgr, plan);
  }

  function cancelPlan(stutterMgr, planId) {
    assertManagerLike(stutterMgr);
    if (!stutterMgr.plans.has(planId)) return false;
    stutterMgr.plans.delete(planId);
    for (const [tick, arr] of Array.from(stutterMgr.scheduledPlans.entries())) {
      const filtered = arr.filter((id) => id !== planId);
      if (filtered.length === 0) stutterMgr.scheduledPlans.delete(tick); else stutterMgr.scheduledPlans.set(tick, filtered);
    }
    return true;
  }

  function runDuePlans(stutterMgr, tick) {
    assertManagerLike(stutterMgr);
    const key = m.round(Number(tick));
    const dueKeys = Array.from(stutterMgr.scheduledPlans.keys()).filter((k) => k <= key).sort((a, b) => a - b);
    for (const k of dueKeys) {
      const arr = stutterMgr.scheduledPlans.get(k) || [];
      for (const planId of arr) {
        const plan = stutterMgr.plans.get(planId);
        if (plan) {
          stutterMetrics.decPendingForTick(k, 1);
          executePlan(stutterMgr, plan);
          stutterMgr.plans.delete(planId); // evict executed plan
        }
      }
      stutterMgr.scheduledPlans.delete(k);
    }
    return true;
  }

  function executePlan(stutterMgr, plan = {}) {
    assertManagerLike(stutterMgr);
    V.requireType(stutterExecutePlan, 'function', 'stutterExecutePlan helper');
    return stutterExecutePlan(stutterMgr, plan);
  }

  return {
    createPlan,
    schedulePlan,
    runPlan,
    cancelPlan,
    runDuePlans,
    executePlan
  };
})();
