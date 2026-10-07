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

Before the first release, the npm org `lingua-api` and the repository secret `NPM_TOKEN` must exist.

## Node support

Everything must run on every Node 22.x and 24.x minor, so never rely on features that landed mid-22.x (native TS type stripping, stable `fs.promises.glob`, `util.styleText` color detection, `require(esm)`).
