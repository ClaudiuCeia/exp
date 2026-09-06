import { test } from "bun:test";
import { assertEquals, assertMatch, assertThrows } from "./assert.ts";
import type { Expr } from "../src/ast/mod.ts";
import { evaluateAst, evaluateExpression, ExpEvalError } from "../src/eval.ts";
import { isPlainObject, type RuntimeValue } from "../src/runtime.ts";

const countPropertyDescriptorTraversals = <T>(
  run: () => T,
): Readonly<{ result: T; descriptorReads: number }> => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Object,
    "getOwnPropertyDescriptors",
  );
  if (originalDescriptor === undefined) {
    throw new Error("missing Object.getOwnPropertyDescriptors");
  }
  const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  let descriptorReads = 0;

  try {
    Object.defineProperty(Object, "getOwnPropertyDescriptors", {
      ...originalDescriptor,
      value: <U>(value: U) => {
        descriptorReads++;
        return getOwnPropertyDescriptors(value);
      },
    });
    const result = run();
    return { result, descriptorReads };
  } finally {
    Object.defineProperty(
      Object,
      "getOwnPropertyDescriptors",
      originalDescriptor,
    );
  }
};

test("evaluateExpression evaluates arithmetic", () => {
  const res = evaluateExpression("1 + 2 * 3", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 7);
});

