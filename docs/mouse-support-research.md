# Mouse Support Research

**Date**: 2026-04-05
**Status**: Deferred — no implementation planned

## Findings

### Ink v6 — No native mouse support

Ink v6 (the React TUI framework used by gsr) has no native mouse/click support.
The only input hook available is `useInput`, which handles keyboard input only.

There is no official API for pointer events, scroll events, or click coordinates in the current Ink release.

### Available third-party library: `@zenobius/ink-mouse`

- **Version**: v1.0.3
- **GitHub stars**: ~25
- **Status**: Low adoption, maintenance risk uncertain
- **Approach**: Patches terminal input to capture mouse escape sequences

### Recommendation: Defer mouse implementation

Reasons:
1. Low adoption of the only available library — high risk of breakage on future Ink/Node updates.
2. Ink's keyboard navigation (`useInput` with arrow keys + enter) already provides a good UX for all TUI screens in gsr.
3. The keyboard-first navigation is accessible and works in all terminal environments, including remote SSH sessions where mouse support may be disabled.
4. Adding mouse support would require testing across multiple terminal emulators (iTerm2, Ghostty, WezTerm, etc.) and would likely produce inconsistent behavior.

**Decision**: Do not implement mouse support. Revisit when Ink adds native mouse support in a stable release.

## References

- [Ink GitHub — Issues on mouse support](https://github.com/vadimdemedes/ink/issues)
- [@zenobius/ink-mouse on npm](https://www.npmjs.com/package/@zenobius/ink-mouse)
