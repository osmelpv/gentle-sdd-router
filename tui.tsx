// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "gentle-sdd-router";

// ── Helpers ───────────────────────────────────────────────────────────────────

function runSafe(cmd: string, fallback = ""): string {
  try {
    const { spawnSync } = require("child_process");
    const [bin, ...args] = cmd.trim().split(/\s+/);
    const result = spawnSync(bin, args, { encoding: "utf8", timeout: 8000 });
    if (result.error || result.status !== 0) return fallback;
    return (result.stdout || "").trim();
  } catch { return fallback; }
}

/**
 * Parse `gsr preset list` output into preset names and active indicator.
 * Format: "Active preset: X\nPresets:\n  name1 (N phases) ...\n  name2 ..."
 */
function parsePresetList(): { presets: string[]; active: string } {
  const out = runSafe("gsr preset list");
  const activeMatch = out.match(/Active preset:\s*(\S+)/i);
  const active = activeMatch?.[1] || "default";
  const presets: string[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    // Skip headers/labels — preset lines start with a name followed by (N phases)
    const m = trimmed.match(/^(\S+)\s+\(\d+ phases?\)/);
    if (m) presets.push(m[1]);
  }
  return { presets, active };
}

function parseGsrFallbackList(output: string) {
  // Also captures phases with 0 fallbacks (for display — show primary even without fallbacks)
  const phases: { name: string; primary: string; fallbacks: string[] }[] = [];
  let current: typeof phases[0] | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    const phaseMatch = line.match(/^(\S[^:]+)\s*\(lane\s*\d+\)\s*:$/);
    if (phaseMatch) {
      if (current) phases.push(current);
      current = { name: phaseMatch[1].trim(), primary: "", fallbacks: [] };
      continue;
    }
    if (!current) continue;
    const primaryMatch = line.match(/^\s+Primary\s*:\s*(.+)$/i);
    if (primaryMatch) { current.primary = primaryMatch[1].trim(); continue; }
    const fallbackMatch = line.match(/^\s+\d+\.\s+(.+)$/);
    if (fallbackMatch) current.fallbacks.push(fallbackMatch[1].trim());
  }
  if (current) phases.push(current);
  return { phases };
}

// ── TUI Plugin ────────────────────────────────────────────────────────────────

