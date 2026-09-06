# Expression language

`exp` parses one complete expression. The grammar uses JavaScript-shaped
operators, but it is its own expression language.

## Values and names

The language supports decimal numbers, single-quoted and double-quoted strings,
`true`, `false`, `null`, `undefined`, arrays, and identifiers.

Identifiers start with an ASCII letter or `_` and continue with ASCII letters,
digits, or `_`. The literal names `true`, `false`, `null`, and `undefined` are
reserved.

Number syntax supports unsigned decimal integers and decimal fractions. Signs
are unary operators. Exponents, hexadecimal literals, binary literals, octal
literals, and leading-dot fractions are not supported. Integer-form literals
must be JavaScript safe integers.

Strings support common escapes, hexadecimal escapes, Unicode escapes, and line
continuations. Raw line terminators and digit or octal escapes are rejected.

Whitespace, `//` comments, and non-nested `/* ... */` comments are accepted as
trivia. The current syntax-nesting limit pre-scan still counts parentheses,
brackets, and conditional markers inside comments.

## Precedence

The table runs from highest to lowest precedence.

| Level | Syntax                                        | Associativity                 |
| ----: | --------------------------------------------- | ----------------------------- |
|     1 | literals, identifiers, arrays, `(expression)` | n/a                           |
|     2 | `value.member`, `value(arguments)`            | left                          |
|     3 | `!`, unary `+`, unary `-`                     | right                         |
|     4 | `*`, `/`, `%`                                 | left                          |
|     5 | `+`, `-`                                      | left                          |
|     6 | `<`, `<=`, `>`, `>=`                          | left                          |
|     7 | `==`, `!=`                                    | left                          |
|     8 | `&&`                                          | left                          |
|     9 | `\|\|`, `??`                                  | left                          |
|    10 | `\|>`                                         | left                          |
|    11 | `test ? consequent : alternate`               | right through nested branches |

`||` and `??` have the same precedence and may be mixed without parentheses.
This differs from JavaScript source grammar.

## Pipeline

Pipeline syntax inserts the left value as the first call argument:

```text
value |> fn
```

becomes:

```text
fn(value)
```

Arguments already present on the right follow the inserted value:

```text
value |> fn(a, b)
```

becomes:

```text
fn(value, a, b)
```

Pipelines chain from left to right:

```text
user.email |> std.lower |> std.endsWith("@company.com")
```

becomes:

```text
std.endsWith(std.lower(user.email), "@company.com")
```

The parser represents the result as normal call nodes. There is no pipeline AST
node.

## Operators

### Numeric conversion

Arithmetic other than `+` and all relational operators convert operands with
these rules:

| Value                   | Numeric result     |
| ----------------------- | ------------------ |
| number                  | unchanged          |
| `true`                  | `1`                |
| `false`                 | `0`                |
| `null`                  | `0`                |
| `undefined`             | `NaN`              |
| string                  | `Number(string)`   |
| array, object, function | evaluation failure |

Relational operators are numeric-only. Two strings are not compared
lexicographically.

### Addition and concatenation

`+` concatenates when either operand is already a string. Supported primitive
values can be converted to text for concatenation. Otherwise `+` applies numeric
conversion to both operands and adds them.

Arrays, objects, and functions are not converted to text.

### Equality

`==` and `!=` loosely coerce primitive values. `null` and `undefined` are equal,
booleans convert to numbers, and string-number pairs use numeric conversion.

Arrays, objects, and functions use reference equality only. They are not passed
through `toString()` or `valueOf()`.

### Logical operators

`&&`, `||`, and `??` short-circuit and return operand values.

- `left && right` returns `left` when it is falsy. Otherwise it evaluates and
  returns `right`.
- `left || right` returns `left` when it is truthy. Otherwise it evaluates and
  returns `right`.
- `left ?? right` returns `left` unless it is `null` or `undefined`. Otherwise it
  evaluates and returns `right`.

Conditions and `!` use JavaScript truthiness. Applications expecting a predicate
should require the final value to be `true` or `false` explicitly.

## Access and calls

Dot access reads supported own data properties from plain objects. Arrays expose
`.length` only. Primitive values and functions do not expose prototype members.
Missing members return `undefined`.

Function calls can target the fixed `std` functions or functions reached through
`env`. Member calls receive the containing object as `this`.

## Unsupported syntax

The grammar does not include:

- assignments, declarations, statements, or multiple top-level expressions
- loops or function definitions
- object literals
- computed or indexed property access
- optional chaining
- spread syntax or trailing commas
- template literals or regular expression literals
- `===`, `!==`, exponentiation, bitwise operators, shifts, `in`, `instanceof`, or
  `typeof`

## AST and spans

`parseExpression()` returns a TypeScript tagged union. Every node has a
zero-based, half-open UTF-16 span:

```ts
type Span = {
  start: number;
  end: number;
};
```

The AST type describes parser output. It does not statically check identifiers,
members, or operations against an environment schema.
