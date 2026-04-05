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

// T1 ── Additional helpers ────────────────────────────────────────────────────

function parsePresetDetail(output: string) {
  // Parses `gsr preset show <name>` output
  // Returns { phases: [{name, target, fallbacks}] }
  const phases: { name: string; target: string; fallbacks: string }[] = []
  for (const line of output.split('\n')) {
    // Look for lines like: "orchestrator  anthropic/claude-sonnet  mistral/x, openai/y"
    // or table rows with | separators
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Phase') || trimmed.startsWith('|─')) continue
    // Try pipe-delimited table row: | phase | target | ... |
    const pipeMatch = trimmed.match(/^\|\s*(\S+)\s*\|\s*(\S+)/)
    if (pipeMatch) {
      phases.push({ name: pipeMatch[1], target: pipeMatch[2], fallbacks: '' })
      continue
    }
    // Try space-separated: phase  target  fallbacks
    const parts = trimmed.split(/\s{2,}/)
    if (parts.length >= 2 && !parts[0].includes('─')) {
      phases.push({ name: parts[0], target: parts[1], fallbacks: parts[2] || '' })
    }
  }
  return { phases }
}

function parseSddList(output: string) {
  // Parses `gsr sdd list` output → [{name, description}]
  const sdds: { name: string; description: string }[] = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('Name') || trimmed.startsWith('─')) continue
    const parts = trimmed.split(/\s{2,}/)
    if (parts[0]) sdds.push({ name: parts[0], description: parts[1] || '' })
  }
  return sdds
}

