# exp

Expression language toolkit for TypeScript/JavaScript.

## Goals

- Small, dependency-light core.
- Runs anywhere JS runs (Deno, Node, browsers).
- Deterministic parsing and evaluation (no `eval`, no `new Function`).
- Great diagnostics (spans + line/column + caret snippets).
- Safe-by-default evaluation with explicit allow-lists and resource budgets.

## Project Structure

- `mod.ts`: public entrypoint (re-export library surface).
- `src/`: implementation.
- `tests/`: Bun tests (`*.test.ts`) using `bun:test`.
- `scripts/`: repository tooling.
- `dist/`: generated npm artifact (do not edit by hand; do not commit changes).
- `deno.json`: JSR package metadata and Deno import mapping only.

## Commands

- `bun run check`: format check, lint, type-check, and test.
- `bun run test`: run tests.
- `bun run build`: build the npm package into `dist/`.
- `bun run package:check`: build and validate npm package metadata and types.

## Conventions

- Keep public exports flowing through `mod.ts`.
- Prefer explicit exported types.
- Keep Bun/Node-only APIs out of `src/`; the core remains runtime-neutral.
