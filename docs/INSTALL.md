# Installing AllSpace

AllSpace is a prototype. Tag-triggered, unsigned desktop releases for macOS
Apple Silicon and Linux x86_64 are published on the
[releases page](https://github.com/1tuz/AllSpace/releases). They are not
notarized and carry no updater feed.

## Install a release

```sh
curl -fsSL https://raw.githubusercontent.com/1tuz/AllSpace/main/scripts/install.sh | bash
```

```sh
curl -fsSL https://raw.githubusercontent.com/1tuz/AllSpace/main/scripts/uninstall.sh | bash
```

The first command installs the release for the current machine; the second
removes the installed application.

### Manual download

Take the asset for your platform from the
[latest release](https://github.com/1tuz/AllSpace/releases/latest):

- `srelens_<ver>_aarch64.dmg` — macOS Apple Silicon
- `srelens_<ver>_amd64.deb` — Debian/Ubuntu x86_64
- `srelens_<ver>_amd64.AppImage` — portable Linux x86_64

The artifact, executable, and bundle names retain upstream identifiers. These
are AllSpace builds; packages from the upstream repository contain the upstream
application instead.

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
