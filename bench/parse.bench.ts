import { bench, run } from "mitata";
import { parseExpression } from "../src/parse.ts";
import { COMPLEX_EXPRESSION, SIMPLE_EXPRESSION } from "./fixtures.ts";

bench("parse: simple filter", () => {
  parseExpression(SIMPLE_EXPRESSION);
});

bench("parse: complex rule", () => {
  parseExpression(COMPLEX_EXPRESSION);
});

await run();
