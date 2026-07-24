import { assertEquals } from "@std/assert";
import { ReplLineDecoder } from "../cli/repl_input.ts";

const encoder = new TextEncoder();

Deno.test("ReplLineDecoder preserves UTF-8 split across chunks", () => {
  const decoder = new ReplLineDecoder();
  const bytes = encoder.encode("hello 😀\n");
  const split = bytes.indexOf(0xf0) + 2;

  assertEquals(decoder.push(bytes.subarray(0, split)), []);
  assertEquals(decoder.push(bytes.subarray(split)), ["hello 😀"]);
  assertEquals(decoder.finish(), []);
});

Deno.test("ReplLineDecoder emits multiple complete lines", () => {
  const decoder = new ReplLineDecoder();
  assertEquals(decoder.push(encoder.encode("one\ntwo\n")), ["one", "two"]);
  assertEquals(decoder.finish(), []);
});

Deno.test("ReplLineDecoder flushes the final unterminated line", () => {
  const decoder = new ReplLineDecoder();
  assertEquals(decoder.push(encoder.encode("partial")), []);
  assertEquals(decoder.finish(), ["partial"]);
});
