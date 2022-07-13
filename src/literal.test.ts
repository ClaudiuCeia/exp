import { assertEquals } from "https://deno.land/std@0.120.0/testing/asserts.ts";
import { boolLiteral, floatLiteral } from "./literal.ts";

Deno.test("float", () => {
  const res = floatLiteral({
    text: "4.20",
    index: 0,
  });

  assertEquals(res.success, true);
  assertEquals(res.ctx.text.length, res.ctx.index);
});

Deno.test("bool", () => {
  const values = ["true", "false"];

  for (const v of values) {
    const res = boolLiteral({
      text: v,
      index: 0,
    });

    assertEquals(res.success, true);
    assertEquals(res.ctx.text.length, res.ctx.index);
  }

  const res = boolLiteral({
    text: "nope",
    index: 0,
  });

  assertEquals(res.success, false);
});
