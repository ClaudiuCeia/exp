# exp

Expression language toolkit for TypeScript/JavaScript.

## Goals

- Parse a documented expression grammar into a typed AST with source spans.
- Evaluate expressions against an explicit environment and fixed standard library.
- Keep parser, runtime-value, and interpreter limits explicit.
- Treat environment functions as trusted host code.
- Use Bun for development while retaining Node npm + Deno JSR compatibility.
- Keep runtime and security claims aligned with CI and the implementation.

## Project Structure

- `mod.ts`: public entrypoint (re-export library surface).
- `src/`: implementation.
- `tests/`: Bun tests (`*.test.ts`) using `bun:test`.
- `scripts/`: repository tooling.
- `dist/`: generated npm artifact (do not edit by hand; do not commit changes).
- `deno.json`: JSR package metadata and Deno import mapping only.

## Commands

- `bun run check`: format, lint, type-check, test, presentation, and benchmark checks.
- `bun run test`: run tests.
- `bun run build`: build the npm package into `dist/`.
- `bun run package:check`: build and validate npm package metadata and types.

## Conventions

- Keep public exports flowing through `mod.ts`.
- Prefer explicit exported types.
- Keep Bun/Node-only APIs out of `src/`; the core remains runtime-neutral.
