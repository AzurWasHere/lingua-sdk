# Contributing

## Prerequisites

- Node 22+
- pnpm 10

## Workflow

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

Add a changeset with `pnpm changeset` for any change that affects a published package.

## Project layout

Packages, data flow, merge rules and format drivers are described in [docs/architecture.md](docs/architecture.md).

## Release

1. Every PR that changes a published package adds a changeset (`pnpm changeset`).
2. On `main`, the release workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) opens a "chore: release" version PR that bumps versions and changelogs.
3. Merging that PR publishes the bumped packages to npm with provenance.

Publishing uses npm Trusted Publishing, so no npm token is stored in the repository. The first release is published locally (`npm login`, `pnpm run version`, `pnpm run release`), because a trusted publisher can only be added to a package that already exists. After that, each package's npm settings must list the trusted publisher: GitHub Actions, repository `AzurWasHere/lingua-sdk`, workflow `release.yml`.

## Node support

Everything must run on every Node 22.x and 24.x minor, so never rely on features that landed mid-22.x (native TS type stripping, stable `fs.promises.glob`, `util.styleText` color detection, `require(esm)`).
