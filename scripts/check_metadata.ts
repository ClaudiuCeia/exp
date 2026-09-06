import {
  evaluatorDiagnostic,
  parserDiagnostic,
} from "../examples/diagnostics.ts";

type PackageManifest = {
  name?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  files?: string[];
  dependencies?: Record<string, string>;
};

type DenoManifest = {
  name?: string;
  version?: string;
  imports?: Record<string, string>;
};

const EXPECTED_DESCRIPTION =
  "TypeScript expression parser and evaluator for application-defined filters, conditions, and formulas.";
const PACKAGE_NAME = "@claudiu-ceia/exp";
const REQUIRED_KEYWORDS = [
  "expression-language",
  "expression-parser",
  "expression-evaluator",
  "filters",
  "conditions",
  "formulas",
];
const FORBIDDEN_KEYWORDS = [
  "safe-evaluation",
  "sandbox",
  "secure-eval",
  "rules-engine",
  "policy-engine",
  "javascript-sandbox",
  "browser",
  "llm",
  "ai",
];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

const packageManifest = await readJson<PackageManifest>("package.json");
const denoManifest = await readJson<DenoManifest>("deno.json");
const readme = await Bun.file("README.md").text();

check(packageManifest.name === PACKAGE_NAME, "unexpected npm package name");
check(denoManifest.name === PACKAGE_NAME, "unexpected JSR package name");
check(
  packageManifest.version === denoManifest.version,
  "package.json and deno.json versions must match",
);
check(
  packageManifest.description === EXPECTED_DESCRIPTION,
  "package description does not match the presentation description",
);

const npmCombine = packageManifest.dependencies?.["@claudiu-ceia/combine"];
const jsrCombine = denoManifest.imports?.["@claudiu-ceia/combine"];
check(npmCombine !== undefined, "npm Combine dependency is missing");
check(jsrCombine !== undefined, "JSR Combine dependency is missing");
check(
  jsrCombine === `jsr:@claudiu-ceia/combine@${npmCombine}`,
  "npm and JSR Combine ranges must represent the same release",
);

for (const keyword of REQUIRED_KEYWORDS) {
  check(
    packageManifest.keywords?.includes(keyword),
    `package keyword '${keyword}' is missing`,
  );
}
for (const keyword of FORBIDDEN_KEYWORDS) {
  check(
    !packageManifest.keywords?.includes(keyword),
    `package keyword '${keyword}' is not allowed`,
  );
}

for (const requiredFile of [
  "dist",
  "docs",
  "examples",
  "LICENSE",
  "README.md",
]) {
  check(
    packageManifest.files?.includes(requiredFile),
    `npm artifact does not include '${requiredFile}'`,
  );
}

function fencedTypeScriptAfter(markdown: string, marker: string): string {
  const markerIndex = markdown.indexOf(marker);
  check(markerIndex !== -1, `README marker '${marker}' is missing`);
  const contentStart = markdown.indexOf("```ts\n", markerIndex);
  check(
    contentStart !== -1,
    `README marker '${marker}' has no TypeScript block`,
  );
  const codeStart = contentStart + "```ts\n".length;
  const codeEnd = markdown.indexOf("\n```", codeStart);
  check(codeEnd !== -1, `README marker '${marker}' has an open code block`);
  return markdown.slice(codeStart, codeEnd);
}

const readmeImports = [...readme.matchAll(/from\s+["']([^"']+)["']/g)].map(
  (match) => match[1],
);
check(readmeImports.length > 0, "README has no checked imports");
for (const specifier of readmeImports) {
  check(
    specifier === PACKAGE_NAME || specifier === `jsr:${PACKAGE_NAME}`,
    `README import '${specifier}' is not a public package import`,
  );
}

const exampleGlob = new Bun.Glob("*.ts");
for await (const path of exampleGlob.scan({ cwd: "examples" })) {
  const source = await Bun.file(`examples/${path}`).text();
  check(
    source.includes(`from "${PACKAGE_NAME}"`) ||
      source.includes(`from "jsr:${PACKAGE_NAME}"`),
    `examples/${path} does not use the public package import`,
  );
}

const primaryExample = await Bun.file("examples/primary-filter.ts").text();
check(
  primaryExample.includes(
    fencedTypeScriptAfter(readme, "application-defined formulas."),
  ),
  "primary README example has drifted from its type-checked source",
);
const parseOnceExample = await Bun.file("examples/parse-once.ts").text();
check(
  parseOnceExample.includes(fencedTypeScriptAfter(readme, "## Parse once")),
  "parse-once README example has drifted from its type-checked source",
);

check(
  readme.includes(`\`\`\`text\n${parserDiagnostic}\n\`\`\``),
  "README parser diagnostic does not match executed output",
);
const diagnostics = await Bun.file("docs/diagnostics.md").text();
check(
  diagnostics.includes(`\`\`\`text\n${evaluatorDiagnostic}\n\`\`\``),
  "documented evaluator diagnostic does not match executed output",
);

console.log("presentation metadata passed");
