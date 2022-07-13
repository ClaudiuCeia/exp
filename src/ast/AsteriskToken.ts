import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class AsteriskToken extends Node<"*"> {
  readonly kind = SyntaxKind.AsteriskToken;

  protected parseValue(v: unknown): "*" {
    if (v !== "*") {
      throw new Error();
    }

    return v;
  }
}
