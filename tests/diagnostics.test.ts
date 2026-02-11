import { assertEquals } from "@std/assert";
import {
  formatCaret,
  formatDiagnosticCaret,
  formatDiagnosticReport,
  formatSpanCaret,
} from "../src/diagnostics.ts";

Deno.test("formatCaret renders a snippet with caret", () => {
  const out = formatCaret("abcdef", 2);
  const [line, caret] = out.split("\n");
  assertEquals(line, "abcdef");
  assertEquals(caret, "  ^");
});

Deno.test("formatCaret restricts snippet to the error line", () => {
  const input = "aa\nbbcc\ndd";
  const out = formatCaret(input, 5); // points at first 'c'
  const [line, caret] = out.split("\n");
  assertEquals(line, "bbcc");
  assertEquals(caret, "  ^");
});

Deno.test("formatCaret clamps index", () => {
  assertEquals(formatCaret("abc", -10).split("\n")[1], "^");
  assertEquals(formatCaret("abc", 999).split("\n")[1], "   ^");
});

Deno.test("formatSpanCaret uses span.start", () => {
  const out = formatSpanCaret("hello", { start: 1, end: 3 });
  assertEquals(out.split("\n")[1], " ^");
});

Deno.test("formatDiagnosticCaret prefers index over span", () => {
  const out = formatDiagnosticCaret("hello", {
    index: 3,
    span: { start: 1, end: 2 },
  });
  assertEquals(out.split("\n")[1], "   ^");
});

Deno.test("formatDiagnosticReport renders unicode arrow with message", () => {
  const out = formatDiagnosticReport("1 +", {
    message: "expected expression at 1:4",
    index: 3,
  });
  const lines = out.split("\n");
  assertEquals(lines[0], "1 | 1 +");
  assertEquals(lines[1], "  |    ╰─▶ expected expression at 1:4");
});

Deno.test("formatDiagnosticReport renders multispan underline with centered arrow", () => {
  const out = formatDiagnosticReport("hello world", {
    message: "boom",
    span: { start: 6, end: 11 },
  });
  const lines = out.split("\n");
  assertEquals(lines[0], "1 | hello world");
  assertEquals(lines[1], "  |       ╰───╯");
  assertEquals(lines[2], "  |         ╰─▶ boom");
});
