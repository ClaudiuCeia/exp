# exp

Parse and evaluate filters, conditions, and formulas without executing
JavaScript source.

`exp` parses expression text into a typed AST and evaluates it against an
explicit environment. Expressions can read application data and call functions
that the application provides. The package also includes source spans,
diagnostics, and configurable limits for parser + interpreter work.

[![npm](https://img.shields.io/npm/v/@claudiu-ceia/exp)](https://www.npmjs.com/package/@claudiu-ceia/exp)
[![JSR](https://jsr.io/badges/@claudiu-ceia/exp)](https://jsr.io/@claudiu-ceia/exp)
[![CI](https://github.com/ClaudiuCeia/exp/actions/workflows/ci.yml/badge.svg)](https://github.com/ClaudiuCeia/exp/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/ClaudiuCeia/exp)](./LICENSE)

Use it for saved filters, rollout conditions, workflow guards, alerts, and
application-defined formulas.

```ts
import { evaluateExpression } from "@claudiu-ceia/exp";

const result = evaluateExpression(
  'account.plan == "pro" && usage.requests >= 1000',
  {
    env: {
      account: { plan: "pro" },
      usage: { requests: 1400 },
    },
    throwOnParseError: false,
    throwOnError: false,
  },
);

if (!result.success) {
  console.error(result.error);
} else {
  console.log(result.value); // true
}

const matches = result.success && result.value === true;
```

Identifiers resolve from `env` or the built-in `std` namespace. No other
globals are added implicitly.

`evaluateExpression()` can return any supported runtime value. Applications
using expressions as predicates should require a boolean result rather than
relying on truthiness.

## Installation

```sh
npm install @claudiu-ceia/exp
```

```sh
bun add @claudiu-ceia/exp
```

```sh
deno add jsr:@claudiu-ceia/exp
```

Import the npm package from Node.js or Bun:

```ts
import { evaluateExpression } from "@claudiu-ceia/exp";
```

Import the JSR package from Deno:

```ts
import { evaluateExpression } from "jsr:@claudiu-ceia/exp";
```

## Where `exp` fits

| Job               | Expression                                                  |
| ----------------- | ----------------------------------------------------------- |
| Saved filter      | `status == "open" && priority >= 3`                         |
| Rollout condition | `user.country == "RO" && user.bucket < rolloutPercent`      |
| Alert condition   | `errorRate >= 0.05 && requestCount >= 100`                  |
| Formula           | `subtotal >= 100 ? subtotal * 0.9 : subtotal`               |
| Text condition    | `user.email \|> std.lower \|> std.endsWith("@company.com")` |

These are expression examples, not built-in domain concepts. The application
provides `status`, `priority`, `user`, `errorRate`, and the other values through
`env`.

The package provides:

```text
exp
  expression parser
  typed AST with source spans
  interpreter
  diagnostics
  standard helper functions
  resource limits
```

It does not provide:

```text
rule persistence
rule priority or conflict handling
actions or workflow execution
a visual rule builder
static type checking against an environment schema
cross-language expression compatibility
process isolation
wall-clock timeouts
arbitrary JavaScript execution
```

Use `exp` when the expression is readable text, a TypeScript application owns
evaluation, and the application can expose a narrow environment. It also fits
when source spans and diagnostics matter, JavaScript-shaped operators are
appropriate, and cross-language compatibility is not required.

Choose another approach when rules must run identically in several languages,
JSON is the required interchange format, expressions need static type checking,
or evaluation must be asynchronous. A different product is also a better fit
for arbitrary scripting or for rule storage, actions, priority, audit history,
and visual editing. See [Choosing an approach](./docs/comparison.md).

A model can generate a filter expression instead of arbitrary JavaScript. Treat
the generated expression as untrusted source, parse it with the normal limits,
expose a narrow environment, and require the expected result type. See the
[checked model-generated filter example](./examples/model-generated-filter.ts).

## Parse once + evaluate many times

```ts
import { evaluateAst, parseExpression } from "@claudiu-ceia/exp";

const expressionSource = 'issue.status == "open" && issue.priority >= 3';
const parsed = parseExpression(expressionSource, {
  throwOnError: false,
});

if (!parsed.success) {
  throw new Error(parsed.error.message);
}

const issues = [
  { status: "open", priority: 4 },
  { status: "closed", priority: 5 },
];

const matching = issues.filter((issue) => {
  const result = evaluateAst(parsed.value, {
    env: {
      issue: {
        status: issue.status,
        priority: issue.priority,
      },
    },
    throwOnError: false,
  });

  return result.success && result.value === true;
});
```

Parsing and evaluation are separate APIs. Parse once when the same expression
will be evaluated against several environments. `parseExpression()` produces an
AST. It does not generate executable code or bytecode.

Every AST node includes a zero-based, half-open UTF-16 source span:

```ts
type Span = {
  start: number;
  end: number;
};
```

The returned AST is a TypeScript tagged union. `exp` does not statically check
an expression against the types or shape of `env`. Parsing `priority >= "high"`
succeeds. Whether evaluation produces a useful result depends on the coercion
rules below.

## Language at a glance

### Values

```text
numbers
strings
true
false
null
undefined
arrays
identifiers
```

### Operators

```text
! + -
* / %
+ -
< <= > >=
== !=
&& || ??
? :
|>
```

### Access and calls

```text
user.plan
std.lower(user.email)
score(value)
```

### Not supported

```text
assignments
statements
loops
object literals
computed property access
optional chaining
class instances
implicit access to JavaScript globals
```

Pipeline syntax is part of this expression language:

```text
user.email |> std.lower |> std.endsWith("@company.com")
```

It desugars to:

```text
std.endsWith(std.lower(user.email), "@company.com")
```

See the [language reference](./docs/language.md) for precedence, literal syntax,
and the complete operator behavior.

## Expression semantics

Equality loosely coerces primitive values:

```text
"1" == 1            // true
null == undefined   // true
true == 1           // true
```

Objects, arrays, and functions are not implicitly converted to primitives:

```text
user == user                // reference equality may be true
user == "[object Object]"   // false
```

Relational operators convert both values to numbers. They do not perform
lexicographic string comparison:

```text
"10" > 2   // true after numeric conversion
"b" > "a"  // false because both values convert to NaN
```

`+` concatenates when either operand is already a string. Otherwise it performs
numeric addition:

```text
1 + 2       // 3
"1" + 2     // "12"
```

`&&`, `||`, and `??` short-circuit. `&&` and `||` return operand values rather
than coercing the result to boolean. A top-level expression can therefore return
a string, number, array, object, or function from the environment. Applications
using `exp` for filters must check the result type.

These semantics affect persisted expressions. Their pre-1.0 status and upgrade
guidance are documented under [Persisted expressions](#persisted-expressions).

## Environment + standard library

`env` contains the values and functions available to an expression. The
evaluator normalizes supported data into arrays and prototype-free plain
objects before evaluation.

The public `EnvironmentInput` type accepts application-owned object types,
including named interfaces, readonly properties, and readonly arrays. It is a
candidate input type rather than a static guarantee: the evaluator still
validates the top-level object and every exposed value at runtime. Input arrays
and plain objects are copied during normalization, so frozen inputs are
supported and caller-owned data is not mutated. Runtime arrays and objects use
readonly result types because trusted host functions may return frozen or
otherwise readonly containers without copying them.

Supported runtime values are:

```text
undefined
null
boolean
number
string
arrays of supported values
plain objects containing supported values
functions accepting and returning supported values
```

The object model is intentionally limited:

- Only own enumerable data properties are readable.
- Inherited properties are not exposed.
- Accessor properties are rejected.
- Class instances are rejected.
- Arrays expose `.length` only.
- `__proto__`, `prototype`, and `constructor` member access is blocked.
- Computed property access is not part of the language.

`user.name.toLowerCase()` is not supported because string prototype methods are
not exposed. Use `std.lower(user.name)` instead.

### Reusing an environment

Use `prepareEnvironment()` when several evaluations share stable input data. It
validates and normalizes the graph once, then returns an opaque snapshot that
can be passed through the existing `env` option:

```ts
import { evaluateExpression, prepareEnvironment } from "@claudiu-ceia/exp";

const env = prepareEnvironment({
  account: { plan: "pro" },
  usage: { requests: 1400 },
});

const plan = evaluateExpression('account.plan == "pro"', {
  env,
  throwOnError: false,
});
const usage = evaluateExpression("usage.requests >= 1000", {
  env,
  throwOnError: false,
});
```

Prepared arrays and objects are library-owned, deeply frozen snapshots. Later
changes to the input do not affect them, and host functions receive frozen
containers when expressions pass snapshot data as arguments or receivers. Host
functions themselves retain their identity and closure state, and their return
values are still validated after every call.

A prepared environment is tied to the package module instance that created it.
Do not serialize, clone, or transfer it across workers, realms, or duplicate
package instances. A cloned token carries no bindings and is not a prepared
environment. Create the snapshot with the same `exp` import used for evaluation.
`prepareEnvironment()` throws `ExpEvalError` when its limits or input are
invalid.

The fixed `std` namespace contains:

```text
std.len

std.abs
std.min
std.max
std.clamp
std.floor
std.ceil
std.round
std.trunc
std.sqrt
std.pow

std.lower
std.upper
std.trim
std.startsWith
std.endsWith
std.includes
std.slice
```

The built-in `std` functions are deterministic, side-effect-free, and frozen
together with their namespace. `env.std` is reserved.

An expression can call functions supplied in `env`. Those functions are retained
as trusted host functions rather than copied. They run with the same authority
as the application and may access values captured by their closure. Their return
values are validated after every call.

Expose narrow, synchronous, bounded functions. Prefer functions without side
effects when expressions come from users or stored configuration.

Expressions are dynamically typed, so a narrow TypeScript parameter annotation
does not prevent an expression from passing a different supported value. Host
functions must validate arguments when a mismatch matters.

```ts
const env = {
  now: () => Date.now(),
};
```

The same expression can return different values when the environment contains
such a function. Environment functions must return a supported value
synchronously. A Promise return is rejected after the function has already been
invoked.

## Diagnostics

This parser failure is formatted by the real package API:

```text
account.plan == && usage.requests >= 1000
```

```text
1 | account.plan == && usage.requests >= 1000
  |                 ╰─▶ expected expression at 1:17
```

Parser errors use a UTF-16 `index`. Evaluator errors tied to an AST node use its
`span`. Evaluation failures include the interpreter `steps` counter when it is
available. See [Diagnostics](./docs/diagnostics.md) for checked parser and
evaluator examples.

## Evaluation boundaries

`exp` interprets its own expression grammar. It does not pass expression text to
`eval()` or `new Function()`.

Identifiers resolve from the normalized `env` object and the fixed `std`
namespace. Member access is limited to supported own data properties.

This is not process isolation. Functions supplied through `env` run as normal
application code and are outside the interpreter's time and memory limits. Read
the [security model](./docs/security-model.md) before evaluating expressions
from untrusted sources.

## Resource limits

| Limit               |   Default | Covers                                         |
| ------------------- | --------: | ---------------------------------------------- |
| `maxInputLength`    | `100_000` | UTF-16 code units in expression source         |
| `maxNestingDepth`   |      `64` | Parentheses, arrays, and conditional nesting   |
| `maxNodes`          |  `10_000` | AST node allocations during parsing            |
| `maxSteps`          |  `10_000` | AST validation and evaluator work units        |
| `maxDepth`          |     `256` | AST validation and interpreter recursion depth |
| `maxArrayElements`  |   `1_000` | Elements in one array literal                  |
| `maxCallArguments`  |   `1_000` | Arguments in one call expression               |
| `maxRuntimeDepth`   |      `64` | Environment/preparation and return graph depth |
| `maxRuntimeEntries` |  `10_000` | Environment/preparation and return entries     |

The `maxNestingDepth` preflight scans the source once. Delimiters and
conditional markers inside strings and comments do not count toward the limit.
The per-parse `maxNodes` construction budget is charged before each AST node is
allocated, and parsing stops at the first node that would exceed it. Transient
nodes that are later replaced or discarded during parsing also count, so this
can exceed the number of nodes reachable from the returned AST.

Validation and evaluation each receive the configured `maxSteps` budget
independently. Validation charges the root and every traversed AST edge,
including repeated edges to a shared acyclic node. Evaluation charges every
visited node plus variable-size work in identifier and member lookup, built-in
coercion and string operations, standard-library helpers, and runtime-value
validation. Search helpers charge incrementally, while native bulk operations
reserve their work before running. Child-array and call-argument lengths are
checked before their entries are traversed.

The counters do not limit the size of a value returned directly, numeric
magnitude, or work inside application-provided functions. They are not a timeout
and do not interrupt a slow environment function.

`prepareEnvironment()` accepts `maxRuntimeDepth` and `maxRuntimeEntries` with
the same defaults and validation. A later evaluation rejects the snapshot in
constant time when its configured limit is below the graph requirement recorded
during preparation. Every host-function return value is traversed under the
runtime limits and charged cumulatively to the evaluation work budget.

## Persisted expressions

Store the expression source as the canonical value.

`exp` is currently pre-1.0. Syntax, AST shape, standard functions, and coercion
semantics may change between releases. Pin the package version and run saved
expressions through a regression corpus before upgrading.

The public AST is useful inside an application, but it is not currently a
versioned storage format. See [Persisted expressions](./docs/persisted-expressions.md)
for upgrade guidance and the compatibility areas to review.

## API summary

```text
parseExpression(input, options?)
prepareEnvironment(environment, options?)
evaluateExpression(input, options?)
evaluateAst(expression, options?)
formatDiagnosticReport(input, error)
```

Parsing throws by default. `parseExpression()` uses `throwOnError`, while
`evaluateExpression()` uses separate `throwOnParseError` and `throwOnError`
controls. `throwOnError: false` converts evaluation exceptions into failures,
including exceptions from environment functions and defensive data inspection.
Thrown objects are not coerced; an object without an own string `message` data
property is reported as `unknown thrown value`. Native messages preserved from
environment functions may vary across JavaScript runtimes. Defensive AST and
environment inspection and setup failures use package-defined messages. This
option does not cover parser failures.

Use the [generated JSR API reference](https://jsr.io/@claudiu-ceia/exp/doc) for
complete option types, result unions, AST variants, runtime value types,
diagnostic helpers, and standard library exports.

## Runtime support

Bun is the primary development toolchain.

The npm package is ESM-only and currently supports Node.js 22+. CI tests the
packed package on Node.js 22, 24, and 26.

The same TypeScript source is published through JSR and smoke-tested with Deno 2.

## Benchmarks

`bench/comparison.bench.ts` runs the same parse and evaluation scenarios against
the base and candidate revisions. It is an internal regression check, not a
competitor comparison or a performance claim.

The scenarios cover short and larger expressions, parsing, pre-parsed AST
evaluation, and parse + evaluation. Environment normalization is included in
the evaluation scenarios.

## Repository CLI

The repository includes a Bun-based REPL and file runner for development. It is
not installed with the published package.

```sh
bun run repl
bun run exp -- run expression.exp
```

`--env` imports and executes a JavaScript or TypeScript module. Only load trusted
environment modules. `--env-json` contains data only, but expressions may still
call the built-in `std` functions.

## Development

```sh
bun install
bun run check
bun run package:check
bun run bench
```

Deno remains part of JSR validation and runtime smoke coverage. The test suite
includes generated parser and evaluator inputs alongside targeted runtime and
member-access cases.

The README examples are executable through
[`examples/readme.test.ts`](./examples/readme.test.ts).

## License

MIT
