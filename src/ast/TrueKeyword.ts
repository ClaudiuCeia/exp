import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class TrueKeyword extends Node<true> {
  readonly kind = SyntaxKind.TrueKeyword;

  protected parseValue(v: unknown): true {
    if (typeof v !== "boolean" || v !== true) {
      throw new Error();
    }

    return v;
  }
}
