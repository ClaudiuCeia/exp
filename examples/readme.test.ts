import { evaluateExpression } from "@claudiu-ceia/exp";
import {
  evaluatorDiagnostic,
  evaluatorResult,
  parserDiagnostic,
  parserResult,
} from "./diagnostics.ts";
import { generatedFilterAccepted } from "./model-generated-filter.ts";
import { matches, result as primaryResult } from "./primary-filter.ts";
import {
  preparedEnvironment,
  preparedPlanResult,
  preparedUsageResult,
} from "./prepared-environment.ts";
import {
  expressionSource,
  expressionSpan,
  matchingIssues,
} from "./parse-once.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(primaryResult.success, "primary filter should evaluate successfully");
assert(primaryResult.value === true, "primary filter should return true");
assert(matches, "predicate example should require a boolean true result");

assert(
  matchingIssues.length === 1,
  "parse-once example should match one issue",
);
assert(matchingIssues[0]?.status === "open", "open issue should match");
assert(expressionSpan.start === 0, "AST span should start at zero");
assert(
  expressionSpan.end === expressionSource.length,
  "AST span should use a half-open UTF-16 range",
);

assert(!parserResult.success, "parser diagnostic should use a parser failure");
assert(
  parserResult.error.index === 16,
  "parser failure index should be checked",
);
assert(
  parserResult.error.steps === 0,
  "parser failure should report zero steps",
);
assert(
  parserDiagnostic ===
    "1 | account.plan == && usage.requests >= 1000\n" +
      "  |                 ╰─▶ expected expression at 1:17",
  "parser diagnostic output should match",
);

assert(
  !evaluatorResult.success,
  "evaluator diagnostic should use an evaluator failure",
);
assert(
  evaluatorResult.error.span?.start === 0 &&
    evaluatorResult.error.span.end === 7,
  "evaluator failure span should be checked",
);
assert(evaluatorResult.error.steps === 9, "evaluator steps should be checked");
assert(
  evaluatorDiagnostic ===
    "1 | missing + 1\n" +
      "  | ╰─────╯\n" +
      "  |    ╰─▶ unknown identifier 'missing'",
  "evaluator diagnostic output should match",
);

const pipelineResult = evaluateExpression(
  'user.email |> std.lower |> std.endsWith("@company.com")',
  {
    env: { user: { email: "ENGINEER@COMPANY.COM" } },
    throwOnParseError: false,
    throwOnError: false,
  },
);

assert(pipelineResult.success, "pipeline should evaluate successfully");
assert(pipelineResult.value === true, "pipeline should return true");
assert(generatedFilterAccepted, "model-generated filter should require true");
assert(Object.isFrozen(preparedEnvironment), "prepared token should be frozen");
assert(
  preparedPlanResult.success && preparedPlanResult.value === true,
  "prepared environment should evaluate the plan",
);
assert(
  preparedUsageResult.success && preparedUsageResult.value === true,
  "prepared environment should be reusable",
);

console.log("README examples passed");
