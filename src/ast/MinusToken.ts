import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class MinusToken extends Node<"-"> {
  readonly kind = SyntaxKind.MinusToken;

  protected parseValue(v: unknown): "-" {
    if (v !== "-") {
      throw new Error();
    }

    return v;
  }
}
