// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "gentle-sdd-router";

// ── Parser — matches actual `gsr fallback list` output ───────────────────────
// Format produced by the CLI:
//   orchestrator (lane 0):
//     Primary: anthropic/claude-sonnet-4-6
//     1. mistral/mistral-large-3
//     2. opencode/qwen3.6-plus-free
function parseGsrFallbackList(output) {
  const phases = [];
  let current = null;

  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();

    // Phase header: "orchestrator (lane 0):"
    const phaseMatch = line.match(/^(\S[^:]+)\s*\(lane\s*\d+\)\s*:$/);
    if (phaseMatch) {
      if (current && current.fallbacks.length > 0) phases.push(current);
      current = { name: phaseMatch[1].trim(), primary: "", fallbacks: [] };
      continue;
    }

    if (!current) continue;

    // "  Primary: anthropic/claude-sonnet-4-6"
    const primaryMatch = line.match(/^\s+Primary\s*:\s*(.+)$/i);
    if (primaryMatch) { current.primary = primaryMatch[1].trim(); continue; }

    // "  1. mistral/mistral-large-3"
    const fallbackMatch = line.match(/^\s+\d+\.\s+(.+)$/);
    if (fallbackMatch) current.fallbacks.push(fallbackMatch[1].trim());
  }

  if (current && current.fallbacks.length > 0) phases.push(current);
  return { phases };
}

// ── TUI Plugin ────────────────────────────────────────────────────────────────
const tui: TuiPlugin = async (api, options) => {

  const getActivePreset = () => {
    const { execSync } = require("child_process");
    try {
      // "Preset      local-hybrid (9 phases)"
      const raw = execSync("gsr status 2>/dev/null", { encoding: "utf8" });
      return raw.match(/Preset\s+(\S+)/i)?.[1] || "default";
    } catch { return "default"; }
  };

  const readFallbackData = () => {
    const { execSync } = require("child_process");
    const preset = getActivePreset();
    try {
      const raw = execSync(`gsr fallback list ${preset} 2>/dev/null`, { encoding: "utf8" });
      return parseGsrFallbackList(raw);
    } catch { return { phases: [] }; }
  };

  const executePromote = async (phase, index) => {
    const { execSync } = require("child_process");
    const preset = getActivePreset();
    try {
      execSync(`gsr fallback promote ${preset} ${phase.name} ${index} 2>&1`, { encoding: "utf8" });
      execSync("gsr sync 2>&1", { encoding: "utf8" });
      api.ui.toast({
        title: "Fallback promoted",
        message: `${phase.fallbacks[index - 1]} → primary for ${phase.name}`,
        variant: "success",
      });
    } catch {
      api.ui.toast({
        title: "Error",
        message: "Could not promote fallback. Check gsr is in PATH.",
        variant: "error",
      });
    }
  };

  const showFallbackSelector = (phase) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR — Promote fallback (${phase.name})`}
        options={phase.fallbacks.map((fb, i) => ({
          title: fb,
          value: i + 1,
          description: `→ becomes primary · ${phase.primary} → fallback #1`,
        }))}
        onSelect={async (opt) => {
          api.ui.dialog.clear();
          await executePromote(phase, opt.value);
        }}
        onCancel={() => showFallbackFlow()}
      />
    ));
  };

  const showFallbackFlow = async () => {
    const data = readFallbackData();
    const phases = data.phases.filter((p) => p.fallbacks.length > 0);

    if (phases.length === 0) {
      api.ui.toast({
        message: "No fallbacks configured. Use: gsr fallback add <preset> <phase> <model>",
        variant: "info",
      });
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Select phase to change"
        options={phases.map((p) => ({
          title: p.name,
          value: p,
          description: `Primary: ${p.primary} · ${p.fallbacks.length} fallback(s)`,
        }))}
        onSelect={(opt) => showFallbackSelector(opt.value)}
        onCancel={() => api.ui.dialog.clear()}
      />
    ));
  };

  // Register command in OpenCode palette + as slash command
  api.command.register(() => [
    {
      title: "GSR — Manage fallbacks",
      value: "gsr-fallback",
      description: "Promote a fallback model to primary via native dialog",
      category: "GSR",
      slash: { name: "gsr-fallback" },
      onSelect: () => showFallbackFlow(),
    },
  ]);

  // Auto-detect model failure
  api.event.on("session.error", async (event) => {
    const autoFallback = api.kv.get("gsr.autoFallback", false);
    if (autoFallback) {
      const data = readFallbackData();
      const phase = data.phases.find((p) => p.fallbacks.length > 0);
      if (phase) await executePromote(phase, 1);
    } else {
      api.ui.toast({
        title: "GSR: Model failed",
        message: "Select GSR — Manage fallbacks to switch model",
        variant: "warning",
      });
      showFallbackFlow();
    }
  });
};

const plugin: TuiPluginModule & { id: string } = { id, tui };
export default plugin;
