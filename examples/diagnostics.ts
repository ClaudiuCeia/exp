import { evaluateExpression, formatDiagnosticReport } from "@claudiu-ceia/exp";

export const parserSource = "account.plan == && usage.requests >= 1000";
export const parserResult = evaluateExpression(parserSource, {
  throwOnParseError: false,
  throwOnError: false,
});

if (parserResult.success) {
  throw new Error("expected parser failure");
}

export const parserDiagnostic = formatDiagnosticReport(
  parserSource,
  parserResult.error,
);

export const evaluatorSource = "missing + 1";
export const evaluatorResult = evaluateExpression(evaluatorSource, {
  throwOnParseError: false,
  throwOnError: false,
});

if (evaluatorResult.success) {
  throw new Error("expected evaluator failure");
}

export const evaluatorDiagnostic = formatDiagnosticReport(
  evaluatorSource,
  evaluatorResult.error,
);
