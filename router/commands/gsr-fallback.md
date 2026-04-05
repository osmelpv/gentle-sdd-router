---
description: "[Fallback] Promote a fallback model to primary for any phase"
---

## Step 1 — Read active preset and fallback config

!`gsr status 2>/dev/null || echo "gsr not found in PATH"`

!`gsr fallback list $ARGUMENTS 2>/dev/null || gsr fallback list 2>/dev/null || echo "NO_FALLBACKS"`

Based on the output above:

**PASO 1 — ¿Qué fase querés cambiar?**

Parse the `gsr fallback list` output. For each phase that has at least one fallback, show:

```
[N] <phase>  →  <current_primary_model>  (<X> fallbacks)
```

Example:
```
[1] orchestrator  →  anthropic/claude-sonnet-4-6  (3 fallbacks)
[2] explore       →  openai/gpt-5.4               (2 fallbacks)
```

- If `gsr not found in PATH`: tell the user to install gsr or add it to PATH.
- If `NO_FALLBACKS` or no phases with fallbacks: tell the user "No fallbacks configured. Use `gsr fallback add <preset> <phase> <model>` to add some."
- If `$ARGUMENTS` was provided, use it as the preset name. Otherwise use the active preset from `gsr status`.

Ask: "Reply with a number to select a phase."

**Wait for user input before continuing.**

---

## Step 2 — Show fallback chain for selected phase

Once the user replies with a number, identify the selected phase from Step 1.

Show:

**PASO 2 — ¿Qué fallback promover a primario?**

```
Primario actual: <current_target_of_selected_phase>

[1] <fallback_1>
[2] <fallback_2>
[N] <fallback_N>

Resultado del intercambio:
→ [elegido] se convierte en primario
→ <current_target> pasa a ser fallback #1
→ El resto mantiene su orden (sin el elegido)
```

Ask: "Reply with a number to promote that fallback."

**Wait for user input before continuing.**

---

## Step 3 — Execute the swap

Once the user replies with a fallback number:

1. Identify from Step 1: `PRESET` (active preset name from `gsr status` output, or `$ARGUMENTS`), `PHASE` (selected in Step 1), `INDEX` (chosen in Step 2).

2. Run the promote command using those values:

!`gsr fallback promote PRESET PHASE INDEX 2>&1`

(Replace PRESET, PHASE, INDEX with the actual values resolved from Steps 1 and 2 — do NOT run this line literally with the words PRESET/PHASE/INDEX.)

3. Then run sync:

!`gsr sync 2>&1 | tail -5`

4. Show the user what changed and confirm:

"✓ Done! **[chosen_model]** is now the primary model for **[phase]**. The previous primary **[old_model]** is now fallback #1."
