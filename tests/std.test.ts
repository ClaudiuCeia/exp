import { test } from "bun:test";
import { assertEquals, assertThrows } from "./assert.ts";
import { evaluateExpression } from "../src/eval.ts";
import type { RuntimeValue } from "../src/runtime.ts";
import { std } from "../src/std.ts";

test("std.len works for strings and arrays", () => {
  const a = evaluateExpression("std.len('abc')", { throwOnError: false });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value, 3);

  const b = evaluateExpression("std.len([1,2,3])", { throwOnError: false });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value, 3);
});

test("std.len rejects objects", () => {
  const res = evaluateExpression("std.len(obj)", {
    throwOnError: false,
    env: { obj: {} },
  });
  assertEquals(res.success, false);
});

test("std math helpers work", () => {
  const a = evaluateExpression("std.floor(1.9)", { throwOnError: false });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value, 1);

  const b = evaluateExpression("std.clamp(-1, 0, 10)", { throwOnError: false });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value, 0);
});

test("std string helpers work", () => {
  const res = evaluateExpression("std.upper(std.trim('  hi '))", {
    throwOnError: false,
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, "HI");
});

test("std.includes supports array membership", () => {
  const a = evaluateExpression("std.includes([1,2,3], 2)", {
    throwOnError: false,
  });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value, true);

  const b = evaluateExpression("std.includes(['a','b'], 'c')", {
    throwOnError: false,
  });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value, false);
});

test("env cannot override std", () => {
  const res = evaluateExpression("std.len('a')", {
    throwOnError: false,
    env: { std: {} },
  });
  assertEquals(res.success, false);
});

test("std cannot be mutated by consumers", () => {
  assertThrows(() => {
    (std as Record<string, RuntimeValue>).len = () => 999;
  }, TypeError);

  const res = evaluateExpression("std.len([1])", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 1);
});

test("std functions cannot be shadowed or reparented by consumers", () => {
  const len = std.len;
  if (typeof len !== "function") throw new Error("missing std.len");

  assertEquals(Object.isFrozen(len), true);
  assertThrows(() => {
    Object.defineProperty(len, "apply", {
      value: () => 999,
    });
  }, TypeError);
  assertThrows(() => {
    Object.setPrototypeOf(len, null);
  }, TypeError);

  const res = evaluateExpression("std.len([1])", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 1);
});
