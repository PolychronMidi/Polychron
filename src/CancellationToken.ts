// CancellationToken.ts - Cancellation support for async operations

export interface CancellationToken {
  isCancelled: boolean;
  throwIfRequested(): void;
}

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
