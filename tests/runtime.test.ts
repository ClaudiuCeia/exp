import { test } from "bun:test";
import { evaluateExpression } from "../src/eval.ts";
import {
  isPlainObject,
  isRuntimeValue,
  normalizeEnv,
  type RuntimeValue,
} from "../src/runtime.ts";
import { assert, assertEquals } from "./assert.ts";

const nestedArrays = (containerCount: number): unknown => {
  let value: unknown = undefined;
  for (let i = 0; i < containerCount; i++) value = [value];
  return value;
};

const getterlessArray = (): RuntimeValue[] => {
  const value: RuntimeValue[] = [undefined];
  Object.defineProperty(value, "0", {
    enumerable: true,
    configurable: true,
    get: undefined,
    set: undefined,
  });
  return value;
};

test("isRuntimeValue accepts depth 40,000 and rejects one below it", () => {
  const maxDepth = 40_000;
  const value = nestedArrays(maxDepth + 1);
  const limits = { maxDepth, maxEntries: maxDepth + 1 };

  assertEquals(isRuntimeValue(value, limits), true);
  assertEquals(
    isRuntimeValue(value, { ...limits, maxDepth: maxDepth - 1 }),
    false,
  );
});

test("isRuntimeValue does not invoke runtime clone constructors", () => {
  const arrayFromDescriptor = Object.getOwnPropertyDescriptor(Array, "from");
  const objectCreateDescriptor = Object.getOwnPropertyDescriptor(
    Object,
    "create",
  );
  if (
    arrayFromDescriptor === undefined ||
    objectCreateDescriptor === undefined
  ) {
    throw new Error("runtime clone constructors are missing");
  }

  let result = false;
  try {
    Object.defineProperty(Array, "from", {
      ...arrayFromDescriptor,
      value: () => {
        throw new Error("Array.from ran");
      },
    });
    Object.defineProperty(Object, "create", {
      ...objectCreateDescriptor,
      value: () => {
        throw new Error("Object.create ran");
      },
    });
    result = isRuntimeValue([{ child: [] }], {
      maxDepth: 2,
      maxEntries: 2,
    });
  } finally {
    Reflect.defineProperty(Array, "from", arrayFromDescriptor);
    Reflect.defineProperty(Object, "create", objectCreateDescriptor);
  }

  assertEquals(result, true);
});

test("isRuntimeValue uses captured cycle-detection methods", () => {
  const hasDescriptor = Object.getOwnPropertyDescriptor(
    WeakSet.prototype,
    "has",
  );
  if (hasDescriptor === undefined) {
    throw new Error("missing WeakSet.prototype.has");
  }
  const target: Record<string, unknown> = { child: new Date() };
  const value = new Proxy(target, {
    getOwnPropertyDescriptor(object, property) {
      if (property === "child") {
        Object.defineProperty(WeakSet.prototype, "has", {
          ...hasDescriptor,
          value: () => true,
        });
      }
      return Reflect.getOwnPropertyDescriptor(object, property);
    },
  });
  let accepted = true;

  try {
    accepted = isRuntimeValue(value);
  } finally {
    Object.defineProperty(WeakSet.prototype, "has", hasDescriptor);
  }

  assertEquals(accepted, false);
});

test("normalizeEnv uses captured alias-detection methods", () => {
  const getDescriptor = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "get",
  );
  if (getDescriptor === undefined) {
    throw new Error("missing WeakMap.prototype.get");
  }
  const target: Record<string, unknown> = { child: new Date() };
  const env = new Proxy(target, {
    getOwnPropertyDescriptor(object, property) {
      if (property === "child") {
        Object.defineProperty(WeakMap.prototype, "get", {
          ...getDescriptor,
          value: () => [],
        });
      }
      return Reflect.getOwnPropertyDescriptor(object, property);
    },
  });
  let result: ReturnType<typeof normalizeEnv> | undefined;

  try {
    result = normalizeEnv(env);
  } finally {
    Object.defineProperty(WeakMap.prototype, "get", getDescriptor);
  }

  if (result === undefined) throw new Error("normalization did not return");
  assertEquals(result, {
    ok: false,
    message: "env['child'] is not a supported runtime value",
  });
});

