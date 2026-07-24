/** Incrementally decode UTF-8 input and emit complete newline-delimited lines. */
export class ReplLineDecoder {
  readonly #decoder = new TextDecoder();
  #carry = "";

  /** Decode one byte chunk and return any complete lines it contains. */
  push(chunk: Uint8Array): string[] {
    this.#carry += this.#decoder.decode(chunk, { stream: true });
    return this.#takeCompleteLines();
  }

  /** Flush the decoder and return the final unterminated line, if present. */
  finish(): string[] {
    this.#carry += this.#decoder.decode();
    const lines = this.#takeCompleteLines();
    if (this.#carry.length > 0) {
      lines.push(this.#carry);
      this.#carry = "";
    }
    return lines;
  }

  #takeCompleteLines(): string[] {
    const lines: string[] = [];
    while (true) {
      const index = this.#carry.indexOf("\n");
      if (index === -1) return lines;
      lines.push(this.#carry.slice(0, index));
      this.#carry = this.#carry.slice(index + 1);
    }
  }
}
