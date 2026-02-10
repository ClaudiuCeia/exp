# exp

A small expression language toolkit: parse expressions, get a typed AST with
spans, and (optionally) evaluate safely.

## Why

This is aimed at real "mini-language" use cases:

- API-rich filters (`status == "open" && priority >= 3`)
- small data-wrangling pipelines (`input |> map(...) |> filter(...)`)
- backtesting strategies (signals, conditions, thresholds) in a constrained DSL

## Non-goals

- Full JavaScript parsing.
- Executing untrusted code via `eval` / `new Function`.

## Status

Scaffolded project; implementation TBD.

## Development

- `deno task check`
- `deno test`

## License

MIT
