import { Node } from "./Node.ts";
import { ParseError } from "./ParseError.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class IntLiteral extends Node<number> {
  readonly kind = SyntaxKind.IntLiteral;

  protected parseValue(v: unknown): number {
    if (typeof v !== "number") {
      throw new ParseError(`
        Can't build an IntLiteral from "${typeof v}::${v}".
      `);
    }

    return v;
  }
}