test("normalizeEnv traverses after stack methods are poisoned", () => {
  const pushDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "push",
  );
  const popDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "pop");
  if (pushDescriptor === undefined || popDescriptor === undefined) {
    throw new Error("Array stack method descriptors are missing");
  }

  const poison = (): never => {
    throw new Error("poisoned Array prototype method ran");
  };
  let prototypeReads = 0;
  const target: Record<string, RuntimeValue> = { nested: { value: 1 } };
  const env = new Proxy(target, {
    getPrototypeOf(value) {
      prototypeReads++;
      if (prototypeReads === 2) {
        Object.defineProperty(Array.prototype, "push", {
          ...pushDescriptor,
          value: poison,
        });
        Object.defineProperty(Array.prototype, "pop", {
          ...popDescriptor,
          value: poison,
        });
      }
      return Reflect.getPrototypeOf(value);
    },
  });

  let accepted: ReturnType<typeof normalizeEnv> = {
    ok: false,
    message: "normalization did not run",
  };
  try {
    accepted = normalizeEnv(env);
  } finally {
    Reflect.defineProperty(Array.prototype, "push", pushDescriptor);
    Reflect.defineProperty(Array.prototype, "pop", popDescriptor);
  }

  assertEquals(prototypeReads, 2);
  assertEquals(accepted.ok, true);
  if (accepted.ok) {
    assertEquals(Object.getPrototypeOf(accepted.env), null);
    const nested = accepted.env.nested;
    assert(isPlainObject(nested));
    assertEquals(nested.value, 1);
  }
});

test("normalizeEnv formats exact paths after path methods are poisoned", () => {
  const reverseDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "reverse",
  );
  const joinDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "join",
  );
  if (reverseDescriptor === undefined || joinDescriptor === undefined) {
    throw new Error("Array path method descriptors are missing");
  }

  const poison = (): never => {
    throw new Error("poisoned Array prototype method ran");
  };
  let prototypeReads = 0;
  const env = new Proxy<Record<string, unknown>>(
    { nested: { unsupported: new Date() } },
    {
      getPrototypeOf(value) {
        prototypeReads++;
        if (prototypeReads === 2) {
          Object.defineProperty(Array.prototype, "reverse", {
            ...reverseDescriptor,
            value: poison,
          });
          Object.defineProperty(Array.prototype, "join", {
            ...joinDescriptor,
            value: poison,
          });
        }
        return Reflect.getPrototypeOf(value);
      },
    },
  );

  let rejected: ReturnType<typeof normalizeEnv> = {
    ok: true,
    env: {},
  };
  try {
    rejected = normalizeEnv(env);
  } finally {
    Reflect.defineProperty(Array.prototype, "reverse", reverseDescriptor);
    Reflect.defineProperty(Array.prototype, "join", joinDescriptor);
  }

  assertEquals(prototypeReads, 2);
  assertEquals(rejected, {
    ok: false,
    message: "env['nested']['unsupported'] is not a supported runtime value",
  });
});

test("normalizeEnv ignores poisoned numeric Array prototype properties", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "0",
  );
  let numericWrites = 0;
  let prototypeReads = 0;
  const target: Record<string, RuntimeValue> = { nested: { value: 1 } };
  const env = new Proxy(target, {
    getPrototypeOf(value) {
      prototypeReads++;
      if (prototypeReads === 2) {
        Object.defineProperty(Array.prototype, "0", {
          configurable: true,
          set() {
            numericWrites++;
          },
        });
      }
      return Reflect.getPrototypeOf(value);
    },
  });
  const invalidEnv = { nested: { unsupported: new Date() } };

  let accepted: ReturnType<typeof normalizeEnv> = {
    ok: false,
    message: "normalization did not run",
  };
  let rejected: ReturnType<typeof normalizeEnv> = {
    ok: true,
    env: {},
  };
  try {
    accepted = normalizeEnv(env);
    rejected = normalizeEnv(invalidEnv);
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(Array.prototype, "0");
    } else {
      Reflect.defineProperty(Array.prototype, "0", originalDescriptor);
    }
  }

  assertEquals(prototypeReads, 2);
  assertEquals(numericWrites, 0);
  assertEquals(accepted.ok, true);
  if (accepted.ok) {
    const nested = accepted.env.nested;
    assert(isPlainObject(nested));
    assertEquals(nested.value, 1);
  }
  assertEquals(rejected, {
    ok: false,
    message: "env['nested']['unsupported'] is not a supported runtime value",
  });
});

test("normalizeEnv accepts depth 40,000 and reports the exact one-below path", () => {
  const maxDepth = 40_000;
  const value = nestedArrays(maxDepth);
  const limits = { maxDepth, maxEntries: maxDepth + 1 };

  const accepted = normalizeEnv({ value }, limits);
  assertEquals(accepted.ok, true);
  if (!accepted.ok) return;

  let current: unknown = accepted.env.value;
  for (let i = 0; i < maxDepth; i++) {
    if (!Array.isArray(current)) {
      throw new Error(`normalized value stopped being an array at depth ${i}`);
    }
    current = current[0];
  }
  assertEquals(current, undefined);

  const rejected = normalizeEnv(
    { value },
    { ...limits, maxDepth: maxDepth - 1 },
  );
  assertEquals(rejected.ok, false);
  if (rejected.ok) return;
  assertEquals(
    rejected.message,
    `env['value']${"[0]".repeat(maxDepth - 1)} exceeds the runtime depth limit`,
  );
});

