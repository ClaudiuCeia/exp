# Contributing

Contributions are welcome. For substantial behavior or API changes, open an
issue before starting implementation so the approach can be discussed.

## Development

Install Bun 1.4, clone the repository, and run:

```sh
bun install
bun run check
```

Changes that affect npm compatibility should also run:

```sh
bun run package:check
```

Deno 2 is only required to validate changes to the JSR package with
`deno publish --dry-run`.

Keep pull requests focused, add regression tests for behavior changes, and
update public documentation when an API changes. Commit messages should follow
the Conventional Commits format.

Report vulnerabilities according to [SECURITY.md](SECURITY.md), not through a
public issue.
