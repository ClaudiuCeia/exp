import { assertEquals, assertThrows } from "@std/assert";
import { parseExpression } from "../src/parse.ts";

Deno.test("parseExpression parses numbers", () => {
  const res = parseExpression("  123  ", { throwOnError: false });
  assertEquals(res.success, true);
  if (res.success) {
    assertEquals(res.value.kind, "number");
    if (res.value.kind !== "number") return;
    assertEquals(res.value.value, 123);
  }
});

Deno.test("parseExpression parses quoted strings", () => {
  const res = parseExpression("'hi'", { throwOnError: false });
  assertEquals(res.success, true);
  if (res.success) {
    assertEquals(res.value.kind, "string");
    if (res.value.kind !== "string") return;
    assertEquals(res.value.value, "hi");
  }
});

Deno.test("parseExpression parses double-quoted strings", () => {
  const res = parseExpression('"hi"', { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "hi");
});

Deno.test("parseExpression parses escapes in double-quoted strings", () => {
  const res = parseExpression('"a\\n\\t\\u0041"', { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "a\n\tA");
});

Deno.test("parseExpression parses string escapes", () => {
  const res = parseExpression("'a\\n\\t\\u0041'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "a\n\tA");
});

Deno.test("parseExpression parses more single-character escapes", () => {
  const res = parseExpression("'\\b\\f\\v\\\\'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "\b\f\v\\");
});

Deno.test("parseExpression parses escaped quotes", () => {
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

Deno.test("parseExpression supports identity escapes (strict mode)", () => {
  const res = parseExpression("'\\q'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "q");
});

Deno.test("parseExpression fails on invalid unicode escape", () => {
  const res = parseExpression("'\\u12G4'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression parses \\xNN and \\u{...} escapes", () => {
  const res = parseExpression("'\\x41\\u{1F600}'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "A\u{1F600}");
});

Deno.test("parseExpression supports line continuations in strings", () => {
  const res = parseExpression("'a\\\nB'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

Deno.test("parseExpression supports CR-only line continuations in strings", () => {
  const res = parseExpression("'a\\\rB'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

Deno.test("parseExpression supports CRLF line continuations in strings", () => {
  const res = parseExpression("'a\\\r\nB'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

Deno.test("parseExpression supports unicode line separator continuations in strings", () => {
  const res = parseExpression("'a\\\u2028B'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

Deno.test("parseExpression supports unicode paragraph separator continuations in strings", () => {
  const res = parseExpression("'a\\\u2029B'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value, "aB");
});

Deno.test("parseExpression fails on raw newlines inside string literals", () => {
  const res = parseExpression("'a\nb'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression parses \\0 when not followed by a digit", () => {
  const res = parseExpression("'\\0x'", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value.kind, "string");
  if (res.value.kind !== "string") return;
  assertEquals(res.value.value.length, 2);
  assertEquals(res.value.value.charCodeAt(0), 0);
  assertEquals(res.value.value[1], "x");
});

Deno.test("parseExpression fails on strict-mode digit escapes (\\8)", () => {
  const res = parseExpression("'\\8'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression fails on strict-mode digit escapes (\\1)", () => {
  const res = parseExpression("'\\1'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression fails on strict-mode legacy octal (\\01)", () => {
  const res = parseExpression("'\\01'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression fails on invalid hex escape", () => {
  const res = parseExpression("'\\x4'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression fails on missing '}' in unicode code point escape", () => {
  const res = parseExpression("'\\u{1F600'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression fails on out-of-range unicode code point", () => {
  const res = parseExpression("'\\u{110000}'", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression respects operator precedence", () => {
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

Deno.test("parseExpression parses member access and calls", () => {
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

Deno.test("parseExpression parses arrays", () => {
  const res = parseExpression("[1, 2, 3]", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  assertEquals(res.value.kind, "array");
  if (res.value.kind !== "array") return;
  assertEquals(res.value.elements.length, 3);
});

Deno.test("parseExpression parses ternary conditionals", () => {
  const res = parseExpression("true ? 1 : 2", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;

  assertEquals(res.value.kind, "conditional");
  if (res.value.kind !== "conditional") return;
  assertEquals(res.value.test.kind, "boolean");
  assertEquals(res.value.consequent.kind, "number");
  assertEquals(res.value.alternate.kind, "number");
});

Deno.test("parseExpression parses pipeline operator", () => {
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

Deno.test("parseExpression fails on empty", () => {
  const res = parseExpression("   ", { throwOnError: false });
  assertEquals(res.success, false);
});

Deno.test("parseExpression throws by default on parse errors", () => {
  assertThrows(() => parseExpression("   "));
});
