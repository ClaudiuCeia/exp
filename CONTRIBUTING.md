# Contributing

Contributions are welcome. For substantial behavior or API changes, open an
issue before starting implementation so the approach can be discussed.

## Development

Install Deno 2, clone the repository, and run:

```sh
deno task check
```

Changes that affect npm compatibility should also run:

```sh
deno task build:npm
```

Keep pull requests focused, add regression tests for behavior changes, and
update public documentation when an API changes. Commit messages should follow
the Conventional Commits format.

Report vulnerabilities according to [SECURITY.md](SECURITY.md), not through a
public issue.
