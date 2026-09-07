import { test } from "bun:test";
import { assertEquals, assertThrows } from "./assert.ts";
import { std, type RuntimeValue, type StandardLibrary } from "../mod.ts";
import { evaluateExpression } from "../src/eval.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type ExpectedStandardLibrary = Readonly<{
  len: (x: RuntimeValue) => number;
  abs: (x: RuntimeValue) => number;
  min: (a: RuntimeValue, b: RuntimeValue) => number;
  max: (a: RuntimeValue, b: RuntimeValue) => number;
  clamp: (x: RuntimeValue, lo: RuntimeValue, hi: RuntimeValue) => number;
  floor: (x: RuntimeValue) => number;
  ceil: (x: RuntimeValue) => number;
  round: (x: RuntimeValue) => number;
  trunc: (x: RuntimeValue) => number;
  sqrt: (x: RuntimeValue) => number;
  pow: (a: RuntimeValue, b: RuntimeValue) => number;
  lower: (s: RuntimeValue) => string;
  upper: (s: RuntimeValue) => string;
  trim: (s: RuntimeValue) => string;
  startsWith: (s: RuntimeValue, prefix: RuntimeValue) => boolean;
  endsWith: (s: RuntimeValue, suffix: RuntimeValue) => boolean;
  includes: (haystack: RuntimeValue, needle: RuntimeValue) => boolean;
  slice: (s: RuntimeValue, start: RuntimeValue, end?: RuntimeValue) => string;
}>;

const exactStandardLibraryType: Equal<
  StandardLibrary,
  ExpectedStandardLibrary
> = true;

test("std exposes exact function signatures through the public entrypoint", () => {
  const typed: StandardLibrary = std;
  const length: number = typed.len("abc");
  const absolute: number = typed.abs(-2);
  const startsWith: boolean = typed.startsWith("abc", "a");
  const slice: string = typed.slice("abc", 1);

  assertEquals(exactStandardLibraryType, true);
  assertEquals([length, absolute, startsWith, slice], [3, 2, true, "bc"]);
});

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

test("std string helpers consume evaluation work at exact boundaries", () => {
  const options = {
    env: { s: "12345678" },
    throwOnError: false,
  } as const;

  assertEquals(
    evaluateExpression("std.upper(s)", { ...options, maxSteps: 20 }),
    {
      success: false,
      error: {
        message: "evaluation budget exceeded",
        span: { start: 0, end: 12 },
        steps: 21,
      },
    },
  );
  assertEquals(
    evaluateExpression("std.upper(s)", { ...options, maxSteps: 21 }),
    { success: true, value: "12345678" },
  );
  assertThrows(
    () =>
      evaluateExpression("std.upper(s)", {
        env: options.env,
        maxSteps: 20,
      }),
    Error,
    "evaluation budget exceeded",
  );
});

test("std prefix and slice helpers reserve bounded string work", () => {
  const env = {
    s: "abcdef",
    nan: Number.NaN,
    negativeInfinity: Number.NEGATIVE_INFINITY,
  };
  const cases = [
    ["std.startsWith(s, 'abc')", true],
    ["std.endsWith(s, 'def')", true],
    ["std.slice(s, 2)", "cdef"],
    ["std.slice(s, nan, 2)", "ab"],
    ["std.slice(s, negativeInfinity, -1)", "abcde"],
    ["std.slice(s, -3, 99)", "def"],
  ] as const;

  for (const [expression, expected] of cases) {
    assertEquals(
      evaluateExpression(expression, {
        env,
        maxSteps: 100,
        throwOnError: false,
      }),
      { success: true, value: expected },
    );
  }
});

test("standard string work uses captured native intrinsics", () => {
  const upperDescriptor = Object.getOwnPropertyDescriptor(
    String.prototype,
    "toUpperCase",
  );
  const truncDescriptor = Object.getOwnPropertyDescriptor(Math, "trunc");
  if (upperDescriptor === undefined || truncDescriptor === undefined) {
    throw new Error("missing native intrinsic descriptor");
  }
  const env = new Proxy(
    { s: "abcdef", start: 0.5 },
    {
      getPrototypeOf(target) {
        Object.defineProperty(String.prototype, "toUpperCase", {
          ...upperDescriptor,
          value: () => "x".repeat(100_000),
        });
        Object.defineProperty(Math, "trunc", {
          ...truncDescriptor,
          value: () => 1_000,
        });
        return Reflect.getPrototypeOf(target);
      },
    },
  );

  try {
    assertEquals(
      evaluateExpression("std.upper(s)", {
        env,
        maxSteps: 100,
        throwOnError: false,
      }),
      { success: true, value: "ABCDEF" },
    );
    assertEquals(
      evaluateExpression("std.slice(s, start)", {
        env,
        maxSteps: 100,
        throwOnError: false,
      }),
      { success: true, value: "abcdef" },
    );
  } finally {
    Reflect.defineProperty(String.prototype, "toUpperCase", upperDescriptor);
    Reflect.defineProperty(Math, "trunc", truncDescriptor);
  }
});

