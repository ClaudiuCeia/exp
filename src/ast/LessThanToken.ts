import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class LessThanToken extends Node<"<"> {
  readonly kind = SyntaxKind.LessThanToken;

  protected parseValue(v: unknown): "<" {
    if (v !== "<") {
      throw new Error();
    }

    return v;
  }
}
