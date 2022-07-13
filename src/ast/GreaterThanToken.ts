import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class GreaterThanToken extends Node<">"> {
  readonly kind = SyntaxKind.GreaterThanToken;

  protected parseValue(v: unknown): ">" {
    if (v !== ">") {
      throw new Error();
    }

    return v;
  }
}
