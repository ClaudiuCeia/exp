# Choosing an approach

`exp` is an expression language parser and evaluator for TypeScript
applications. It is not a complete rule engine or a JavaScript sandbox.

## Use `exp`

Use `exp` when:

- filters, conditions, or formulas should be stored as readable text
- a TypeScript application owns evaluation
- the application can expose a narrow environment
- source spans and diagnostics matter
- JavaScript-shaped operators fit the intended authors
- cross-language compatibility is not required

## Choose another expression format

Choose a JSON or cross-language expression format when:

- rules must run identically in several languages
- JSON is required for storage or interchange
- external systems must inspect and transform every operation structurally

Choose a schema-aware language or add a separate checking layer when
expressions must be statically checked against environment names and types.
The typed AST in `exp` does not provide that check.

## Choose a larger rules product

Choose a rules or workflow system when the product needs:

- rule persistence and version management
- priority or conflict resolution
- actions and workflow execution
- audit history
- a visual rule builder

These are application concerns outside the `exp` package boundary.

## Choose scripting or isolation

Choose a scripting runtime when arbitrary programs, statements, loops, object
literals, or asynchronous work are required.

Choose a worker or separate process when evaluation requires wall-clock, memory,
or operating-system isolation. Functions supplied through `env` are normal host
functions and are not isolated by the interpreter.
