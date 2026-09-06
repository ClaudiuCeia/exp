import { describe, expect, test } from "bun:test";
import type { BenchmarkMeasurement } from "../scripts/benchmark-report.ts";
import {
  compareBenchmarkRuns,
  extractExpMeasurements,
} from "../scripts/benchmark-report.ts";

function measurement(
  p50: number,
  p99 = p50 * 2,
  heap = p50 * 3,
): BenchmarkMeasurement {
  return { p50, p99, heap };
}

function run(
  entries: Readonly<Record<string, BenchmarkMeasurement>>,
): Map<string, BenchmarkMeasurement> {
  return new Map(Object.entries(entries));
}

function failureMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected action to fail");
}

function result(
  stats: unknown = { p50: 100, p99: 200, heap: { avg: 300 } },
): unknown {
  return {
    layout: [{ name: null }, { name: "parse/small" }],
    benchmarks: [
      { alias: "exp", group: 1, runs: [{ stats }] },
      {
        alias: "other",
        group: 1,
        runs: [{ stats: { p50: 50, p99: 100, heap: { avg: 150 } } }],
      },
    ],
  };
}

function resultWithBenchmark(
  benchmark: unknown,
  layout: readonly unknown[] = [{ name: "parse/small" }],
): unknown {
  return { layout, benchmarks: [benchmark] };
}

const VALID_STATS = { p50: 100, p99: 200, heap: { avg: 300 } };

