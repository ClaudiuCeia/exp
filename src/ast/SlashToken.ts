import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class SlashToken extends Node<"/"> {
  readonly kind = SyntaxKind.SlashToken;

  protected parseValue(v: unknown): "/" {
    if (v !== "/") {
      throw new Error();
    }

    return v;
  }
}
