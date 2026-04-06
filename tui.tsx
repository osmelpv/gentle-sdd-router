// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

// ── GUARD: Module loaded ──────────────────────────────────────────────────────
// Written to disk immediately at module evaluation time
const { writeFileSync: _gw, appendFileSync: _ga } = require("fs");
const _glog = (msg) => { try { _ga(".gsr/debug.log", `[${Date.now()}] ${msg}\n`); } catch {} };
try { require("fs").mkdirSync(".gsr", { recursive: true }); } catch {}
_gw(".gsr/debug.log", `[${Date.now()}] GUARD-0: module loaded (tui.tsx evaluated by Bun)\n`);

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

function detectActivePreset(options: any): string {
  const agentName: string = options?.agent ?? "";
  if (agentName.startsWith("gsr-")) return agentName.replace(/^gsr-/, "");
  const out = runSafe("gsr status");
  return out.match(/Active\s+(\S+)/i)?.[1] || "default";
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

// ── GUARD: Before tui function definition ────────────────────────────────────
_glog("GUARD-1: before tui function definition");

// ── TUI Plugin ────────────────────────────────────────────────────────────────

const tui: TuiPlugin = async (api, options) => {

  // ── GUARD: tui() called by OpenCode ────────────────────────────────────────
  _glog("GUARD-2: tui() async function entered — OpenCode called the plugin");

  // ── Fallback flow ─────────────────────────────────────────────────────────

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
        message: `No fallbacks configured for preset "${preset}".`,
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

  // ── GUARD: Before command registration ───────────────────────────────────
  _glog("GUARD-3: before api.command.register()");

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

  // ── GUARD: Before event registration ─────────────────────────────────────
  _glog("GUARD-4: before api.event.on(session.error)");

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
          api.ui.toast({ title: "GSR: Model failed", message: "Run /gsr-fallback to switch model", variant: "warning" });
          if (phase) showFallbackFlow();
        }
      } catch {
        api.ui.toast({ title: "GSR: Model failed", message: "Run /gsr-fallback to manage fallbacks", variant: "warning" });
      }
    }, 50);
  });

  // ── GUARD: tui() completed ────────────────────────────────────────────────
  _glog("GUARD-5: tui() completed successfully");
};

// ── GUARD: After tui function definition ─────────────────────────────────────
_glog("GUARD-6: after tui function definition — plugin object about to be created");

const plugin: TuiPluginModule & { id: string } = { id, tui };

_glog("GUARD-7: export default plugin — module evaluation complete");

export default plugin;
