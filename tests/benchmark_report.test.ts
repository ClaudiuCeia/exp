import { describe, expect, test } from "bun:test";
import {
  compareBenchmarkRuns,
  extractExpMeasurements,
} from "../scripts/benchmark-report.ts";

function run(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe("benchmark report", () => {
  test("extracts exp p50 measurements by group", () => {
    const measurements = extractExpMeasurements({
      layout: [{ name: null }, { name: "parse/small" }],
      benchmarks: [
        { alias: "exp", group: 1, runs: [{ stats: { p50: 100 } }] },
        { alias: "other", group: 1, runs: [{ stats: { p50: 50 } }] },
      ],
    });

    expect(measurements).toEqual(new Map([["parse/small", 100]]));
  });

  test("uses median runs and reports only changes above the threshold", () => {
    const report = compareBenchmarkRuns(
      [
        run({ parse: 90, evaluate: 100 }),
        run({ parse: 100, evaluate: 110 }),
        run({ parse: 200, evaluate: 120 }),
      ],
      [
        run({ parse: 110, evaluate: 130 }),
        run({ parse: 114, evaluate: 132 }),
        run({ parse: 300, evaluate: 134 }),
      ],
      15,
    );

    expect(report.comparisons[0]).toEqual({
      name: "evaluate",
      baseline: 110,
      current: 132,
      delta: 20,
      regression: true,
    });
    expect(report.comparisons[1]).toMatchObject({
      name: "parse",
      baseline: 100,
      current: 114,
      regression: false,
    });
    expect(report.comparisons[1]!.delta).toBeCloseTo(14);
    expect(report.regressionCount).toBe(1);
    expect(report.markdown).toContain("Failed: 1 benchmark exceeded");
  });

  test("rejects mismatched benchmark sets", () => {
    expect(() =>
      compareBenchmarkRuns([run({ parse: 100 })], [run({ other: 100 })], 15),
    ).toThrow("Baseline and current benchmark sets do not match");
  });
});
