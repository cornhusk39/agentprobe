# AgentProbe

A regression safety net for LLM agents.

Change a prompt, swap a model, or bump a dependency, and you usually find out
something broke from a user, not from CI. AgentProbe treats agent runs like a
test suite: it records each run as a cassette (the full trace), replays those
cassettes deterministically on every change, scores them with deterministic
assertions and an LLM judge, and fails the build when quality, cost, or latency
regress against a saved baseline.

This README grows into a full case study at M7. For now, see:

- [SPEC.md](./SPEC.md) for the v1 specification (added during the build).
- [DISCOVERY.md](./DISCOVERY.md) for the ground-truth findings and milestone plan.
- [CLAUDE.md](./CLAUDE.md) for the working agreement and style rules.

## Status

Under construction, milestone by milestone (M1 to M7). Private repo. Not for
publication until a human review at the final gate.

## Layout

- `packages/core` the framework-free engine (agent interface, recorder, replay,
  assertions, judge, persistence, regression diff).
- `packages/cli` the command line entry point (added at a later milestone).
- `packages/web` the Next.js dashboard (added at a later milestone).
- `examples/` the reference agent, suites, and seeded cassettes (later milestone).

## Develop

```sh
pnpm install
pnpm test        # vitest across packages
pnpm typecheck
pnpm lint
```
