# Security model

This document describes where expression interpretation ends and application
trust begins. Use [SECURITY.md](../SECURITY.md) to report a vulnerability.

## Expression input

Expression source may be untrusted. `exp` parses its own expression grammar and
does not execute the source through `eval()` or `new Function()`.

Input length, syntax nesting, and AST construction have configurable limits.
Parser limits count parser work. They are not wall-clock deadlines.
The syntax-nesting preflight scans the source once and ignores delimiters and
conditional markers inside strings, line comments, and block comments.
`maxNodes` is a per-parse construction budget. It is charged before each AST
node is allocated, including transient nodes later replaced or discarded during
parsing. Exhaustion aborts parsing before that node is built, so the construction
count can exceed the number of nodes reachable from a successful result.

## Environment data

The top-level environment must be a plain object or an object with a null
prototype. The evaluator normalizes arrays and plain objects before evaluation.

- Only own enumerable string-keyed data properties are copied and readable.
- Inherited properties are not exposed.
- Enumerable accessors are rejected without invoking them.
- Class instances and unsupported object types are rejected.
- Non-enumerable and symbol-keyed properties are ignored.
- Cycles and shared references are preserved within runtime graph limits.
- Arrays expose `.length` only.
- `__proto__`, `prototype`, and `constructor` member access is blocked.

The runtime entry counter includes all own object keys before non-enumerable and
symbol-keyed properties are ignored.

## Environment functions

Functions supplied through `env` are trusted host code. They run with the same
authority as the application.

Environment functions can:

- access values captured by closures and application globals
- perform I/O or mutate state
- block indefinitely
- allocate memory
- return different values across calls

Function work is not counted by `maxSteps`. Return values are validated only
after the function returns. A Promise return is unsupported, but the function
has already run by the time that return is rejected.

Errors thrown by an environment function are converted into evaluation
failures. Converting an error does not undo side effects performed before it was
thrown.

Expose narrow, synchronous, bounded functions. Prefer functions without side
effects when expressions come from users or stored configuration.

## Resource limits

Parser and interpreter limits are counters, not wall-clock limits.

The package has no built-in:

- timeout
- cancellation API
- maximum output string length
- numeric magnitude bound
- preemption of environment functions

`maxSteps` limits AST validation and interpreter visits. `maxRuntimeDepth` and
`maxRuntimeEntries` limit supported environment and function-return graphs.
None of these options interrupts host function work. String length and work
inside standard string helpers are not metered by `maxSteps`.

## Isolation

The interpreter is not a process isolation boundary.

Run evaluation in a worker or separate process when wall-clock, memory, or
operating-system isolation is required. Whether a worker provides a security
boundary depends on the deployment runtime and its configuration.
