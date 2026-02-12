import { evaluateAst, evaluateExpression } from "../src/eval.ts";
import { parseExpression } from "../src/parse.ts";
import type { Expr } from "../src/ast/mod.ts";

const SIMPLE_EXPR = "status == 'open' && priority >= 3";

const COMPLEX_EXPR = `(
  user.isInternal == true
  || std.includes(allowlist, user.id)
  || (
    (user.plan ?? "free") != "free"
    && user.status == "active"
    && !std.includes(blockedEmails, std.lower(user.email ?? ""))
    && (user.age ?? 0) >= 18
    && (
      std.clamp((user.rolloutBucket ?? 0), 0, 99) < rolloutPercent
      || std.includes(forcedBuckets, user.rolloutBucket ?? -1)
    )
  )
)
&& !std.includes(bannedCountries, user.country ?? "XX")`;

const mustParse = (input: string): Expr => {
  const res = parseExpression(input, { throwOnError: false });
  if (!res.success) throw new Error(res.error.message);
  return res.value;
};

const simpleAst = mustParse(SIMPLE_EXPR);
const complexAst = mustParse(COMPLEX_EXPR);

const simpleEnv = {
  status: "open",
  priority: 4,
};

const complexEnv = {
  user: {
    id: "u_123",
    email: "Ada@example.com",
    plan: "pro",
    status: "active",
    country: "US",
    age: 29,
    rolloutBucket: 17,
    isInternal: false,
  },
  allowlist: ["u_999"],
  blockedEmails: ["bad@example.com", "test@example.com"],
  forcedBuckets: [42, 77],
  bannedCountries: ["CN", "RU"],
  rolloutPercent: 25,
};

Deno.bench("evalAst: simple filter", () => {
  const res = evaluateAst(simpleAst, { env: simpleEnv, throwOnError: true });
  // Ensure result is used.
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

Deno.bench("evalExpression: simple filter (parse+eval)", () => {
  const res = evaluateExpression(SIMPLE_EXPR, {
    env: simpleEnv,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

Deno.bench("evalAst: complex rule", () => {
  const res = evaluateAst(complexAst, { env: complexEnv, throwOnError: true });
  if (!res.success) throw new Error("unexpected eval failure");
  // Expected: should be true for this env.
  if (res.value !== true) throw new Error("unexpected value");
});

Deno.bench("evalExpression: complex rule (parse+eval)", () => {
  const res = evaluateExpression(COMPLEX_EXPR, {
    env: complexEnv,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});
