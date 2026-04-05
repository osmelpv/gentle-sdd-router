// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const id = "gentle-sdd-router";

const tui: TuiPlugin = async (api, options) => {
	const getGsrPath = () => {
		const { join } = require("node:path");
		return join(process.cwd(), "bin", "gsr.js");
	};

	const getActivePreset = () => {
		const { execSync } = require("child_process");
		const gsr = getGsrPath();
		try {
			const raw = execSync(`${gsr} status 2>/dev/null`, { encoding: "utf8" });
			const match = raw.match(/active[:\s]+(\S+)/i);
			return match?.[1] || "default";
		} catch {
			return "default";
		}
	};

	const readFallbackData = async () => {
		const { execSync } = require("child_process");
		const gsr = getGsrPath();
		const preset = getActivePreset();
		try {
			const raw = execSync(`${gsr} fallback list ${preset} 2>/dev/null`, { encoding: "utf8" });
			return parseGsrFallbackList(raw);
		} catch {
			return { phases: [] };
		}
	};

	const parseGsrFallbackList = (output) => {
		const phases = [];
		let currentPhase = null;
		let inFallbacks = false;
		for (const raw of output.split("\n")) {
			const line = raw.trimEnd();
			const phaseMatch = line.match(/^\s*[Pp]hase\s*:\s*(.+)$/);
			if (phaseMatch) {
				if (currentPhase && currentPhase.fallbacks.length > 0) phases.push(currentPhase);
				currentPhase = { name: phaseMatch[1].trim(), primary: "", fallbacks: [] };
				inFallbacks = false;
				continue;
			}
			if (!currentPhase) continue;
			const primaryMatch = line.match(/primary\s*:\s*(.+)$/i);
			if (primaryMatch) {
				currentPhase.primary = primaryMatch[1].trim();
				inFallbacks = false;
				continue;
			}
			if (/fallbacks\s*:/i.test(line)) {
				inFallbacks = true;
				continue;
			}
			if (inFallbacks) {
				const fallbackMatch = line.match(/^\s+(\d+)\.\s+(.+)$/);
				if (fallbackMatch) currentPhase.fallbacks.push(fallbackMatch[2].trim());
			}
		}
		if (currentPhase && currentPhase.fallbacks.length > 0) phases.push(currentPhase);
		return { phases };
	};

	const executePromote = async (phase, index) => {
		const { execSync } = require("child_process");
		const gsr = getGsrPath();
		const preset = getActivePreset();
		try {
			execSync(`${gsr} fallback promote ${preset} ${phase.name} ${index} 2>&1`, { encoding: "utf8" });
			execSync(`${gsr} sync 2>&1`, { encoding: "utf8" });
			api.ui.toast({ title: "Fallback promoted", variant: "success" });
		} catch (e) {
			api.ui.toast({ title: "Error promoting fallback", variant: "error" });
		}
	};

	const showFallbackSelector = (phase) => {
		api.ui.dialog.replace(() => (
			<api.ui.DialogSelect
				title={`GSR — Promote fallback (${phase.name})`}
				options={phase.fallbacks.map((fb, i) => ({ 
					title: fb, 
					value: i + 1,
					description: `Promote to primary`
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
		const data = await readFallbackData();
		const phases = data.phases.filter((p) => p.fallbacks.length > 0);
		if (phases.length === 0) {
			api.ui.toast({ message: "No fallbacks configured for current preset", variant: "info" });
			return;
		}
		api.ui.dialog.replace(() => (
			<api.ui.DialogSelect
				title="GSR — Select phase to change"
				options={phases.map((p) => ({ 
					title: p.name, 
					value: p,
					description: `Primary: ${p.primary}`
				}))}
				onSelect={(opt) => showFallbackSelector(opt.value)}
				onCancel={() => api.ui.dialog.clear()}
			/>
		));
	};

	api.command.register(() => [
		{
			title: "GSR — Manage fallbacks",
			value: "gsr-fallback",
			description: "Open fallback management dialog",
			category: "GSR",
			slash: { name: "gsr-fallback" },
			onSelect: () => showFallbackFlow(),
		},
	]);
};

export default { id, tui } satisfies TuiPluginModule;
