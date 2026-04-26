'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// Bring up the moduleLifecycle global. utils self-registers on require.
require('../../../../src/utils');

const ML = global.moduleLifecycle;

function withFreshRegistry(body) {
  // Snapshot any existing globals we'll touch so we can restore after the test.
  // _resetForTests clears manifests/instances/overrides AND flips bootState back
  // to pending so we can re-run initializeAll from scratch in the next test.
  ML._resetForTests();
  try {
    body();
  } finally {
    ML._resetForTests();
  }
}

test('declare: validates manifest shape', () => {
  withFreshRegistry(() => {
    assert.throws(() => ML.declare({}), /name/);
    assert.throws(() => ML.declare({ name: 'a' }), /deps/);
    assert.throws(() => ML.declare({ name: 'a', deps: [] }), /provides/);
    assert.throws(() => ML.declare({ name: 'a', deps: [], provides: [] }), /at least one/);
    assert.throws(() => ML.declare({ name: 'a', deps: [], provides: ['a'] }), /init/);
    // Valid minimal manifest:
    assert.doesNotThrow(() => ML.declare({
      name: 'test_minimal_' + Date.now(),
      deps: [],
      provides: ['test_minimal_' + Date.now()],
      init: () => ({}),
    }));
  });
});

test('declare: rejects duplicate name (within declare)', () => {
  withFreshRegistry(() => {
    const m = { name: 'dup_a', deps: [], provides: ['dup_a'], init: () => ({}) };
    ML.declare(m);
    assert.throws(() => ML.declare(m), /duplicate/);
  });
});

test('declare: rejects collision with registerInitializer name', () => {
  withFreshRegistry(() => {
    ML.registerInitializer('shared_name', () => {});
    assert.throws(() => ML.declare({
      name: 'shared_name',
      deps: [],
      provides: ['shared_name'],
      init: () => ({}),
    }), /already registered/);
  });
});

test('registerInitializer: rejects collision with declared manifest', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'shared_name_2',
      deps: [],
      provides: ['shared_name_2'],
      init: () => ({}),
    });
    assert.throws(() => ML.registerInitializer('shared_name_2', () => {}), /already declared/);
  });
});

test('initializeAll: runs declared modules and binds return value to globalThis', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'leaf_mod',
      deps: [],
      provides: ['leaf_mod'],
      init: () => ({ greeting: 'hi from leaf' }),
    });
    ML.initializeAll();
    assert.ok(global.leaf_mod, 'leaf_mod should be bound to global');
    assert.strictEqual(global.leaf_mod.greeting, 'hi from leaf');
    delete global.leaf_mod;
  });
});

test('initializeAll: deps resolved before dependent init() runs', () => {
  withFreshRegistry(() => {
    let leafInitTime = null;
    let parentInitTime = null;
    ML.declare({
      name: 'leaf2',
      deps: [],
      provides: ['leaf2'],
      init: () => {
        leafInitTime = Date.now();
        return { value: 42 };
      },
    });
    ML.declare({
      name: 'parent2',
      deps: ['leaf2'],
      provides: ['parent2'],
      init: (deps) => {
        parentInitTime = Date.now();
        // Tiny delay-free way to assert ordering; deps must be the resolved leaf
        assert.ok(deps.leaf2);
        assert.strictEqual(deps.leaf2.value, 42);
        return { wrapped: deps.leaf2.value * 2 };
      },
    });
    ML.initializeAll();
    assert.ok(leafInitTime !== null && parentInitTime !== null, 'both ran');
    assert.ok(leafInitTime <= parentInitTime, 'leaf must init before parent');
    assert.strictEqual(global.parent2.wrapped, 84);
    delete global.leaf2;
    delete global.parent2;
  });
});

test('initializeAll: detects circular declared deps', () => {
  withFreshRegistry(() => {
    // Eager instantiation can't progress on a cycle (each defers waiting on
    // the other). initializeAll's topo-sort surfaces the cycle explicitly.
    ML.declare({ name: 'cyc_a', deps: ['cyc_b'], provides: ['cyc_a'], init: () => ({}) });
    ML.declare({ name: 'cyc_b', deps: ['cyc_a'], provides: ['cyc_b'], init: () => ({}) });
    assert.throws(() => ML.initializeAll(), /Circular/);
  });
});

test('initializeAll: undeclared dep that ALSO does not exist as global -> error at finalization', () => {
  withFreshRegistry(() => {
    // Eager declare with unresolvable deps defers (no instantiation).
    // initializeAll's final pending check surfaces the unresolved manifest.
    ML.declare({
      name: 'orphan_consumer',
      deps: ['nonexistent_global_xyz_' + Date.now()],
      provides: ['orphan_consumer'],
      init: () => ({}),
    });
    assert.throws(() => ML.initializeAll(), /failed to instantiate/);
  });
});

test('initializeAll: declared module CAN depend on legacy global', () => {
  withFreshRegistry(() => {
    // 'validator' is a legacy global (loaded by utils) that we did NOT declare.
    // The registry should resolve it via globalThis lookup.
    let observedValidator = null;
    ML.declare({
      name: 'legacy_dep_consumer',
      deps: ['validator'],
      provides: ['legacy_dep_consumer'],
      init: (deps) => {
        observedValidator = deps.validator;
        return { ok: true };
      },
    });
    ML.initializeAll();
    assert.ok(observedValidator, 'legacy global validator should resolve via globalThis');
    assert.strictEqual(typeof observedValidator.create, 'function');
    delete global.legacy_dep_consumer;
  });
});

