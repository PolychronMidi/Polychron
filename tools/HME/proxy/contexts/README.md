# `proxy/contexts/<context>/index.js`

Each subdirectory in `contexts/` is the **single façade** for a bounded
context declared in `doc/PROXY_CONTEXTS.md`. New code outside that
context should depend on `./contexts/<name>` only, never on the
context's internal helper files.

Today the façades re-export from the existing flat-namespace modules in
`proxy/*`. As internals stabilize, files will move physically under the
context directory and the façade re-exports become local requires.

## Conventions

- One `index.js` per context, listing the public surface.
- Façade imports go through relative paths so file moves stay
  mechanical.
- No business logic in the façade -- just re-exports.
- Tests can stub a whole context by replacing the façade module in
  `require.cache`.

See `doc/PROXY_CONTEXTS.md` for the full context registry.
