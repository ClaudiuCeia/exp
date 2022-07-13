import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class PlusEqualsToken extends Node<"+="> {
  readonly kind = SyntaxKind.PlusEqualsToken;

  protected parseValue(v: unknown): "+=" {
    if (v !== "+=") {
      throw new Error();
    }

    return v;
  }
}
