const V = Validator.create('factoryPoolResolver');

factoryPoolResolver = {
  /**
   * @param {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} [extraConfig]
   * @param {Object} [composerCtx]
   */
  resolveComposerPoolName(extraConfig = {}, composerCtx = null) {
    if (extraConfig !== undefined) V.assertObject(extraConfig, 'extraConfig');

    const requestedPoolName = /** @type {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} */ (extraConfig).composerPool ?? /** @type {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} */ (extraConfig).profilePool ?? /** @type {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} */ (extraConfig).composerProfilePool;

    if (composerCtx !== null) V.assertObject(composerCtx, 'composerCtx');
    const context = Object.assign({}, composerCtx || {});
    if (!Object.prototype.hasOwnProperty.call(context, 'sectionIndex')) {
      context.sectionIndex = sectionIndex;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'phraseIndex')) {
      context.phraseIndex = phraseIndex;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'measureIndex')) {
      context.measureIndex = measureIndex;
    }

    if (selectComposerPoolOrFail) {
      V.requireType(selectComposerPoolOrFail, 'function', 'selectComposerPoolOrFail');
      return selectComposerPoolOrFail({ requestedPoolName, context });
    }

    if (requestedPoolName !== undefined && requestedPoolName !== null) {
      V.assertNonEmptyString(requestedPoolName, 'requestedPoolName');
      return requestedPoolName;
    }

    return 'default';
  }
};
