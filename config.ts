export type Cfg = {
  enabled: boolean
  theme: string
  show_sidebar: boolean
  show_logo: boolean
  auto_sync: boolean
}

const pick = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback
  if (!value.trim()) return fallback
  return value
}

const bool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value !== "boolean") return fallback
  return value
}

export const cfg = (opts: Record<string, unknown> | undefined): Cfg => {
  return {
    enabled:      bool(opts?.enabled, true),
    theme:        pick(opts?.theme, "gentle-sdd"),
    show_sidebar: bool(opts?.show_sidebar, true),
    show_logo:    bool(opts?.show_logo, true),
    auto_sync:    bool(opts?.auto_sync, true),
  }
}
