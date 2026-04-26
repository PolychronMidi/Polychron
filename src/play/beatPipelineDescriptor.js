// beatPipelineDescriptor.js - Declarative stage graph for processBeat.
// Each stage declares its name, what it depends on (after), and what it produces.
// Boot-time validation asserts the execution order in processBeat is a valid
// topological ordering of this graph - if a stage runs before its dependency,
// the build fails immediately rather than producing subtle timing bugs.

/**
 * @typedef {{ name: string, after: string[], produces: string[] }} BeatPipelineStage
 */

moduleLifecycle.declare({
  name: 'beatPipelineDescriptor',
  subsystem: 'play',
  deps: [],
  provides: ['beatPipelineDescriptor'],
  init: () => {

  /** @type {readonly BeatPipelineStage[]} */
  const STAGES = Object.freeze([
    { name: 'beat-setup',
      after: [],
      produces: ['absoluteSeconds', 'fxStereoPan', 'fxVelocityShift'] },

    { name: 'intent',
      after: ['beat-setup'],
      produces: ['clIntent'] },

    { name: 'entropy',
      after: ['intent'],
      produces: ['clEntropy'] },

    { name: 'phase',
      after: ['beat-setup'],
      produces: ['clPhase'] },

    { name: 'climax',
      after: ['beat-setup'],
      produces: ['clClimaxMods'] },

    { name: 'envelope',
      after: ['beat-setup'],
      produces: [] },

    { name: 'silhouette',
      after: ['beat-setup'],
      produces: ['clSilhouetteCorrections'] },

    { name: 'rest',
      after: ['intent'],
      produces: ['clRest', 'clComplementRest'] },

    { name: 'complement',
      after: ['beat-setup'],
      produces: [] },

    { name: 'tension-cadence',
      after: ['beat-setup'],
      produces: ['clTension', 'clCadence'] },

    { name: 'negotiation',
      after: ['intent', 'entropy', 'phase', 'tension-cadence'],
      produces: [] },

    { name: 'probability-adjust',
      after: ['negotiation', 'climax', 'silhouette', 'rest'],
      produces: [] },

    { name: 'emission',
      after: ['probability-adjust'],
      produces: [] },

    { name: 'post-beat',
      after: ['emission', 'rest'],
      produces: [] }
  ]);

  /**
   * Validate that STAGES is a valid topological ordering of its own dependency graph.
   * Throws immediately if any stage appears before a declared dependency.
   * Called once at boot by mainBootstrap.
   */
  function assertTopologicalOrder() {
    const seen = new Set();
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      for (let j = 0; j < stage.after.length; j++) {
        if (!seen.has(stage.after[j])) {
          throw new Error(
            `beatPipelineDescriptor: stage "${stage.name}" depends on "${stage.after[j]}" ` +
            `which has not appeared earlier in the pipeline`
          );
        }
      }
      seen.add(stage.name);
    }
  }

  /** @returns {readonly BeatPipelineStage[]} frozen stage array */
  function getStages() { return STAGES; }

  /** @returns {string[]} ordered stage names */
  function getStageNames() { return STAGES.map(s => s.name); }

  return { getStages, getStageNames, assertTopologicalOrder };
  },
});
