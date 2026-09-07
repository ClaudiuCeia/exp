import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type BenchmarkMeasurement = Readonly<{
  p50: number;
  p99: number;
  heap: number;
}>;

export type MetricComparison = Readonly<{
  baseline: number;
  current: number;
  delta: number;
}>;

export type BenchmarkComparison = Readonly<{
  name: string;
  p50: MetricComparison;
  p99: MetricComparison;
  heap: MetricComparison;
  regression: boolean;
}>;

export type BenchmarkReport = Readonly<{
  comparisons: readonly BenchmarkComparison[];
  regressionCount: number;
  markdown: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined)
    throw new Error("Cannot find the median of no values");
  if (sorted.length % 2 !== 0) return upper;

  const lower = sorted[middle - 1];
  if (lower === undefined)
    throw new Error("Cannot find the median of no values");
  return (lower + upper) / 2;
}

function formatDuration(nanoseconds: number): string {
  if (nanoseconds >= 1_000_000) {
    return `${(nanoseconds / 1_000_000).toFixed(2)} ms`;
  }
  if (nanoseconds >= 1_000) return `${(nanoseconds / 1_000).toFixed(2)} us`;
  return `${nanoseconds.toFixed(2)} ns`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MiB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(2)} KiB`;
  return `${bytes.toFixed(2)} B`;
}

function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) return "+infinity";
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function readPositiveMetric(
  stats: Record<string, unknown>,
  name: "p50" | "p99",
  benchmark: string,
): number {
  const value = stats[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Benchmark '${benchmark}' has an invalid ${name}`);
  }
  return value;
}

function readHeap(stats: Record<string, unknown>, benchmark: string): number {
  const heap = stats.heap;
  if (!isRecord(heap)) {
    throw new Error(`Benchmark '${benchmark}' has invalid heap stats`);
  }
  const average = heap.avg;
  if (typeof average !== "number" || !Number.isFinite(average) || average < 0) {
    throw new Error(`Benchmark '${benchmark}' has an invalid heap average`);
  }
  return average;
}

export function extractExpMeasurements(
  value: unknown,
): ReadonlyMap<string, BenchmarkMeasurement> {
  if (!isRecord(value)) throw new Error("Mitata result must be an object");
  if (!Array.isArray(value.layout)) {
    throw new Error("Mitata result layout must be an array");
  }
  if (!Array.isArray(value.benchmarks)) {
    throw new Error("Mitata result benchmarks must be an array");
  }

  const measurements = new Map<string, BenchmarkMeasurement>();
  for (const valueBenchmark of value.benchmarks) {
    if (!isRecord(valueBenchmark)) {
      throw new Error("Mitata benchmark must be an object");
    }
    if (typeof valueBenchmark.alias !== "string") {
      throw new Error("Mitata benchmark alias must be a string");
    }
    if (valueBenchmark.alias !== "exp") continue;
    const group = valueBenchmark.group;
    if (
      typeof group !== "number" ||
      !Number.isSafeInteger(group) ||
      group < 0
    ) {
      throw new Error("Exp benchmark group must be a non-negative integer");
    }

    const layout = value.layout[group];
    if (!isRecord(layout) || typeof layout.name !== "string" || !layout.name) {
      throw new Error("Exp benchmark group must have a name");
    }
    const name = layout.name;
    if (measurements.has(name)) {
      throw new Error(`Duplicate benchmark: ${name}`);
    }
    if (!Array.isArray(valueBenchmark.runs)) {
      throw new Error(`Benchmark '${name}' runs must be an array`);
    }
    const firstRun = valueBenchmark.runs[0];
    if (firstRun === undefined) {
      throw new Error(`Benchmark '${name}' must contain at least one run`);
    }
    if (!isRecord(firstRun) || !isRecord(firstRun.stats)) {
      throw new Error(`Benchmark '${name}' run must contain stats`);
    }

    const p50 = readPositiveMetric(firstRun.stats, "p50", name);
    const p99 = readPositiveMetric(firstRun.stats, "p99", name);
    measurements.set(name, {
      p50,
      p99,
      heap: readHeap(firstRun.stats, name),
    });
  }

  if (measurements.size === 0) throw new Error("No exp benchmarks found");
  return measurements;
}

function getMeasurement(
  run: ReadonlyMap<string, BenchmarkMeasurement>,
  name: string,
): BenchmarkMeasurement {
  const measurement = run.get(name);
  if (measurement === undefined) {
    throw new Error("Baseline and current benchmark sets do not match");
  }
  return measurement;
}

