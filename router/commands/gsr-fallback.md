---
description: "[Fallback] Promote a fallback model to primary for any phase"
---

## Step 1 — Read and display phase list

!`node --input-type=module --eval "
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
try {
  const raw = execSync('gsr fallback list $ARGUMENTS 2>/dev/null || gsr fallback list', { encoding: 'utf8' });
  process.stdout.write(raw);
} catch(e) {
  process.stdout.write('Could not read fallback config. Make sure gsr is configured.\n');
}
" 2>/dev/null`

Based on the output above, present this to the user:

**PASO 1 — ¿Qué fase querés cambiar?**

Show a numbered list of phases that have at least one fallback. Format each line as:
  [N] <phase>  →  <current_primary_model>  (<X> fallbacks)

Example:
  [1] orchestrator  →  anthropic/claude-sonnet-4-6  (3 fallbacks)
  [2] explore       →  openai/gpt-5.4               (2 fallbacks)

If no phases have fallbacks, tell the user: "No fallbacks configured. Use `gsr fallback add <preset> <phase> <model>` to add some."

Ask: "Reply with a number to select a phase."

Wait for user input before continuing to Step 2.

---

## Step 2 — Show fallback options for selected phase

Once the user picks a phase number, show:

**PASO 2 — ¿Qué fallback promover a primario?**

List the fallback chain for the selected phase:
  Primario actual: <current_target>

  [1] <fallback_1>
  [2] <fallback_2>
  [N] <fallback_N>

  Resultado del intercambio:
  → [elegido] se convierte en primario
  → <current_target> pasa a ser fallback #1
  → El resto mantiene su orden (sin el elegido)

Ask: "Reply with a number to promote that fallback."

Wait for user input before executing Step 3.

---

## Step 3 — Execute the swap

Once the user picks a fallback number, run:

!`gsr fallback promote $ARGUMENTS <phase> <chosen_index>`

Replace `$ARGUMENTS` with the active preset name (read from `!`gsr status --json 2>/dev/null | node --input-type=module --eval "import {createReadStream} from 'node:stream'; let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.active_preset||'')}catch{}})"` or use `$ARGUMENTS` if preset was passed as argument).

Then show the result and run:

!`node --input-type=module --eval "
import { createOpencodeClient } from '@opencode-ai/sdk';
try {
  const { client } = await createOpencodeClient({ timeout: 3000 });
  await client.tui.showToast({ body: { 
    message: '✓ Fallback promoted. Run gsr sync to apply.',
    variant: 'success'
  }});
} catch(e) {}
" 2>/dev/null || true`

Finally tell the user:
"✓ Done! The new primary model is active. OpenCode config has been updated via `gsr sync`."
