import { bench, run } from "mitata";
import { evaluateAst, evaluateExpression } from "../src/eval.ts";
import {
  COMPLEX_ENV,
  COMPLEX_EXPRESSION,
  mustParse,
  SIMPLE_ENV,
  SIMPLE_EXPRESSION,
} from "./fixtures.ts";

const simpleAst = mustParse(SIMPLE_EXPRESSION);
const complexAst = mustParse(COMPLEX_EXPRESSION);

bench("evalAst: simple filter", () => {
  const res = evaluateAst(simpleAst, { env: SIMPLE_ENV, throwOnError: true });
  // Ensure result is used.
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

bench("evalExpression: simple filter (parse+eval)", () => {
  const res = evaluateExpression(SIMPLE_EXPRESSION, {
    env: SIMPLE_ENV,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

bench("evalAst: complex rule", () => {
  const res = evaluateAst(complexAst, {
    env: COMPLEX_ENV,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  // Expected: should be true for this env.
  if (res.value !== true) throw new Error("unexpected value");
});

bench("evalExpression: complex rule (parse+eval)", () => {
  const res = evaluateExpression(COMPLEX_EXPRESSION, {
    env: COMPLEX_ENV,
    throwOnError: true,
  });
  if (!res.success) throw new Error("unexpected eval failure");
  if (res.value !== true) throw new Error("unexpected value");
});

await run();
