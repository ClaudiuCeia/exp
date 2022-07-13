import { Identifier } from "./Identifier.ts";
import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class PropertyAccessExpression extends Node<Identifier[]> {
  readonly kind = SyntaxKind.PropertyAccessExpression;

  protected parseValue(v: unknown): Identifier[] {
    if (!Array.isArray(v) || !v.every((m) => m instanceof Identifier)) {
      throw Error();
    }

    return v;
  }
}
