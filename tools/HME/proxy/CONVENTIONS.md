## Proxy module conventions

### Imports: require from source, not barrels

Every `require()` in the proxy must import directly from the source module file,
never from a directory `index.js` barrel re-export — unless you are the
top-level entry point (`hme_proxy.js`, `hme_proxy_core.js`).

```js
// DO: import from the specific source file
const { markRouteCooldown } = require('./contexts/failure_policy/model_route_health');

// DON'T: import from a barrel that re-exports everything
const { markRouteCooldown } = require('./contexts/failure_policy');
```

**Why:** Barrel files pull in every transitive dependency of every sub-module
they re-export. A single `require('./contexts/failure_policy')` loads
`omni_failure_policy`, `hme_proxy_upstream_failure`, `hme_proxy_codex`,
`failure_classification`, `hme_proxy_connection_errors`, and `model_route_health`
— and `hme_proxy_connection_errors` in turn pulls in `response_transform`, which
pulls in `hme_proxy_anthropic_response`, which pulls in `overdrive_route`.
Importing the barrel from `overdrive_route` creates a circular chain.

### Lazy requires are allowed if documented

```js
function someHandler(...args) {
  const { helper } = require('./expensive_module');
  return helper(...args);
}
```

Lazy requires inside function bodies break import-time cycles. They are benign
as long as the module is never required at the top level of a cycle participant.

### Detecting violations

```bash
# Check for new circular dependencies (compares against baseline)
npm run hme:circular

# Run the import-sanity test (catches undefined-from-cycle imports)
npm run test:hme -- --test-name-pattern="no circular dependency"

# Update the baseline if you've resolved a known cycle
npm run hme:circular  # auto-updates baseline on resolution
```

### The baseline

`tools/HME/tests/fixtures/circular-baseline.txt` tracks the two known-benign
cycles (both use lazy requires to break import-time chains). Any new cycle
detected at import time will fail CI.
