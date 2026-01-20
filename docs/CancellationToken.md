# CancellationToken.ts - Cooperative Cancellation for Async Operations

> **Status**: Utility  
> **Dependencies**: None


## Overview

`CancellationToken.ts` provides a lightweight, cooperative cancellation mechanism for long-running or asynchronous operations. It enables callers to request cancellation and callee code to check and respond without forcing abrupt termination.

**Core Responsibilities:**
- `CancellationToken` interface exposing `isCancelled` and `throwIfRequested()`
- `CancellationTokenSource` for creating and controlling a token
- Safe propagation of cancellation request across layers

## Architecture Role

- Used by orchestration flows like play.ts ([code](../src/play.ts)) ([doc](play.md)) to allow graceful early exit
- Can be threaded through composers, stage, and writers to stop work promptly when requested

---

## API

### `interface CancellationToken`

A read-only view to query cancellation state and fail fast when needed.

**Properties:**
- `isCancelled: boolean` - True once cancellation is requested

**Methods:**
- `throwIfRequested(): void` - Throws `Error('Operation was cancelled')` if cancelled

<!-- BEGIN: snippet:CancellationToken -->

```typescript
export interface CancellationToken {
  isCancelled: boolean;
  throwIfRequested(): void;
}
```

<!-- END: snippet:CancellationToken -->

### `class CancellationTokenSource`

Creates and controls a `CancellationToken`. The token reflects internal `_cancelled` state via a getter.

**Methods:**
- `get token(): CancellationToken` - Current token view
- `cancel(): void` - Request cancellation
- `reset(): void` - Clear cancellation state

<!-- BEGIN: snippet:CancellationTokenSource -->

```typescript
export class CancellationTokenSource {
  private _cancelled: boolean = false;
  private _token: CancellationToken;

  constructor() {
    // Create token once that dynamically reflects cancellation state
    const self = this;
    this._token = {
      get isCancelled() {
        return self._cancelled;
      },
      throwIfRequested() {
        if (self._cancelled) {
          throw new Error('Operation was cancelled');
        }
      }
    };
  }

  get token(): CancellationToken {
    return this._token;
  }

  cancel(): void {
    this._cancelled = true;
  }

  reset(): void {
    this._cancelled = false;
  }
}
```

<!-- END: snippet:CancellationTokenSource -->

#### `cancel()`

Requests cancellation. Subsequent token checks will observe `isCancelled = true` and `throwIfRequested()` will throw.

<!-- BEGIN: snippet:CancellationTokenSource_cancel -->

```typescript
cancel(): void {
    this._cancelled = true;
  }
```

<!-- END: snippet:CancellationTokenSource_cancel -->

#### `reset()`

Clears the cancellation state, making the token reusable in controlled scenarios.

<!-- BEGIN: snippet:CancellationTokenSource_reset -->

```typescript
reset(): void {
    this._cancelled = false;
  }
```

<!-- END: snippet:CancellationTokenSource_reset -->

#### `token`

Provides a `CancellationToken` view. Consumers should not mutate; they only check `isCancelled` or call `throwIfRequested()`.

<!-- BEGIN: snippet:CancellationTokenSource_token -->

```typescript
get token(): CancellationToken {
    return this._token;
  }
```

<!-- END: snippet:CancellationTokenSource_token -->

---

## Usage Example

```typescript
import { CancellationTokenSource } from '../src/CancellationToken';

async function doWork(token: CancellationToken) {
  for (let i = 0; i < 100; i++) {
    token.throwIfRequested();
    await step(i);
  }
}

const source = new CancellationTokenSource();
const p = doWork(source.token);
// Later
source.cancel();
await p.catch(err => console.log(err.message));
```

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Orchestration flow that accepts cancellation
- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Downstream processing that can cooperatively check cancellation
- writer.ts ([code](../src/writer.ts)) ([doc](writer.md)) - Output generation that can be cancelled gracefully

