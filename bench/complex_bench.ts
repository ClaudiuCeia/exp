import { exp } from "../mod.ts";
import jsep from "https://esm.sh/jsep@1.3.6";

Deno.bench("complex exp", () => {
  exp()({
    text: `a ? 1 + 2 / (3 - 4) + 4 : 1 + foo.bar.baz(42) - (foo(42) * 2)`,
    index: 0,
  });
});

Deno.bench("complex jsep", () => {
  jsep(`a ? 1 + 2 / (3 - 4) + 4 : 1 + foo.bar.baz(42) - (foo(42) * 2)`);
});