function compareMetric(baseline: number, current: number): MetricComparison {
  const delta =
    baseline === 0
      ? current === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : ((current - baseline) / baseline) * 100;
  return { baseline, current, delta };
}

export function compareBenchmarkRuns(
  baselineRuns: readonly ReadonlyMap<string, BenchmarkMeasurement>[],
  currentRuns: readonly ReadonlyMap<string, BenchmarkMeasurement>[],
  thresholdPercent: number,
): BenchmarkReport {
  if (baselineRuns.length === 0 || currentRuns.length === 0) {
    throw new Error(
      "At least one baseline and current benchmark run is required",
    );
  }
  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0) {
    throw new Error("The regression threshold must be positive and finite");
  }

  const firstBaseline = baselineRuns[0];
  if (firstBaseline === undefined) {
    throw new Error(
      "At least one baseline and current benchmark run is required",
    );
  }
  for (const benchmarkRun of [...baselineRuns, ...currentRuns]) {
    if (benchmarkRun.size === 0) {
      throw new Error("Benchmark runs must contain at least one measurement");
    }
  }
  const names = [...firstBaseline.keys()].sort();
  const expected = names.join("\n");
  for (const benchmarkRun of [...baselineRuns, ...currentRuns]) {
    if ([...benchmarkRun.keys()].sort().join("\n") !== expected) {
      throw new Error("Baseline and current benchmark sets do not match");
    }
  }

  const comparisons = names.map((name): BenchmarkComparison => {
    const baseline = baselineRuns.map((run) => getMeasurement(run, name));
    const current = currentRuns.map((run) => getMeasurement(run, name));
    const p50 = compareMetric(
      median(baseline.map((measurement) => measurement.p50)),
      median(current.map((measurement) => measurement.p50)),
    );
    return {
      name,
      p50,
      p99: compareMetric(
        median(baseline.map((measurement) => measurement.p99)),
        median(current.map((measurement) => measurement.p99)),
      ),
      heap: compareMetric(
        median(baseline.map((measurement) => measurement.heap)),
        median(current.map((measurement) => measurement.heap)),
      ),
      regression: p50.delta > thresholdPercent,
    };
  });
  const regressionCount = comparisons.filter(
    ({ regression }) => regression,
  ).length;
  const status =
    regressionCount === 0
      ? `Passed: no benchmark exceeded the ${thresholdPercent}% p50 regression threshold.`
      : `Failed: ${regressionCount} benchmark${regressionCount === 1 ? "" : "s"} exceeded the ${thresholdPercent}% p50 regression threshold.`;
  const rows = comparisons.map(({ name, p50, p99, heap, regression }) =>
    [
      `| \`${name}\``,
      formatDuration(p50.baseline),
      formatDuration(p50.current),
      formatDelta(p50.delta),
      formatDuration(p99.baseline),
      formatDuration(p99.current),
      formatDelta(p99.delta),
      formatBytes(heap.baseline),
      formatBytes(heap.current),
      formatDelta(heap.delta),
      regression ? "Fail |" : "Pass |",
    ].join(" | "),
  );
  const markdown = [
    "## Performance",
    "",
    status,
    "",
    `Results use median metrics from ${baselineRuns.length} base and ${currentRuns.length} head runs on the same runner. The gate applies to p50. Mitata p99 and heap allocation per operation are diagnostic.`,
    "",
    "| Benchmark | Base p50 | Head p50 | Change | Base p99 | Head p99 | Change | Base heap/op | Head heap/op | Change | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |",
    ...rows,
    "",
  ].join("\n");

  return { comparisons, regressionCount, markdown };
}

async function readRuns(
  directory: string,
): Promise<Array<ReadonlyMap<string, BenchmarkMeasurement>>> {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No benchmark results found in ${directory}`);
  }

  return Promise.all(
    files.map(async (file) => {
      const result: unknown = JSON.parse(
        await readFile(join(directory, file), "utf8"),
      );
      return extractExpMeasurements(result);
    }),
  );
}

function readOption(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) throw new Error(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const baselineDirectory = readOption("--baseline");
  const currentDirectory = readOption("--current");
  const output = readOption("--output");
  const threshold = Number(readOption("--threshold"));
  const report = compareBenchmarkRuns(
    await readRuns(baselineDirectory),
    await readRuns(currentDirectory),
    threshold,
  );

  await writeFile(output, report.markdown);
  process.stdout.write(report.markdown);
  if (report.regressionCount > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
