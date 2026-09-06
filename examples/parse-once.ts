import { evaluateAst, parseExpression } from "@claudiu-ceia/exp";

const expressionSource = 'issue.status == "open" && issue.priority >= 3';
const parsed = parseExpression(expressionSource, {
  throwOnError: false,
});

if (!parsed.success) {
  throw new Error(parsed.error.message);
}

const issues = [
  { status: "open", priority: 4 },
  { status: "closed", priority: 5 },
];

const matching = issues.filter((issue) => {
  const result = evaluateAst(parsed.value, {
    env: {
      issue: {
        status: issue.status,
        priority: issue.priority,
      },
    },
    throwOnError: false,
  });

  return result.success && result.value === true;
});

export { expressionSource, matching as matchingIssues };
export const expressionSpan = parsed.value.span;
