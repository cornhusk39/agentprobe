# Contributing

Thanks for taking a look. A few conventions keep this codebase consistent.

## Layout

This is a pnpm workspace.

- `packages/core` is the engine. It stays framework-free: no Next, no React, no
  CLI concerns, so it can be extracted and reused on its own. Depend only on
  small libraries (zod, better-sqlite3, the Anthropic SDK).
- `packages/cli` is the command line entry point. It composes core.
- `packages/web` is the Next.js (App Router) dashboard. It reads the SQLite
  database core writes through the public store API, never core internals.
- `examples/` holds the reference agent, its suite, and committed cassettes.

## Style

- Comments explain *why*, not *what*, in plain language. If a line of code is
  clear, it gets no comment. A comment earns its place by explaining a decision,
  a tradeoff, or a non-obvious constraint.
- TypeScript strict. Prefer `unknown` plus a Zod parse at boundaries over `any`.
- Conventional commits, one logical unit per commit. The history is meant to be
  read.
- Tests live alongside features and stay green. A feature without a test is not
  done.

## Security

- Secrets live in env only. `.env` is gitignored; `.env.example` is committed.
- The gitleaks pre-commit hook runs on every commit and must pass. Enable it
  once with `git config core.hooksPath .githooks`.
- Cassettes are redacted at capture time. A cassette that fails the redaction
  check is never written.
- Agent output is treated as data, never as instructions, especially in the
  judge prompt.

## Verifying a change

```sh
pnpm test         # vitest across packages
pnpm typecheck
pnpm lint
./publish-gate.sh # the full gate, including a secret scan
```