describe("benchmark report", () => {
  test("extracts exp latency and allocation measurements by group", () => {
    expect(extractExpMeasurements(result())).toEqual(
      new Map([["parse/small", measurement(100, 200, 300)]]),
    );
  });

  test("rejects a malformed top-level result shape", () => {
    expect(failureMessage(() => extractExpMeasurements(null))).toBe(
      "Mitata result must be an object",
    );
    expect(
      failureMessage(() =>
        extractExpMeasurements({ layout: {}, benchmarks: [] }),
      ),
    ).toBe("Mitata result layout must be an array");
    expect(
      failureMessage(() =>
        extractExpMeasurements({ layout: [], benchmarks: {} }),
      ),
    ).toBe("Mitata result benchmarks must be an array");
    expect(
      failureMessage(() =>
        extractExpMeasurements({ layout: [], benchmarks: [null] }),
      ),
    ).toBe("Mitata benchmark must be an object");
  });

  test("rejects an exp benchmark without runs", () => {
    expect(
      failureMessage(() =>
        extractExpMeasurements({
          layout: [{ name: "parse/small" }],
          benchmarks: [{ alias: "exp", group: 0 }],
        }),
      ),
    ).toBe("Benchmark 'parse/small' runs must be an array");
    expect(
      failureMessage(() =>
        extractExpMeasurements({
          layout: [{ name: "parse/small" }],
          benchmarks: [{ alias: "exp", group: 0, runs: [] }],
        }),
      ),
    ).toBe("Benchmark 'parse/small' must contain at least one run");
  });

  test("rejects an exp benchmark without stats", () => {
    expect(
      failureMessage(() =>
        extractExpMeasurements({
          layout: [{ name: "parse/small" }],
          benchmarks: [{ alias: "exp", group: 0, runs: [{}] }],
        }),
      ),
    ).toBe("Benchmark 'parse/small' run must contain stats");
  });

  test("rejects invalid latency and allocation stats", () => {
    expect(
      failureMessage(() =>
        extractExpMeasurements(result({ ...VALID_STATS, p50: 0 })),
      ),
    ).toBe("Benchmark 'parse/small' has an invalid p50");
    expect(
      failureMessage(() =>
        extractExpMeasurements(result({ ...VALID_STATS, p99: null })),
      ),
    ).toBe("Benchmark 'parse/small' has an invalid p99");
    expect(
      failureMessage(() =>
        extractExpMeasurements(result({ ...VALID_STATS, heap: [] })),
      ),
    ).toBe("Benchmark 'parse/small' has invalid heap stats");
    expect(
      failureMessage(() =>
        extractExpMeasurements(
          result({ ...VALID_STATS, heap: { avg: Number.POSITIVE_INFINITY } }),
        ),
      ),
    ).toBe("Benchmark 'parse/small' has an invalid heap average");
  });

  test("rejects invalid benchmark aliases groups and layout entries", () => {
    expect(
      failureMessage(() =>
        extractExpMeasurements(
          resultWithBenchmark({ alias: null, group: 0, runs: [] }),
        ),
      ),
    ).toBe("Mitata benchmark alias must be a string");
    expect(
      failureMessage(() =>
        extractExpMeasurements(
          resultWithBenchmark({ alias: "exp", group: -1, runs: [] }),
        ),
      ),
    ).toBe("Exp benchmark group must be a non-negative integer");
    expect(
      failureMessage(() =>
        extractExpMeasurements(
          resultWithBenchmark(
            {
              alias: "exp",
              group: 0,
              runs: [{ stats: VALID_STATS }],
            },
            [null],
          ),
        ),
      ),
    ).toBe("Exp benchmark group must have a name");
  });

  test("rejects duplicate exp benchmark cases", () => {
    expect(
      failureMessage(() =>
        extractExpMeasurements({
          layout: [{ name: "parse/small" }],
          benchmarks: [
            {
              alias: "exp",
              group: 0,
              runs: [{ stats: { p50: 1, p99: 2, heap: { avg: 3 } } }],
            },
            {
              alias: "exp",
              group: 0,
              runs: [{ stats: { p50: 4, p99: 5, heap: { avg: 6 } } }],
            },
          ],
        }),
      ),
    ).toBe("Duplicate benchmark: parse/small");
  });

  test("uses median runs and reports p50 p99 and allocation changes", () => {
    const report = compareBenchmarkRuns(
      [
        run({
          parse: measurement(90, 180, 270),
          evaluate: measurement(100, 200, 300),
        }),
        run({
          parse: measurement(100, 200, 300),
          evaluate: measurement(110, 220, 330),
        }),
        run({
          parse: measurement(200, 400, 600),
          evaluate: measurement(120, 240, 360),
        }),
      ],
      [
        run({
          parse: measurement(110, 230, 330),
          evaluate: measurement(130, 260, 390),
        }),
        run({
          parse: measurement(114, 240, 360),
          evaluate: measurement(132, 264, 396),
        }),
        run({
          parse: measurement(300, 500, 900),
          evaluate: measurement(134, 268, 402),
        }),
      ],
      15,
    );

    expect(report.comparisons[0]).toEqual({
      name: "evaluate",
      p50: { baseline: 110, current: 132, delta: 20 },
      p99: { baseline: 220, current: 264, delta: 20 },
      heap: { baseline: 330, current: 396, delta: 20 },
      regression: true,
    });
    expect(report.comparisons[1]?.p50.delta).toBeCloseTo(14);
    expect(report.comparisons[1]?.p99).toEqual({
      baseline: 200,
      current: 240,
      delta: 20,
    });
    expect(report.comparisons[1]?.heap).toEqual({
      baseline: 300,
      current: 360,
      delta: 20,
    });
    expect(report.comparisons[1]?.regression).toBe(false);
    expect(report.regressionCount).toBe(1);
    expect(report.markdown).toContain("Failed: 1 benchmark exceeded");
    expect(report.markdown).toContain("Base p99");
    expect(report.markdown).toContain("Base heap/op");
  });

  test("uses the mean of the two middle values for even run counts", () => {
    const report = compareBenchmarkRuns(
      [
        run({ parse: measurement(1_000_000, 2_000_000, 1_024) }),
        run({ parse: measurement(3_000_000, 4_000_000, 3_072) }),
      ],
      [
        run({ parse: measurement(2_000_000, 3_000_000, 2_048) }),
        run({ parse: measurement(4_000_000, 5_000_000, 4_096) }),
      ],
      60,
    );

    expect(report.comparisons).toEqual([
      {
        name: "parse",
        p50: { baseline: 2_000_000, current: 3_000_000, delta: 50 },
        p99: {
          baseline: 3_000_000,
          current: 4_000_000,
          delta: 33.33333333333333,
        },
        heap: { baseline: 2_048, current: 3_072, delta: 50 },
        regression: false,
      },
    ]);
    expect(report.markdown).toContain("| 2.00 ms | 3.00 ms | +50.0%");
    expect(report.markdown).toContain("| 2.00 KiB | 3.00 KiB | +50.0%");
  });

  test("rejects missing baseline and current run collections", () => {
    const oneRun = [run({ parse: measurement(100) })];
    expect(failureMessage(() => compareBenchmarkRuns([], oneRun, 15))).toBe(
      "At least one baseline and current benchmark run is required",
    );
    expect(failureMessage(() => compareBenchmarkRuns(oneRun, [], 15))).toBe(
      "At least one baseline and current benchmark run is required",
    );
  });

  test("rejects empty baseline and current measurement maps", () => {
    const emptyRun = new Map<string, BenchmarkMeasurement>();
    const oneRun = run({ parse: measurement(100) });
    expect(
      failureMessage(() => compareBenchmarkRuns([emptyRun], [oneRun], 15)),
    ).toBe("Benchmark runs must contain at least one measurement");
    expect(
      failureMessage(() => compareBenchmarkRuns([oneRun], [emptyRun], 15)),
    ).toBe("Benchmark runs must contain at least one measurement");
  });

  test("rejects mismatched benchmark sets", () => {
    expect(
      failureMessage(() =>
        compareBenchmarkRuns(
          [run({ parse: measurement(100) })],
          [run({ other: measurement(100) })],
          15,
        ),
      ),
    ).toBe("Baseline and current benchmark sets do not match");
  });

  test("rejects invalid regression thresholds", () => {
    const runs = [run({ parse: measurement(100) })];
    for (const threshold of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      0,
    ]) {
      expect(
        failureMessage(() => compareBenchmarkRuns(runs, runs, threshold)),
      ).toBe("The regression threshold must be positive and finite");
    }
  });

  test("reports an infinite allocation delta from a zero baseline", () => {
    const report = compareBenchmarkRuns(
      [run({ parse: measurement(100, 200, 0) })],
      [run({ parse: measurement(100, 200, 10) })],
      15,
    );

    expect(report.comparisons).toEqual([
      {
        name: "parse",
        p50: { baseline: 100, current: 100, delta: 0 },
        p99: { baseline: 200, current: 200, delta: 0 },
        heap: {
          baseline: 0,
          current: 10,
          delta: Number.POSITIVE_INFINITY,
        },
        regression: false,
      },
    ]);
    expect(report.markdown).toContain(
      "| 0.00 B | 10.00 B | +infinity | Pass |",
    );
  });
});
