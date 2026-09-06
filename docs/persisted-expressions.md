# Persisted expressions

Store expression source as the canonical value. Do not use a serialized AST as
a storage format across package versions.

`exp` is pre-1.0. Pin the package version used to evaluate saved expressions.
Before upgrading, run a representative corpus of stored source through the new
parser and evaluator and compare results and diagnostics.

Review these compatibility areas for every upgrade:

- grammar and accepted syntax
- operator coercion and short-circuit behavior
- standard library names and behavior
- AST shape and source spans
- diagnostic messages and formatting
- migration requirements for stored source

Before 1.0, decide whether loose primitive equality, numeric relational
comparison, string concatenation through `+`, operand-returning `&&` and `||`,
and missing member access returning `undefined` are the intended long-term
contract. Until then, these behaviors deserve explicit regression cases.

The package does not currently export a language version. Adding one requires a
defined policy for each compatibility area above rather than a number alone.
