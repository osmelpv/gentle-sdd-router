// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "gentle-sdd-router";

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  const { execSync } = require("child_process");
  return execSync(cmd, { encoding: "utf8" });
}

function runSafe(cmd: string, fallback = ""): string {
  try { return run(cmd); } catch { return fallback; }
}

function getActivePreset(): string {
  // "Preset      local-hybrid (9 phases)"
  return runSafe("gsr status 2>/dev/null").match(/Preset\s+(\S+)/i)?.[1] || "default";
}

function getPresetList(): string[] {
  try {
    return run("gsr preset list 2>/dev/null")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("Name") && !l.startsWith("─") && !l.startsWith("Preset"));
  } catch { return []; }
}

function parseGsrFallbackList(output: string) {
  const phases: { name: string; primary: string; fallbacks: string[] }[] = [];
  let current: typeof phases[0] | null = null;

  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    const phaseMatch = line.match(/^(\S[^:]+)\s*\(lane\s*\d+\)\s*:$/);
    if (phaseMatch) {
      if (current && current.fallbacks.length > 0) phases.push(current);
      current = { name: phaseMatch[1].trim(), primary: "", fallbacks: [] };
      continue;
    }
    if (!current) continue;
    const primaryMatch = line.match(/^\s+Primary\s*:\s*(.+)$/i);
    if (primaryMatch) { current.primary = primaryMatch[1].trim(); continue; }
    const fallbackMatch = line.match(/^\s+\d+\.\s+(.+)$/);
    if (fallbackMatch) current.fallbacks.push(fallbackMatch[1].trim());
  }
  if (current && current.fallbacks.length > 0) phases.push(current);
  return { phases };
}

