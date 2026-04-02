// scripts/eslint-rules/no-unregistered-feedback-loop.js
// Architectural boundary enforcement: ensures every manual feedback loop
// creation is accompanied by a feedbackRegistry.registerLoop() call.
//
// closedLoopController.create() auto-registers with feedbackRegistry
// internally (passing sourceDomain + targetDomain), so files that only
// use closedLoopController are NOT flagged.
//
// This rule catches the rarer case where code calls feedbackRegistry or
// creates raw feedback loops outside the closedLoopController factory
// without registering them.

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every raw feedback loop to register with feedbackRegistry. ' +
        'closedLoopController.create() auto-registers, so it is always allowed.'
    },
    schema: []
  },
  create(context) {
    const filename = context.getFilename();
    const normalized = filename.replace(/\\/g, '/');

    // The factory itself handles registration internally
    if (normalized.includes('src/utils/closedLoopController.js')) return {};

    // Only enforce in src/
    if (!normalized.includes('src/')) return {};

    let hasControllerCreate = false;
    let hasFeedbackRegister = false;
    let hasRawLoopCreation = false;
    const rawLoopNodes = [];

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || obj.type !== 'Identifier') return;
        const methodName = (prop && prop.type === 'Identifier') ? prop.name : null;

        // closedLoopController.create() auto-registers -- always safe
        if (obj.name === 'closedLoopController' && methodName === 'create') {
          hasControllerCreate = true;
        }

        if (obj.name === 'feedbackRegistry' && methodName === 'registerLoop') {
          hasFeedbackRegister = true;
        }

        // Detect manual/raw feedback loop patterns that bypass closedLoopController:
        // e.g. feedbackRegistry.getResonanceDampening() used without registerLoop()
        if (obj.name === 'feedbackRegistry' && methodName === 'getResonanceDampening') {
          hasRawLoopCreation = true;
          rawLoopNodes.push(node);
        }
      },

      'Program:exit'() {
        // If file only uses closedLoopController.create(), that auto-registers -- no error.
        // Only flag files with raw feedback loop access that lack registration.
        if (hasRawLoopCreation && !hasFeedbackRegister && !hasControllerCreate) {
          for (const node of rawLoopNodes) {
            context.report({
              node,
              message:
                'Feedback loop boundary: feedbackRegistry access detected without ' +
                'feedbackRegistry.registerLoop() or closedLoopController.create() in this file. ' +
                'All feedback loops must register with feedbackRegistry to prevent catastrophic resonance.'
            });
          }
        }
      }
    };
  }
};
