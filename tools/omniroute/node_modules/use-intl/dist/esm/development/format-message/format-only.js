const a$1 = 0,
  s = 1,
  c$1 = 2,
  e = 3,
  o = 4,
  t = 5,
  b = 6;

function f(t, r, n = {}, e) {
  if ("string" == typeof t) return t;
  return g(i(t, r, n, e, void 0));
}
function i(t, r, n, e, o) {
  const u = [];
  for (const s of t) {
    const t = a(s, r, n, e, o);
    Array.isArray(t) ? u.push(...t) : u.push(t);
  }
  return u;
}
function a(f, a, y, d, h) {
  if ("string" == typeof f) return f;
  if (f === a$1) {
    const t = h;
    return d.formatters.getNumberFormat(t.locale).format(t.value);
  }
  const [b$1, v, ...A] = f;
  if (void 0 === v) {
    const t = c(y, b$1);
    return String(t);
  }
  if ("number" != typeof v || v === a$1) return function (t, r, n, e, o, u) {
    const s = c(e, t),
      f = s,
      a = i(r, n, e, o, u),
      m = g(a),
      l = Array.isArray(m) ? m : [m];
    return f(l);
  }(b$1, [v, ...A], a, y, d, h);
  switch (v) {
    case s:
      return function (t, r, n, e, o, u) {
        const s = String(c(e, t)),
          f = r[s] ?? r.other;
        return l(f, n, e, o, u);
      }(b$1, A[0], a, y, d, h);
    case c$1:
      return m(b$1, A[0], a, y, d, "cardinal");
    case e:
      return m(b$1, A[0], a, y, d, "ordinal");
    case o:
      return function (t, r, n, e, o) {
        const u = c(e, t),
          s = u,
          f = function (t, r) {
            if (!t) return;
            if ("string" == typeof t) return r.formats?.number?.[t] ? r.formats.number[t] : void 0;
            return t;
          }(r, o);
        return o.formatters.getNumberFormat(n, f).format(s);
      }(b$1, A[0], a, y, d);
    case t:
      return p(b$1, A[0], a, y, d);
    case b:
      return p(b$1, A[0], a, y, d);
    default:
      return "";
  }
}
function c(t, r) {
  return t[r];
}
function m(t, r, n, e, o, u) {
  const s = c(e, t),
    f = `=${s}`;
  if (f in r) return l(r[f], n, e, o, {
    value: s,
    locale: n
  });
  return l(r[o.formatters.getPluralRules(n, {
    type: u
  }).select(s)] ?? r.other, n, e, o, {
    value: s,
    locale: n
  });
}
function l(r, n, e, o, u) {
  return "string" == typeof r ? r : r === a$1 ? a(r, n, e, o, u) : i(r, n, e, o, u);
}
function p(t, r, n, e, o, u) {
  const s = c(e, t),
    f = function (t, r, n) {
      if (!t) return;
      if ("string" == typeof t) {
        const r = n.formats?.dateTime?.[t];
        return r;
      }
      return t;
    }(r, 0, o),
    i = {
      ...f,
      timeZone: f?.timeZone ?? o.timeZone
    };
  return o.formatters.getDateTimeFormat(n, i).format(s);
}
function g(t) {
  if (0 === t.length) return "";
  const r = [];
  let n = "";
  for (const e of t) "string" == typeof e ? n += e : (n && (r.push(n), n = ""), r.push(e));
  return n && r.push(n), 1 === r.length ? r[0] : r;
}

/**
 * Formats a precompiled ICU message using icu-minify/format.
 * This implementation requires messages to be precompiled at build time.
 */
function formatMessage(/** The precompiled ICU message (CompiledMessage from icu-minify) */
...[, message, values, options]) {
  const {
    formats,
    globalFormats,
    locale,
    ...rest
  } = options;
  const result = f(message, locale, values, {
    formats: {
      dateTime: {
        ...globalFormats?.dateTime,
        ...formats?.dateTime
      },
      number: {
        ...globalFormats?.number,
        ...formats?.number
      }
    },
    ...rest
  });
  return result;
}

// `t.raw` is not supported
formatMessage.raw = false;

export { formatMessage as default };
