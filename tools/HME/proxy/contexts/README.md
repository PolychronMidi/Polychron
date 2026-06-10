# `proxy/contexts/<context>/index.js`

Each subdirectory in `contexts/` is the **single fa?ade** for a bounded
context declared in `doc/self-coherence-full.md#hme-proxy-bounded-contexts`. New code outside that
context should depend on `./contexts/<name>` only, never on the
context's internal helper files.

Today the fa?ades re-export from the existing flat-namespace modules in
`proxy/*`. As internals stabilize, files will move physically under the
context directory and the fa?ade re-exports become local requires.

## Conventions

- One `index.js` per context, listing the public surface.
- Fa?ade imports go through relative paths so file moves stay
  mechanical.
- No business logic in the fa?ade -- just re-exports.
- Tests can stub a whole context by replacing the fa?ade module in
  `require.cache`.

See `doc/self-coherence-full.md#hme-proxy-bounded-contexts` for the full context registry.
