import { Node } from "./Node.ts";
import { SyntaxKind } from "./SyntaxKind.ts";

export class StringLiteral extends Node<string> {
  readonly kind = SyntaxKind.StringLiteral;

  protected parseValue(v: unknown): string {
    if (typeof v !== "string") {
      throw new Error();
    }

    return v;
  }
}
