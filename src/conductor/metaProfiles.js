// metaProfiles.js -- Metaprofile registry, loader, and accessor.
// Sets coordinated initial conditions for the relationship layer.
// Meta-controllers read their axis from the active metaprofile every tick.
//
// scaleFactor(axis, key) is the canonical multiplier API: it divides the
// active profile's value by the `default` profile's value, returning 1.0 when
// no profile is active or when the active profile lacks the key. Controllers
// multiply their _BASE constants by scaleFactor() instead of dividing by
// hardcoded baselines -- the implicit "default profile" lives in one place.

metaProfiles = (() => {
  const V = validator.create('metaProfiles');
  const _fs = require('fs');
  const _path = require('path');
  const _activeFile      = _path.join(METRICS_DIR, 'metaprofile-active.json');
  const _historyFile     = _path.join(METRICS_DIR, 'metaprofile-history.jsonl');
  // Empirical tuning loop: attribute per-section outcomes to the profile
  // that was active. Append-only JSONL; aggregator scripts later compute
  // per-profile mean scores + sensitivity. Schema:
  //   {profile, section, sectionType?, score?, hci?, ts}
  const _attributionFile = _path.join(METRICS_DIR, 'metaprofile-attribution.jsonl');

  /** @type {Object|null} */
  let activeProfile = null;
  /** @type {string|null} */
  let activeProfileName = null;
  /** @type {number|null} */
  let activeSinceSection = null;

  // Default profile is the scaleFactor neutral point. Looked up once at module
  // load so accessors stay hot-path-cheap.
  const _defaultProfile = metaProfileDefinitions.get('default');
  if (!_defaultProfile) {
    throw new Error('metaProfiles: metaProfileDefinitions must define a "default" profile (scaleFactor neutral point)');
  }

  // Load three-scope custom profiles from .hme/metaprofiles/. Project
  // overrides global; built-ins are baseline. New names register; same
  // names override (lets a project tweak a built-in's axis values
  // without forking the codebase).
  if (typeof metaProfileDefinitions.loadCustomProfiles === 'function') {
    metaProfileDefinitions.loadCustomProfiles();
  }

  // Clear stale history at module load (once per pipeline run).
  if (_fs.existsSync(_historyFile)) _fs.unlinkSync(_historyFile);

  // Per-influence-point disable toggles. Set via METAPROFILE_DISABLE_AXES env
  // var (comma-separated) or programmatically. When disabled, accessors return
  // null for that axis -- controllers fall back to their own _BASE defaults.
  const _disabled = {};
  const _disableEnv = process.env.METAPROFILE_DISABLE_AXES;
  if (_disableEnv) {
    for (const axisId of _disableEnv.split(',').map(s => s.trim()).filter(Boolean)) {
      _disabled[axisId] = true;
    }
  }

  function _atomicWriteJson(file, obj) {
    const tmp = file + '.tmp';
    _fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    _fs.renameSync(tmp, file);
  }

  function _appendHistory(entry) {
    _fs.appendFileSync(_historyFile, JSON.stringify(entry) + '\n');
  }

  function setActive(name, currentSection) {
    if (name === null || name === undefined) {
      activeProfile = null;
      activeProfileName = null;
      activeSinceSection = null;
      if (_fs.existsSync(_activeFile)) _fs.unlinkSync(_activeFile);
      return true;
    }
    V.assertNonEmptyString(name, 'metaProfiles.setActive.name');
    const profile = metaProfileDefinitions.get(name);
    if (!profile) {
      throw new Error(`metaProfiles.setActive: unknown profile "${name}". Available: ${metaProfileDefinitions.list().join(', ')}`);
    }

    const sec = V.optionalFinite(currentSection, null);

    // Dwell guard: skip switch if active profile has not held its minimum
    // section span yet. Only applies when currentSection is provided AND we
    // already have an active profile AND the names differ.
    if (sec !== null && activeProfile !== null && activeProfileName !== name && activeSinceSection !== null) {
      const dwell = activeProfile.minDwellSections;
      const elapsed = sec - activeSinceSection;
      if (elapsed < dwell) return false;
    }

    activeProfile = profile;
    activeProfileName = name;
    activeSinceSection = sec;
    _atomicWriteJson(_activeFile, profile);
    _appendHistory({
      name,
      section: activeSinceSection,
      ts: Date.now(),
    });
    return true;
  }

  function getActive() { return activeProfile; }
  function getActiveName() { return activeProfileName; }
  function getActiveSinceSection() { return activeSinceSection; }
  function isActive() { return activeProfile !== null; }

  // Activation progress in [0, 1] -- how far the active profile has held
  // relative to its minDwellSections. Set by main.js per-section via
  // setActivationProgress, so controllers can read time-varying envelope
  // values without each one having to compute progress independently.
  // Default 0.5 when nothing is set: matches getAxisValue's mid-progress
  // collapse, so behavior is unchanged for callers that don't care.
  let _activationProgress = 0.5;
  function setActivationProgress(p) {
    const v = V.optionalFinite(p, 0.5);
    _activationProgress = m.max(0, m.min(1, v));
  }
  function getActivationProgress() { return _activationProgress; }

  function getAxis(axis) {
    if (!activeProfile) return null;
    if (isAxisDisabled(axis)) return null;
    return activeProfile[axis] || null;
  }

  function _looksLikeEnvelope(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return false;
    if (typeof v === 'object') {
      return 'from' in v && 'to' in v;
    }
    return false;
  }

  function _looksLikeDistribution(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return false;
    if (typeof v === 'object') {
      return 'mean' in v && 'std' in v;
    }
    return false;
  }

  // Sample from a stochastic distribution descriptor {mean, std, skew?}.
  // Box-Muller transform for the gaussian; skew applied as a cubic warp on
  // the standardized variate so callers can bias higher (skew > 0) or lower
  // (skew < 0) without a heavy gamma/lognormal dependency. Pure aside from
  // m.random; deterministic samplers can be wired later via a seed hook.
  function _sampleDistribution(dist) {
    const mean = V.assertFinite(dist.mean, '_sampleDistribution.mean');
    const std = V.assertFinite(dist.std, '_sampleDistribution.std');
    const skew = V.optionalFinite(dist.skew, 0);
    const u1 = m.max(1e-12, m.random());
    const u2 = m.random();
    let z = m.sqrt(-2 * m.log(u1)) * m.cos(2 * m.PI * u2);
    if (skew !== 0) {
      z = z + skew * (z * z - 1) / 6;
    }
    return mean + std * z;
  }

  function getAxisValue(axis, key, fallback) {
    const section = getAxis(axis);
    if (!section || !(key in section)) return fallback;
    const v = section[key];
    // Envelope shape: collapse to mid-activation value (progress=0.5).
    // Callers that want time-varying behavior use getAxisValueAt instead.
    if (_looksLikeEnvelope(v)) {
      return _resolveEnvelope(v, 0.5);
    }
    // Distribution shape: collapse to mean. Stochastic callers use
    // sampleAxisValue to draw from the distribution per-tick instead.
    if (_looksLikeDistribution(v)) {
      return v.mean;
    }
    return v;
  }

  // Stochastic accessor. Returns a fresh sample if the axis value is a
  // distribution; otherwise behaves like getAxisValue (returns the
  // scalar / envelope-collapsed value). Callers wanting per-tick
  // micro-variation use this instead of getAxisValue.
  function sampleAxisValue(axis, key, fallback) {
    const section = getAxis(axis);
    if (!section || !(key in section)) return fallback;
    const v = section[key];
    if (_looksLikeDistribution(v)) return _sampleDistribution(v);
    if (_looksLikeEnvelope(v))     return _resolveEnvelope(v, 0.5);
    return v;
  }

  // Resolve an envelope value at a specific progress in [0, 1]. Curves:
  //   linear      -> from + (to - from) * progress
  //   ascending   -> same as linear (alias for declarative readability)
  //   descending  -> reverse: from at progress=1, to at progress=0
  //   arch        -> sine peak at midpoint, ends at min(from, to)
  function _resolveEnvelope(env, progress) {
    const t = m.max(0, m.min(1, progress));
    const curve = env.curve || 'linear';
    if (Array.isArray(env.from)) {
      // Pair envelope -- interpolate each component.
      const f = env.from, g = env.to;
      const ratio = _curveRatio(curve, t);
      return [f[0] + (g[0] - f[0]) * ratio, f[1] + (g[1] - f[1]) * ratio];
    }
    const ratio = _curveRatio(curve, t);
    return env.from + (env.to - env.from) * ratio;
  }

  function _curveRatio(curve, t) {
    switch (curve) {
      case 'descending': return 1 - t;
      case 'arch':       return m.sin(t * m.PI);
      case 'ascending':
      case 'linear':
      default:           return t;
    }
  }

  // Time-varying axis-value accessor. Same shape as getAxisValue but
  // resolves envelope values at the given progress instead of mid-point.
  function getAxisValueAt(axis, key, fallback, progress) {
    const section = getAxis(axis);
    if (!section || !(key in section)) return fallback;
    const v = section[key];
    if (_looksLikeEnvelope(v)) {
      return _resolveEnvelope(v, progress);
    }
    if (_looksLikeDistribution(v)) {
      return v.mean;
    }
    return v;
  }

  // scaleFactor(axis, key) = activeValue / defaultValue, or 1.0 when no
  // metaprofile is active / axis disabled / key missing. Controllers multiply
  // their _BASE constants by this -- the "default" profile is the single
  // source of truth for the scaling neutral point.
  function _collapseToScalar(v) {
    if (_looksLikeEnvelope(v)) return _resolveEnvelope(v, 0.5);
    if (_looksLikeDistribution(v)) return v.mean;
    if (Array.isArray(v)) return (v[0] + v[1]) / 2;
    return v;
  }

  function scaleFactor(axis, key) {
    const defAxis = /** @type {Record<string, any>} */ (_defaultProfile)[axis];
    if (!defAxis || !(key in defAxis)) {
      throw new Error(`metaProfiles.scaleFactor: default profile lacks "${axis}.${key}"`);
    }
    // default profile uses scalars only; collapse defensively.
    const defVal = _collapseToScalar(defAxis[key]);
    if (defVal === 0) {
      throw new Error(`metaProfiles.scaleFactor: default "${axis}.${key}" is 0 (no scaleFactor reference); use getAxisValue + additive bias instead`);
    }
    const active = getAxis(axis);
    if (!active || !(key in active)) return 1.0;
    // Active value can be scalar / pair / envelope / distribution; collapse
    // to a representative scalar so scaleFactor stays deterministic. Stochastic
    // call sites use sampledScaleFactor instead.
    return _collapseToScalar(active[key]) / defVal;
  }

  // Progress-aware ratio: when the active value is an envelope, resolves
  // it at _activationProgress (set per-section by main.js). Otherwise
  // behaves like scaleFactor. Lets controllers honor envelope shape
  // without each one tracking section index. _BASE * progressedScaleFactor
  // pattern mirrors _BASE * scaleFactor for backwards compatibility.
  function progressedScaleFactor(axis, key) {
    const defAxis = /** @type {Record<string, any>} */ (_defaultProfile)[axis];
    if (!defAxis || !(key in defAxis)) {
      throw new Error(`metaProfiles.progressedScaleFactor: default profile lacks "${axis}.${key}"`);
    }
    const defVal = _collapseToScalar(defAxis[key]);
    if (defVal === 0) {
      throw new Error(`metaProfiles.progressedScaleFactor: default "${axis}.${key}" is 0`);
    }
    const active = getAxis(axis);
    if (!active || !(key in active)) return 1.0;
    const v = active[key];
    if (_looksLikeEnvelope(v)) return _resolveEnvelope(v, _activationProgress) / defVal;
    return _collapseToScalar(v) / defVal;
  }

  // Stochastic counterpart: returns a fresh ratio per call when the active
  // value is a distribution; otherwise behaves like scaleFactor. Use this
  // in controllers that want per-tick organic variation in their _BASE
  // multiplier without changing the surrounding _BASE * scaleFactor pattern.
  function sampledScaleFactor(axis, key) {
    const defAxis = /** @type {Record<string, any>} */ (_defaultProfile)[axis];
    if (!defAxis || !(key in defAxis)) {
      throw new Error(`metaProfiles.sampledScaleFactor: default profile lacks "${axis}.${key}"`);
    }
    const defVal = _collapseToScalar(defAxis[key]);
    if (defVal === 0) {
      throw new Error(`metaProfiles.sampledScaleFactor: default "${axis}.${key}" is 0`);
    }
    const active = getAxis(axis);
    if (!active || !(key in active)) return 1.0;
    const v = active[key];
    if (_looksLikeDistribution(v)) return _sampleDistribution(v) / defVal;
    return _collapseToScalar(v) / defVal;
  }

  // Record an outcome attribution: which profile was active during a
  // section + the section's score / HCI / arbitrary metadata. Append-
  // only JSONL at output/metrics/metaprofile-attribution.jsonl. Caller
  // (typically main.js per-section close-out, or post-pipeline analysis
  // script) supplies the score signals it can attribute.
  //
  // Aggregation is deferred to a separate analysis script (built in a
  // later round). This entry is the data-collection foothold; without
  // it, no future tuning loop has anything to consume.
  function recordAttribution(fields) {
    V.assertPlainObject(fields, 'metaProfiles.recordAttribution.fields');
    const entry = {
      ...fields,
      profile: activeProfileName,
      section: V.optionalFinite(fields.section, null),
      sectionType: fields.sectionType || null,
      score: V.optionalFinite(fields.score, null),
      hci: V.optionalFinite(fields.hci, null),
      ts: Date.now(),
    };
    _fs.mkdirSync(_path.dirname(_attributionFile), { recursive: true });
    _fs.appendFileSync(_attributionFile, JSON.stringify(entry) + '\n');
  }

  // Evaluate reactive triggers against a runtime signal snapshot. Returns
  // the highest-priority `{ profile, priority }` whose `enter` condition
  // matches, or null if none. Does NOT auto-activate -- callers (e.g.
  // main.js's section rotation) decide whether to honor it vs section
  // affinity and dwell. Single-pass, no sustained-for-N-beats yet.
  function evaluateTriggers(snapshot) {
    V.assertPlainObject(snapshot, 'metaProfiles.evaluateTriggers.snapshot');
    let best = null;
    const all = metaProfileDefinitions.all();
    for (const [name, profile] of Object.entries(all)) {
      if (!profile.triggers) continue;
      // _validateTriggers guarantees `enter` is an array when defined.
      const enterList = profile.triggers.enter;
      if (!enterList) continue;
      for (const trig of enterList) {
        const parsed = metaProfileDefinitions._parseTriggerExpr(trig.if);
        if (!parsed) continue;
        if (!metaProfileDefinitions._evalTriggerExpr(parsed, snapshot)) continue;
        const priority = V.optionalFinite(trig.priority, 50);
        if (!best || priority > best.priority) {
          best = { profile: name, priority, condition: trig.if };
        }
      }
    }
    return best;
  }

  function disableAxis(axisId) { _disabled[axisId] = true; }
  function enableAxis(axisId)  { delete _disabled[axisId]; }
  function isAxisDisabled(axisId) { return Boolean(_disabled[axisId]); }

  // ── Substrate-level accessors ──────────────────────────────────────
  // These let consumers read the optional substrate fields the metaprofile
  // may declare. Each returns a sensible default (no bias / no override)
  // when the field is absent or no profile is active. Centralizing the
  // safe-read here keeps consumer code simple.

  // Composer family weight bias. Returns 1.0 when no profile active,
  // no composerFamilies declared, or family not specifically biased.
  function getComposerFamilyWeight(familyName) {
    if (!activeProfile || !activeProfile.composerFamilies) return 1.0;
    const v = activeProfile.composerFamilies[familyName];
    return Number.isFinite(v) ? v : 1.0;
  }

  // Conductor profile affinity: returns true when the active profile
  // explicitly favors / dispreferes the given conductor profile name.
  // Default false for both -- absence of opinion doesn't mean opposition.
  function preferConductorProfile(name) {
    if (!activeProfile || !Array.isArray(activeProfile.conductorAffinity)) return false;
    return activeProfile.conductorAffinity.includes(name);
  }
  function avoidConductorProfile(name) {
    if (!activeProfile || !Array.isArray(activeProfile.conductorAntipathy)) return false;
    return activeProfile.conductorAntipathy.includes(name);
  }

  // Per-layer metaprofile variant. When the active profile declares
  // layerVariants: { L1: name, L2: name }, this returns the variant name
  // for the given layer (or null if not declared). Layer-aware controllers
  // can resolve a layer-specific axis value via this -- the smaller-
  // footprint version of full per-layer profile activation.
  function getLayerVariant(layer) {
    if (!activeProfile || !activeProfile.layerVariants) return null;
    return activeProfile.layerVariants[layer] || null;
  }

  // Section arc override: when declared, replaces the structural section
  // sequence for this metaprofile's activation span.
  function getSectionArcOverride() {
    if (!activeProfile || !Array.isArray(activeProfile.sectionArc)) return null;
    return activeProfile.sectionArc.slice();
  }

  // Controller enablement. Returns true when the active profile lists
  // the given controller name in disableControllers.
  function isControllerDisabled(controllerName) {
    if (!activeProfile || !Array.isArray(activeProfile.disableControllers)) return false;
    return activeProfile.disableControllers.includes(controllerName);
  }

  // Coupling-topology hint: prescribed pairs the active profile wants
  // present, regardless of runtime correlation. Coupling controllers can
  // augment / override their candidate set with these.
  function getCouplingPairsHint() {
    if (!activeProfile || !Array.isArray(activeProfile.couplingPairs)) return null;
    return activeProfile.couplingPairs.map((p) => p.slice());
  }

  // canSwitch(currentSection, candidateName) -- true when dwell allows a
  // switch to candidateName. Used by the section rotator before setActive.
  function canSwitch(currentSection, candidateName) {
    if (activeProfile === null || activeSinceSection === null) return true;
    if (activeProfileName === candidateName) return true;
    const sec = V.optionalFinite(currentSection, null);
    if (sec === null) return true;
    return (sec - activeSinceSection) >= activeProfile.minDwellSections;
  }

  // Convenience accessors. Return null when no profile active or axis
  // disabled, so callers can cleanly fall back to their own _BASE defaults
  // instead of using a duplicated baseline.
  function getRegimeTargets() {
    const r = getAxis('regime');
    return r ? { coherent: r.coherent, evolving: r.evolving, exploring: r.exploring } : null;
  }

  function getCouplingRange() {
    const c = getAxis('coupling');
    return c ? { lo: c.strength[0], hi: c.strength[1], density: c.density, antagonismThreshold: c.antagonismThreshold, midpoint: c.midpoint } : null;
  }

  function getTensionArc() {
    const t = getAxis('tension');
    return t ? { shape: t.shape, floor: t.floor, ceiling: t.ceiling } : null;
  }

  function getEnergyEnvelope() {
    const e = getAxis('energy');
    return e ? { densityTarget: e.densityTarget, flickerLo: e.flickerRange[0], flickerHi: e.flickerRange[1] } : null;
  }

  return {
    setActive,
    getActive,
    getActiveName,
    getActiveSinceSection,
    getAxis,
    getAxisValue,
    getAxisValueAt,
    sampleAxisValue,
    evaluateTriggers,
    recordAttribution,
    isActive,
    canSwitch,
    scaleFactor,
    sampledScaleFactor,
    progressedScaleFactor,
    setActivationProgress,
    getActivationProgress,
    getComposerFamilyWeight,
    preferConductorProfile,
    avoidConductorProfile,
    getLayerVariant,
    getSectionArcOverride,
    isControllerDisabled,
    getCouplingPairsHint,
    getRegimeTargets,
    getCouplingRange,
    getTensionArc,
    getEnergyEnvelope,
    disableAxis,
    enableAxis,
    isAxisDisabled,
    list: metaProfileDefinitions.list,
    bySection: metaProfileDefinitions.bySection,
  };
})();
