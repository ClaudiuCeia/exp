const stableVersion = /^\d+\.\d+\.\d+$/;

function compareStableVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

export function chooseNpmPublishTag(
  version: string,
  publishedVersions: string[],
): string {
  if (!stableVersion.test(version)) {
    throw new Error(
      `Expected a stable semantic version, received '${version}'`,
    );
  }

  const versions = publishedVersions.filter((value) =>
    stableVersion.test(value),
  );
  versions.push(version);
  versions.sort(compareStableVersions);
  return versions.at(-1) === version ? "latest" : `release-${version}`;
}

if (import.meta.main) {
  const version = Bun.env.VERSION;
  const serializedVersions = Bun.env.VERSIONS;
  if (!version || !serializedVersions) {
    throw new Error("VERSION and VERSIONS are required");
  }
  const parsed = JSON.parse(serializedVersions) as unknown;
  const versions = Array.isArray(parsed) ? parsed : [parsed];
  if (!versions.every((value) => typeof value === "string")) {
    throw new Error("VERSIONS must contain only strings");
  }
  process.stdout.write(chooseNpmPublishTag(version, versions));
}
