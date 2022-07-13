import { Context } from "https://deno.land/x/combine@v0.0.2/mod.ts";
import { BinaryExpression } from "./BinaryExpression.ts";
import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export const createNode =
  (kind: SyntaxKind) =>
  (value: unknown, before: Context, after: Context): Node => {
    switch (kind) {
      case SyntaxKind.BinaryExpression: {
        return new BinaryExpression(value, before, after);
      }
    }

    throw new Error("Unimplemented");
  };
