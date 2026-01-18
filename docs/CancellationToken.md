# CancellationToken (src/CancellationToken.ts)

- Source: ../src/CancellationToken.ts
- Area: Cancellation primitives for async composition flows.

## Overview
Provides `CancellationTokenSource` and token interface used to cancel long-running or staged operations safely across modules.

## Key Exports
- CancellationTokenSource
- CancellationToken (interface)

## Usage
```ts
import { CancellationTokenSource } from '../src/CancellationToken';
const source = new CancellationTokenSource();
const token = source.token;
// pass token into async flows
```

## Integration Notes
- Used by async play engine and progress reporting modules.
- Ensure consumers call `throwIfRequested()` periodically.

## Tests
- test/CancellationToken.test.ts
- test/async.test.ts

## Related (old docs)
- docs_old/play.md

## Changelog
- TODO
