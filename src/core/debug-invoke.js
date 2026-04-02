/**
 * debug-invoke.js — Pure logic for determining if sdd-debug should be invoked.
 *
 * GSR boundary: pure function, no file I/O, no side effects.
 * Used by orchestrators after verify to determine whether sdd-debug is needed.
 *
 * @module debug-invoke
 */

/**
 * Validate that all required fields from debugInvoke.required_fields are present
 * in verifyOutput. Returns an invoke result object.
 *
 * @param {{ preset: string, required_fields?: string[] }} debugInvoke
 * @param {Record<string, unknown>} verifyOutput
 * @returns {{ invoke: boolean, reason?: string, preset?: string, payload?: object, missing?: string[] }}
 */
function validateRequiredFields(debugInvoke, verifyOutput) {
  const requiredFields = Array.isArray(debugInvoke.required_fields)
    ? debugInvoke.required_fields
    : [];

  const missing = requiredFields.filter((f) => !(f in verifyOutput));

  if (missing.length > 0) {
    return { invoke: false, reason: 'missing_fields', missing };
  }

  return { invoke: true, preset: debugInvoke.preset, payload: verifyOutput };
}

/**
 * Determine whether sdd-debug should be invoked based on the debug_invoke config
 * and the current verify output.
 *
 * This is a PURE function — no side effects, no file I/O.
 *
 * @param {object|null|undefined} debugInvoke - The debug_invoke block from the active preset
 * @param {object|null|undefined} verifyOutput - The output produced by the verify phase
 * @returns {{ invoke: boolean, reason?: string, preset?: string, payload?: object, missing?: string[] }}
 */
export function shouldInvokeDebug(debugInvoke, verifyOutput) {
  // null/undefined debugInvoke → treat as disabled
  if (!debugInvoke) {
    return { invoke: false, reason: 'disabled' };
  }

  const { trigger } = debugInvoke;

  // never → always disabled
  if (trigger === 'never') {
    return { invoke: false, reason: 'disabled' };
  }

  // manual → not auto-invoked
  if (trigger === 'manual') {
    return { invoke: false, reason: 'manual' };
  }

  // always → skip issue check, go straight to field validation
  if (trigger === 'always') {
    return validateRequiredFields(debugInvoke, verifyOutput ?? {});
  }

  // on_issues (default) → only if verifyOutput.issues is a non-empty array
  if (!verifyOutput?.issues?.length) {
    return { invoke: false, reason: 'no_issues' };
  }

  return validateRequiredFields(debugInvoke, verifyOutput);
}
