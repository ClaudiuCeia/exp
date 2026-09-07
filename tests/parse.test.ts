import { test } from "bun:test";
import { assertEquals, assertStringIncludes, assertThrows } from "./assert.ts";
import { ExpParseError, parseExpression } from "../src/parse.ts";

test("parseExpression parses numbers", () => {
  const res = parseExpression("  123  ", { throwOnError: false });
  assertEquals(res.success, true);
  if (res.success) {
    assertEquals(res.value.kind, "number");
    if (res.value.kind !== "number") return;
    assertEquals(res.value.value, 123);
  }
});

test("parseExpression parses undefined", () => {
  const res = parseExpression("undefined", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "undefined");
});

test("parseExpression parses nullish coalescing", () => {
  const res = parseExpression("a ?? b", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "binary");
  if (res.value.kind !== "binary") return;
  assertEquals(res.value.op, "??");
});

test("parseExpression parses quoted strings", () => {
  const res = parseExpression("'hi'", { throwOnError: false });
  assertEquals(res.success, true);
  if (res.success) {
    assertEquals(res.value.kind, "string");
    if (res.value.kind !== "string") return;
    assertEquals(res.value.value, "hi");
  }
});

test("parseExpression parses double-quoted strings", () => {
  const res = parseExpression('"hi"', { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "hi");
});

test("parseExpression parses escapes in double-quoted strings", () => {
  const res = parseExpression('"a\\n\\t\\u0041"', { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "a\n\tA");
});

test("parseExpression parses string escapes", () => {
  const res = parseExpression("'a\\n\\t\\u0041'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "a\n\tA");
});

test("parseExpression parses more single-character escapes", () => {
  const res = parseExpression("'\\b\\f\\v\\\\'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "\b\f\v\\");
});

test("parseExpression parses escaped quotes", () => {
  const a = parseExpression("'\\''", { throwOnError: false });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value.kind, "string");
  if (a.value.kind !== "string") return;
  assertEquals(a.value.value, "'");

  const b = parseExpression('"\\""', { throwOnError: false });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value.kind, "string");
  if (b.value.kind !== "string") return;
  assertEquals(b.value.value, '"');
});

test("parseExpression supports identity escapes (strict mode)", () => {
  const res = parseExpression("'\\q'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "q");
});

test("parseExpression fails on invalid unicode escape", () => {
  const res = parseExpression("'\\u12G4'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression parses \\xNN and \\u{...} escapes", () => {
  const res = parseExpression("'\\x41\\u{1F600}'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "A\u{1F600}");
});

test("parseExpression supports line continuations in strings", () => {
  const res = parseExpression("'a\\\nB'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

test("parseExpression supports CR-only line continuations in strings", () => {
  const res = parseExpression("'a\\\rB'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

test("parseExpression supports CRLF line continuations in strings", () => {
  const res = parseExpression("'a\\\r\nB'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

test("parseExpression supports unicode line separator continuations in strings", () => {
  const res = parseExpression("'a\\\u2028B'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

test("parseExpression supports unicode paragraph separator continuations in strings", () => {
  const res = parseExpression("'a\\\u2029B'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

test("parseExpression fails on raw newlines inside string literals", () => {
  const res = parseExpression("'a\nb'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression parses \\0 when not followed by a digit", () => {
  const res = parseExpression("'\\0x'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value.length, 2);
  assertEquals(res.value.value.charCodeAt(0), 0);
  assertEquals(res.value.value[1], "x");
});

test("parseExpression fails on strict-mode digit escapes (\\8)", () => {
  const res = parseExpression("'\\8'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression fails on strict-mode digit escapes (\\1)", () => {
  const res = parseExpression("'\\1'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression fails on strict-mode legacy octal (\\01)", () => {
  const res = parseExpression("'\\01'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression fails on invalid hex escape", () => {
  const res = parseExpression("'\\x4'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression fails on missing '}' in unicode code point escape", () => {
  const res = parseExpression("'\\u{1F600'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression fails on out-of-range unicode code point", () => {
  const res = parseExpression("'\\u{110000}'", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression respects operator precedence", () => {
  const res = parseExpression("1 + 2 * 3", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  assertEquals(res.value.kind, "binary");
  if (res.value.kind !== "binary") return;
  assertEquals(res.value.op, "+");
  assertEquals(res.value.left.kind, "number");
  assertEquals(res.value.right.kind, "binary");
  if (res.value.right.kind !== "binary") return;
  assertEquals(res.value.right.op, "*");
});

test("parseExpression parses member access and calls", () => {
  const res = parseExpression("foo.bar(1, 2)", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  assertEquals(res.value.kind, "call");
  if (res.value.kind !== "call") return;
  assertEquals(res.value.args.length, 2);
  assertEquals(res.value.callee.kind, "member");
  if (res.value.callee.kind !== "member") return;
  assertEquals(res.value.callee.property, "bar");
});

test("parseExpression parses arrays", () => {
  const res = parseExpression("[1, 2, 3]", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  assertEquals(res.value.kind, "array");
  if (res.value.kind !== "array") return;
  assertEquals(res.value.elements.length, 3);
});

test("parseExpression parses ternary conditionals", () => {
  const res = parseExpression("true ? 1 : 2", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  assertEquals(res.value.kind, "conditional");
  if (res.value.kind !== "conditional") return;
  assertEquals(res.value.test.kind, "boolean");
  assertEquals(res.value.consequent.kind, "number");
  assertEquals(res.value.alternate.kind, "number");
});

test("parseExpression parses pipeline operator", () => {
  const res = parseExpression("1 + 2 |> inc", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  // Pipeline desugars to a call expression.
  assertEquals(res.value.kind, "call");
  if (res.value.kind !== "call") return;
  assertEquals(res.value.callee.kind, "identifier");
  if (res.value.callee.kind !== "identifier") return;
  assertEquals(res.value.callee.name, "inc");
  assertEquals(res.value.args.length, 1);
  assertEquals(res.value.args[0].kind, "binary");
});

test("parseExpression fails on empty", () => {
  const res = parseExpression("   ", { throwOnError: false });
  assertEquals(res.success, false);
});

test("parseExpression throws by default on parse errors", () => {
  try {
    parseExpression("   ");
    throw new Error("expected parseExpression to throw");
  } catch (e) {
    assertEquals(e instanceof ExpParseError, true);
    if (e instanceof ExpParseError) {
      assertEquals(typeof e.index, "number");
      assertEquals(e.index >= 0, true);
    }
  }
});

test("parseExpression reports missing RHS as expected expression", () => {
  const res = parseExpression("1 +", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;

  assertStringIncludes(res.error.message, "expected expression");
  assertStringIncludes(res.error.message, "at 1:4");
  assertEquals(res.error.index, 3);
});

test("parseExpression reports pipeline missing RHS with helpful message", () => {
  const res = parseExpression("1 |>", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;

  assertStringIncludes(res.error.message, "expression after '|>'");
});

test("parseExpression reports conditional missing consequent with helpful message", () => {
  const res = parseExpression("1 ?", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;

  assertStringIncludes(res.error.message, "expression after '?'");
});

test("parseExpression reports member missing property name", () => {
  const res = parseExpression("foo.", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;

  assertStringIncludes(res.error.message, "identifier after '.'");
});

test("parseExpression reports call missing closing paren", () => {
  const res = parseExpression("f(", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;

  assertStringIncludes(res.error.message, "closing ')'");
});

test("parseExpression enforces input length limits", () => {
  const res = parseExpression("12345", {
    throwOnError: false,
    maxInputLength: 4,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertStringIncludes(res.error.message, "input length limit");
  assertEquals(res.error.index, 4);
});

test("parseExpression rejects excessive nesting without overflowing", () => {
  const inputs = [
    "(".repeat(10_000) + "1" + ")".repeat(10_000),
    "[".repeat(10_000) + "1" + "]".repeat(10_000),
    "true ? 1 : ".repeat(2_000) + "0",
  ];

  for (const input of inputs) {
    const res = parseExpression(input, {
      throwOnError: false,
      maxInputLength: input.length,
      maxNestingDepth: 64,
    });
    assertEquals(res.success, false);
    if (res.success) continue;
    assertStringIncludes(res.error.message, "nesting limit");
  }
});

test("parseExpression treats delimiters and comment markers inside strings as content", () => {
  const cases = [
    { input: '"(([[???"', value: "(([[???" },
    { input: "'// /* */ ([? \"'", value: '// /* */ ([? "' },
    { input: '"// /* */ ([? \\\""', value: '// /* */ ([? "' },
  ];

  for (const { input, value } of cases) {
    const res = parseExpression(input, {
      throwOnError: false,
      maxNestingDepth: 0,
    });
    assertEquals(res, {
      success: true,
      value: { kind: "string", value, span: { start: 0, end: input.length } },
    });
  }
});

test("parseExpression counts question marks but not nullish operators", () => {
  const nullish = parseExpression("null ?? undefined", {
    throwOnError: false,
    maxNestingDepth: 0,
  });
  assertEquals(nullish.success, true);

  const conditional = parseExpression("a ? b : c", {
    throwOnError: false,
    maxNestingDepth: 0,
  });
  assertEquals(conditional, {
    success: false,
    error: { message: "parse nesting limit exceeded", index: 2 },
  });
});

test("parseExpression rejects comment cancellation of 1000 real nesting levels", () => {
  const input = "(/*)*/".repeat(1_000) + "1" + ")".repeat(1_000);
  const res = parseExpression(input, {
    throwOnError: false,
    maxInputLength: input.length,
    maxNestingDepth: 1,
  });

  assertEquals(res, {
    success: false,
    error: { message: "parse nesting limit exceeded", index: 6 },
  });
});

test("parseExpression ignores opening delimiters and quotes in comments", () => {
  const inputs = ["1 // ([? \" '\n", "1 /* ([? \" ' */"];

  for (const input of inputs) {
    const res = parseExpression(input, {
      throwOnError: false,
      maxNestingDepth: 0,
    });
    assertEquals(res, {
      success: true,
      value: { kind: "number", value: 1, span: { start: 0, end: 1 } },
    });
  }
});

test("parseExpression does not let closing delimiters in comments cancel nesting", () => {
  const cases = [
    { input: "(// )]\n(1))", index: 7 },
    { input: "(/*)]*/(1))", index: 7 },
  ];

  for (const { input, index } of cases) {
    const res = parseExpression(input, {
      throwOnError: false,
      maxNestingDepth: 1,
    });
    assertEquals(res, {
      success: false,
      error: { message: "parse nesting limit exceeded", index },
    });
  }
});

test("parseExpression resumes nesting checks after quotes in comments", () => {
  const cases = [
    { input: "// ' \"\n(1)", index: 7 },
    { input: "/* ' \" */(1)", index: 9 },
  ];

  for (const { input, index } of cases) {
    const res = parseExpression(input, {
      throwOnError: false,
      maxNestingDepth: 0,
    });
    assertEquals(res, {
      success: false,
      error: { message: "parse nesting limit exceeded", index },
    });
  }
});

test("parseExpression preserves unterminated comment and string failures", () => {
  const cases = [
    {
      input: "1 /* ([? \" '",
      message: "expected */ at 1:13",
      index: 12,
    },
    {
      input: '"// /* ([? \\"',
      message: 'expected " at 1:14',
      index: 13,
    },
    {
      input: "'// /* ([? \\'",
      message: "expected ' at 1:14",
      index: 13,
    },
  ];

  for (const { input, message, index } of cases) {
    const res = parseExpression(input, {
      throwOnError: false,
      maxNestingDepth: 0,
    });
    assertEquals(res, { success: false, error: { message, index } });
  }
});

test("parseExpression resets conditional depth after a comma", () => {
  const res = parseExpression("[a ? b : c, d ? e : f]", {
    throwOnError: false,
    maxNestingDepth: 2,
  });

  assertEquals(res.success, true);
});

test("parseExpression enforces the exact nesting boundary and error index", () => {
  const boundary = parseExpression("((1))", {
    throwOnError: false,
    maxNestingDepth: 2,
  });
  assertEquals(boundary.success, true);

  const exceeded = parseExpression("((1))", {
    throwOnError: false,
    maxNestingDepth: 1,
  });
  assertEquals(exceeded, {
    success: false,
    error: { message: "parse nesting limit exceeded", index: 1 },
  });
});

test("parseExpression enforces AST node limits", () => {
  const res = parseExpression("1 + 2", {
    throwOnError: false,
    maxNodes: 2,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertStringIncludes(res.error.message, "AST node limit");
});

test("parseExpression validates resource limit options", () => {
  const res = parseExpression("1", {
    throwOnError: false,
    maxNodes: Number.NaN,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertStringIncludes(res.error.message, "non-negative safe integer");

  assertThrows(
    () => parseExpression("1", { maxNestingDepth: -1 }),
    ExpParseError,
    "non-negative safe integer",
  );
});
