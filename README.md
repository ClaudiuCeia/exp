# exp

A small expression language toolkit: parse expressions, get a typed AST with
spans, and evaluate safely.

## Why

This is aimed at real "mini-language" use cases:

- API-rich filters (`status == "open" && priority >= 3`)
- small data-wrangling pipelines (`input |> map(...) |> filter(...)`)
- backtesting strategies (signals, conditions, thresholds) in a constrained DSL

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

Use `evaluateExpression` to parse + evaluate in one step, with an explicit
environment and resource budgets.

- `evaluateExpression("status == \"open\" && priority >= 3", { env })`

### `env`

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

#### Example: filter over an input object

```ts
import { evaluateExpression } from "exp";

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
import { evaluateExpression } from "exp";

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