test("evaluateExpression handles unary ops", () => {
  const res = evaluateExpression("!false || -1 < +2", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

test("evaluateExpression supports string concatenation", () => {
  const res = evaluateExpression("'a' + 1 + true + null + undefined", {
    throwOnError: false,
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, "a1truenullundefined");
});

test("evaluateExpression parses undefined as a literal", () => {
  const res = evaluateExpression("undefined", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

test("evaluateExpression supports nullish coalescing (??)", () => {
  const a = evaluateExpression("null ?? 1", { throwOnError: false });
  assertEquals(a.success, true);
  if (!a.success) return;
  assertEquals(a.value, 1);

  const b = evaluateExpression("undefined ?? 1", { throwOnError: false });
  assertEquals(b.success, true);
  if (!b.success) return;
  assertEquals(b.value, 1);

  const c = evaluateExpression("0 ?? 1", { throwOnError: false });
  assertEquals(c.success, true);
  if (!c.success) return;
  assertEquals(c.value, 0);
});

test("evaluateExpression nullish coalescing is lazy", () => {
  let called = 0;
  const res = evaluateExpression("0 ?? boom()", {
    throwOnError: false,
    env: {
      boom: () => {
        called++;
        return 123;
      },
    },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 0);
  assertEquals(called, 0);
});

test("evaluateExpression supports all numeric binary operators", () => {
  const res = evaluateExpression(
    "10 - 3 == 7 && 2 * 3 == 6 && 8 / 2 == 4 && 9 % 4 == 1",
    { throwOnError: false },
  );
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

test("evaluateExpression supports comparison operators", () => {
  const res = evaluateExpression(
    "1 < 2 && 2 <= 2 && 3 > 2 && 3 >= 3 && (1 != 2) && (1 == 1)",
    { throwOnError: false },
  );
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

test("evaluateExpression does not coerce objects for == / !=", () => {
  const res1 = evaluateExpression("obj == '[object Object]'", {
    throwOnError: false,
    env: { obj: {} },
  });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, false);

  const res2 = evaluateExpression("xs == '1,2,3'", {
    throwOnError: false,
    env: { xs: [1, 2, 3] },
  });
  assertEquals(res2.success, true);
  if (!res2.success) return;
  assertEquals(res2.value, false);
});

test("evaluateExpression supports toNumber conversions", () => {
  const res1 = evaluateExpression("+true + +false + +null", {
    throwOnError: false,
  });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, 1);

  // By default, missing identifiers are errors.
  const res2 = evaluateExpression("+missing", { throwOnError: false });
  assertEquals(res2.success, false);

  // Legacy JS-ish behavior is still available behind an option.
  const res2b = evaluateExpression("+missing", {
    throwOnError: false,
    unknownIdentifier: "undefined",
  });
  assertEquals(res2b.success, true);
  if (!res2b.success) return;
  assertEquals(typeof res2b.value, "number");
  if (typeof res2b.value !== "number") return;
  assertEquals(Number.isNaN(res2b.value), true);

  const res3 = evaluateExpression("+s", {
    throwOnError: false,
    env: { s: "42" },
  });
  assertEquals(res3.success, true);
  if (!res3.success) return;
  assertEquals(res3.value, 42);
});

test("evaluateExpression errors when numeric ops see non-primitives", () => {
  const res = evaluateExpression("+[1]", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /expected primitive/);
});

test("evaluateExpression errors when string concat sees non-primitives", () => {
  const res = evaluateExpression("'x' + [1]", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /expected primitive/);
});

test("evaluateExpression resolves identifiers + member access", () => {
  const res = evaluateExpression("user.plan", {
    throwOnError: false,
    env: {
      user: { plan: "free" },
    },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, "free");
});

test("evaluateExpression does not revalidate repeated normalized member chains", () => {
  const { result, descriptorReads } = countPropertyDescriptorTraversals(() =>
    evaluateExpression("root.subgraph.value + root.subgraph.value", {
      env: { root: { subgraph: { value: 21 } } },
      throwOnError: false,
    }),
  );

  assertEquals(descriptorReads, 3);
  assertEquals(result.success, true);
  if (!result.success) return;
  assertEquals(result.value, 42);
});

test("evaluateExpression does not recache normalized members after standard library calls", () => {
  const { result, descriptorReads } = countPropertyDescriptorTraversals(() =>
    evaluateExpression(
      "std.abs(0) + root.subgraph.value + root.subgraph.value",
      {
        env: { root: { subgraph: { value: 21 } } },
        throwOnError: false,
      },
    ),
  );

  assertEquals(descriptorReads, 5);
  assertEquals(result, { success: true, value: 42 });
});

test("evaluateExpression creates a fresh normalized member cache for every call", () => {
  const options = {
    env: { root: { subgraph: { value: 21 } } },
    throwOnError: false,
  } as const;
  const { result, descriptorReads } = countPropertyDescriptorTraversals(
    () =>
      [
        evaluateExpression("root.subgraph.value", options),
        evaluateExpression("root.subgraph.value", options),
      ] as const,
  );
  const [first, second] = result;

  assertEquals(descriptorReads, 6);
  assertEquals(first, { success: true, value: 21 });
  assertEquals(second, { success: true, value: 21 });
});

test("evaluateExpression member access works on arrays (length only)", () => {
  const res1 = evaluateExpression("xs.length", {
    throwOnError: false,
    env: { xs: [1, 2, 3] },
  });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, 3);

  const res2 = evaluateExpression("xs.nope", {
    throwOnError: false,
    env: { xs: [1, 2, 3] },
  });
  assertEquals(res2.success, true);
  if (!res2.success) return;
  assertEquals(res2.value, undefined);
});

test("evaluateExpression keeps runtime entry limits scoped away from array literals", () => {
  const res = evaluateExpression("[1].length", {
    maxRuntimeEntries: 0,
    throwOnError: false,
  });

  assertEquals(res, { success: true, value: 1 });
});

test("evaluateExpression member access works on proto-null objects", () => {
  const obj = Object.assign(Object.create(null), { a: 1 });
  const res = evaluateExpression("obj.a", {
    throwOnError: false,
    env: { obj },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 1);
});

test("evaluateExpression does not expose inherited env properties", () => {
  const res = evaluateExpression("toString", {
    throwOnError: false,
    env: {},
    unknownIdentifier: "undefined",
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

test("evaluateExpression does not expose inherited member properties", () => {
  const res = evaluateExpression("obj.toString", {
    throwOnError: false,
    env: { obj: {} },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

test("evaluateExpression errors by default on missing identifiers", () => {
  const res = evaluateExpression("missing", { throwOnError: false });
  assertEquals(res.success, false);
});

test("evaluateExpression can treat missing identifiers as undefined", () => {
  const res = evaluateExpression("missing", {
    throwOnError: false,
    unknownIdentifier: "undefined",
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

test("evaluateExpression can call allow-listed functions", () => {
  const res = evaluateExpression("inc(41)", {
    throwOnError: false,
    env: {
      inc: (x: unknown) => (typeof x === "number" ? x + 1 : 0),
    },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 42);
});

test("evaluateExpression binds receiver for member calls", () => {
  const user = {
    name: "Ada",
    getName: function (this: unknown) {
      if (typeof this === "object" && this !== null && "name" in this) {
        return (this as Record<"name", RuntimeValue>).name;
      }
      return "bad";
    },
  };

  const res = evaluateExpression("user.getName()", {
    throwOnError: false,
    env: { user },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, "Ada");
});

test("evaluateExpression errors when calling non-functions", () => {
  const res = evaluateExpression("1(2)", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /non-function/);
});

test("evaluateExpression catches env function exceptions", () => {
  const res = evaluateExpression("boom()", {
    throwOnError: false,
    env: {
      boom: () => {
        throw new Error("kaboom");
      },
    },
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "kaboom");
});

test("evaluateExpression does not coerce hostile function exceptions", () => {
  let coercions = 0;
  const thrown = {
    get message(): string {
      coercions++;
      throw new Error("message getter ran");
    },
    toString(): string {
      coercions++;
      throw new Error("toString ran");
    },
  };

  const res = evaluateExpression("boom()", {
    throwOnError: false,
    env: {
      boom: () => {
        throw thrown;
      },
    },
  });

  assertEquals(res.success, false);
  assertEquals(coercions, 0);
  if (res.success) return;
  assertEquals(res.error.message, "unknown thrown value");
});

test("evaluateExpression contains nested exception-description failures", () => {
  const thrown = new Proxy<Record<string, unknown>>(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error("message inspection ran");
      },
    },
  );

  const res = evaluateExpression("boom()", {
    throwOnError: false,
    env: {
      boom: () => {
        throw thrown;
      },
    },
  });

  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "unknown thrown value");
});

test("evaluateExpression does not depend on the global String function", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "String");
  if (descriptor === undefined) throw new Error("missing global String");

  try {
    Object.defineProperty(globalThis, "String", {
      ...descriptor,
      value: () => {
        throw new Error("global String ran");
      },
    });
    const res = evaluateExpression("boom()", {
      throwOnError: false,
      env: {
        boom: () => {
          throw 7;
        },
      },
    });

    assertEquals(res.success, false);
    if (res.success) return;
    assertEquals(res.error.message, "7");
  } finally {
    Object.defineProperty(globalThis, "String", descriptor);
  }
});

test("evaluateExpression reports primitive function exceptions deterministically", () => {
  const cases: readonly (readonly [unknown, string])[] = [
    [undefined, "undefined"],
    [null, "null"],
    [false, "false"],
    [42, "42"],
    [42n, "42"],
    ["failed", "failed"],
    [Symbol("failed"), "unknown thrown value"],
  ];

  for (const [thrown, message] of cases) {
    const res = evaluateExpression("boom()", {
      throwOnError: false,
      env: {
        boom: () => {
          throw thrown;
        },
      },
    });

    assertEquals(res.success, false);
    if (res.success) continue;
    assertEquals(res.error.message, message);
  }
});

test("evaluateExpression rejects unsupported function return values", () => {
  const res = evaluateExpression("f()", {
    throwOnError: false,
    env: {
      // Date is not an allowed runtime value.
      f: () => ({ when: new Date() }) as unknown as RuntimeValue,
    },
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /unsupported value/);
});

test("evaluateExpression does not expose hidden function return values", () => {
  const value = Object.create(null);
  Object.defineProperty(value, "secret", {
    value: new Date(),
    enumerable: false,
  });

  const res = evaluateExpression("f().secret", {
    throwOnError: false,
    env: { f: () => value },
  });

  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

test("evaluateExpression does not invoke hidden function return getters", () => {
  let called = 0;
  const value = Object.create(null);
  Object.defineProperty(value, "secret", {
    enumerable: false,
    get() {
      called++;
      throw new Error("getter ran");
    },
  });

  const res = evaluateExpression("f().secret", {
    throwOnError: false,
    env: { f: () => value },
  });

  assertEquals(res.success, true);
  assertEquals(called, 0);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

test("evaluateExpression rejects returned accessors without invoking them", () => {
  let called = 0;
  const value = Object.create(null);
  Object.defineProperty(value, "secret", {
    enumerable: true,
    get() {
      called++;
      throw new Error("getter ran");
    },
  });

  const res = evaluateExpression("f()", {
    throwOnError: false,
    env: { f: () => value },
  });

  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertMatch(res.error.message, /unsupported value/);
});

test("evaluateExpression rejects unsupported env values", () => {
  assertThrows(() => {
    evaluateExpression("x", {
      throwOnError: true,
      env: { x: new Date() as unknown as RuntimeValue },
      throwOnParseError: true,
    });
  });

  const res = evaluateExpression("x", {
    throwOnError: false,
    env: { x: new Date() as unknown as RuntimeValue },
    throwOnParseError: false,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /env\['x'\] is not a supported runtime value/);
});

test("evaluateExpression rejects env accessor properties without invoking them", () => {
  let called = 0;
  const env: Record<string, unknown> = {};
  Object.defineProperty(env, "x", {
    enumerable: true,
    get() {
      called++;
      throw new Error("getter ran");
    },
  });

  const res = evaluateExpression("x", {
    throwOnError: false,
    env: env as unknown as Record<string, RuntimeValue>,
  });

  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertMatch(res.error.message, /data property/);
});

test("evaluateExpression rejects nested accessor properties without invoking them", () => {
  let called = 0;
  const user: Record<string, unknown> = {};
  Object.defineProperty(user, "plan", {
    enumerable: true,
    get() {
      called++;
      throw new Error("getter ran");
    },
  });

  const res = evaluateExpression("user.plan", {
    throwOnError: false,
    env: { user } as unknown as Record<string, RuntimeValue>,
  });

  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertMatch(res.error.message, /data property/);
});

test("evaluateExpression rejects array index accessor properties without invoking them", () => {
  let called = 0;
  const xs: unknown[] = [1];
  Object.defineProperty(xs, "0", {
    enumerable: true,
    get() {
      called++;
      throw new Error("getter ran");
    },
  });

  const res = evaluateExpression("xs.length", {
    throwOnError: false,
    env: { xs } as unknown as Record<string, RuntimeValue>,
  });

  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertMatch(res.error.message, /data property/);
});

test("evaluateExpression preserves shared environment references", () => {
  const shared = { value: 1 };
  const direct = evaluateExpression("a == b", {
    throwOnError: false,
    env: { a: shared, b: shared },
  });
  assertEquals(direct.success, true);
  if (!direct.success) return;
  assertEquals(direct.value, true);

  const nested = evaluateExpression("std.includes(items, item)", {
    throwOnError: false,
    env: { item: shared, items: [shared] },
  });
  assertEquals(nested.success, true);
  if (!nested.success) return;
  assertEquals(nested.value, true);
});

test("evaluateExpression safely normalizes cyclic environments", () => {
  const node: Record<string, RuntimeValue> = {};
  node.self = node;
  const objectResult = evaluateExpression("node.self == node", {
    throwOnError: false,
    env: { node },
  });
  assertEquals(objectResult.success, true);
  if (!objectResult.success) return;
  assertEquals(objectResult.value, true);

  const xs: RuntimeValue[] = [];
  xs.push(xs);
  const arrayResult = evaluateExpression("std.includes(xs, xs)", {
    throwOnError: false,
    env: { xs },
  });
  assertEquals(arrayResult.success, true);
  if (!arrayResult.success) return;
  assertEquals(arrayResult.value, true);
});

test("evaluateExpression rejects accessors in cyclic environments", () => {
  let called = 0;
  const node: Record<string, unknown> = {};
  node.self = node;
  Object.defineProperty(node, "value", {
    enumerable: true,
    get() {
      called++;
      return 1;
    },
  });

  const res = evaluateExpression("node.self", {
    throwOnError: false,
    env: { node } as unknown as Record<string, RuntimeValue>,
  });
  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertMatch(res.error.message, /data property/);
});

test("evaluateExpression contains hostile environment inspection exceptions", () => {
  let coercions = 0;
  const thrown = {
    toString(): string {
      coercions++;
      throw new Error("toString ran");
    },
  };
  const env = new Proxy<Record<string, RuntimeValue>>(
    {},
    {
      getPrototypeOf() {
        throw thrown;
      },
    },
  );

  const res = evaluateExpression("1", {
    env,
    throwOnError: false,
  });

  assertEquals(res.success, false);
  assertEquals(coercions, 0);
  if (res.success) return;
  assertEquals(res.error.message, "environment inspection failed");
  assertEquals(res.error.steps, 0);
});

test("evaluateExpression contains post-normalization intrinsic failures", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn");
  if (descriptor === undefined) throw new Error("missing Object.hasOwn");
  const env = new Proxy<Record<string, RuntimeValue>>(
    {},
    {
      getPrototypeOf(target) {
        Object.defineProperty(Object, "hasOwn", {
          ...descriptor,
          value: () => {
            throw new Error("Object.hasOwn ran");
          },
        });
        return Reflect.getPrototypeOf(target);
      },
    },
  );

  try {
    const res = evaluateExpression("1", {
      env,
      throwOnError: false,
    });

    assertEquals(res.success, false);
    if (res.success) return;
    assertEquals(res.error.message, "evaluation setup failed");
    assertEquals(res.error.steps, 0);
  } finally {
    Reflect.defineProperty(Object, "hasOwn", descriptor);
  }
});

test("evaluateExpression bounds runtime value normalization", () => {
  const nested = { child: { child: { value: 1 } } };
  const depthResult = evaluateExpression("nested.child", {
    throwOnError: false,
    env: { nested },
    maxRuntimeDepth: 1,
  });
  assertEquals(depthResult.success, false);
  if (depthResult.success) return;
  assertMatch(depthResult.error.message, /runtime depth limit/);

  const entriesResult = evaluateExpression("xs", {
    throwOnError: false,
    env: { xs: Array.from({ length: 100 }) },
    maxRuntimeEntries: 10,
  });
  assertEquals(entriesResult.success, false);
  if (entriesResult.success) return;
  assertMatch(entriesResult.error.message, /runtime entry limit/);
});

test("evaluateExpression revalidates values after host mutation", () => {
  const res = evaluateExpression("mutate(obj) + obj.secret", {
    throwOnError: false,
    env: {
      obj: {},
      mutate: (value: RuntimeValue) => {
        if (typeof value === "object" && value !== null) {
          Object.defineProperty(value, "secret", {
            value: new Date(),
            enumerable: true,
          });
        }
        return 0;
      },
    },
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression clears cached values before proxy validation", () => {
  const res = evaluateExpression(
    "install(root) == 0 && root.safe.value == 1 && root.proxy.value == 0 && root.safe.value",
    {
      env: {
        root: { safe: { value: 1 } },
        install: (value: RuntimeValue) => {
          if (!isPlainObject(value) || !isPlainObject(value.safe)) return -1;
          const safe = value.safe;
          const target = Object.assign(
            Object.create(null) as Record<string, RuntimeValue>,
            { value: 0 },
          );
          value.proxy = new Proxy(target, {
            getOwnPropertyDescriptor(object, property) {
              if (property === "value") {
                safe.value = new Date() as unknown as RuntimeValue;
              }
              return Reflect.getOwnPropertyDescriptor(object, property);
            },
          });
          return 0;
        },
      },
      throwOnError: false,
    },
  );

  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression does not cache containers mutated during validation", () => {
  const res = evaluateExpression("install(root) == 0 && root.safe.value", {
    env: {
      root: { safe: { value: 1 } },
      install: (value: RuntimeValue) => {
        if (!isPlainObject(value) || !isPlainObject(value.safe)) return -1;
        const safe = value.safe;
        const target = Object.assign(
          Object.create(null) as Record<string, RuntimeValue>,
          { value: 0 },
        );
        safe.proxy = new Proxy(target, {
          getOwnPropertyDescriptor(object, property) {
            if (property === "value") {
              safe.value = new Date() as unknown as RuntimeValue;
            }
            return Reflect.getOwnPropertyDescriptor(object, property);
          },
        });
        return 0;
      },
    },
    throwOnError: false,
  });

  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression validates cyclic function return values", () => {
  const value: Record<string, RuntimeValue> = {};
  value.self = value;
  const res = evaluateExpression("f().self == f().self", {
    throwOnError: false,
    env: { f: () => value },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

test("evaluateExpression allows structured return values", () => {
  const res = evaluateExpression("f().a + f().b.length", {
    throwOnError: false,
    env: {
      f: () => ({ a: 41, b: [1] }),
    },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 42);
});

test("evaluateExpression does not cache validated function return values", () => {
  const target = Object.assign(
    Object.create(null) as Record<string, RuntimeValue>,
    { value: 1 },
  );
  let descriptorReads = 0;
  const returned = new Proxy(target, {
    getOwnPropertyDescriptor(value, property) {
      if (property === "value") {
        descriptorReads++;
        return {
          configurable: true,
          enumerable: true,
          value: descriptorReads === 1 ? 1 : new Date(),
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(value, property);
    },
  });

  const res = evaluateExpression("make().value", {
    env: { make: () => returned },
    throwOnError: false,
  });

  assertEquals(descriptorReads, 2);
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression uses captured WeakSet methods for returned member validation", () => {
  const hasDescriptor = Object.getOwnPropertyDescriptor(
    WeakSet.prototype,
    "has",
  );
  if (hasDescriptor === undefined) {
    throw new Error("missing WeakSet.prototype.has");
  }
  const target = Object.assign(
    Object.create(null) as Record<string, RuntimeValue>,
    { value: 1 },
  );
  let descriptorReads = 0;
  const returned = new Proxy(target, {
    getOwnPropertyDescriptor(value, property) {
      if (property === "value") {
        descriptorReads++;
        if (descriptorReads === 1) {
          Object.defineProperty(WeakSet.prototype, "has", {
            ...hasDescriptor,
            value: () => true,
          });
        }
        return {
          configurable: true,
          enumerable: true,
          value: descriptorReads === 1 ? 1 : 1n,
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(value, property);
    },
  });
  let result: ReturnType<typeof evaluateExpression> | undefined;

  try {
    result = evaluateExpression("make().value", {
      env: { make: () => returned },
      throwOnError: false,
    });
  } finally {
    Object.defineProperty(WeakSet.prototype, "has", hasDescriptor);
  }

  assertEquals(descriptorReads, 2);
  if (result === undefined) throw new Error("evaluation did not return");
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(result.error.message, "member is not a supported runtime value");
});

test("evaluateExpression uses the captured array length validator", () => {
  const safeIntegerDescriptor = Object.getOwnPropertyDescriptor(
    Number,
    "isSafeInteger",
  );
  if (safeIntegerDescriptor === undefined) {
    throw new Error("missing Number.isSafeInteger");
  }
  let descriptorReads = 0;
  const returned = new Proxy([1], {
    getOwnPropertyDescriptor(value, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
      if (property !== "length" || descriptor === undefined) return descriptor;
      descriptorReads++;
      if (descriptorReads === 2) {
        Object.defineProperty(Number, "isSafeInteger", {
          ...safeIntegerDescriptor,
          value: () => true,
        });
      }
      return descriptorReads === 3 ? { ...descriptor, value: 1.5 } : descriptor;
    },
  });
  let result: ReturnType<typeof evaluateExpression> | undefined;

  try {
    result = evaluateExpression("make().length", {
      env: { make: () => returned },
      throwOnError: false,
    });
  } finally {
    Object.defineProperty(Number, "isSafeInteger", safeIntegerDescriptor);
  }

  assertEquals(descriptorReads, 3);
  if (result === undefined) throw new Error("evaluation did not return");
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(result.error.message, "member is not a supported runtime value");
});

test("evaluateExpression reads returned array length without invoking proxy get traps", () => {
  let getCalls = 0;
  const returned = new Proxy([1], {
    get(value, property, receiver) {
      if (property === "length") {
        getCalls++;
        return new Date();
      }
      return Reflect.get(value, property, receiver);
    },
  });

  const res = evaluateExpression("make().length", {
    env: { make: () => returned },
    throwOnError: false,
  });

  assertEquals(getCalls, 0);
  assertEquals(res, { success: true, value: 1 });
});

test("evaluateExpression rejects returned array proxies revoked after validation", () => {
  let descriptorReads = 0;
  const { proxy, revoke } = Proxy.revocable([1], {
    getOwnPropertyDescriptor(value, property) {
      descriptorReads++;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
      if (property === "0") revoke();
      return descriptor;
    },
  });

  const res = evaluateExpression("make().length", {
    env: { make: () => proxy },
    throwOnError: false,
  });

  assertEquals(descriptorReads, 2);
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression rejects returned array proxies that throw on revalidation", () => {
  let lengthDescriptorReads = 0;
  const returned = new Proxy([1], {
    getOwnPropertyDescriptor(value, property) {
      if (property === "length") {
        lengthDescriptorReads++;
        if (lengthDescriptorReads === 2) {
          throw new Error("length descriptor failed");
        }
      }
      return Reflect.getOwnPropertyDescriptor(value, property);
    },
  });

  const res = evaluateExpression("make().length", {
    env: { make: () => returned },
    throwOnError: false,
  });

  assertEquals(lengthDescriptorReads, 2);
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression rejects malformed returned array length descriptors", () => {
  const invalidLengths: readonly unknown[] = [
    "1",
    -1,
    1.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
    4,
  ];

  for (const invalidLength of invalidLengths) {
    let descriptorReads = 0;
    let getCalls = 0;
    const returned = new Proxy([1], {
      get(value, property, receiver) {
        if (property === "length") getCalls++;
        return Reflect.get(value, property, receiver);
      },
      getOwnPropertyDescriptor(value, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
        if (property !== "length" || descriptor === undefined) {
          return descriptor;
        }
        descriptorReads++;
        return descriptorReads === 3
          ? { ...descriptor, value: invalidLength }
          : descriptor;
      },
    });

    const res = evaluateExpression("make().length", {
      env: { make: () => returned },
      maxRuntimeEntries: 3,
      throwOnError: false,
    });

    assertEquals(descriptorReads, 3);
    assertEquals(getCalls, 0);
    assertEquals(res.success, false);
    if (res.success) continue;
    assertEquals(res.error.message, "member is not a supported runtime value");
  }
});

test("evaluateExpression rejects arrays enlarged by host code before reading entries", () => {
  let getterCalls = 0;
  const res = evaluateExpression("enlarge(xs) + xs.length", {
    env: {
      xs: [1],
      enlarge: (value: RuntimeValue) => {
        if (Array.isArray(value)) {
          value.length = 4;
          Object.defineProperty(value, "0", {
            configurable: true,
            enumerable: true,
            get() {
              getterCalls++;
              return new Date();
            },
          });
        }
        return 0;
      },
    },
    maxRuntimeEntries: 3,
    throwOnError: false,
  });

  assertEquals(getterCalls, 0);
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "member is not a supported runtime value");
});

test("evaluateExpression supports pipeline operator", () => {
  const env = {
    inc: (x: RuntimeValue) => (typeof x === "number" ? x + 1 : 0),
    add: (x: RuntimeValue, y: RuntimeValue) =>
      typeof x === "number" && typeof y === "number" ? x + y : 0,
  };

  const res1 = evaluateExpression("41 |> inc", { throwOnError: false, env });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, 42);

  const res2 = evaluateExpression("41 |> add(1)", { throwOnError: false, env });
  assertEquals(res2.success, true);
  if (!res2.success) return;
  assertEquals(res2.value, 42);

  const res3 = evaluateExpression("1 + 2 |> inc", { throwOnError: false, env });
  assertEquals(res3.success, true);
  if (!res3.success) return;
  assertEquals(res3.value, 4);

  const res4 = evaluateExpression("40 |> inc |> inc", {
    throwOnError: false,
    env,
  });
  assertEquals(res4.success, true);
  if (!res4.success) return;
  assertEquals(res4.value, 42);
});

test("evaluateExpression short-circuits &&", () => {
  const res = evaluateExpression("false && boom()", {
    throwOnError: false,
    env: {
      boom: () => {
        throw new Error("should not run");
      },
    },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, false);
});

test("evaluateExpression evaluates RHS for && when LHS truthy", () => {
  const res = evaluateExpression("true && inc(41)", {
    throwOnError: false,
    env: { inc: (x: RuntimeValue) => (typeof x === "number" ? x + 1 : 0) },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 42);
});

test("evaluateExpression short-circuits ||", () => {
  const res = evaluateExpression("true || boom()", {
    throwOnError: false,
    env: {
      boom: () => {
        throw new Error("should not run");
      },
    },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

test("evaluateExpression evaluates RHS for || when LHS falsy", () => {
  const res = evaluateExpression("false || 42", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 42);
});

test("evaluateExpression evaluates conditionals", () => {
  const res1 = evaluateExpression("true ? 1 : 2", { throwOnError: false });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, 1);

  const res2 = evaluateExpression("false ? 1 : 2", { throwOnError: false });
  assertEquals(res2.success, true);
  if (!res2.success) return;
  assertEquals(res2.value, 2);
});

test("evaluateExpression forbids dangerous member access", () => {
  try {
    evaluateExpression("obj.__proto__", {
      env: { obj: { a: 1 } },
      throwOnError: true,
    });
    throw new Error("expected evaluateExpression to throw");
  } catch (e) {
    assertEquals(e instanceof ExpEvalError, true);
    if (e instanceof ExpEvalError) {
      assertEquals(typeof e.steps, "number");
      assertEquals(e.steps !== undefined && e.steps >= 1, true);
      assertEquals(!!e.span, true);
    }
  }

  const res = evaluateExpression("obj.__proto__", {
    env: { obj: { a: 1 } },
    throwOnError: false,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /forbidden member access/);
});

test("evaluateExpression enforces step budgets", () => {
  const res = evaluateExpression("1 + 2", {
    throwOnError: false,
    maxSteps: 0,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /budget exceeded/);
});

test("evaluateExpression enforces array literal size budgets", () => {
  const res = evaluateExpression("[1, 2]", {
    throwOnError: false,
    maxArrayElements: 1,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /array literal too large/);
});

test("evaluateExpression enforces call argument size budgets", () => {
  const env = {
    count: (...args: RuntimeValue[]) => args.length,
  };
  const empty = evaluateExpression("count()", {
    env,
    throwOnError: false,
    maxCallArguments: 0,
  });
  assertEquals(empty.success, true);
  if (empty.success) assertEquals(empty.value, 0);

  const exact = evaluateExpression("count(1, 2)", {
    env,
    throwOnError: false,
    maxCallArguments: 2,
  });
  assertEquals(exact.success, true);
  if (exact.success) assertEquals(exact.value, 2);

  const over = evaluateExpression("count(1, 2, 3)", {
    env,
    throwOnError: false,
    maxCallArguments: 2,
  });
  assertEquals(over.success, false);
  if (over.success) return;
  assertEquals(over.error.message, "invalid AST: call argument list too large");
});

test("evaluateExpression enforces the default call argument boundary", () => {
  const argumentCount = 1_000;
  const input = `count(${Array.from({ length: argumentCount }, () => "0").join(",")})`;
  const res = evaluateExpression(input, {
    env: { count: (...args: RuntimeValue[]) => args.length },
    throwOnError: false,
  });

  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, argumentCount);

  const over = evaluateExpression(`${input.slice(0, -1)},0)`, {
    env: { count: (...args: RuntimeValue[]) => args.length },
    throwOnError: false,
  });
  assertEquals(over.success, false);
  if (over.success) return;
  assertEquals(over.error.message, "invalid AST: call argument list too large");
  assertEquals(over.error.steps, 1);
});

test("evaluateExpression enforces recursion depth budgets", () => {
  const res = evaluateExpression("!true", {
    throwOnError: false,
    maxDepth: 0,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /recursion limit exceeded/);
});

test("evaluateExpression rejects invalid evaluation budgets", () => {
  const cases = [
    { maxSteps: Number.NaN },
    { maxDepth: Number.POSITIVE_INFINITY },
    { maxArrayElements: -1 },
    { maxCallArguments: -1 },
    { maxRuntimeDepth: 1.5 },
    { maxRuntimeEntries: -1 },
  ];

  for (const options of cases) {
    const res = evaluateExpression("1", {
      ...options,
      throwOnError: false,
    });
    assertEquals(res.success, false);
    if (res.success) continue;
    assertMatch(res.error.message, /non-negative safe integer/);
    assertEquals(res.error.steps, 0);
  }
});

test("evaluateExpression reports parse failures when throwOnParseError=false", () => {
  const res = evaluateExpression("(", {
    throwOnError: false,
    throwOnParseError: false,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(typeof res.error.index, "number");
  assertEquals(res.error.index !== undefined && res.error.index >= 0, true);
});

test("evaluateExpression forwards parser resource limits", () => {
  const res = evaluateExpression("1 + 2", {
    throwOnError: false,
    throwOnParseError: false,
    maxNodes: 2,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /AST node limit/);
  assertEquals(res.error.steps, 0);
});

test("evaluateAst returns errors for unknown operators (defensive)", () => {
  const badUnary = {
    kind: "unary",
    op: "~",
    expr: { kind: "number", value: 1, span: { start: 0, end: 1 } },
    span: { start: 0, end: 2 },
  } as unknown as Expr;

  const ur = evaluateAst(badUnary, { throwOnError: false });
  assertEquals(ur.success, false);
  if (ur.success) return;
  assertMatch(ur.error.message, /unknown unary operator/);

  const badBinary = {
    kind: "binary",
    op: "**",
    left: { kind: "number", value: 1, span: { start: 0, end: 1 } },
    right: { kind: "number", value: 2, span: { start: 4, end: 5 } },
    span: { start: 0, end: 5 },
  } as unknown as Expr;

  const br = evaluateAst(badBinary, { throwOnError: false });
  assertEquals(br.success, false);
  if (br.success) return;
  assertMatch(br.error.message, /unknown binary operator/);
});

test("evaluateAst rejects malformed nodes in non-throwing mode", () => {
  const cases = [
    null,
    { kind: "unknown", span: { start: 0, end: 0 } },
    { kind: "number", value: new Date(), span: { start: 0, end: 1 } },
    { kind: "array", elements: null, span: { start: 0, end: 1 } },
  ];

  for (const value of cases) {
    const res = evaluateAst(value as unknown as Expr, { throwOnError: false });
    assertEquals(res.success, false);
    if (res.success) continue;
    assertMatch(res.error.message, /invalid AST/);
  }
});

test("evaluateAst rejects accessors without invoking them", () => {
  let called = 0;
  const expr: Record<string, unknown> = {
    span: { start: 0, end: 1 },
  };
  Object.defineProperty(expr, "kind", {
    enumerable: true,
    get() {
      called++;
      return "number";
    },
  });

  const res = evaluateAst(expr as unknown as Expr, { throwOnError: false });
  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertMatch(res.error.message, /data property/);
});

test("evaluateAst contains hostile validation exceptions", () => {
  let coercions = 0;
  const thrown = {
    toString(): string {
      coercions++;
      throw new Error("toString ran");
    },
  };
  const expr = new Proxy<Record<string, unknown>>(
    {},
    {
      getOwnPropertyDescriptor() {
        throw thrown;
      },
    },
  );

  const res = evaluateAst(expr as unknown as Expr, { throwOnError: false });

  assertEquals(res.success, false);
  assertEquals(coercions, 0);
  if (res.success) return;
  assertEquals(res.error.message, "invalid AST: inspection failed");
  assertEquals(res.error.steps, 1);
});

test("evaluateAst contains hostile property reads after validation", () => {
  let coercions = 0;
  const thrown = {
    toString(): string {
      coercions++;
      throw new Error("toString ran");
    },
  };
  const target: Expr = {
    kind: "number",
    value: 1,
    span: { start: 0, end: 1 },
  };
  const expr = new Proxy(target, {
    get(value, property, receiver) {
      if (property === "span") throw thrown;
      return Reflect.get(value, property, receiver);
    },
  });

  const res = evaluateAst(expr, { throwOnError: false });

  assertEquals(res.success, false);
  assertEquals(coercions, 0);
  if (res.success) return;
  assertEquals(res.error.message, "unknown thrown value");
  assertEquals(res.error.steps, 0);
  assertEquals(res.error.span, undefined);
});

test("evaluateAst contains post-validation intrinsic failures", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn");
  if (descriptor === undefined) throw new Error("missing Object.hasOwn");
  const target: Expr = {
    kind: "number",
    value: 1,
    span: { start: 0, end: 1 },
  };
  const expr = new Proxy(target, {
    getOwnPropertyDescriptor(value, property) {
      if (property === "kind") {
        Object.defineProperty(Object, "hasOwn", {
          ...descriptor,
          value: () => {
            throw new Error("Object.hasOwn ran");
          },
        });
      }
      return Reflect.getOwnPropertyDescriptor(value, property);
    },
  });

  try {
    const res = evaluateAst(expr, { throwOnError: false });

    assertEquals(res.success, false);
    if (res.success) return;
    assertEquals(res.error.message, "evaluation setup failed");
    assertEquals(res.error.steps, 0);
  } finally {
    Reflect.defineProperty(Object, "hasOwn", descriptor);
  }
});

test("evaluateAst bounds 100,000 aliased arguments by traversed edges", () => {
  const shared: Expr = {
    kind: "number",
    value: 1,
    span: { start: 2, end: 3 },
  };
  const expr: Expr = {
    kind: "call",
    callee: {
      kind: "identifier",
      name: "fn",
      span: { start: 0, end: 1 },
    },
    args: Array<Expr>(100_000).fill(shared),
    span: { start: 0, end: 3 },
  };

  const res = evaluateAst(expr, {
    throwOnError: false,
    maxCallArguments: 100_000,
    maxSteps: 1,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "invalid AST: validation budget exceeded");
  assertEquals(res.error.steps, 2);
});

test("evaluateAst counts unique and aliased call argument edges", () => {
  const callee: Expr = {
    kind: "identifier",
    name: "count",
    span: { start: 0, end: 5 },
  };
  const uniqueArgs: Expr[] = Array.from({ length: 4 }, (_, index) => ({
    kind: "number",
    value: index,
    span: { start: index + 6, end: index + 7 },
  }));
  const shared = uniqueArgs[0];
  if (shared === undefined) throw new Error("missing test argument");
  const cases: Expr[][] = [uniqueArgs, Array<Expr>(4).fill(shared)];

  for (const args of cases) {
    const expr: Expr = {
      kind: "call",
      callee,
      args,
      span: { start: 0, end: 10 },
    };
    const rejected = evaluateAst(expr, {
      env: { count: (...values: RuntimeValue[]) => values.length },
      throwOnError: false,
      maxSteps: 5,
    });
    assertEquals(rejected.success, false);
    if (!rejected.success) {
      assertEquals(
        rejected.error.message,
        "invalid AST: validation budget exceeded",
      );
      assertEquals(rejected.error.steps, 6);
    }

    const accepted = evaluateAst(expr, {
      env: { count: (...values: RuntimeValue[]) => values.length },
      throwOnError: false,
      maxSteps: 6,
    });
    assertEquals(accepted.success, true);
    if (accepted.success) assertEquals(accepted.value, 4);
  }
});

test("evaluateAst rejects sparse child arrays", () => {
  const args: Expr[] = [];
  args.length = 1;
  const expr: Expr = {
    kind: "call",
    callee: {
      kind: "identifier",
      name: "fn",
      span: { start: 0, end: 2 },
    },
    args,
    span: { start: 0, end: 4 },
  };

  const res = evaluateAst(expr, { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(
    res.error.message,
    "invalid AST: 'args[0]' must be an own data property",
  );
});

test("evaluateAst rejects accessor child entries without invocation", () => {
  let called = 0;
  const elements: Expr[] = [];
  elements.length = 1;
  Object.defineProperty(elements, "0", {
    configurable: true,
    enumerable: true,
    get() {
      called++;
      return {
        kind: "number",
        value: 1,
        span: { start: 3, end: 4 },
      } satisfies Expr;
    },
  });
  const expr: Expr = {
    kind: "array",
    elements,
    span: { start: 0, end: 5 },
  };

  const res = evaluateAst(expr, { throwOnError: false });
  assertEquals(res.success, false);
  assertEquals(called, 0);
  if (res.success) return;
  assertEquals(
    res.error.message,
    "invalid AST: 'elements[0]' must be an own data property",
  );
});

test("evaluateAst rejects malformed child array descriptors", () => {
  let argsPropertyCalled = 0;
  const malformedProperty: Record<string, unknown> = {
    kind: "call",
    callee: {
      kind: "identifier",
      name: "fn",
      span: { start: 0, end: 2 },
    },
    span: { start: 0, end: 4 },
  };
  Object.defineProperty(malformedProperty, "args", {
    enumerable: true,
    get() {
      argsPropertyCalled++;
      return [];
    },
  });
  const propertyResult = evaluateAst(malformedProperty as unknown as Expr, {
    throwOnError: false,
  });
  assertEquals(propertyResult.success, false);
  assertEquals(argsPropertyCalled, 0);
  if (!propertyResult.success) {
    assertEquals(
      propertyResult.error.message,
      "invalid AST: 'args' must be an own data property",
    );
  }

  const child: Expr = {
    kind: "number",
    value: 1,
    span: { start: 3, end: 4 },
  };
  const malformedLength = new Proxy<Expr[]>([child], {
    getOwnPropertyDescriptor(target, property) {
      if (property === "length") {
        return {
          configurable: false,
          enumerable: false,
          value: "1",
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const lengthResult = evaluateAst(
    {
      kind: "call",
      callee: {
        kind: "identifier",
        name: "fn",
        span: { start: 0, end: 2 },
      },
      args: malformedLength,
      span: { start: 0, end: 5 },
    },
    { throwOnError: false },
  );
  assertEquals(lengthResult.success, false);
  if (lengthResult.success) return;
  assertEquals(
    lengthResult.error.message,
    "invalid AST: 'args.length' must be a non-negative safe integer",
  );
});

test("evaluateAst rejects oversized child arrays before reading entries", () => {
  const child: Expr = {
    kind: "number",
    value: 1,
    span: { start: 1, end: 2 },
  };
  let elementReads = 0;
  const elements = new Proxy<Expr[]>([child, child], {
    getOwnPropertyDescriptor(target, property) {
      if (property === "0" || property === "1") elementReads++;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const arrayResult = evaluateAst(
    {
      kind: "array",
      elements,
      span: { start: 0, end: 3 },
    },
    { throwOnError: false, maxArrayElements: 1 },
  );
  assertEquals(arrayResult.success, false);
  assertEquals(elementReads, 0);
  if (!arrayResult.success) {
    assertEquals(
      arrayResult.error.message,
      "invalid AST: array literal too large",
    );
  }

  let argumentReads = 0;
  const args = new Proxy<Expr[]>([child, child], {
    getOwnPropertyDescriptor(target, property) {
      if (property === "0" || property === "1") argumentReads++;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const callResult = evaluateAst(
    {
      kind: "call",
      callee: {
        kind: "identifier",
        name: "fn",
        span: { start: 0, end: 2 },
      },
      args,
      span: { start: 0, end: 4 },
    },
    { throwOnError: false, maxCallArguments: 1 },
  );
  assertEquals(callResult.success, false);
  assertEquals(argumentReads, 0);
  if (!callResult.success) {
    assertEquals(
      callResult.error.message,
      "invalid AST: call argument list too large",
    );
  }
});

test("evaluateAst stops reading child descriptors when validation work is exhausted", () => {
  const child: Expr = {
    kind: "number",
    value: 1,
    span: { start: 3, end: 4 },
  };
  const inspected: string[] = [];
  const args = new Proxy<Expr[]>([child, child, child], {
    getOwnPropertyDescriptor(target, property) {
      if (property === "0" || property === "1" || property === "2") {
        inspected.push(property);
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const expr: Expr = {
    kind: "call",
    callee: {
      kind: "identifier",
      name: "fn",
      span: { start: 0, end: 2 },
    },
    args,
    span: { start: 0, end: 5 },
  };

  const res = evaluateAst(expr, { throwOnError: false, maxSteps: 2 });
  assertEquals(res.success, false);
  assertEquals(inspected, ["0"]);
  if (res.success) return;
  assertEquals(res.error.message, "invalid AST: validation budget exceeded");
  assertEquals(res.error.steps, 3);
});

test("evaluateAst counts edges through aliased child arrays", () => {
  const leaf: Expr = {
    kind: "number",
    value: 1,
    span: { start: 1, end: 2 },
  };
  const sharedElements = [leaf];
  const consequent: Expr = {
    kind: "array",
    elements: sharedElements,
    span: { start: 0, end: 3 },
  };
  const alternate: Expr = {
    kind: "array",
    elements: sharedElements,
    span: { start: 4, end: 7 },
  };
  const expr: Expr = {
    kind: "conditional",
    test: { kind: "boolean", value: true, span: { start: 0, end: 1 } },
    consequent,
    alternate,
    span: { start: 0, end: 7 },
  };

  const rejected = evaluateAst(expr, {
    throwOnError: false,
    maxSteps: 5,
  });
  assertEquals(rejected.success, false);
  if (!rejected.success) {
    assertEquals(
      rejected.error.message,
      "invalid AST: validation budget exceeded",
    );
    assertEquals(rejected.error.steps, 6);
  }

  const accepted = evaluateAst(expr, {
    throwOnError: false,
    maxSteps: 6,
  });
  assertEquals(accepted.success, true);
  if (accepted.success) assertEquals(accepted.value, [1]);
});

test("evaluateAst enforces depth on every path to a shared node", () => {
  const shared: Expr = {
    kind: "number",
    value: 1,
    span: { start: 0, end: 1 },
  };
  const expr: Expr = {
    kind: "conditional",
    test: { kind: "boolean", value: true, span: { start: 0, end: 1 } },
    consequent: shared,
    alternate: {
      kind: "unary",
      op: "!",
      expr: {
        kind: "unary",
        op: "!",
        expr: shared,
        span: { start: 0, end: 1 },
      },
      span: { start: 0, end: 1 },
    },
    span: { start: 0, end: 1 },
  };

  const res = evaluateAst(expr, {
    throwOnError: false,
    maxDepth: 2,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "invalid AST: recursion limit exceeded");
  assertEquals(res.error.steps, 6);
});

test("evaluateAst rejects cyclic ASTs", () => {
  const expr: Record<string, unknown> = {
    kind: "unary",
    op: "!",
    span: { start: 0, end: 1 },
  };
  expr.expr = expr;

  const res = evaluateAst(expr as unknown as Expr, { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertEquals(res.error.message, "invalid AST: cycle detected");
  assertEquals(res.error.steps, 2);
});

test("evaluateAst wraps malformed AST errors in throwing mode", () => {
  assertThrows(
    () => evaluateAst(null as unknown as Expr),
    ExpEvalError,
    "invalid AST",
  );
});
