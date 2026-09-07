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
The `EnvironmentInput` TypeScript type describes a candidate object, not proof
that its runtime shape or values are supported.

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

### Prepared environments

`prepareEnvironment()` validates and normalizes an environment once for reuse.
The returned token is opaque, frozen, and accepted only by the package module
instance that created it. Another live module instance rejects the token as a
non-plain environment. Structured cloning strips its identity and produces an
ordinary empty object with no bindings, so prepared tokens must not be cloned,
serialized, or transferred.

The normalized arrays and objects are library-owned and deeply frozen. The
caller-owned input and function objects are never frozen or mutated. Aliases and
cycles are preserved in the snapshot, while later changes to the input graph do
not affect it.

Evaluation compares its runtime limits with the exact graph requirements
recorded during preparation without traversing the snapshot during setup. Every
function return is independently traversed under the current evaluation limits,
including a return that aliases a container in the snapshot.

## Environment functions

Functions supplied through `env` are trusted host code. They run with the same
authority as the application.

When a prepared environment is used, object and array arguments and method
receivers from its snapshot are frozen. Function identity and closure state
remain live across evaluations.

Environment functions can:

- access values captured by closures and application globals
- perform I/O or mutate state
- block indefinitely
- allocate memory
- return different values across calls

Function work is not counted by `maxSteps`. Return values are validated and
charged to the evaluation work budget only after the function returns. A Promise
return is unsupported, but the function has already run by the time that return
is rejected.

TypeScript parameter annotations on host functions do not constrain expression
arguments. A host function that requires narrower values must validate them.

Errors thrown by an environment function are converted into evaluation
failures. Thrown `undefined`, `null`, booleans, numbers, bigints, strings, and own
string `message` data properties are reported directly. Symbols and other
objects are reported as `unknown thrown value` without invoking accessors or
coercion hooks. Preserved native error messages are host/runtime supplied and can
differ across JavaScript runtimes. Exceptions from defensive AST and environment
inspection or setup use stable package-defined messages. Converting an error
does not undo side effects performed before it was thrown.

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

AST validation and evaluation each receive an independent `maxSteps` budget.
Validation charges the root and every traversed AST edge, even when multiple
edges reference the same shared acyclic node. Evaluation charges every node
visit plus variable-size identifier and member lookup, coercion, string,
standard-library, and function-return or member revalidation work. Those runtime
graph traversals share the cumulative evaluation budget rather than receiving a
fresh allowance. Initial environment normalization remains bounded by
`maxRuntimeDepth` and `maxRuntimeEntries`, not `maxSteps`.
`maxArrayElements` and `maxCallArguments` reject oversized child arrays before
individual entries are inspected. `maxRuntimeDepth` and `maxRuntimeEntries`
limit supported environment and function-return graphs. Runtime graph traversal
is iterative, so configured depths are not limited by the JavaScript call stack.
None of these options interrupts host function work, Proxy traps, or native
object-key enumeration.

## Isolation

The interpreter is not a process isolation boundary.

Run evaluation in a worker or separate process when wall-clock, memory, or
operating-system isolation is required. Whether a worker provides a security
boundary depends on the deployment runtime and its configuration.