test('override: replaces declared init for testing', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'overridable',
      deps: [],
      provides: ['overridable'],
      init: () => ({ source: 'real' }),
    });
    ML.override('overridable', { source: 'mock' });
    ML.initializeAll();
    assert.strictEqual(global.overridable.source, 'mock', 'override should win over real init');
    delete global.overridable;
  });
});

test('override: dependents see the mock instance', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'dep_root',
      deps: [],
      provides: ['dep_root'],
      init: () => ({ tag: 'real_root' }),
    });
    ML.declare({
      name: 'dep_consumer',
      deps: ['dep_root'],
      provides: ['dep_consumer'],
      init: (deps) => ({ wrapping: deps.dep_root.tag }),
    });
    ML.override('dep_root', { tag: 'mock_root' });
    ML.initializeAll();
    assert.strictEqual(global.dep_consumer.wrapping, 'mock_root',
      'consumer should receive the override, not the real root');
    delete global.dep_root;
    delete global.dep_consumer;
  });
});

test('override: rejected after module is already instantiated', () => {
  withFreshRegistry(() => {
    // Eager declare instantiates immediately; subsequent override is too late.
    ML.declare({
      name: 'already_instantiated',
      deps: [],
      provides: ['already_instantiated'],
      init: () => ({ source: 'real' }),
    });
    assert.ok(global.already_instantiated, 'eager declare should bind global immediately');
    assert.throws(() => ML.override('already_instantiated', {}),
      /cannot override .* after instantiation/);
    delete global.already_instantiated;
  });
});

test('declare: ALLOWED after initializeAll (idempotent re-drain)', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'before_init_all',
      deps: [],
      provides: ['before_init_all'],
      init: () => ({}),
    });
    ML.initializeAll();
    // Eager-instantiation model: declare-after-init is fine; the new manifest
    // just instantiates through the same flow.
    assert.doesNotThrow(() => ML.declare({
      name: 'after_init_all',
      deps: [],
      provides: ['after_init_all'],
      init: () => ({ ok: true }),
    }));
    assert.ok(global.after_init_all);
    delete global.before_init_all;
    delete global.after_init_all;
  });
});

test('initializeAll: idempotent (drain-and-verify; second call is a no-op)', () => {
  withFreshRegistry(() => {
    ML.declare({ name: 'idem_test', deps: [], provides: ['idem_test'], init: () => ({}) });
    ML.initializeAll();
    assert.doesNotThrow(() => ML.initializeAll(), 'second initializeAll should be a no-op');
    delete global.idem_test;
  });
});

test('getDeclared / getInstance: diagnostics on eagerly-instantiated modules', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'diag_a',
      deps: [],
      provides: ['diag_a'],
      init: () => ({ kind: 'a' }),
    });
    ML.declare({
      name: 'diag_b',
      deps: ['diag_a'],
      provides: ['diag_b'],
      init: (deps) => ({ kind: 'b', a: deps.diag_a.kind }),
    });
    const declared = ML.getDeclared();
    assert.ok(declared.includes('diag_a'));
    assert.ok(declared.includes('diag_b'));
    // Eager instantiation: instances are available immediately after declare.
    const instA = ML.getInstance('diag_a');
    const instB = ML.getInstance('diag_b');
    assert.ok(instA && instA.kind === 'a');
    assert.ok(instB && instB.a === 'a');
    delete global.diag_a;
    delete global.diag_b;
  });
});

test('manifest with multiple provides: each global gets bound', () => {
  withFreshRegistry(() => {
    ML.declare({
      name: 'multi_provider',
      deps: [],
      provides: ['multi_provider', 'mp_alias'],
      init: () => ({ shared: 'instance' }),
    });
    ML.initializeAll();
    assert.strictEqual(global.multi_provider, global.mp_alias,
      'both provided names should reference the same instance');
    assert.strictEqual(global.multi_provider.shared, 'instance');
    delete global.multi_provider;
    delete global.mp_alias;
  });
});

test('mixed legacy registerInitializer + declared manifests: shared topo-sort', () => {
  withFreshRegistry(() => {
    let order = [];
    ML.registerInitializer('legacy_first', () => order.push('legacy_first'));
    ML.declare({
      name: 'manifest_after_legacy',
      deps: ['legacy_first'],
      provides: ['manifest_after_legacy'],
      init: () => {
        order.push('manifest_after_legacy');
        return { ok: true };
      },
    });
    ML.initializeAll();
    // Legacy initializer ran first because the declared manifest depends on it.
    assert.deepStrictEqual(order, ['legacy_first', 'manifest_after_legacy']);
    delete global.manifest_after_legacy;
  });
});

test('initializeAll: subsystem/reads/emits metadata is permitted but not required', () => {
  withFreshRegistry(() => {
    assert.doesNotThrow(() => ML.declare({
      name: 'metadata_carrier',
      deps: [],
      provides: ['metadata_carrier'],
      subsystem: 'conductor',
      reads: ['LM.activeLayer'],
      emits: ['L0_TEST_CHANNEL'],
      init: () => ({ ok: true }),
    }));
    ML.initializeAll();
    assert.strictEqual(global.metadata_carrier.ok, true);
    delete global.metadata_carrier;
  });
});
