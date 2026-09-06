import { bench, group, run } from "mitata";
import type { Expr } from "../src/ast/mod.ts";
import { evaluateAst, evaluateExpression } from "../src/eval.ts";
import { parseExpression } from "../src/parse.ts";

const SIMPLE = "status == 'open' && priority >= 3";
const COMPLEX = `(
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

const simpleEnv = { status: "open", priority: 4 };
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

function mustParse(input: string): Expr {
  const result = parseExpression(input, { throwOnError: false });
  if (!result.success) throw new Error(result.error.message);
  return result.value;
}

const simpleAst = mustParse(SIMPLE);
const complexAst = mustParse(COMPLEX);
let sink: unknown;

const cases = [
  {
    name: "parse/simple",
    execute: () => {
      sink = mustParse(SIMPLE);
    },
  },
  {
    name: "parse/complex",
    execute: () => {
      sink = mustParse(COMPLEX);
    },
  },
  {
    name: "evaluate-ast/simple",
    execute: () => {
      const result = evaluateAst(simpleAst, {
        env: simpleEnv,
        throwOnError: true,
      });
      if (!result.success || result.value !== true) {
        throw new Error("simple AST evaluation returned the wrong result");
      }
      sink = result.value;
    },
  },
  {
    name: "evaluate-ast/complex",
    execute: () => {
      const result = evaluateAst(complexAst, {
        env: complexEnv,
        throwOnError: true,
      });
      if (!result.success || result.value !== true) {
        throw new Error("complex AST evaluation returned the wrong result");
      }
      sink = result.value;
    },
  },
  {
    name: "evaluate-expression/simple",
    execute: () => {
      const result = evaluateExpression(SIMPLE, {
        env: simpleEnv,
        throwOnError: true,
      });
      if (!result.success || result.value !== true) {
        throw new Error("simple expression returned the wrong result");
      }
      sink = result.value;
    },
  },
  {
    name: "evaluate-expression/complex",
    execute: () => {
      const result = evaluateExpression(COMPLEX, {
        env: complexEnv,
        throwOnError: true,
      });
      if (!result.success || result.value !== true) {
        throw new Error("complex expression returned the wrong result");
      }
      sink = result.value;
    },
  },
] as const;

if (Bun.argv.includes("--verify")) {
  for (const testCase of cases) {
    testCase.execute();
    console.log(`verified ${testCase.name}`);
  }
} else {
  for (const testCase of cases) {
    group(testCase.name, () => {
      bench("exp", testCase.execute);
    });
  }

  await run({
    throw: true,
    format: Bun.argv.includes("--json")
      ? { json: { debug: false, samples: false } }
      : "mitata",
  });
}

void sink;
