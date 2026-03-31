# Getting Started

## Prerequisites

- **Node.js 20+** — required for running gsr
- **A project directory** — gsr creates config inside your project

## Installation

### From npm (recommended)

```bash
npm install -g gentle-sdd-router
```

### From source

```bash
git clone https://github.com/osmelpv/gentle-sdd-router.git
cd gentle-sdd-router
npm install
npm link
```

This makes `gsr` available globally in your terminal.

### With gentle-ai (recommended)

If you use the [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) ecosystem, gsr integrates automatically. When gentle-ai is detected, gsr uses it as the routing controller.

### Without gentle-ai (standalone)

gsr works independently. Without gentle-ai, the controller label defaults to `host`, the default persona is `neutral`, and all execution owners fall back to `['host']`. You get the same routing features — just without the Gentleman persona injection and ecosystem integration.

## First Setup

### Interactive wizard

Run `gsr` with no arguments in your project directory:

```bash
cd your-project
gsr
```

The wizard detects your project state and offers options:
- **No router config found** → Install gsr
- **Outdated config** → Update to latest version
- **Current config** → Switch presets, view status, manage profiles

### Direct install

```bash
cd your-project
gsr setup install
```

> **Note**: The old `gsr install` command still works as a backward-compat alias.

This creates the v4 multi-file layout:

```
your-project/
  router/
    router.yaml                    # core config
    profiles/
      multivendor.router.yaml      # default preset
```

## Basic Usage

```bash
# Check current state
gsr status

# List available presets
gsr profile list

# Switch to a different preset
gsr route use claude

# View resolved routes
gsr route show

# Import or export presets
gsr profile export multivendor --compact
gsr profile import ./shared.router.yaml
```

> **Backward-compat aliases**: The old commands `gsr list`, `gsr use claude`, `gsr reload`, and `gsr install` still work. The new tree (`gsr profile list`, `gsr route use`, etc.) is the recommended form going forward.

## Next Steps

- [Presets Guide](presets-guide.md) — understand and customize presets
- [Import/Export Guide](import-export.md) — share, package, and import presets
- [Migration Guide](migration-guide.md) — upgrading from older schema versions
- [Architecture](architecture.md) — how gsr works under the hood
