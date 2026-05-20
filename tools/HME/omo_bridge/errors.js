'use strict';

class OmoBridgeError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'OmoBridgeError';
    this.fields = fields;
  }
}

module.exports = { OmoBridgeError };
