# exp

A small expression language toolkit: parse expressions, get a typed AST with
spans, and evaluate safely.

```ts
import { evaluateExpression } from "jsr:@claudiu-ceia/exp";

const res = evaluateExpression('status == "open" && priority >= 3', {
  env: { status: "open", priority: 4 },
  throwOnError: false,
});

if (res.success) {
  console.log(res.value); // true
}
```

## Overview

**exp** is a tiny, deterministic expression parser + evaluator intended for
"mini-language" use cases:

- API-rich filters (`status == "open" && priority >= 3`)
- data-wrangling pipelines (`input |> map(...) |> filter(...)`)
- backtesting strategies (signals, conditions, thresholds) in a constrained DSL

Design goals:

- **No `eval` / `new Function`** — all evaluation is interpreter-based.
- **Typed AST + spans** — nodes carry `{ start, end }` indices for diagnostics.
- **Safe-by-default access** — expressions only touch data/functions you place
  in `env`.
- **Budgeted evaluation** — max steps, recursion depth, and array literal size.

## Documentation

- [Installation](#installation)
- [Getting started](#getting-started)
- [Supported syntax](#supported-syntax-today)
  - [Equality semantics (`==` / `!=`)](#equality-semantics--)
- [Safe evaluation model](#safe-evaluation-model)
  - [`env` and runtime values](#env-and-runtime-values)
  - [Member access restrictions](#member-access-restrictions)
  - [Resource budgets](#resource-budgets)
- [API reference](#api-reference)
- [Errors and diagnostics](#errors-and-diagnostics)
- [CLI](#cli)
- [Development](#development)
- [License](#license)

## Why

The expression language is intentionally small, but ergonomic enough for real
application DSLs.

## Non-goals

- Full JavaScript parsing.
- Executing untrusted code via `eval` / `new Function`.

## Supported syntax (today)

Expressions:

- literals: numbers, strings, `true`, `false`, `null`
- identifiers: `[A-Za-z_]` followed by `[A-Za-z0-9_]*` (with `true/false/null`
  reserved)
- arrays: `[expr, expr, ...]`
- grouping: `(expr)`
- postfix chaining: `expr.ident` and `expr(arg1, arg2, ...)` (chainable)
- unary: `!`, `+`, `-`
- binary (with precedence): `* / %`, `+ -`, `< <= > >=`, `== !=`, `&& ||`
- conditional: `test ? consequent : alternate`
- pipeline: `lhs |> fn` and `lhs |> fn(arg1, arg2, ...)` (desugars to `fn(lhs)`
  / `fn(lhs, ...)`)

### Equality semantics (`==` / `!=`)

Equality is intentionally **JS-like for primitives**, but **never coerces
objects/arrays/functions** via implicit `ToPrimitive` (so no surprise
`toString()` / `valueOf()` calls).

- Primitives: loosely coerced similar to JavaScript
  - `null == undefined` is `true`
  - booleans coerce to numbers (`true` → `1`, `false` → `0`)
  - strings and numbers may coerce via `Number(...)`
- Non-primitives (plain objects, arrays, functions): **reference equality only**
  - `user == user` can be `true`
  - `user == "[object Object]"` is `false` (no coercion)

String literals:

- single or double quotes
- ECMAScript-oriented escape semantics (see `src/string_literal.ts` for tc39
  links)
- strict-mode-style failures for digit/octal escapes

## Examples

Filters:

- `status == "open" && priority >= 3`
- `user.plan != "free" && (user.age >= 18 || user.admin == true)`

Chaining:

- `user.profile.name`
- `fn(1, 2).next(3).done`

## Safe evaluation

## Safe evaluation model

Use `evaluateExpression` to parse + evaluate in one step, with an explicit
environment and resource budgets.

At a high level:

- Identifiers read from `env` only.
- Member access is restricted.
- Calls are only possible through functions present in `env`.
- Evaluation has configurable budgets.

### `env` and runtime values

`env` is the _only_ way expressions can access data and functions. Identifiers
resolve to properties on `env`.

- Missing identifiers evaluate to `undefined`.
- Values must be made of supported runtime values:
  - primitives: `undefined | null | boolean | number | string`
  - arrays of supported values
  - plain objects (`{...}`) whose values are supported values
  - functions that accept/return supported values

Member access (`obj.prop`) is intentionally conservative:

- Works on plain objects (and arrays only expose `.length`).
- Blocks `__proto__`, `prototype`, and `constructor`.

`env` is validated at runtime: it must be a plain object (or proto-null object),
and all nested values must be supported runtime values.

### Member access restrictions

- Only plain objects expose own-properties.
- Arrays expose `.length` only.
- Everything else returns `undefined`.

This is designed to avoid prototype leakage and surprise access to inherited
properties.

### Resource budgets

Evaluation supports a few defensive limits (all optional):

- `maxSteps` (default `10_000`): max AST nodes visited
- `maxDepth` (default `256`): max recursion depth while evaluating
- `maxArrayElements` (default `1_000`): max elements in an array literal

#### Example: filter over an input object

```ts
import { evaluateExpression } from "jsr:@claudiu-ceia/exp";

const env = {
  status: "open",
  priority: 4,
};

const res = evaluateExpression('status == "open" && priority >= 3', {
  env,
  throwOnError: false,
});
```

#### Example: allow-listed helper functions

```ts
import { evaluateExpression } from "jsr:@claudiu-ceia/exp";

const env = {
  lower: (s: unknown) => (typeof s === "string" ? s.toLowerCase() : ""),
  contains: (s: unknown, sub: unknown) => {
    if (typeof s !== "string") throw new Error("contains: expected string");
    if (typeof sub !== "string") throw new Error("contains: expected string");
    return s.includes(sub);
  },
  user: { plan: "Free" },
};

const res = evaluateExpression('contains(lower(user.plan), "free")', {
  env,
  maxSteps: 5_000,
  throwOnError: false,
});
```

## Installation

### Deno / JSR

```ts
import { evaluateExpression } from "jsr:@claudiu-ceia/exp";
```

Or add it to your project:

```sh
deno add jsr:@claudiu-ceia/exp
```

### npm

This package is published for npm via a generated build.

```sh
npx jsr add @claudiu-ceia/exp
```

Then:

```ts
import { evaluateExpression } from "@claudiu-ceia/exp";
```

## Getting started

### Parse only

```ts
import { parseExpression } from "jsr:@claudiu-ceia/exp";

const parsed = parseExpression("1 + 2 * 3", { throwOnError: false });
if (parsed.success) {
  console.log(parsed.value.kind); // "binary"
}
```

### Evaluate a pre-parsed AST

```ts
import { evaluateAst, parseExpression } from "jsr:@claudiu-ceia/exp";

const ast = parseExpression("x + 1").value;
const out = evaluateAst(ast, { env: { x: 41 }, throwOnError: false });
```

## API reference

### `parseExpression(input, opts?)`

- Returns `{ success: true, value: Expr }` or `{ success: false, error }`.
- With `opts.throwOnError !== false`, throws `ExpParseError`.

### `evaluateExpression(input, opts?)`

- Parses + evaluates.
- With `opts.throwOnParseError === false`, returns a failure result on parse
  error.
- With `opts.throwOnError !== false`, throws `ExpEvalError` on evaluation
  errors.

### `evaluateAst(expr, opts?)`

- Evaluates an existing AST.
- Enforces runtime validation of `opts.env`.

### Types

- `Expr`, `Span`, `NodeBase` (AST)
- `RuntimeValue` (allowed runtime values)
- `EvalOptions`, `EvalResult`, `EvalError`

## Errors and diagnostics

When you enable throwing (the default), you’ll get typed errors:

- `ExpParseError`: includes `index` (byte index into the input string)
- `ExpEvalError`: includes `span` (AST span) and `steps` (budget counter)

If you prefer non-throwing control flow, use `throwOnError: false` and inspect
the returned `{ success: false, error: { message, span?, steps?, index? } }`.

## Development

- `deno task check`
- `deno test`

## CLI

This repo includes a small Deno-only CLI (not part of the npm build), built with
`@stricli/core`.

- `deno task repl`
- `deno task exp -- run [file]`

### Providing `env`

For real usage, you typically want helper functions in `env` (so JSON alone is
often not enough). The CLI supports both:

- `--env path/to/env.ts` (JS/TS module; supports functions)
- `--env-json path/to/env.json` (JSON object; values only)

Example `env.ts`:

```ts
export const env = {
  lower: (s: unknown) => (typeof s === "string" ? s.toLowerCase() : ""),
  user: { plan: "Free" },
};
```

Run:

```sh
deno task exp -- run --env ./env.ts program.expr
echo '1 + 2*3' | deno task exp -- run
deno task repl -- --env ./env.ts

# value-only env (no functions)
echo 'x + 1' | deno task exp -- run --env-inline '{"x": 41}'

# see full flag docs
deno task exp -- --help
```

## License

MIT