const tui: TuiPlugin = async (api, options) => {

  // ── Promote a fallback to primary ─────────────────────────────────────────

  const executePromote = (preset: string, phase: any, index: number) => {
    try {
      runSafe(`gsr fallback promote ${preset} ${phase.name} ${index}`);
      runSafe("gsr sync");
      api.ui.toast({
        title: "Promoted",
        message: `${phase.fallbacks[index - 1]} → primary for ${phase.name}`,
        variant: "success",
      });
    } catch {
      api.ui.toast({ title: "Error", message: "Could not promote fallback.", variant: "error" });
    }
  };

  // ── Remove a fallback from the chain ──────────────────────────────────────

  const executeRemove = (preset: string, phase: any, index: number) => {
    try {
      runSafe(`gsr fallback remove ${preset} ${phase.name} ${index}`);
      runSafe("gsr sync");
      api.ui.toast({
        title: "Removed",
        message: `Removed fallback #${index} from ${phase.name}`,
        variant: "success",
      });
    } catch {
      api.ui.toast({ title: "Error", message: "Could not remove fallback.", variant: "error" });
    }
  };

  // ── Add a fallback to a phase ─────────────────────────────────────────────

  const showAddFallback = (preset: string, phaseName: string) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={`Add fallback to ${preset} / ${phaseName}`}
        placeholder="provider/model-name (e.g. openai/gpt-5)"
        onConfirm={(modelId: string) => {
          const trimmed = (modelId || "").trim();
          if (!trimmed || !trimmed.includes("/")) {
            api.ui.toast({ title: "Invalid", message: "Model ID must be provider/model (e.g. openai/gpt-5)", variant: "error" });
            showPhaseDetail(preset, phaseName);
            return;
          }
          runSafe(`gsr fallback add ${preset} ${phaseName} ${trimmed}`);
          runSafe("gsr sync");
          api.ui.toast({ title: "Added", message: `${trimmed} added to ${phaseName} fallbacks`, variant: "success" });
          showPhaseDetail(preset, phaseName);
        }}
        onCancel={() => showPhaseDetail(preset, phaseName)}
      />
    ));
  };

  // ── Phase detail: show primary + fallbacks with actions ───────────────────

  const showPhaseDetail = (preset: string, phaseName: string) => {
    const raw = runSafe(`gsr fallback list ${preset} ${phaseName}`);
    const { phases } = parseGsrFallbackList(raw);
    const phase = phases.find((p: any) => p.name === phaseName);

    if (!phase) {
      api.ui.toast({ message: `Could not read phase "${phaseName}" for preset "${preset}".`, variant: "error" });
      showPhasePicker(preset);
      return;
    }

    const options: any[] = [];

    // Show primary model as info (not actionable)
    if (phase.primary) {
      options.push({
        title: `★ ${phase.primary}`,
        value: "__primary__",
        description: "Current primary model",
      });
    }

    // Show each fallback with promote/remove actions
    phase.fallbacks.forEach((fb: string, i: number) => {
      options.push({
        title: `  ${i + 1}. ${fb}`,
        value: { action: "select-fallback", index: i + 1, model: fb },
        description: "Select to promote or remove",
      });
    });

    options.push({ title: "+ Add fallback", value: "__add__", description: "Add a new model to the fallback chain" });
    options.push({ title: "← Back", value: "__back__" });

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`${preset} / ${phaseName} — Primary: ${phase.primary || "(none)"}`}
        options={options}
        onSelect={(opt: any) => {
          if (opt.value === "__primary__") return; // no-op
          if (opt.value === "__back__") { showPhasePicker(preset); return; }
          if (opt.value === "__add__") { showAddFallback(preset, phaseName); return; }

          // Selected a specific fallback → show promote/remove options
          const { index, model } = opt.value;
          api.ui.dialog.replace(() => (
            <api.ui.DialogSelect
              title={`${model} — fallback #${index}`}
              options={[
                { title: "⬆ Promote to primary", value: "promote", description: `Swap ${model} with ${phase.primary}` },
                { title: "✕ Remove", value: "remove", description: `Remove ${model} from fallback chain` },
                { title: "← Back", value: "back" },
              ]}
              onSelect={(action: any) => {
                if (action.value === "back") { showPhaseDetail(preset, phaseName); return; }
                if (action.value === "promote") {
                  executePromote(preset, phase, index);
                  showPhaseDetail(preset, phaseName);
                  return;
                }
                if (action.value === "remove") {
                  executeRemove(preset, phase, index);
                  showPhaseDetail(preset, phaseName);
                  return;
                }
              }}
              onCancel={() => showPhaseDetail(preset, phaseName)}
            />
          ));
        }}
        onCancel={() => showPhasePicker(preset)}
      />
    ));
  };

  // ── Phase picker: list all phases for a preset ────────────────────────────

  const showPhasePicker = (preset: string) => {
    const raw = runSafe(`gsr fallback list ${preset}`);
    const { phases } = parseGsrFallbackList(raw);

    if (phases.length === 0) {
      api.ui.toast({ message: `No phases found for preset "${preset}".`, variant: "info" });
      showPresetPicker();
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR Fallbacks — ${preset}`}
        options={[
          ...phases.map((p: any) => ({
            title: p.name,
            value: p.name,
            description: `Primary: ${p.primary}${p.fallbacks.length > 0 ? ` · ${p.fallbacks.length} fallback(s)` : " · no fallbacks"}`,
          })),
          { title: "← Back to presets", value: "__back__" },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") { showPresetPicker(); return; }
          showPhaseDetail(preset, opt.value);
        }}
        onCancel={() => showPresetPicker()}
      />
    ));
  };

  // ── Preset picker: first step — choose which preset to manage ─────────────

  const showPresetPicker = () => {
    const { presets, active } = parsePresetList();

    if (presets.length === 0) {
      api.ui.toast({ message: "No presets found. Run `gsr install` first.", variant: "error" });
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Select preset to manage fallbacks"
        options={[
          ...presets.map((name: string) => ({
            title: name === active ? `${name} (active)` : name,
            value: name,
            description: name === active ? "Currently active preset" : "Select to manage fallbacks",
          })),
          { title: "✕ Close", value: "__close__" },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__close__") { api.ui.dialog.clear(); return; }
          showPhasePicker(opt.value);
        }}
        onCancel={() => api.ui.dialog.clear()}
      />
    ));
  };

  // ── Command registration ──────────────────────────────────────────────────

  api.command.register(() => [
    {
      title: "GSR — Manage fallbacks",
      value: "gsr-fallback",
      description: "View and manage fallback models for any preset",
      category: "GSR",
      slash: { name: "gsr-fallback" },
      onSelect: () => showPresetPicker(),
    },
  ]);

  // ── Auto-trigger on model failure ─────────────────────────────────────────

  api.event.on("session.error", async () => {
    setTimeout(() => {
      try {
        // On error, go straight to preset picker — user decides which preset to fix
        const { presets } = parsePresetList();
        if (presets.length > 0) {
          api.ui.toast({
            title: "GSR: Model failed",
            message: "Run /gsr-fallback to switch to a backup model",
            variant: "warning",
          });
          showPresetPicker();
        } else {
          api.ui.toast({
            title: "GSR: Model failed",
            message: "No presets found. Run gsr install to set up.",
            variant: "warning",
          });
        }
      } catch {
        api.ui.toast({
          title: "GSR: Model failed",
          message: "Run /gsr-fallback to manage fallbacks",
          variant: "warning",
        });
      }
    }, 50);
  });
};

const plugin: TuiPluginModule & { id: string } = { id, tui };
export default plugin;
