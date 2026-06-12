'use strict';
const { emit } = require('../proxy/shared');

function emitOmo(event, fields = {}, sink) {
  const payload = { event, ...fields };
  if (typeof sink === 'function') sink(payload);
  emit(payload);
  return payload;
}

module.exports = { emitOmo };
