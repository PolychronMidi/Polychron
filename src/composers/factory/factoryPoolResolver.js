factoryPoolResolver = {
  /**
   * @param {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} [extraConfig]
   * @param {Object} [composerCtx]
   */
  resolveComposerPoolName(extraConfig = {}, composerCtx = null) {
    if (extraConfig !== undefined && (typeof extraConfig !== 'object' || extraConfig === null)) {
      throw new Error('ComposerFactory.resolveComposerPoolName: extraConfig must be an object if provided');
    }

    const requestedPoolName = /** @type {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} */ (extraConfig).composerPool ?? /** @type {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} */ (extraConfig).profilePool ?? /** @type {{composerPool?:string, profilePool?:string, composerProfilePool?:string}} */ (extraConfig).composerProfilePool;

    const context = Object.assign({}, (composerCtx && typeof composerCtx === 'object') ? composerCtx : {});
    if (!Object.prototype.hasOwnProperty.call(context, 'sectionIndex')) {
      context.sectionIndex = sectionIndex;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'phraseIndex')) {
      context.phraseIndex = phraseIndex;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'measureIndex')) {
      context.measureIndex = measureIndex;
    }

    if (typeof selectComposerPoolOrFail === 'function') {
      return selectComposerPoolOrFail({ requestedPoolName, context });
    }

    if (requestedPoolName !== undefined && requestedPoolName !== null) {
      if (typeof requestedPoolName !== 'string' || requestedPoolName.length === 0) {
        throw new Error('ComposerFactory.resolveComposerPoolName: configured pool name must be a non-empty string');
      }
      return requestedPoolName;
    }

    return 'default';
  }
};
