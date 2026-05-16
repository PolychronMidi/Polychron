// scripts/eslint-rules/no-direct-buffer-push-from-crosslayer.js
// Architectural boundary enforcement: cross-layer modules must not push MIDI
// events directly to buffers. All MIDI emissions must go through
// crossLayerEmissionGateway.emit() for attribution and density tracking.
// Only crossLayerEmissionGateway.js itself is exempt.

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that cross-layer modules do not push MIDI events directly to buffers. ' +
        'All cross-layer MIDI emissions must route through crossLayerEmissionGateway.emit(). ' +
        'crossLayerEmissionGateway.js itself is exempt.'
    },
    schema: []
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');

    // Only enforce inside src/crossLayer/
    if (!filename.includes('src/crossLayer/')) return {};

    // Exempt the gateway itself - it contains the canonical buffer.push()
    if (filename.endsWith('crossLayerEmissionGateway.js')) return {};

    // Known buffer push functions
    const PUSH_FUNCTIONS = new Set(['p', 'pushMultiple']);

    return {
      // Ban: p(buffer, event) or pushMultiple(buffer, event)
      CallExpression(node) {
        const callee = node.callee;
        if (!callee) return;

        // Direct call: p(c, event)
        if (callee.type === 'Identifier' && PUSH_FUNCTIONS.has(callee.name)) {
          context.report({
            node,
            message:
              'Architectural boundary: cross-layer modules must not call ' +
              callee.name + '() directly to push MIDI events. ' +
              'Use crossLayerEmissionGateway.emit(sourceModule, buffer, event) instead.'
          });
          return;
        }

        // Member call: buffer.push(event) where buffer is a parameter named c
        if (callee.type === 'MemberExpression') {
          const obj = callee.object;
          const prop = callee.property;
          if (obj && obj.type === 'Identifier' && obj.name === 'c' &&
              prop && prop.type === 'Identifier' && prop.name === 'push') {
            context.report({
              node,
              message:
                'Architectural boundary: cross-layer modules must not call c.push() ' +
                'to emit MIDI events directly. ' +
                'Use crossLayerEmissionGateway.emit(sourceModule, buffer, event) instead.'
            });
          }
        }
      }
    };
  }
};
