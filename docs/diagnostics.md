# Diagnostics

Parser and evaluator failures use different source locations.

- Parser failures provide `index`, a zero-based UTF-16 code-unit offset.
- Evaluator failures tied to an AST node provide its half-open `span`.
- Evaluator failures provide the `steps` work counter when available.

`formatDiagnosticReport()` accepts either location form.

## Parser failure

```ts
import { evaluateExpression, formatDiagnosticReport } from "@claudiu-ceia/exp";

const source = "account.plan == && usage.requests >= 1000";
const result = evaluateExpression(source, {
  throwOnParseError: false,
  throwOnError: false,
});

if (!result.success) {
  console.error(formatDiagnosticReport(source, result.error));
}
```

Output from the checked example:

```text
1 | account.plan == && usage.requests >= 1000
  |                 ╰─▶ expected expression at 1:17
```

The failure has `index: 16` and `steps: 0`.

## Evaluator failure

```ts
import { evaluateExpression, formatDiagnosticReport } from "@claudiu-ceia/exp";

const source = "missing + 1";
const result = evaluateExpression(source, {
  throwOnParseError: false,
  throwOnError: false,
});

if (!result.success) {
  console.error(formatDiagnosticReport(source, result.error));
}
```

Output from the checked example:

```text
1 | missing + 1
  | ╰─────╯
  |    ╰─▶ unknown identifier 'missing'
```

The failure has `span: { start: 0, end: 7 }` and `steps: 9`.

Both reports are generated and checked in
[`examples/diagnostics.ts`](../examples/diagnostics.ts) and
[`examples/readme.test.ts`](../examples/readme.test.ts).

## Formatter API

- `formatDiagnosticReport(input, error)` renders numbered source lines and an
  error pointer.
- `formatDiagnosticCaret(input, error)` renders a compact caret and prefers
  `index` over `span.start`.
- `formatCaret(input, index)` renders a compact caret from a parser index.
- `formatSpanCaret(input, span)` renders a compact caret from `span.start`.

`formatDiagnosticReport()` can include surrounding context lines and configure
tab expansion. See the [generated API reference](https://jsr.io/@claudiu-ceia/exp/doc)
for the complete option types.

## Throwing and returning failures

`parseExpression()` throws `ExpParseError` by default. Its `throwOnError: false`
option returns a `ParseResult` failure instead.

`evaluateExpression()` has separate controls. `throwOnParseError` controls
parser failures and `throwOnError` controls evaluator failures. Set both to
`false` when all expression failures should be returned:

```ts
const result = evaluateExpression(source, {
  throwOnParseError: false,
  throwOnError: false,
});
```

`throwOnError: false` by itself does not cover parser failures.

Before 1.0, the API should make an explicit decision about whether one option
controls all failures, a separate result-returning function is added, or
throwing and returning APIs receive distinct names. This documentation keeps
the current two-option behavior rather than making that decision through copy.
