factoryPoolResolver = {
  resolveComposerPoolName(extraConfig = {}, composerCtx = null) {
    if (extraConfig !== undefined && (typeof extraConfig !== 'object' || extraConfig === null)) {
      throw new Error('ComposerFactory.resolveComposerPoolName: extraConfig must be an object if provided');
    }

    const requestedPoolName = extraConfig.composerPool ?? extraConfig.profilePool ?? extraConfig.composerProfilePool;

    const context = Object.assign({}, (composerCtx && typeof composerCtx === 'object') ? composerCtx : {});
    if (!Object.prototype.hasOwnProperty.call(context, 'sectionIndex')) {
      context.sectionIndex = (typeof sectionIndex === 'number') ? sectionIndex : null;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'phraseIndex')) {
      context.phraseIndex = (typeof phraseIndex === 'number') ? phraseIndex : null;
    }
    if (!Object.prototype.hasOwnProperty.call(context, 'measureIndex')) {
      context.measureIndex = (typeof measureIndex === 'number') ? measureIndex : null;
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
