import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertEquals } from "./assert.ts";
import { ReplLineDecoder } from "../cli/repl_input.ts";

const encoder = new TextEncoder();
const projectRoot = resolve(import.meta.dir, "..");

async function runCli(
  args: string[],
  input = "",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn([process.execPath, "run", "cli/exp.ts", ...args], {
    cwd: projectRoot,
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("ReplLineDecoder preserves UTF-8 split across chunks", () => {
  const decoder = new ReplLineDecoder();
  const bytes = encoder.encode("hello 😀\n");
  const split = bytes.indexOf(0xf0) + 2;

  assertEquals(decoder.push(bytes.subarray(0, split)), []);
  assertEquals(decoder.push(bytes.subarray(split)), ["hello 😀"]);
  assertEquals(decoder.finish(), []);
});

test("ReplLineDecoder emits multiple complete lines", () => {
  const decoder = new ReplLineDecoder();
  assertEquals(decoder.push(encoder.encode("one\ntwo\n")), ["one", "two"]);
  assertEquals(decoder.finish(), []);
});

test("ReplLineDecoder flushes the final unterminated line", () => {
  const decoder = new ReplLineDecoder();
  assertEquals(decoder.push(encoder.encode("partial")), []);
  assertEquals(decoder.finish(), ["partial"]);
});

test("CLI evaluates stdin with Bun streams and inspect formatting", async () => {
  const result = await runCli(["run"], '"hello"');
  expect(result).toEqual({ stdout: '"hello"\n', stderr: "", exitCode: 0 });
});

test("CLI reads expression and JSON environment files", async () => {
  const prefix = join(tmpdir(), `exp-cli-${crypto.randomUUID()}`);
  const expressionPath = `${prefix}.expr`;
  const environmentPath = `${prefix}.json`;
  try {
    await Promise.all([
      Bun.write(expressionPath, "value + 1"),
      Bun.write(environmentPath, '{"value":41}'),
    ]);
    const result = await runCli([
      "run",
      "--env-json",
      environmentPath,
      expressionPath,
    ]);
    expect(result).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 });
  } finally {
    await Promise.all([
      rm(expressionPath, { force: true }),
      rm(environmentPath, { force: true }),
    ]);
  }
});

test("CLI imports TypeScript environment modules", async () => {
  const modulePath = join(tmpdir(), `exp-cli-${crypto.randomUUID()}.ts`);
  try {
    await Bun.write(
      modulePath,
      "export const env = { double: (value: number) => value * 2 };\n",
    );
    const result = await runCli(["run", "--env", modulePath], "double(21)");
    expect(result).toEqual({ stdout: "42\n", stderr: "", exitCode: 0 });
  } finally {
    await rm(modulePath, { force: true });
  }
});
