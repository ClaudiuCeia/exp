import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class AmpersandAmpersandToken extends Node<"&&"> {
  readonly kind = SyntaxKind.AmpersandAmpersandToken;

  protected parseValue(v: unknown): "&&" {
    if (v !== "&&") {
      throw new Error();
    }

    return v;
  }
}
