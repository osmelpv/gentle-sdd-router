// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { Cfg } from "./config";

export const RouterLogo = (props: { theme: TuiThemeCurrent }) => {
	const t = props.theme;
	return (
		<box flexDirection="column" alignItems="center">
			<text fg={t.primary} bold={true}>
				   _____  _____  _____    _____             _
			</text>
			<text fg={t.primary} bold={true}>
				  / ____|/ ____|  __ \  |  __ \           | |
			</text>
			<text fg={t.secondary} bold={true}>
				 | (___ | (___ | |  | | | |__) |___  _   _| |_ ___ _ __
			</text>
			<text fg={t.secondary} bold={true}>
				  \___ \ \___ \| |  | | |  _  // _ \| | | | __/ _ \ '__|
			</text>
			<text fg={t.accent} bold={true}>
				  ____) |____) | |__| | | | \ \ (_) | |_| | ||  __/ |
			</text>
			<text fg={t.accent} bold={true}>
				 |_____/|_____/|_____/  |_|  \_\___/ \__,_|\__\___|_|
			</text>
			<text> </text>
			<box flexDirection="row" gap={1}>
				<text fg={t.textMuted}>Gentle SDD Router</text>
				<text fg={t.accent}>·</text>
				<text fg={t.text}>v0.1.0</text>
			</box>
		</box>
	);
};

export const SidebarRouter = (props: {
	theme: TuiThemeCurrent;
	config: Cfg;
	activePreset?: string;
	laneRoles?: string[];
	sddStatus?: string;
}) => {
	if (!props.config.show_sidebar) return null;
	const t = props.theme;

	return (
		<box flexDirection="column" alignItems="flex-start" paddingX={1}>
			<box flexDirection="row" gap={1} marginBottom={1}>
				<text fg={t.primary}>⦿</text>
				<text fg={t.text} bold={true}>SDD ROUTER</text>
			</box>

			<box flexDirection="column" gap={0}>
				<text fg={t.textMuted} scale={0.9}>PRESET ACTIVO</text>
				<text fg={t.secondary} bold={true}>{props.activePreset || "Ninguno"}</text>
			</box>

			{props.laneRoles && props.laneRoles.length > 0 && (
				<box flexDirection="column" gap={0} marginTop={1}>
					<text fg={t.textMuted} scale={0.9}>ROLES EN LÍNEA</text>
					<text fg={t.accent}>{props.laneRoles.join(" / ")}</text>
				</box>
			)}

			<box flexDirection="column" gap={0} marginTop={1}>
				<text fg={t.textMuted} scale={0.9}>ESTADO SDD</text>
				<text fg={props.sddStatus === "Sync" ? t.success : t.warning}>
					{props.sddStatus || "Desconocido"}
				</text>
			</box>

			<text> </text>
			<text fg={t.textMuted} dimColor={true} scale={0.8}>
				gsr command boundary: active
			</text>
		</box>
	);
};