test("normalizeEnv applies depth and entry limits from the environment root", () => {
  assertEquals(
    normalizeEnv({ value: 1 }, { maxDepth: 0, maxEntries: 1 }).ok,
    true,
  );

  const depthAtZero = normalizeEnv(
    { value: {} },
    { maxDepth: 0, maxEntries: 1 },
  );
  assertEquals(depthAtZero, {
    ok: false,
    message: "env['value'] exceeds the runtime depth limit",
  });

  const depthAtOne = normalizeEnv(
    { value: { child: {} } },
    { maxDepth: 1, maxEntries: 2 },
  );
  assertEquals(depthAtOne, {
    ok: false,
    message: "env['value']['child'] exceeds the runtime depth limit",
  });

  assertEquals(
    normalizeEnv({ value: [] }, { maxDepth: 1, maxEntries: 1 }).ok,
    true,
  );
  const entriesAtOne = normalizeEnv(
    { value: [undefined] },
    { maxDepth: 1, maxEntries: 1 },
  );
  assertEquals(entriesAtOne, {
    ok: false,
    message: "env['value'] exceeds the runtime entry limit",
  });
  assertEquals(
    normalizeEnv({ value: [undefined] }, { maxDepth: 1, maxEntries: 2 }).ok,
    true,
  );
});

test("getterless array accessors are rejected in every runtime boundary", () => {
  const value = getterlessArray();
  assertEquals(isRuntimeValue(value, { maxDepth: 1, maxEntries: 1 }), false);

  const normalized = normalizeEnv({ value }, { maxDepth: 1, maxEntries: 2 });
  assertEquals(normalized, {
    ok: false,
    message: "env['value'][0] must be a data property",
  });

  const environmentResult = evaluateExpression("value.length", {
    env: { value },
    throwOnError: false,
  });
  assertEquals(environmentResult.success, false);
  if (!environmentResult.success) {
    assertEquals(
      environmentResult.error.message,
      "env['value'][0] must be a data property",
    );
  }

  const returnResult = evaluateExpression("value()", {
    env: { value: getterlessArray },
    throwOnError: false,
  });
  assertEquals(returnResult.success, false);
  if (!returnResult.success) {
    assertEquals(
      returnResult.error.message,
      "function returned an unsupported value",
    );
  }
});

test("array holes remain valid and normalize to explicit undefined entries", () => {
  const value: RuntimeValue[] = [];
  value.length = 2;

  assertEquals(isRuntimeValue(value, { maxDepth: 0, maxEntries: 2 }), true);
  const normalized = normalizeEnv({ value }, { maxDepth: 1, maxEntries: 3 });
  assertEquals(normalized.ok, true);
  if (!normalized.ok) return;

  const output = normalized.env.value;
  assert(Array.isArray(output));
  assertEquals(output, [undefined, undefined]);
  assertEquals(Object.hasOwn(output, 0), true);
  assertEquals(Object.hasOwn(output, 1), true);
});

test("aliases preserve identity and charge entries only once", () => {
  const shared: Record<string, RuntimeValue> = { value: 1 };
  const rejected = normalizeEnv(
    { a: shared, b: shared },
    { maxDepth: 1, maxEntries: 2 },
  );
  assertEquals(rejected, {
    ok: false,
    message: "env['a'] exceeds the runtime entry limit",
  });

  const normalized = normalizeEnv(
    { a: shared, b: shared },
    { maxDepth: 1, maxEntries: 3 },
  );
  assertEquals(normalized.ok, true);
  if (!normalized.ok) return;
  assertEquals(normalized.env.a === normalized.env.b, true);
  assert(isPlainObject(normalized.env.a));
  assertEquals(Object.getPrototypeOf(normalized.env.a), null);
});

test("object and array cycles remain preserved", () => {
  const objectCycle: Record<string, RuntimeValue> = {};
  objectCycle.self = objectCycle;
  const arrayCycle: RuntimeValue[] = [];
  arrayCycle.push(arrayCycle);

  const normalized = normalizeEnv(
    { objectCycle, arrayCycle },
    { maxDepth: 2, maxEntries: 4 },
  );
  assertEquals(normalized.ok, true);
  if (!normalized.ok) return;

  const normalizedObject = normalized.env.objectCycle;
  assert(isPlainObject(normalizedObject));
  assertEquals(normalizedObject.self === normalizedObject, true);

  const normalizedArray = normalized.env.arrayCycle;
  assert(Array.isArray(normalizedArray));
  assertEquals(normalizedArray[0] === normalizedArray, true);
});

test("isRuntimeValue uses fresh traversal state after host mutation", () => {
  const value: Record<string, unknown> = { child: {} };
  const limits = { maxDepth: 1, maxEntries: 2 };
  assertEquals(isRuntimeValue(value, limits), true);

  Object.defineProperty(value.child, "unsupported", {
    value: new Date(),
    enumerable: true,
  });
  assertEquals(isRuntimeValue(value, limits), false);
});
