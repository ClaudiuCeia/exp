import { buildCommand } from "@stricli/core";
import { evaluateExpression } from "../src/eval.ts";
import type { RuntimeValue } from "../src/eval.ts";

export type Format = "json" | "inspect";

type CommonFlags = {
  env?: string;
  "env-json"?: string;
  "env-inline"?: string;
  format?: Format;
};

type CliContext = {
  process: {
    stdout: { write(s: string): void };
    stderr: { write(s: string): void };
  };
};

const encoder = new TextEncoder();

const writeStdout = async (s: string): Promise<void> => {
  await Deno.stdout.write(encoder.encode(s));
};

const writeStderr = async (s: string): Promise<void> => {
  await Deno.stderr.write(encoder.encode(s));
};

const toFileUrl = (path: string): URL => {
  const base = new URL(`file://${Deno.cwd()}/`);
  return new URL(path, base);
};

const isRecord = (v: unknown): v is Record<string, unknown> => {
  return typeof v === "object" && v !== null && !Array.isArray(v);
};

const readAllStdin = async (): Promise<string> => {
  return await new Response(Deno.stdin.readable).text();
};

const loadEnvFromModule = async (
  modulePath: string,
): Promise<Record<string, RuntimeValue>> => {
  // Bust the module cache so repeated loads pick up edits.
  const url = toFileUrl(modulePath);
  const bust = new URL(url.href);
  bust.searchParams.set("t", Date.now().toString(36));

  const mod = await import(bust.href);
  const candidate = (mod.env ?? mod.default) as unknown;
  if (!isRecord(candidate)) {
    throw new Error(
      `--env module must export an object as default export or named export 'env'`,
    );
  }
  return candidate as Record<string, RuntimeValue>;
};

const loadEnvFromJson = async (
  jsonPath: string,
): Promise<Record<string, RuntimeValue>> => {
  const text = await Deno.readTextFile(jsonPath);
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error(`--env-json must be a JSON object`);
  return value as Record<string, RuntimeValue>;
};

const loadEnvFromInline = (json: string): Record<string, RuntimeValue> => {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error(`--env-inline must be a JSON object`);
  return value as Record<string, RuntimeValue>;
};

const resolveEnv = async (
  flags: CommonFlags,
): Promise<Record<string, RuntimeValue> | undefined> => {
  const envFlags = [flags.env, flags["env-json"], flags["env-inline"]].filter(
    (x) => x,
  ).length;

  if (envFlags > 1) {
    throw new Error("use only one of --env, --env-json, or --env-inline");
  }

  if (flags.env) return await loadEnvFromModule(flags.env);
  if (flags["env-json"]) return await loadEnvFromJson(flags["env-json"]);
  if (flags["env-inline"]) return loadEnvFromInline(flags["env-inline"]);
  return undefined;
};

const formatValue = (value: RuntimeValue, format: Format): string => {
  if (format === "inspect") {
    return `${Deno.inspect(value, { colors: false, depth: 6 })}\n`;
  }

  // json
  if (value === undefined) return "undefined\n";

  try {
    return `${JSON.stringify(value)}\n`;
  } catch {
    return `${Deno.inspect(value, { colors: false, depth: 6 })}\n`;
  }
};

const commonFlagParameters = {
  env: {
    kind: "parsed" as const,
    optional: true,
    brief:
      "Path to a JS/TS module exporting env (default export or named export 'env')",
    placeholder: "path",
    parse: (input: string) => input,
  },
  "env-json": {
    kind: "parsed" as const,
    optional: true,
    brief: "Path to a JSON file containing an env object (values only)",
    placeholder: "path",
    parse: (input: string) => input,
  },
  "env-inline": {
    kind: "parsed" as const,
    optional: true,
    brief: "Inline JSON string containing an env object (values only)",
    placeholder: "json",
    parse: (input: string) => input,
  },
  format: {
    kind: "parsed" as const,
    optional: true,
    brief: "Output format (default: inspect)",
    placeholder: "inspect|json",
    parse: (input: string) => {
      if (input === "inspect" || input === "json") return input;
      throw new Error("--format must be 'inspect' or 'json'");
    },
  },
} as const;

