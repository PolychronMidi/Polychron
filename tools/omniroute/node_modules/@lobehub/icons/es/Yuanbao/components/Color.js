'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["size", "style"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { memo } from 'react';
import { TITLE } from "../style";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var Icon = /*#__PURE__*/memo(function (_ref) {
  var _ref$size = _ref.size,
    size = _ref$size === void 0 ? '1em' : _ref$size,
    style = _ref.style,
    rest = _objectWithoutProperties(_ref, _excluded);
  return /*#__PURE__*/_jsxs("svg", _objectSpread(_objectSpread({
    height: size,
    style: _objectSpread({
      flex: 'none',
      lineHeight: 1
    }, style),
    viewBox: "0 0 24 24",
    width: size,
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M11.988 23.968c6.612 0 11.972-5.361 11.972-11.974S18.6.021 11.988.021C5.376.02.016 5.38.016 11.994s5.36 11.974 11.972 11.974z",
      fill: "#E5FFE7"
    }), /*#__PURE__*/_jsx("path", {
      d: "M17.281 14.715s-3.273 9.93-15.24 3.982c0 0 3.26 5.434 10.249 5.275l9.48-8.489-4.489-.77v.002z",
      fill: "#8FF793"
    }), /*#__PURE__*/_jsx("path", {
      d: "M21.64 4.9c-1.93-2.377-5.41-2.94-8.006-1.208a5.991 5.991 0 00-1.65 8.311 5.995 5.995 0 01-2.785 8.909 5.93 5.93 0 01-6.457-1.356 6.123 6.123 0 01-.886-1.152C-1.606 12.932-.097 5.663 5.32 2.044a11.936 11.936 0 0116.318 2.855h.003z",
      fill: "#38CF6F"
    }), /*#__PURE__*/_jsx("path", {
      d: "M23.75 9.66a12.77 12.77 0 00-.733-2.356c-.77-1.64-2.841-2.378-4.57-1.452-1.156.622-1.847 1.884-1.691 3.187.017.127.045.274.072.394.25.732.43 1.51.525 2.328a10.718 10.718 0 01-5.548 10.658c-.998.538-2.025.91-3.055 1.121 3.19.898 6.76.538 9.92-1.586 4.013-2.698 6.072-7.563 5.086-12.296h-.003l-.002.003z",
      fill: "#38CF6F"
    })]
  }));
});
export default Icon;