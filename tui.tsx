// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { RouterLogo, SidebarRouter } from "./components";
import { cfg } from "./config";

const id = "gentle-sdd-router";

const rec = (value: unknown) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	return Object.fromEntries(Object.entries(value));
};

const tui: TuiPlugin = async (api, options) => {
	const boot = cfg(rec(options));
	if (!boot.enabled) return;

	// ─── Comandos y Atajos (Estilo opencode-mask) ───────────────────────────
	api.command.register(() => [
		{
			title: "Gestión de Presets SDD",
			value: "gsr-profiles",
			description: "Configurar enrutamiento y agentes del proyecto",
			keybind: "alt+p",
			slash: { name: "gsr-profiles" },
			onSelect: () => {
				const { readFileSync, existsSync } = require("fs");
				const { join } = require("path");

				// Resolución de rutas del proyecto
				const projectRoot = api.state.workspace?.root || process.cwd();
				const routerDir = join(projectRoot, "router");
				const configPath = join(routerDir, "router.yaml");

				if (!existsSync(routerDir)) {
					api.ui.toast({ title: "GSR no detectado", message: "No se encontró la carpeta 'router/'", variant: "error" });
					return;
				}

				// Importación dinámica de la lógica core del router
				const getRouterCore = async () => import("./src/router-config.js");
				const getFallbackCore = async () => import("./src/core/fallback-io.js");

				const NAV_CATEGORY = "─────────────";

				// ── Lógica de Activación ────────────────────────────────────────────

				const activateProfile = async (presetName: string, onSuccess: () => void) => {
					try {
						const mod = await getRouterCore();
						const currentConfig = mod.loadRouterConfig(configPath);
						const nextConfig = mod.setActiveProfile(currentConfig, presetName);
						mod.saveRouterConfig(nextConfig, configPath, currentConfig);
						
						// Sincronizar y aplicar overlay en tiempo real
						const report = mod.applyOpenCodeOverlayCommand({ apply: true, configPath });
						await api.client.global.config.update({ config: { agent: report.agents } });
						
						api.ui.toast({ title: "Éxito", message: `Preset '${presetName}' activado`, variant: "success" });
						
						api.ui.dialog.replace(() => (
							<api.ui.DialogConfirm
								title={`Preset '${presetName}' activado`}
								message={`El enrutamiento ha sido actualizado.\n\nLos agentes de este proyecto ya están configurados con sus modelos correspondientes.`}
								onConfirm={() => onSuccess()}
								onCancel={() => onSuccess()}
							/>
						));
					} catch (e) {
						api.ui.toast({ title: "Error", message: "No se pudo activar el preset", variant: "error" });
					}
				};

				// ── Menús (Arquitectura de opencode-mask) ──────────────────────────

				const showMainMenu = () => {
					api.ui.dialog.replace(() => (
						<api.ui.DialogSelect
							title="Gentle SDD Router"
							options={[
								{
									title: "Seleccionar Preset",
									value: "list",
									description: "Cambiar el perfil de enrutamiento activo",
								},
								{
									title: "Sincronizar SDD",
									value: "sync",
									description: "Actualizar contratos y agentes",
								},
								{
									title: "Gestionar Fallbacks",
									value: "fallbacks",
									description: "Configurar modelos de respaldo",
								},
								{
									title: "✕ Cerrar",
									value: "__close__",
									category: NAV_CATEGORY,
								},
							]}
							onSelect={async (opt) => {
								if (opt.value === "list") showPresetList();
								else if (opt.value === "sync") runSync();
								else if (opt.value === "fallbacks") showFallbackMenu();
								else api.ui.dialog.clear();
							}}
							onCancel={() => api.ui.dialog.clear()}
						/>
					));
				};

				const showPresetList = async () => {
					try {
						const mod = await getRouterCore();
						const config = mod.loadRouterConfig(configPath);
						const presets = mod.getPublicPresetMetadata(config);

						api.ui.dialog.replace(() => (
							<api.ui.DialogSelect
								title="Presets Disponibles"
								current={config.active_preset}
								options={[
									...presets.map(p => ({
										title: p.name,
										value: p.name,
										description: `${p.phases} fases · ${p.sdd} (${p.scope})`,
									})),
									{
										title: "← Volver",
										value: "__back__",
										category: NAV_CATEGORY,
									},
								]}
								onSelect={(opt) => {
									if (opt.value === "__back__") { showMainMenu(); return; }
									showPresetDetail(opt.value);
								}}
								onCancel={() => showMainMenu()}
							/>
						));
					} catch (e) {
						api.ui.toast({ title: "Error", message: "No se pudieron cargar los presets", variant: "error" });
					}
				};

				const showPresetDetail = async (presetName: string) => {
					api.ui.dialog.replace(() => (
						<api.ui.DialogSelect
							title={`Preset: ${presetName}`}
							options={[
								{
									title: "✓ Activar ahora",
									value: "__activate__",
									description: "Aplicar este enrutamiento al proyecto",
									category: "Acciones",
								},
								{
									title: "← Volver",
									value: "__back__",
									category: NAV_CATEGORY,
								},
							]}
							onSelect={async (opt) => {
								if (opt.value === "__back__") showPresetList();
								else if (opt.value === "__activate__") {
									await activateProfile(presetName, () => showPresetList());
								}
							}}
							onCancel={() => showPresetList()}
						/>
					));
				};

				const runSync = async () => {
					api.ui.toast({ title: "Sincronizando...", message: "Actualizando contratos SDD", variant: "info" });
					try {
						const syncMod = await import("./src/core/unified-sync.js");
						const result = await syncMod.unifiedSync({ configPath, force: true });
						if (result.status === "ok") {
							api.ui.toast({ title: "Sincronización Exitosa", message: "Agentes actualizados", variant: "success" });
						} else {
							api.ui.toast({ title: "Error", message: "Fallo al sincronizar", variant: "error" });
						}
					} catch (e) {
						api.ui.toast({ title: "Error", message: e.message, variant: "error" });
					}
					showMainMenu();
				};

				const showFallbackMenu = async () => {
					try {
						const mod = await getRouterCore();
						const fallbackMod = await getFallbackCore();
						const config = mod.loadRouterConfig(configPath);
						const presets = mod.getPublicPresetMetadata(config);

						api.ui.dialog.replace(() => (
							<api.ui.DialogSelect
								title="Fallbacks: Seleccionar Preset"
								options={[
									...presets.map(p => ({ title: p.name, value: p.name })),
									{ title: "← Volver", value: "__back__", category: NAV_CATEGORY }
								]}
								onSelect={(pOpt) => {
									if (pOpt.value === "__back__") { showMainMenu(); return; }
									
									const phases = fallbackMod.getPresetPhases(configPath, pOpt.value);
									api.ui.dialog.replace(() => (
										<api.ui.DialogSelect
											title={`Fase: ${pOpt.value}`}
											options={[
												...phases.map(f => ({ title: f, value: f })),
												{ title: "← Volver", value: "__back__", category: NAV_CATEGORY }
											]}
											onSelect={(fOpt) => {
												if (fOpt.value === "__back__") { showFallbackMenu(); return; }
												
												const chain = fallbackMod.readFallbackChain(configPath, pOpt.value, fOpt.value);
												api.ui.dialog.replace(() => (
													<api.ui.DialogSelect
														title={`Cadena: ${fOpt.value}`}
														options={[
															...chain.map((m, i) => ({
																title: `${i + 1}. ${m}`,
																value: i + 1,
																description: "Promocionar a principal",
																category: "Modelos",
															})),
															{ title: "← Volver", value: "__back__", category: NAV_CATEGORY }
														]}
														onSelect={async (mOpt) => {
															if (mOpt.value === "__back__") { showFallbackMenu(); return; }
															try {
																const res = await fallbackMod.promoteFallback(configPath, pOpt.value, fOpt.value, 0, mOpt.value);
																const report = mod.applyOpenCodeOverlayCommand({ apply: true, configPath });
																await api.client.global.config.update({ config: { agent: report.agents } });
																api.ui.toast({ title: "Promocionado", message: `${res.promoted} es ahora principal`, variant: "success" });
																showFallbackMenu();
															} catch (e) {
																api.ui.toast({ title: "Error", message: e.message, variant: "error" });
															}
														}}
														onCancel={() => showFallbackMenu()}
													/>
												));
											}}
											onCancel={() => showFallbackMenu()}
										/>
									));
								}}
								onCancel={() => showMainMenu()}
							/>
						));
					} catch (e) {}
				};

				showMainMenu();
			},
		},
		{
			title: "GSR: Sincronizar",
			value: "gsr-sync-quick",
			slash: { name: "gsr-sync" },
			onSelect: () => {
				api.command.trigger("gsr-profiles", { value: "sync" });
			}
		},
		{
			title: "GSR: Fallbacks",
			value: "gsr-fallback-quick",
			slash: { name: "gsr-fallback" },
			onSelect: () => {
				api.command.trigger("gsr-profiles", { value: "fallbacks" });
			}
		}
	]);

	// ─── Slots de UI (Personalización) ──────────────────────────────────────
	api.slots.register({
		slots: {
			home_logo(ctx) {
				return boot.show_logo ? <RouterLogo theme={ctx.theme.current} /> : null;
			},
			sidebar_content(ctx) {
				if (!boot.show_sidebar) return null;
				const activeConfig = api.state.config as any;
				const activePreset = activeConfig?.active_preset || "GSR Active";
				
				return (
					<SidebarRouter
						theme={ctx.theme.current}
						config={boot}
						activePreset={activePreset}
						laneRoles={["Architect", "Implementer"]}
						sddStatus="Sync"
					/>
				);
			}
		}
	});
};

const plugin: TuiPluginModule & { id: string } = { id, tui };
export default plugin;
