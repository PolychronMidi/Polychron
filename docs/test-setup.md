# test-setup.ts

Purpose: Mutes noisy console output during automated test runs to keep test output focused and prevent CPU/log overloads during traceroutes. The file is intentionally small and is loaded via Vitest `setupFiles` so it runs before tests.

Notes:
- The file stores original console functions as `console._origLog`, `console._origError`, etc., so they can be restored if needed.
- This file is intentionally included in source and has a corresponding test to satisfy project code-quality checks.