// ── TUI Plugin ────────────────────────────────────────────────────────────────
const tui: TuiPlugin = async (api, options) => {

  const NAV = "──────────";

  // ── Fallback flow ─────────────────────────────────────────────────────────

  const executePromote = (phase, index) => {
    const preset = getActivePreset();
    try {
      run(`gsr fallback promote ${preset} ${phase.name} ${index} 2>&1`);
      run("gsr sync 2>&1");
      api.ui.toast({ title: "Promoted", message: `${phase.fallbacks[index - 1]} → primary for ${phase.name}`, variant: "success" });
    } catch {
      api.ui.toast({ title: "Error", message: "Could not promote fallback.", variant: "error" });
    }
  };

  const showFallbackSelector = (phase) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR — Promote fallback (${phase.name})`}
        options={[
          ...phase.fallbacks.map((fb, i) => ({
            title: fb,
            value: i + 1,
            description: `→ becomes primary · ${phase.primary} → fallback #1`,
          })),
          { title: "← Back", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showFallbackFlow(); return; }
          api.ui.dialog.clear();
          executePromote(phase, opt.value);
        }}
        onCancel={() => showFallbackFlow()}
      />
    ));
  };

  const showFallbackFlow = () => {
    const preset = getActivePreset();
    const raw = runSafe(`gsr fallback list ${preset} 2>/dev/null`);
    const phases = parseGsrFallbackList(raw).phases.filter(p => p.fallbacks.length > 0);

    if (phases.length === 0) {
      api.ui.toast({ message: "No fallbacks configured. Use: gsr fallback add <preset> <phase> <model>", variant: "info" });
      showMainMenu();
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Select phase to change"
        options={[
          ...phases.map(p => ({
            title: p.name,
            value: p,
            description: `Primary: ${p.primary} · ${p.fallbacks.length} fallback(s)`,
          })),
          { title: "← Back to menu", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showMainMenu(); return; }
          showFallbackSelector(opt.value);
        }}
        onCancel={() => showMainMenu()}
      />
    ));
  };

  // ── Route flow ────────────────────────────────────────────────────────────

  const showRouteMenu = () => {
    const active = getActivePreset();
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR — Route  (active: ${active})`}
        options={[
          { title: "Switch preset", value: "use", description: "Change the active routing preset" },
          { title: "Show routes", value: "show", description: "Show resolved routes for current preset" },
          { title: "Activate gsr", value: "activate", description: "Activate gsr routing control" },
          { title: "Deactivate gsr", value: "deactivate", description: "Hand control back to host" },
          { title: "← Main menu", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showMainMenu(); return; }
          if (opt.value === "use") { showPresetPicker(); return; }
          api.ui.dialog.clear();
          const cmd = { show: "gsr route show", activate: "gsr route activate", deactivate: "gsr route deactivate" }[opt.value];
          const out = runSafe(`${cmd} 2>&1`, "Done.");
          api.ui.toast({ title: `gsr route ${opt.value}`, message: out.slice(0, 120), variant: "info" });
        }}
        onCancel={() => showMainMenu()}
      />
    ));
  };

  const showPresetPicker = () => {
    const presets = getPresetList();
    if (presets.length === 0) {
      api.ui.toast({ message: "No presets found.", variant: "warning" });
      showRouteMenu();
      return;
    }
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Switch preset"
        options={[
          ...presets.map(p => ({ title: p, value: p })),
          { title: "← Back", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showRouteMenu(); return; }
          api.ui.dialog.clear();
          const out = runSafe(`gsr route use ${opt.value} 2>&1`, "Done.");
          api.ui.toast({ title: "Preset switched", message: `Now using: ${opt.value}`, variant: "success" });
        }}
        onCancel={() => showRouteMenu()}
      />
    ));
  };

  // ── System flow ───────────────────────────────────────────────────────────

  const showSystemMenu = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — System"
        options={[
          { title: "Status", value: "status", description: "Show router state and active preset" },
          { title: "Sync", value: "sync", description: "Full sync: overlay + commands + validate" },
          { title: "← Main menu", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showMainMenu(); return; }
          api.ui.dialog.clear();
          const out = runSafe(`gsr ${opt.value} 2>&1`, "Done.");
          api.ui.toast({ title: `gsr ${opt.value}`, message: out.slice(0, 200), variant: "info" });
        }}
        onCancel={() => showMainMenu()}
      />
    ));
  };

  // ── Setup flow ────────────────────────────────────────────────────────────

  const showSetupMenu = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Setup"
        options={[
          { title: "Apply overlay", value: "apply", description: "Generate and apply TUI overlay" },
          { title: "Update config", value: "update", description: "Check and apply config migrations" },
          { title: "← Main menu", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showMainMenu(); return; }
          api.ui.dialog.clear();
          const out = runSafe(`gsr setup ${opt.value} 2>&1`, "Done.");
          api.ui.toast({ title: `gsr setup ${opt.value}`, message: out.slice(0, 200), variant: "info" });
        }}
        onCancel={() => showMainMenu()}
      />
    ));
  };

  // ── Inspect flow ──────────────────────────────────────────────────────────

  const showInspectMenu = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Inspect"
        options={[
          { title: "Browse metadata", value: "browse", description: "Browse multimodel metadata" },
          { title: "Compare presets", value: "compare", description: "Compare two presets side by side" },
          { title: "← Main menu", value: "__back__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__back__") { showMainMenu(); return; }
          api.ui.dialog.clear();
          api.ui.toast({ title: "Inspect", message: `Run: gsr inspect ${opt.value}`, variant: "info" });
        }}
        onCancel={() => showMainMenu()}
      />
    ));
  };

  // ── Main menu ─────────────────────────────────────────────────────────────

  const showMainMenu = () => {
    const active = getActivePreset();
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR Router  ·  preset: ${active}`}
        options={[
          { title: "Route", value: "route", description: "Switch preset, activate / deactivate routing", category: "Navigation" },
          { title: "Fallbacks", value: "fallback", description: "Promote a fallback model to primary", category: "Navigation" },
          { title: "Inspect", value: "inspect", description: "Browse and compare preset metadata", category: "Navigation" },
          { title: "Setup", value: "setup", description: "Apply overlay and config migrations", category: "Navigation" },
          { title: "System", value: "system", description: "Status and sync", category: "Navigation" },
          { title: "✕ Close", value: "__close__", category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === "__close__") { api.ui.dialog.clear(); return; }
          if (opt.value === "route")    { showRouteMenu(); return; }
          if (opt.value === "fallback") { showFallbackFlow(); return; }
          if (opt.value === "inspect")  { showInspectMenu(); return; }
          if (opt.value === "setup")    { showSetupMenu(); return; }
          if (opt.value === "system")   { showSystemMenu(); return; }
        }}
        onCancel={() => api.ui.dialog.clear()}
      />
    ));
  };

  // ── Command registration ──────────────────────────────────────────────────

  api.command.register(() => [
    {
      title: "GSR — Main menu",
      value: "gsr",
      description: "Open gsr router control panel",
      category: "GSR",
      slash: { name: "gsr" },
      onSelect: () => showMainMenu(),
    },
    {
      title: "GSR — Manage fallbacks",
      value: "gsr-fallback",
      description: "Promote a fallback model to primary",
      category: "GSR",
      slash: { name: "gsr-fallback" },
      onSelect: () => showFallbackFlow(),
    },
  ]);

  // ── Auto-trigger on model failure ─────────────────────────────────────────

  api.event.on("session.error", async (event) => {
    const autoFallback = api.kv.get("gsr.autoFallback", false);
    const preset = getActivePreset();
    const raw = runSafe(`gsr fallback list ${preset} 2>/dev/null`);
    const phases = parseGsrFallbackList(raw).phases;
    const phase = phases.find(p => p.fallbacks.length > 0);

    if (autoFallback && phase) {
      executePromote(phase, 1);
    } else {
      api.ui.toast({ title: "GSR: Model failed", message: "Open GSR — Manage fallbacks to switch", variant: "warning" });
      if (phase) showFallbackFlow();
    }
  });
};

const plugin: TuiPluginModule & { id: string } = { id, tui };
export default plugin;
