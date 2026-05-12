"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.genNoMotionStyle = void 0;
const genNoMotionStyle = () => {
  return {
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      animation: 'none'
    }
  };
};
exports.genNoMotionStyle = genNoMotionStyle;