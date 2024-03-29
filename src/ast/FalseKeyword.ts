import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class FalseKeyword extends Node<false> {
  readonly kind = SyntaxKind.FalseKeyword;

  protected parseValue(v: unknown): false {
    if (typeof v !== "boolean" || v !== false) {
      throw new Error();
    }

    return v;
  }
}