test("standard array work uses captured type checks", () => {
  const isArrayDescriptor = Object.getOwnPropertyDescriptor(Array, "isArray");
  if (isArrayDescriptor === undefined) {
    throw new Error("missing Array.isArray descriptor");
  }
  const env = new Proxy(
    { values: Array.from({ length: 1_000 }, () => 0), target: 1 },
    {
      getPrototypeOf(target) {
        Object.defineProperty(Array, "isArray", {
          ...isArrayDescriptor,
          value: () => false,
        });
        return Reflect.getPrototypeOf(target);
      },
    },
  );

  try {
    assertEquals(
      evaluateExpression("std.includes(values, target)", {
        env,
        maxRuntimeEntries: 2_000,
        maxSteps: 30,
        throwOnError: false,
      }),
      {
        success: false,
        error: {
          message: "evaluation budget exceeded",
          span: { start: 0, end: 28 },
          steps: 31,
        },
      },
    );
  } finally {
    Reflect.defineProperty(Array, "isArray", isArrayDescriptor);
  }
});

test("aliased standard string helpers remain metered", () => {
  assertEquals(
    evaluateExpression("up(s)", {
      env: { up: std.upper, s: "12345678" },
      maxSteps: 13,
      throwOnError: false,
    }),
    {
      success: false,
      error: {
        message: "evaluation budget exceeded",
        span: { start: 0, end: 5 },
        steps: 14,
      },
    },
  );
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

test("std.includes charges only inspected array entries", () => {
  const env = { values: [1, 2, 3, 4] };
  assertEquals(
    evaluateExpression("std.includes(values, 1)", {
      env,
      maxSteps: 23,
      throwOnError: false,
    }),
    { success: true, value: true },
  );
  assertEquals(
    evaluateExpression("std.includes(values, 9)", {
      env,
      maxSteps: 23,
      throwOnError: false,
    }),
    {
      success: false,
      error: {
        message: "evaluation budget exceeded",
        span: { start: 0, end: 23 },
        steps: 24,
      },
    },
  );
});

test("std.includes meters string code-unit comparisons", () => {
  const options = {
    env: { s: "ababa", n: "ba" },
    throwOnError: false,
  } as const;

  assertEquals(
    evaluateExpression("std.includes(s, n)", { ...options, maxSteps: 20 }),
    {
      success: false,
      error: {
        message: "evaluation budget exceeded",
        span: { start: 0, end: 18 },
        steps: 21,
      },
    },
  );
  assertEquals(
    evaluateExpression("std.includes(s, n)", { ...options, maxSteps: 21 }),
    { success: true, value: true },
  );
  assertEquals(
    evaluateExpression("std.includes(s, '')", {
      env: options.env,
      maxSteps: 100,
      throwOnError: false,
    }),
    { success: true, value: true },
  );
  assertEquals(
    evaluateExpression("std.includes(s, 'zz')", {
      env: options.env,
      maxSteps: 100,
      throwOnError: false,
    }),
    { success: true, value: false },
  );
});

test("std.includes stops scanning arrays enlarged by host functions", () => {
  let calls = 0;
  const result = evaluateExpression("grow(values) && std.includes(values, 1)", {
    env: {
      values: [0],
      grow: (value: RuntimeValue) => {
        calls++;
        if (!Array.isArray(value)) throw new Error("expected array");
        value.length = 10_000_000;
        return true;
      },
    },
    maxSteps: 100,
    maxRuntimeEntries: 10,
    throwOnError: false,
  });

  assertEquals(calls, 1);
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(result.error.message, "evaluation budget exceeded");
  assertEquals(result.error.span, { start: 16, end: 39 });
  assertEquals(result.error.steps, 101);
});

test("std.includes does not invoke array accessors installed by host functions", () => {
  let getterCalls = 0;
  const result = evaluateExpression(
    "mutate(values) && std.includes(values, 1)",
    {
      env: {
        values: [0],
        mutate: (value: RuntimeValue) => {
          if (!Array.isArray(value)) throw new Error("expected array");
          Object.defineProperty(value, "0", {
            enumerable: true,
            configurable: true,
            get() {
              getterCalls++;
              return 1;
            },
          });
          return true;
        },
      },
      maxSteps: 100,
      throwOnError: false,
    },
  );

  assertEquals(getterCalls, 0);
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(
    result.error.message,
    "std.includes array entries must be data properties",
  );
});

test("std.includes reads proxy array lengths through data descriptors", () => {
  let lengthReads = 0;
  const values = new Proxy([0, 2], {
    get(target, property, receiver) {
      if (property === "length") lengthReads++;
      return Reflect.get(target, property, receiver);
    },
  });

  assertEquals(
    evaluateExpression("std.includes(make(), 2)", {
      env: { make: () => values },
      maxSteps: 100,
      throwOnError: false,
    }),
    { success: true, value: true },
  );
  assertEquals(lengthReads, 0);
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
