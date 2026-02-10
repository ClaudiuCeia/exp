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
- `tests/`: Deno tests (`*.test.ts`) using `Deno.test` and `@std/assert`.
- `scripts/`: repo tooling (npm build via `@deno/dnt`).
- `npm/`: generated npm artifact (do not edit by hand; do not commit changes).

## Commands

- `deno task check`: format, lint, and test.
- `deno test`: run tests.
- `deno task build:npm`: build npm package into `npm/`.

## Conventions

- Keep public exports flowing through `mod.ts`.
- Prefer explicit exported types.
- Avoid Bun/Node-only APIs in runtime code.
