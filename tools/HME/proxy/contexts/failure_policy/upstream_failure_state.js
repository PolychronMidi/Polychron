'use strict';

const { recordUpstreamSuccess } = require('../upstream_dispatch');

function recordSuccessAndReset({ getConsecutive429s, setConsecutive429s }) {
  recordUpstreamSuccess();
  if (getConsecutive429s() > 0) {
    console.error(`success -- resetting panic-shrink counter (was ${getConsecutive429s()})`);
    setConsecutive429s(0);
  }
}

module.exports = { recordSuccessAndReset };
