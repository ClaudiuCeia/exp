import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import type { Expr } from "../src/ast/mod.ts";
import { evaluateAst, evaluateExpression } from "../src/eval.ts";
import type { RuntimeValue } from "../src/eval.ts";

Deno.test("evaluateExpression evaluates arithmetic", () => {
  const res = evaluateExpression("1 + 2 * 3", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 7);
});

Deno.test("evaluateExpression handles unary ops", () => {
  const res = evaluateExpression("!false || -1 < +2", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

Deno.test("evaluateExpression supports string concatenation", () => {
  const res = evaluateExpression("'a' + 1 + true + null + undefined", {
    throwOnError: false,
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, "a1truenullundefined");
});

Deno.test("evaluateExpression supports all numeric binary operators", () => {
  const res = evaluateExpression(
    "10 - 3 == 7 && 2 * 3 == 6 && 8 / 2 == 4 && 9 % 4 == 1",
    { throwOnError: false },
  );
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

Deno.test("evaluateExpression supports comparison operators", () => {
  const res = evaluateExpression(
    "1 < 2 && 2 <= 2 && 3 > 2 && 3 >= 3 && (1 != 2) && (1 == 1)",
    { throwOnError: false },
  );
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, true);
});

Deno.test("evaluateExpression supports toNumber conversions", () => {
  const res1 = evaluateExpression("+true + +false + +null", {
    throwOnError: false,
  });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, 1);

  const res2 = evaluateExpression("+missing", { throwOnError: false });
  assertEquals(res2.success, true);
  if (!res2.success) return;
  assertEquals(typeof res2.value, "number");
  if (typeof res2.value !== "number") return;
  assertEquals(Number.isNaN(res2.value), true);

  const res3 = evaluateExpression("+s", {
    throwOnError: false,
    env: { s: "42" },
  });
  assertEquals(res3.success, true);
  if (!res3.success) return;
  assertEquals(res3.value, 42);
});

Deno.test("evaluateExpression errors when numeric ops see non-primitives", () => {
  const res = evaluateExpression("+[1]", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /expected primitive/);
});

Deno.test("evaluateExpression errors when string concat sees non-primitives", () => {
  const res = evaluateExpression("'x' + [1]", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /expected primitive/);
});

Deno.test("evaluateExpression resolves identifiers + member access", () => {
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

Deno.test("evaluateExpression member access works on arrays (length only)", () => {
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

Deno.test("evaluateExpression member access works on proto-null objects", () => {
  const obj = Object.assign(Object.create(null), { a: 1 });
  const res = evaluateExpression("obj.a", {
    throwOnError: false,
    env: { obj },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 1);
});

Deno.test("evaluateExpression returns undefined for missing identifiers", () => {
  const res = evaluateExpression("missing", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, undefined);
});

Deno.test("evaluateExpression can call allow-listed functions", () => {
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

Deno.test("evaluateExpression binds receiver for member calls", () => {
  const user = {
    name: "Ada",
    getName: function (this: unknown) {
      if (typeof this === "object" && this !== null && "name" in this) {
        // deno-lint-ignore no-explicit-any
        return (this as any).name;
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

Deno.test("evaluateExpression errors when calling non-functions", () => {
  const res = evaluateExpression("1(2)", { throwOnError: false });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /non-function/);
});

Deno.test("evaluateExpression catches env function exceptions", () => {
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
  assertMatch(res.error.message, /kaboom/);
});

Deno.test("evaluateExpression rejects unsupported function return values", () => {
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

Deno.test("evaluateExpression allows structured return values", () => {
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

Deno.test("evaluateExpression supports pipeline operator", () => {
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

Deno.test("evaluateExpression short-circuits &&", () => {
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

Deno.test("evaluateExpression evaluates RHS for && when LHS truthy", () => {
  const res = evaluateExpression("true && inc(41)", {
    throwOnError: false,
    env: { inc: (x: RuntimeValue) => (typeof x === "number" ? x + 1 : 0) },
  });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 42);
});

Deno.test("evaluateExpression short-circuits ||", () => {
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

Deno.test("evaluateExpression evaluates RHS for || when LHS falsy", () => {
  const res = evaluateExpression("false || 42", { throwOnError: false });
  assertEquals(res.success, true);
  if (!res.success) return;
  assertEquals(res.value, 42);
});

Deno.test("evaluateExpression evaluates conditionals", () => {
  const res1 = evaluateExpression("true ? 1 : 2", { throwOnError: false });
  assertEquals(res1.success, true);
  if (!res1.success) return;
  assertEquals(res1.value, 1);

  const res2 = evaluateExpression("false ? 1 : 2", { throwOnError: false });
  assertEquals(res2.success, true);
  if (!res2.success) return;
  assertEquals(res2.value, 2);
});

Deno.test("evaluateExpression forbids dangerous member access", () => {
  assertThrows(() => {
    evaluateExpression("obj.__proto__", {
      env: { obj: { a: 1 } },
      throwOnError: true,
    });
  });

  const res = evaluateExpression("obj.__proto__", {
    env: { obj: { a: 1 } },
    throwOnError: false,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /forbidden member access/);
});

Deno.test("evaluateExpression enforces step budgets", () => {
  const res = evaluateExpression("1 + 2", {
    throwOnError: false,
    maxSteps: 0,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /budget exceeded/);
});

Deno.test("evaluateExpression enforces array literal size budgets", () => {
  const res = evaluateExpression("[1, 2]", {
    throwOnError: false,
    maxArrayElements: 1,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /array literal too large/);
});

Deno.test("evaluateExpression enforces recursion depth budgets", () => {
  const res = evaluateExpression("!true", {
    throwOnError: false,
    maxDepth: 0,
  });
  assertEquals(res.success, false);
  if (res.success) return;
  assertMatch(res.error.message, /recursion limit exceeded/);
});

Deno.test("evaluateExpression reports parse failures when throwOnParseError=false", () => {
  const res = evaluateExpression("(", {
    throwOnError: false,
    throwOnParseError: false,
  });
  assertEquals(res.success, false);
});

Deno.test("evaluateAst returns errors for unknown operators (defensive)", () => {
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
