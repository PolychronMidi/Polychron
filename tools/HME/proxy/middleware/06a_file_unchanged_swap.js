'use strict';

const { swapFileUnchanged } = require('../file_unchanged_swap');

module.exports = {
  name: 'file_unchanged_swap',
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.messages)) return;
    const swaps = swapFileUnchanged(payload.messages);
    if (swaps > 0 && ctx && typeof ctx.markDirty === 'function') ctx.markDirty();
  },
};
