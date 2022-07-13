import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class EqualsEqualsToken extends Node<"=="> {
  readonly kind = SyntaxKind.EqualsEqualsToken;

  protected parseValue(v: unknown): "==" {
    if (v !== "==") {
      throw new Error();
    }

    return v;
  }
}