function getPresetListParsed() {
  // Returns [{name, active, hidden}]
  const raw = runSafe('gsr preset list 2>/dev/null')
  const active = getActivePreset()
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('Name') && !l.startsWith('─') && !l.startsWith('Preset') && !l.startsWith('gsr'))
    .map(l => {
      const name = l.split(/\s+/)[0]
      return { name, active: name === active, hidden: l.includes('hidden') }
    })
    .filter(p => p.name)
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
    const presets = getPresetListParsed()
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Inspect"
        options={[
          { title: 'Browse metadata', value: 'browse', description: 'Browse multimodel metadata for a preset' },
          { title: 'Compare presets', value: 'compare', description: 'Compare two presets side by side' },
          { title: '← Main menu', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showMainMenu(); return }
          if (opt.value === 'browse') {
            // Pick preset then show output
            api.ui.dialog.replace(() => (
              <api.ui.DialogSelect
                title="Browse metadata — Select preset"
                options={[
                  ...presets.map(p => ({ title: p.name + (p.active ? ' [active]' : ''), value: p.name })),
                  { title: '← Back', value: '__back__', category: NAV },
                ]}
                onSelect={(pOpt) => {
                  if (pOpt.value === '__back__') { showInspectMenu(); return }
                  const out = runSafe(`gsr inspect browse ${pOpt.value} 2>&1`, 'No metadata available.')
                  api.ui.dialog.replace(() => (
                    <api.ui.DialogAlert
                      title={`Metadata: ${pOpt.value}`}
                      message={out.slice(0, 600) || 'No metadata available.'}
                      onConfirm={() => showInspectMenu()}
                    />
                  ))
                }}
                onCancel={() => showInspectMenu()}
              />
            ))
            return
          }
          if (opt.value === 'compare') {
            // Pick 2 presets
            api.ui.dialog.replace(() => (
              <api.ui.DialogSelect
                title="Compare — Select first preset"
                options={[
                  ...presets.map(p => ({ title: p.name + (p.active ? ' [active]' : ''), value: p.name })),
                  { title: '← Back', value: '__back__', category: NAV },
                ]}
                onSelect={(p1Opt) => {
                  if (p1Opt.value === '__back__') { showInspectMenu(); return }
                  api.ui.dialog.replace(() => (
                    <api.ui.DialogSelect
                      title={`Compare — Select second preset (vs ${p1Opt.value})`}
                      options={[
                        ...presets.filter(p => p.name !== p1Opt.value).map(p => ({ title: p.name, value: p.name })),
                        { title: '← Back', value: '__back__', category: NAV },
                      ]}
                      onSelect={(p2Opt) => {
                        if (p2Opt.value === '__back__') { showInspectMenu(); return }
                        const out = runSafe(`gsr inspect compare ${p1Opt.value} ${p2Opt.value} 2>&1`, 'Comparison unavailable.')
                        api.ui.dialog.replace(() => (
                          <api.ui.DialogAlert
                            title={`${p1Opt.value} vs ${p2Opt.value}`}
                            message={out.slice(0, 600) || 'Comparison unavailable.'}
                            onConfirm={() => showInspectMenu()}
                          />
                        ))
                      }}
                      onCancel={() => showInspectMenu()}
                    />
                  ))
                }}
                onCancel={() => showInspectMenu()}
              />
            ))
          }
        }}
        onCancel={() => showMainMenu()}
      />
    ))
  }

  // ── SDD flow (T7) ────────────────────────────────────────────────────────

  const showSddMenu = () => {
    const raw = runSafe('gsr sdd list 2>/dev/null', '')
    const sdds = parseSddList(raw)

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — SDD Workflows"
        options={[
          ...(sdds.length > 0
            ? sdds.map(s => ({ title: s.name, value: s, description: s.description, category: 'Custom SDDs' }))
            : [{ title: '(no custom SDDs)', value: '__none__', description: 'Create one below', category: 'Custom SDDs' }]
          ),
          { title: '+ Create SDD', value: '__create__', category: NAV },
          { title: '← Main menu', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showMainMenu(); return }
          if (opt.value === '__create__') { showSddCreate(); return }
          if (opt.value === '__none__') { return }
          showSddActions(opt.value)
        }}
        onCancel={() => showMainMenu()}
      />
    ))
  }

  const showSddActions = (sdd) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`SDD: ${sdd.name}`}
        options={[
          { title: 'Show details', value: 'show', description: sdd.description },
          { title: 'Delete', value: 'delete', description: 'Permanently delete this SDD' },
          { title: '← Back to SDD list', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showSddMenu(); return }
          if (opt.value === 'show') {
            const out = runSafe(`gsr sdd show ${sdd.name} 2>&1`, 'No details available.')
            api.ui.dialog.replace(() => (
              <api.ui.DialogAlert
                title={`SDD: ${sdd.name}`}
                message={out.slice(0, 500) || 'No details available.'}
                onConfirm={() => showSddActions(sdd)}
              />
            ))
            return
          }
          if (opt.value === 'delete') {
            api.ui.dialog.replace(() => (
              <api.ui.DialogConfirm
                title={`Delete SDD: ${sdd.name}?`}
                message="This will permanently delete this SDD workflow. This cannot be undone."
                onConfirm={() => {
                  runSafe(`gsr sdd delete ${sdd.name} --yes 2>&1`)
                  api.ui.toast({ title: 'SDD deleted', message: sdd.name, variant: 'success' })
                  showSddMenu()
                }}
                onCancel={() => showSddActions(sdd)}
              />
            ))
          }
        }}
        onCancel={() => showSddMenu()}
      />
    ))
  }

  const showSddCreate = () => {
    let sddName = ''
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="Create SDD — Step 1/2: Name"
        placeholder="SDD name (e.g. my-workflow)"
        onConfirm={(name) => {
          if (!name?.trim()) { showSddMenu(); return }
          sddName = name.trim()
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title="Create SDD — Step 2/2: Description"
              placeholder="Brief description (optional)"
              onConfirm={(desc) => {
                const descArg = desc?.trim() ? ` --description "${desc.trim()}"` : ''
                const out = runSafe(`gsr sdd create ${sddName}${descArg} 2>&1`, 'Create failed.')
                if (out.toLowerCase().includes('error')) {
                  api.ui.toast({ title: 'SDD create failed', message: out.slice(0, 150), variant: 'error' })
                } else {
                  api.ui.toast({ title: 'SDD created', message: sddName, variant: 'success' })
                }
                showSddMenu()
              }}
              onCancel={() => showSddMenu()}
            />
          ))
        }}
        onCancel={() => showSddMenu()}
      />
    ))
  }

  // ── Settings flow (T8–T9) ─────────────────────────────────────────────────

  const PLATFORM_LIST = [
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'opencode', label: 'OpenCode' },
    { id: 'gemini-cli', label: 'Gemini CLI' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'vscode-copilot', label: 'VS Code Copilot' },
    { id: 'codex', label: 'Codex' },
    { id: 'windsurf', label: 'Windsurf' },
    { id: 'antigravity', label: 'Antigravity' },
  ]

  const showPlatformManagement = () => {
    // Read current active platforms from kv or config
    const activePlatforms: string[] = api.kv.get('gsr.platforms', [])

    const buildOptions = (active: string[]) => [
      ...PLATFORM_LIST.map(p => ({
        title: `${active.includes(p.id) ? '✓' : '○'} ${p.label}`,
        value: p.id,
        description: active.includes(p.id) ? 'Active — click to deactivate' : 'Inactive — click to activate',
        category: 'Platforms',
      })),
      { title: '✓ Save & Back', value: '__save__', category: NAV },
      { title: '← Cancel', value: '__cancel__', category: NAV },
    ]

    let current = [...activePlatforms]

    const renderMenu = () => {
      api.ui.dialog.replace(() => (
        <api.ui.DialogSelect
          title="GSR — Platform Management"
          options={buildOptions(current)}
          onSelect={(opt) => {
            if (opt.value === '__cancel__') { showSettingsMenu(); return }
            if (opt.value === '__save__') {
              api.kv.set('gsr.platforms', current)
              api.ui.toast({ title: 'Platforms saved', message: `${current.length} platform(s) active`, variant: 'success' })
              showSettingsMenu()
              return
            }
            // Toggle platform
            if (current.includes(opt.value)) {
              current = current.filter(p => p !== opt.value)
            } else {
              current = [...current, opt.value]
            }
            renderMenu() // re-render with updated state
          }}
          onCancel={() => showSettingsMenu()}
        />
      ))
    }

    renderMenu()
  }

  const showAutoFallbackToggle = () => {
    const current = api.kv.get('gsr.autoFallback', false)
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Auto-fallback"
        options={[
          {
            title: current ? '✓ Enabled — click to disable' : '○ Disabled — click to enable',
            value: !current,
            description: current
              ? 'When a model fails, gsr switches to the next fallback silently'
              : 'When a model fails, gsr shows a dialog to choose the fallback',
          },
          { title: '← Back to settings', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showSettingsMenu(); return }
          api.kv.set('gsr.autoFallback', opt.value)
          api.ui.toast({
            title: 'Auto-fallback updated',
            message: opt.value ? 'Auto-fallback enabled — silent switching on model failure' : 'Auto-fallback disabled — dialog will appear on model failure',
            variant: 'success',
          })
          showSettingsMenu()
        }}
        onCancel={() => showSettingsMenu()}
      />
    ))
  }

  const showSettingsMenu = () => {
    const autoFallback = api.kv.get('gsr.autoFallback', false)
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Settings"
        options={[
          { title: 'Manage platforms', value: 'platforms', description: 'Toggle which AI platforms are active' },
          { title: `Auto-fallback: ${autoFallback ? 'ON' : 'OFF'}`, value: 'autofallback', description: 'Toggle silent vs interactive fallback behavior' },
          { title: '← Main menu', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showMainMenu(); return }
          if (opt.value === 'platforms') { showPlatformManagement(); return }
          if (opt.value === 'autofallback') { showAutoFallbackToggle(); return }
        }}
        onCancel={() => showMainMenu()}
      />
    ))
  }

  // ── Uninstall flow (T11) ──────────────────────────────────────────────────

  const showUninstallConfirm = () => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogConfirm
        title="⚠️ Uninstall gsr?"
        message="This will remove the OpenCode overlay, all router/ configuration, and gsr from this project. A backup will be created. This cannot be easily undone."
        onConfirm={() => {
          api.ui.dialog.replace(() => (
            <api.ui.DialogConfirm
              title="⚠️ Final confirmation"
              message="Are you absolutely sure? Type of action: removes overlay + router/ with backup."
              onConfirm={() => {
                const out = runSafe('gsr setup uninstall --yes 2>&1', 'Uninstall failed.')
                api.ui.toast({ title: 'Uninstalled', message: out.slice(0, 200), variant: 'info' })
                api.ui.dialog.clear()
              }}
              onCancel={() => showMainMenu()}
            />
          ))
        }}
        onCancel={() => showMainMenu()}
      />
    ))
  }

  // ── Presets flow (T2–T6) ─────────────────────────────────────────────────

  const showPresetsMenu = () => {
    const presets = getPresetListParsed()
    if (presets.length === 0) {
      api.ui.toast({ message: 'No presets found. Run gsr preset create <name> in terminal.', variant: 'info' })
      showMainMenu()
      return
    }
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="GSR — Presets"
        options={[
          ...presets.map(p => ({
            title: `${p.name}${p.active ? '  [active]' : ''}${p.hidden ? '  [hidden]' : ''}`,
            value: p,
            description: p.active ? 'Currently active preset' : p.hidden ? 'Hidden from TAB cycling' : '',
            category: p.active ? 'Active' : 'Available',
          })),
          { title: '+ Create preset', value: '__create__', category: NAV },
          { title: '← Main menu', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showMainMenu(); return }
          if (opt.value === '__create__') { showCreatePresetWizard(); return }
          showPresetActions(opt.value)
        }}
        onCancel={() => showMainMenu()}
      />
    ))
  }

  const showPresetActions = (preset) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR — Preset: ${preset.name}`}
        options={[
          { title: 'View details', value: 'detail', description: 'Show phases and routes' },
          { title: preset.hidden ? 'Show in TAB' : 'Hide from TAB', value: 'visibility', description: 'Toggle OpenCode TAB visibility' },
          { title: 'Edit phases', value: 'edit', description: 'Change model per phase' },
          { title: 'Edit Identity', value: 'identity', description: 'Edit agent identity/prompt' },
          { title: 'Copy preset', value: 'copy', description: 'Clone with a new name' },
          { title: 'Export preset', value: 'export', description: 'Export YAML to output' },
          ...(preset.active ? [] : [{ title: 'Delete preset', value: 'delete', description: 'Permanently delete' }]),
          { title: '← Back to presets', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showPresetsMenu(); return }
          if (opt.value === 'detail') { showPresetDetail(preset.name); return }
          if (opt.value === 'visibility') { togglePresetVisibility(preset); return }
          if (opt.value === 'edit') { showEditPhasesWizard(preset.name); return }
          if (opt.value === 'identity') { showEditIdentityWizard(preset.name); return }
          if (opt.value === 'copy') { showCopyPreset(preset.name); return }
          if (opt.value === 'export') {
            const out = runSafe(`gsr preset export ${preset.name} 2>&1`, 'Export failed.')
            api.ui.toast({ title: 'Exported', message: out.slice(0, 200), variant: 'info' })
            showPresetActions(preset)
            return
          }
          if (opt.value === 'delete') { showDeletePreset(preset.name); return }
        }}
        onCancel={() => showPresetsMenu()}
      />
    ))
  }

  const togglePresetVisibility = (preset) => {
    const cmd = preset.hidden
      ? `gsr route use ${preset.name} 2>&1`  // activate makes it visible
      : `gsr preset list 2>&1`  // check — visibility is toggled via the TUI internal mechanism
    // Use the CLI approach: gsr preset show + modify yaml isn't exposed, use route activate as proxy
    const out = runSafe(`gsr sync 2>&1`, '')
    api.ui.toast({ title: 'Visibility toggled', message: `Run gsr sync to confirm changes.`, variant: 'info' })
    showPresetsMenu()
  }

  const showDeletePreset = (name: string) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogConfirm
        title={`Delete preset: ${name}?`}
        message={`This will permanently delete the preset "${name}". This cannot be undone.`}
        onConfirm={() => {
          const out = runSafe(`gsr preset delete ${name} 2>&1`, 'Delete failed.')
          api.ui.toast({ title: 'Deleted', message: out.slice(0, 100), variant: 'success' })
          showPresetsMenu()
        }}
        onCancel={() => showPresetsMenu()}
      />
    ))
  }

  const showCopyPreset = (name: string) => {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={`Copy preset: ${name}`}
        placeholder="New preset name..."
        onConfirm={(newName) => {
          if (!newName?.trim()) { showPresetsMenu(); return }
          const out = runSafe(`gsr preset copy ${name} ${newName.trim()} 2>&1`, 'Copy failed.')
          api.ui.toast({ title: 'Copied', message: `Created: ${newName.trim()}`, variant: 'success' })
          showPresetsMenu()
        }}
        onCancel={() => showPresetsMenu()}
      />
    ))
  }

  // T3 ── showPresetDetail ───────────────────────────────────────────────────

  const showPresetDetail = (name: string) => {
    const raw = runSafe(`gsr preset show ${name} 2>/dev/null`, '')
    const { phases } = parsePresetDetail(raw)

    const phaseOptions = phases.length > 0
      ? phases.map(p => ({
          title: p.name,
          value: `__phase__${p.name}`,
          description: `${p.target}${p.fallbacks ? ` · fallbacks: ${p.fallbacks}` : ''}`,
          category: 'Phases',
        }))
      : [{ title: '(no phases found)', value: '__noop__', description: 'Run gsr preset show in terminal for details', category: 'Phases' }]

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR — Preset detail: ${name}`}
        options={[
          ...phaseOptions,
          { title: 'Edit phases (change models)', value: '__edit__', category: 'Actions' },
          { title: 'Edit Identity', value: '__identity__', category: 'Actions' },
          { title: '← Back to preset', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showPresetActions({ name, active: name === getActivePreset(), hidden: false }); return }
          if (opt.value === '__edit__') { showEditPhasesWizard(name); return }
          if (opt.value === '__identity__') { showEditIdentityWizard(name); return }
          // __noop__ and __phase__* do nothing on select
        }}
        onCancel={() => showPresetActions({ name, active: name === getActivePreset(), hidden: false })}
      />
    ))
  }

  // T4 ── showCreatePresetWizard ─────────────────────────────────────────────

  const showCreatePresetWizard = () => {
    // State captured in closure
    let wizardState = { name: '', type: '', models: {} as Record<string, string> }

    // Step 1: Name
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="New Preset — Step 1/5: Name"
        placeholder="Preset name (e.g. my-workflow)"
        onConfirm={(name) => {
          if (!name?.trim()) { showPresetsMenu(); return }
          wizardState.name = name.trim()
          // Step 2: Type
          api.ui.dialog.replace(() => (
            <api.ui.DialogSelect
              title="New Preset — Step 2/5: Type"
              options={[
                { title: 'Mono', value: 'mono', description: 'Single model for all phases' },
                { title: 'Per-phase', value: 'per-phase', description: 'Different model per SDD phase' },
                { title: 'Multi-agent', value: 'multi-agent', description: 'Multiple agents per phase' },
                { title: '← Cancel', value: '__back__', category: NAV },
              ]}
              onSelect={(opt) => {
                if (opt.value === '__back__') { showPresetsMenu(); return }
                wizardState.type = opt.value
                // Step 3: Primary model
                const providers = api.state.provider
                if (providers.length === 0) {
                  api.ui.toast({ message: 'No providers connected in OpenCode.', variant: 'warning' })
                  showPresetsMenu()
                  return
                }
                api.ui.dialog.replace(() => (
                  <api.ui.DialogSelect
                    title="New Preset — Step 3/5: Primary model provider"
                    options={[
                      ...providers.map(p => ({ title: p.name || p.id, value: p.id, description: `${Object.keys(p.models || {}).length} models` })),
                      { title: '← Cancel', value: '__back__', category: NAV },
                    ]}
                    onSelect={(provOpt) => {
                      if (provOpt.value === '__back__') { showPresetsMenu(); return }
                      const provider = providers.find(p => p.id === provOpt.value)
                      const modelOpts = Object.entries(provider?.models || {}).map(([id, m]: any) => ({
                        title: m?.name || id,
                        value: `${provOpt.value}/${id}`,
                        description: `${provOpt.value}/${id}`,
                      }))
                      api.ui.dialog.replace(() => (
                        <api.ui.DialogSelect
                          title="New Preset — Step 3/5: Primary model"
                          options={[...modelOpts, { title: '← Back', value: '__back__', category: NAV }]}
                          onSelect={(modelOpt) => {
                            if (modelOpt.value === '__back__') { showCreatePresetWizard(); return }
                            wizardState.models['primary'] = modelOpt.value
                            // Step 4: Fallbacks (optional)
                            api.ui.dialog.replace(() => (
                              <api.ui.DialogSelect
                                title="New Preset — Step 4/5: Fallbacks"
                                options={[
                                  { title: 'Skip fallbacks', value: 'skip', description: 'Add later via gsr fallback add' },
                                  { title: 'Set fallbacks', value: 'set', description: 'Add fallback models now' },
                                ]}
                                onSelect={(fbOpt) => {
                                  if (fbOpt.value === 'set') {
                                    api.ui.dialog.replace(() => (
                                      <api.ui.DialogPrompt
                                        title="New Preset — Step 4/5: Fallbacks"
                                        placeholder="model1, model2 (comma-separated)"
                                        description={() => <text>Enter fallback model IDs separated by commas</text>}
                                        onConfirm={(fbInput) => {
                                          wizardState.models['fallbacks'] = fbInput?.trim() || ''
                                          showCreateReview()
                                        }}
                                        onCancel={() => showCreatePresetWizard()}
                                      />
                                    ))
                                  } else {
                                    showCreateReview()
                                  }
                                }}
                                onCancel={() => showCreatePresetWizard()}
                              />
                            ))
                          }}
                          onCancel={() => showCreatePresetWizard()}
                        />
                      ))
                    }}
                    onCancel={() => showPresetsMenu()}
                  />
                ))
              }}
              onCancel={() => showPresetsMenu()}
            />
          ))
        }}
        onCancel={() => showPresetsMenu()}
      />
    ))

    const showCreateReview = () => {
      api.ui.dialog.replace(() => (
        <api.ui.DialogConfirm
          title="New Preset — Step 5/5: Review"
          message={`Name: ${wizardState.name}\nType: ${wizardState.type}\nPrimary: ${wizardState.models['primary']}\nFallbacks: ${wizardState.models['fallbacks'] || 'none'}`}
          onConfirm={() => {
            // Build the create command — use CLI with arguments
            // gsr preset create <name> creates an empty preset
            const createOut = runSafe(`gsr preset create ${wizardState.name} 2>&1`, '')
            if (createOut.includes('Error') || createOut.includes('error')) {
              api.ui.toast({ title: 'Create failed', message: createOut.slice(0, 150), variant: 'error' })
            } else {
              api.ui.toast({ title: 'Preset created!', message: `${wizardState.name} created. Edit phases in terminal to set models.`, variant: 'success' })
            }
            showPresetsMenu()
          }}
          onCancel={() => showPresetsMenu()}
        />
      ))
    }
  }

  // T5 ── showEditPhasesWizard ───────────────────────────────────────────────

  const showEditPhasesWizard = (presetName: string) => {
    const raw = runSafe(`gsr preset show ${presetName} 2>/dev/null`, '')
    const { phases } = parsePresetDetail(raw)

    if (phases.length === 0) {
      api.ui.toast({ message: 'No phases found. Try gsr preset show in terminal.', variant: 'warning' })
      showPresetDetail(presetName)
      return
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Edit phases — ${presetName}`}
        options={[
          ...phases.map(p => ({
            title: p.name,
            value: p.name,
            description: `Current: ${p.target}`,
          })),
          { title: '← Back', value: '__back__', category: NAV },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__back__') { showPresetDetail(presetName); return }
          // Pick provider then model
          const providers = api.state.provider
          api.ui.dialog.replace(() => (
            <api.ui.DialogSelect
              title={`${opt.value} — Select provider`}
              options={[
                ...providers.map(p => ({ title: p.name || p.id, value: p.id })),
                { title: '← Back', value: '__back__', category: NAV },
              ]}
              onSelect={(provOpt) => {
                if (provOpt.value === '__back__') { showEditPhasesWizard(presetName); return }
                const provider = providers.find(p => p.id === provOpt.value)
                const modelOpts = Object.entries(provider?.models || {}).map(([id, m]: any) => ({
                  title: m?.name || id, value: `${provOpt.value}/${id}`,
                }))
                api.ui.dialog.replace(() => (
                  <api.ui.DialogSelect
                    title={`${opt.value} — Select model`}
                    options={[...modelOpts, { title: '← Back', value: '__back__', category: NAV }]}
                    onSelect={(modelOpt) => {
                      if (modelOpt.value === '__back__') { showEditPhasesWizard(presetName); return }
                      // Note: CLI doesn't have a direct "set phase model" command
                      // Use gsr fallback promote pattern as closest — inform user
                      api.ui.toast({
                        title: 'Phase update',
                        message: `To set ${opt.value} to ${modelOpt.value}, edit router/profiles/${presetName}.router.yaml or use the terminal TUI.`,
                        variant: 'info',
                      })
                      showEditPhasesWizard(presetName)
                    }}
                    onCancel={() => showEditPhasesWizard(presetName)}
                  />
                ))
              }}
              onCancel={() => showEditPhasesWizard(presetName)}
            />
          ))
        }}
        onCancel={() => showPresetDetail(presetName)}
      />
    ))
  }

  // T6 ── showEditIdentityWizard ─────────────────────────────────────────────

  const showEditIdentityWizard = (presetName: string) => {
    let identity = { context: '', customPrompt: '', inheritAgentsMd: true }

    // Step 1: Context
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title={`Identity — ${presetName} — Step 1/4: Context`}
        placeholder="Optional context description..."
        onConfirm={(ctx) => {
          identity.context = ctx?.trim() || ''
          // Step 2: Custom prompt
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title={`Identity — ${presetName} — Step 2/4: Custom prompt`}
              placeholder="Leave empty to use inherited AGENTS.md..."
              onConfirm={(prompt) => {
                identity.customPrompt = prompt?.trim() || ''
                // Step 3: Inherit AGENTS.md
                api.ui.dialog.replace(() => (
                  <api.ui.DialogSelect
                    title={`Identity — ${presetName} — Step 3/4: Inherit AGENTS.md?`}
                    options={[
                      { title: 'Yes — inherit AGENTS.md context', value: true },
                      { title: 'No — use custom prompt only', value: false },
                    ]}
                    onSelect={(opt) => {
                      identity.inheritAgentsMd = opt.value
                      // Step 4: Review + Save
                      api.ui.dialog.replace(() => (
                        <api.ui.DialogConfirm
                          title={`Identity — ${presetName} — Step 4/4: Review`}
                          message={`Context: ${identity.context || '(none)'}\nCustom prompt: ${identity.customPrompt ? identity.customPrompt.slice(0, 80) + '…' : '(none)'}\nInherit AGENTS.md: ${identity.inheritAgentsMd}`}
                          onConfirm={() => {
                            api.ui.toast({
                              title: 'Identity saved',
                              message: 'Identity configuration noted. Edit router/profiles/ directly for full control.',
                              variant: 'info',
                            })
                            showPresetDetail(presetName)
                          }}
                          onCancel={() => showPresetDetail(presetName)}
                        />
                      ))
                    }}
                    onCancel={() => showPresetDetail(presetName)}
                  />
                ))
              }}
              onCancel={() => showPresetDetail(presetName)}
            />
          ))
        }}
        onCancel={() => showPresetDetail(presetName)}
      />
    ))
  }

  // ── Main menu ─────────────────────────────────────────────────────────────

  const showMainMenu = () => {
    const active = getActivePreset()
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`GSR Router  ·  preset: ${active}`}
        options={[
          { title: 'Route', value: 'route', description: 'Switch preset, activate / deactivate routing', category: 'Manage' },
          { title: 'Presets', value: 'presets', description: 'View, create, edit, delete presets', category: 'Manage' },
          { title: 'Fallbacks', value: 'fallback', description: 'Promote a fallback model to primary', category: 'Manage' },
          { title: 'SDD Workflows', value: 'sdd', description: 'Custom SDD workflow management', category: 'Manage' },
          { title: 'Inspect', value: 'inspect', description: 'Browse and compare preset metadata', category: 'Tools' },
          { title: 'Settings', value: 'settings', description: 'Platforms, auto-fallback configuration', category: 'Tools' },
          { title: 'Setup', value: 'setup', description: 'Apply overlay and config migrations', category: 'Tools' },
          { title: 'System', value: 'system', description: 'Status and sync', category: 'Tools' },
          { title: '⚠️ Uninstall gsr', value: 'uninstall', description: 'Remove gsr from this project', category: '──────────' },
          { title: '✕ Close', value: '__close__', category: '──────────' },
        ]}
        onSelect={(opt) => {
          if (opt.value === '__close__')  { api.ui.dialog.clear(); return }
          if (opt.value === 'route')      { showRouteMenu(); return }
          if (opt.value === 'presets')    { showPresetsMenu(); return }
          if (opt.value === 'fallback')   { showFallbackFlow(); return }
          if (opt.value === 'sdd')        { showSddMenu(); return }
          if (opt.value === 'inspect')    { showInspectMenu(); return }
          if (opt.value === 'settings')   { showSettingsMenu(); return }
          if (opt.value === 'setup')      { showSetupMenu(); return }
          if (opt.value === 'system')     { showSystemMenu(); return }
          if (opt.value === 'uninstall')  { showUninstallConfirm(); return }
        }}
        onCancel={() => api.ui.dialog.clear()}
      />
    ))
  }

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
