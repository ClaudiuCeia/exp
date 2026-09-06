import { expect, test } from "bun:test";
import { chooseNpmPublishTag } from "../scripts/npm-publish-tag.ts";

test("uses latest for the highest stable version", () => {
  expect(chooseNpmPublishTag("1.10.0", ["1.9.0", "1.10.0-beta.1"])).toBe(
    "latest",
  );
});

test("does not move latest backward for an older release", () => {
  expect(chooseNpmPublishTag("1.2.3", ["1.2.3-beta.1", "1.3.0"])).toBe(
    "release-1.2.3",
  );
});

test("rejects prerelease publication versions", () => {
  expect(() => chooseNpmPublishTag("1.2.3-beta.1", ["1.2.2"])).toThrow(
    "Expected a stable semantic version",
  );
});
