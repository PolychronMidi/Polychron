import * as vscode from "vscode";

/**
 * Manages an optional side-by-side VS Code terminal running `claude` directly.
 * The hidden node-pty session handles chat rendering independently — this is
 * purely a user-visible companion view, not part of the stream pipeline.
 */
export class MirrorTerminal {
  private _enabled = false;
  private _terminal: vscode.Terminal | undefined;

  constructor(private readonly projectRoot: string) {}

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean, model: string, effort: string): void {
    this._enabled = enabled;
    if (enabled) this._ensure(model, effort);
  }

  private _ensure(model: string, effort: string): void {
    if (this._terminal && !this._terminal.exitStatus) {
      this._terminal.show(true);
      return;
    }
    const args = ["--model", model, "--effort", effort, "--permission-mode", "bypassPermissions"];
    this._terminal = vscode.window.createTerminal({
      name: "HME Claude",
      shellPath: "claude",
      shellArgs: args,
      cwd: this.projectRoot,
    });
    this._terminal.show(true);
  }
}
