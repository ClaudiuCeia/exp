import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class ExclamationEqualsToken extends Node<"!="> {
  readonly kind = SyntaxKind.ExclamationEqualsToken;

  protected parseValue(v: unknown): "!=" {
    if (v !== "!=") {
      throw new Error();
    }

    return v;
  }
}
