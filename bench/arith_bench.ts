import { exp } from "../mod.ts";
import jsep from "https://esm.sh/jsep@1.3.6";
import aexpr from "https://esm.sh/aexpr@1.0.1";

Deno.bench("arith exp", () => {
  exp()({ text: `1 + 2 / (3 - 4) + 4 % 2`, index: 0 });
});

Deno.bench("arith jsep", () => {
  jsep(`1 + 2 / (3 - 4) + 4 % 2`);
});

Deno.bench("arith aexpr", () => {
  aexpr(`1 + 2 / (3 - 4) + 4`);
});
