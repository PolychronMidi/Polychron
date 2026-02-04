// noteCascade.js - Schedule and cascade note events across units (generic helper)

// NOTE: This module follows the project's naked-global, side-effect require pattern.
// It exposes a single API: NoteCascade.scheduleNoteCascade(manager, opts)

/**
 * Schedule note cascade for a single unit-level note. Designed to be generic (works with or without stutter helper).
 * @param {any} manager - Instance of StutterManager (owns `pending`, `shared` etc.)
 * @param {any} [opts] - Options forwarded to underlying helper (profile, channel, note, on, sustain, velocity, binVel, rf, ri, shared, config, emit)
 * @returns {number} number of scheduled events added
 */
function scheduleNoteCascade(manager, opts = {}) {
  const provided = Object.assign({}, opts);
  if (!provided.shared) provided.shared = manager.shared;
  // propagate manager config into the scheduling call
  provided.config = Object.assign({}, manager.config || {}, provided.config || {});
  provided.emit = false;

  // Resolve helper: instance override, then registered helper from StutterConfig
  const SC = (typeof StutterConfig !== 'undefined') ? StutterConfig : null;
  let helper = (typeof manager._helperOverride === 'function') ? manager._helperOverride : (SC && SC.getRegisteredHelper ? SC.getRegisteredHelper() : null);
  if (helper === null || typeof helper !== 'function') {
    if (SC && SC.logDebug) SC.logDebug('noteCascade: no stutterNotes helper available (will use fallback on event)');
  }

  let events = [];
  if (!helper || typeof helper !== 'function') {
    if (SC && SC.logDebug) SC.logDebug('noteCascade: no valid helper available, skipping helper call');
  } else if (helper === manager.stutterNotes) {
    // avoid recursion if helper somehow resolves to manager delegator
    if (SC && SC.logDebug) SC.logDebug('noteCascade: helper resolved to manager delegator, skipping helper call');
  } else {
    const result = helper(provided);
    events = result && result.events ? result.events : [];
  }

  if (SC && SC.logDebug) SC.logDebug('noteCascade: events', events.length, events.map(e => Math.round(e.tick)));

  let added = 0;
  for (const ev of events) {
    ev._profile = provided.profile || 'unknown';
    const key = Math.round(ev.tick);
    if (!manager.pending.has(key)) manager.pending.set(key, []);
    manager.pending.get(key).push(ev);
    if (SC && SC.incPendingForTick) SC.incPendingForTick(key, 1);
    added++;
  }

  // fallback: ensure at least an 'on' event at the requested tick
  const onTick = Math.round(provided.on);
  const hasOnAtRequested = events.some(ev => Math.round(ev.tick) === onTick || (ev.type === 'on' && Math.round(ev.tick) === onTick));
  if (!hasOnAtRequested) {
    const fallbackEv = { tick: provided.on, type: 'on', vals: [provided.channel, provided.note, provided.velocity || provided.binVel || (SC && SC.getConfig ? SC.getConfig().fallbackVelocity : 64)], _profile: provided.profile || 'unknown' };
    if (!manager.pending.has(onTick)) manager.pending.set(onTick, []);
    manager.pending.get(onTick).push(fallbackEv);
    if (SC && SC.incPendingForTick) SC.incPendingForTick(onTick, 1);
    added++;
  }

  if (SC && SC.incScheduled) SC.incScheduled(added, provided.profile || 'unknown');
  return added;
}

// Export as naked global
NoteCascade = { scheduleNoteCascade };
