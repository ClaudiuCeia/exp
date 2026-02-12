import { assertEquals } from "@std/assert";
import { evaluateExpression } from "../src/eval.ts";

Deno.test("std.len works for strings and arrays", () => {
  const a = evaluateExpression("std.len('abc')", { throwOnError: false });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value, 3);

  const b = evaluateExpression("std.len([1,2,3])", { throwOnError: false });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value, 3);
});

Deno.test("std.len rejects objects", () => {
  const res = evaluateExpression("std.len(obj)", {
    throwOnError: false,
    env: { obj: {} },
  });
  assertEquals(res.success, false);
});

Deno.test("std math helpers work", () => {
  const a = evaluateExpression("std.floor(1.9)", { throwOnError: false });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value, 1);

  const b = evaluateExpression("std.clamp(-1, 0, 10)", { throwOnError: false });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value, 0);
});

Deno.test("std string helpers work", () => {
  const res = evaluateExpression("std.upper(std.trim('  hi '))", {
    throwOnError: false,
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, "HI");
});

Deno.test("env cannot override std", () => {
  const res = evaluateExpression("std.len('a')", {
    throwOnError: false,
    env: { std: {} },
  });
  assertEquals(res.success, false);
});
