import { assertEquals } from "@std/assert";
import { parseExpression } from "../src/parse.ts";

Deno.test("parseExpression parses numbers", () => {
  const res = parseExpression("  123  ", { throwOnError: false });
  assertEquals(res.success, true);
  if (res.success) {
    assertEquals(res.value.kind, "number");
    assertEquals(res.value.value, 123);
  }
});

Deno.test("parseExpression parses quoted strings", () => {
  const res = parseExpression("'hi'", { throwOnError: false });
  assertEquals(res.success, true);
  if (res.success) {
    assertEquals(res.value.kind, "string");
    assertEquals(res.value.value, "hi");
  }
});

Deno.test("parseExpression fails on empty", () => {
  const res = parseExpression("   ", { throwOnError: false });
  assertEquals(res.success, false);
});
