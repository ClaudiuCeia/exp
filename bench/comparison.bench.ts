import { bench, group, run } from "mitata";
import type { Expr } from "../src/ast/mod.ts";
import { evaluateAst, evaluateExpression } from "../src/eval.ts";
import { parseExpression } from "../src/parse.ts";
import type { Env } from "../src/runtime.ts";
import {
  COMPLEX_ENV,
  COMPLEX_EXPRESSION,
  mustParse,
  SIMPLE_ENV,
  SIMPLE_EXPRESSION,
} from "./fixtures.ts";

function nestedPreflightInput(depth: number): string {
  return "@" + "(".repeat(depth) + ")".repeat(depth);
}

type RuntimeMemberWorkload = Readonly<{
  ast: Expr;
  env: Env;
  expected: number;
}>;

function runtimeMemberWorkload(
  reads: number,
  entries: number,
): RuntimeMemberWorkload {
  const member = "root.subgraph.values.length";
  return {
    ast: mustParse(Array.from({ length: reads }, () => member).join(" + ")),
    env: {
      root: {
        subgraph: {
          values: Array.from({ length: entries }, (_, index) => index),
        },
      },
    },
    expected: reads * entries,
  };
}

const simpleAst = mustParse(SIMPLE_EXPRESSION);
const complexAst = mustParse(COMPLEX_EXPRESSION);
const nesting256 = nestedPreflightInput(256);
const nesting1k = nestedPreflightInput(1_024);
const nesting4k = nestedPreflightInput(4_096);
const flat16k = Array.from({ length: 16_384 }, () => "1").join(" + ");
const runtimeMember4x250 = runtimeMemberWorkload(4, 250);
const runtimeMember16x1k = runtimeMemberWorkload(16, 1_000);
const runtimeMembers10k: Env = {
  record: Array.from({ length: 10_000 }, (_, index) => index),
};
const aliasedArgument: Expr = {
  kind: "number",
  value: 1,
  span: { start: 3, end: 4 },
};
const aliasedArguments100k: Expr = {
  kind: "call",
  callee: {
    kind: "identifier",
    name: "fn",
    span: { start: 0, end: 2 },
  },
  args: Array<Expr>(100_000).fill(aliasedArgument),
  span: { start: 0, end: 5 },
};
let sink: unknown;

function rejectNestedInput(
  input: string,
  maxNestingDepth: number,
  expectedMessage: string,
  expectedIndex: number,
): void {
  const result = parseExpression(input, {
    throwOnError: false,
    maxInputLength: input.length,
    maxNestingDepth,
  });
  if (
    result.success ||
    result.error.message !== expectedMessage ||
    result.error.index !== expectedIndex
  ) {
    throw new Error("nested input returned an unexpected parse result");
  }
  sink = result.error.index;
}

function rejectFlatInput(input: string, maxNodes: number): void {
  const result = parseExpression(input, {
    throwOnError: false,
    maxInputLength: input.length,
    maxNodes,
  });
  if (
    result.success ||
    result.error.message !== "AST node limit exceeded" ||
    (result.error.index !== 4 &&
      !(Bun.argv.includes("--baseline") && result.error.index === 0))
  ) {
    throw new Error("flat input returned an unexpected parse result");
  }
  sink = result.error.index;
}

function evaluateRuntimeMembers(workload: RuntimeMemberWorkload): void {
  const result = evaluateAst(workload.ast, {
    env: workload.env,
    throwOnError: true,
  });
  if (!result.success || result.value !== workload.expected) {
    throw new Error("runtime member evaluation returned the wrong result");
  }
  sink = result.value;
}

const cases = [
  {
    name: "parse/simple",
    execute: () => {
      sink = mustParse(SIMPLE_EXPRESSION);
    },
  },
  {
    name: "parse/complex",
    execute: () => {
      sink = mustParse(COMPLEX_EXPRESSION);
    },
  },
  {
    name: "parse/nesting-preflight-256",
    execute: () => {
      rejectNestedInput(nesting256, 256, "expected expression at 1:1", 0);
    },
  },
  {
    name: "parse/nesting-preflight-1024",
    execute: () => {
      rejectNestedInput(nesting1k, 1_024, "expected expression at 1:1", 0);
    },
  },
  {
    name: "parse/reject-nesting-4096-at-1024",
    execute: () => {
      rejectNestedInput(
        nesting4k,
        1_024,
        "parse nesting limit exceeded",
        1_025,
      );
    },
  },
  {
    name: "parse/reject-flat-16384-at-1-node",
    execute: () => {
      rejectFlatInput(flat16k, 1);
    },
  },
  {
    name: "evaluate-ast/simple",
    execute: () => {
      const result = evaluateAst(simpleAst, {
        env: SIMPLE_ENV,
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
        env: COMPLEX_ENV,
        throwOnError: true,
      });
      if (!result.success || result.value !== true) {
        throw new Error("complex AST evaluation returned the wrong result");
      }
      sink = result.value;
    },
  },
  {
    name: "evaluate-ast/reject-aliased-arguments-100000-at-1-step",
    execute: () => {
      const result = evaluateAst(aliasedArguments100k, {
        throwOnError: false,
        maxCallArguments: 100_000,
        maxSteps: 1,
      });
      if (
        result.success ||
        result.error.message !== "invalid AST: validation budget exceeded"
      ) {
        throw new Error("aliased arguments returned an unexpected result");
      }
      sink = result.error.steps;
    },
  },
  {
    name: "evaluate-expression/simple",
    execute: () => {
      const result = evaluateExpression(SIMPLE_EXPRESSION, {
        env: SIMPLE_ENV,
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
      const result = evaluateExpression(COMPLEX_EXPRESSION, {
        env: COMPLEX_ENV,
        throwOnError: true,
      });
      if (!result.success || result.value !== true) {
        throw new Error("complex expression returned the wrong result");
      }
      sink = result.value;
    },
  },
  {
    name: "evaluate-ast/runtime-member-revalidation-4x250",
    execute: () => {
      evaluateRuntimeMembers(runtimeMember4x250);
    },
  },
  {
    name: "evaluate-ast/runtime-member-revalidation-16x1000",
    execute: () => {
      evaluateRuntimeMembers(runtimeMember16x1k);
    },
  },
  {
    name: "evaluate-ast/reject-runtime-members-10000",
    execute: () => {
      const result = evaluateAst(simpleAst, {
        env: runtimeMembers10k,
        throwOnError: false,
      });
      if (
        result.success ||
        result.error.message !== "env['record'] exceeds the runtime entry limit"
      ) {
        throw new Error("oversized runtime members were not rejected");
      }
      sink = result.error.steps;
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