export const runCommand = buildCommand({
  async func(this: CliContext, flags: CommonFlags, file?: string) {
    const env = await resolveEnv(flags);
    const format = flags.format ?? "inspect";

    const input = file && file !== "-"
      ? await Deno.readTextFile(file)
      : await readAllStdin();

    const expr = input.trim();
    if (expr.length === 0) {
      throw new Error("empty input");
    }

    const res = evaluateExpression(expr, {
      env,
      throwOnError: false,
      throwOnParseError: false,
    });

    if (!res.success) {
      throw new Error(res.error.message);
    }

    this.process.stdout.write(formatValue(res.value, format));
  },
  parameters: {
    flags: commonFlagParameters,
    positional: {
      kind: "tuple" as const,
      parameters: [
        {
          brief: "Expression file path (defaults to stdin). Use '-' for stdin.",
          placeholder: "file",
          parse: (input: string) => input,
          optional: true,
        },
      ],
    },
  },
  docs: {
    brief: "Evaluate an expression from stdin or a file",
  },
});

export const replCommand = buildCommand({
  async func(this: CliContext, flags: CommonFlags) {
    let env = await resolveEnv(flags);
    const format = flags.format ?? "inspect";

    const help = () => {
      this.process.stdout.write(
        "Commands:\n" +
          "  .help\n" +
          "  .exit\n" +
          "  .env (lists top-level env keys)\n" +
          "  .load <path> (load env module; default export or named export 'env')\n" +
          "\nEnter an expression per line to evaluate.\n",
      );
    };

    help();

    const decoder = new TextDecoder();
    const buf = new Uint8Array(1024 * 64);
    let carry = "";

    const prompt = async () => {
      await writeStdout("> ");
    };

    const handleLine = async (
      lineRaw: string,
      opts: { promptAfter: boolean },
    ): Promise<"continue" | "exit"> => {
      const line = lineRaw.replace(/\r$/, "").trim();
      if (line.length === 0) {
        if (opts.promptAfter) await prompt();
        return "continue";
      }

      if (line === ".exit") return "exit";
      if (line === ".help") {
        help();
        if (opts.promptAfter) await prompt();
        return "continue";
      }
      if (line === ".env") {
        this.process.stdout.write(
          env ? `${Object.keys(env).sort().join("\n")}\n` : "(empty)\n",
        );
        if (opts.promptAfter) await prompt();
        return "continue";
      }

      if (line.startsWith(".load ")) {
        const p = line.slice(".load ".length).trim();
        if (!p) {
          this.process.stdout.write("usage: .load <path>\n");
          if (opts.promptAfter) await prompt();
          return "continue";
        }

        try {
          env = await loadEnvFromModule(p);
          this.process.stdout.write(
            `loaded env (${Object.keys(env).length} keys)\n`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.process.stdout.write(`${msg}\n`);
        }

        if (opts.promptAfter) await prompt();
        return "continue";
      }

      const res = evaluateExpression(line, {
        env,
        throwOnError: false,
        throwOnParseError: false,
      });

      if (!res.success) {
        this.process.stdout.write(`${res.error.message}\n`);
      } else {
        this.process.stdout.write(formatValue(res.value, format));
      }

      if (opts.promptAfter) await prompt();
      return "continue";
    };

    await prompt();

    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;

      carry += decoder.decode(buf.subarray(0, n));

      while (true) {
        const idx = carry.indexOf("\n");
        if (idx === -1) break;

        const lineRaw = carry.slice(0, idx);
        carry = carry.slice(idx + 1);

        const r = await handleLine(lineRaw, { promptAfter: true });
        if (r === "exit") return;
      }
    }

    // If stdin ended without a trailing newline, process the final buffered line.
    if (carry.length > 0) {
      const r = await handleLine(carry, { promptAfter: false });
      if (r === "exit") return;
    }
  },
  parameters: {
    flags: commonFlagParameters,
  },
  docs: {
    brief: "Interactive REPL",
  },
});

export const denoContext: CliContext = {
  process: {
    stdout: {
      write: (s: string) => {
        // best-effort sync write (stricli expects sync-ish writes)
        Deno.stdout.writeSync(encoder.encode(s));
      },
    },
    stderr: {
      write: (s: string) => {
        Deno.stderr.writeSync(encoder.encode(s));
      },
    },
  },
};

// Avoid unused warnings for helpers used only in async prompt.
void writeStderr;
