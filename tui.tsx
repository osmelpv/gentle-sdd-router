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
 * Detect the active preset from OpenCode's current agent context.
 * Priority:
 *   1. options.agent — e.g. "gsr-local-hybrid" → "local-hybrid"
 *      Reflects exactly what the user has loaded in OpenCode (TAB selection).
 *   2. gsr status — fallback when not running inside an agent context
 */
function detectActivePreset(options: any): string {
  // Try options.agent first (e.g. "gsr-local-hybrid" → "local-hybrid")
  const agentName: string = options?.agent ?? "";
  if (agentName.startsWith("gsr-")) return agentName.replace(/^gsr-/, "");

  // Fallback: parse "Active preset <name>" from gsr status output
  // Must match the exact line format to avoid cross-line regex traps
  // (e.g. "Activation    active\n  Environment" was incorrectly matching "Environment")
  const out = runSafe("gsr status");
  const match = out.match(/Active preset\s+(\S+)/i)
    ?? out.match(/^  Active\s+(\S+)/m);
  return match?.[1] || "default";
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

  const showFallbackSelector = (preset: string, phase: any) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR Fallbacks — ${preset} / ${phase.name}`}
        options={[
          ...phase.fallbacks.map((fb: string, i: number) => ({
            title: fb,
            value: i + 1,
            description: `→ becomes primary · current primary: ${phase.primary}`,
          })),
          { title: "← Back", value: "__back__" },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") { showFallbackFlow(); return; }
          api.ui.dialog.clear();
          executePromote(preset, phase, opt.value);
        }}
        onCancel={() => showFallbackFlow()}
      />
    ));
  };

  const showFallbackFlow = () => {
    const preset = detectActivePreset(options);
    const raw = runSafe(`gsr fallback list ${preset}`);
    const { phases } = parseGsrFallbackList(raw);
    if (phases.length === 0) {
      api.ui.toast({
        message: `No fallbacks configured for preset "${preset}". Add with: gsr fallback add ${preset} <phase> <model>`,
        variant: "info",
      });
      return;
    }
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR Fallbacks — preset: ${preset}`}
        options={[
          ...phases.map((p: any) => ({
            title: p.name,
            value: p,
            description: `Primary: ${p.primary} · ${p.fallbacks.length} fallback(s)`,
          })),
          { title: "✕ Close", value: "__close__" },
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__close__") { api.ui.dialog.clear(); return; }
          showFallbackSelector(preset, opt.value);
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
      description: "Promote a fallback model to primary for the active preset",
      category: "GSR",
      slash: { name: "gsr-fallback" },
      onSelect: () => showFallbackFlow(),
    },
  ]);

  // ── Auto-trigger on model failure ─────────────────────────────────────────

  api.event.on("session.error", async () => {
    setTimeout(() => {
      try {
        const preset = detectActivePreset(options);
        const raw = runSafe(`gsr fallback list ${preset}`);
        const { phases } = parseGsrFallbackList(raw);
        const phase = phases.find((p: any) => p.fallbacks.length > 0);
        const autoFallback = api.kv.get("gsr.autoFallback", false);
        if (autoFallback && phase) {
          executePromote(preset, phase, 1);
        } else {
          api.ui.toast({
            title: "GSR: Model failed",
            message: "Run /gsr-fallback to switch to a backup model",
            variant: "warning",
          });
          if (phase) showFallbackFlow();
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
