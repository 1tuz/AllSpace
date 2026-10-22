# Installing AllSpace

AllSpace is a prototype. The repository builds unsigned desktop bundles for
macOS Apple Silicon and Linux x86_64 in
[GitHub Actions](https://github.com/1tuz/AllSpace/actions/workflows/desktop-build.yml).
Signed releases and an updater feed are not configured.

## Download a CI build

1. Open a successful **Desktop builds** run for `main`.
2. Download the artifact for your platform (GitHub sign-in is required):
   - `srelens-desktop-macos-arm64` — app ZIP and DMG.
   - `srelens-desktop-linux-x86_64` — DEB and AppImage.
3. Extract the artifact and use the package appropriate to your platform.

The artifact, executable, and bundle names retain upstream identifiers. These
are AllSpace development builds; packages from the upstream repository contain
the upstream application instead.

## Run or build from source

Install the prerequisites in the [developer guide](DEVELOPMENT.md), then:

```sh
git clone https://github.com/1tuz/AllSpace
cd AllSpace
pnpm install
pnpm dev
```

To create local desktop bundles:

```sh
pnpm tauri build
```

The [developer guide](DEVELOPMENT.md) also covers local macOS installation,
coverage checks, and the web host. See [Credits](../README.md#credits) for the
projects AllSpace builds on.
