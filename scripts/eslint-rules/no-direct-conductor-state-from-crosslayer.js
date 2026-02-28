// scripts/eslint-rules/no-direct-conductor-state-from-crosslayer.js
// Architectural boundary enforcement: cross-layer modules must read conductor
// signals through conductorSignalBridge, never directly from conductorState
// or signalReader. This preserves the beat-delayed firewall that prevents
// microscopic layer interplay from polluting macroscopic composition trajectories.
//
// Exempt: src/crossLayer/conductorSignalBridge.js (the bridge itself)

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that cross-layer modules read conductor signals through ' +
        'conductorSignalBridge, not directly from conductorState or signalReader.'
    },
    schema: []
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');

    // Only enforce inside src/crossLayer/
    if (!filename.includes('src/crossLayer/')) return {};

    // The bridge itself is exempt
    if (filename.includes('conductorSignalBridge.js')) return {};

    const BANNED_OBJECTS = new Set(['conductorState']);

    return {
      MemberExpression(node) {
        const obj = node.object;
        if (!obj || obj.type !== 'Identifier') return;

        if (BANNED_OBJECTS.has(obj.name)) {
          context.report({
            node,
            message:
              `Signal firewall: cross-layer modules must read conductor signals through ` +
              `conductorSignalBridge, not directly from ${obj.name}. ` +
              `Use conductorSignalBridge.get() or conductorSignalBridge.getCached() instead.`
          });
        }
      }
    };
  }
};
