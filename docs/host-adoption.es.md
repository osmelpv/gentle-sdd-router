# Adopción del Host

## Proposito

Instala el router skill solo en archivos del host. El router sigue externo, y el flujo de instalacion/desinstalacion conserva intactas las ediciones del usuario fuera del bloque administrado.
Este documento cubre solo la adopcion; la sincronizacion activa de `/gsr` es un contrato aparte, propiedad del host.

## Instalacion

1. Llamar a `installHostAdoption(hostRoot)` desde la capa de integracion del host.
2. El instalador copia `assets/host-skill/router-skill/**` en `.gsr/skills/router-skill/`.
3. Inserta un unico bloque de guardrail administrado en `.gsr/policy/rules.md`.

## Desinstalacion

1. Llamar a `uninstallHostAdoption(hostRoot)` desde la capa de integracion del host.
2. El desinstalador elimina solo el bloque administrado, los archivos rastreados del skill y el manifest.
3. Falla cerrado si el manifest, los marcadores o los hashes rastreados ya no coinciden.

## Notas de seguridad

- El flujo falla cerrado si faltan marcadores, si estan duplicados o si los hashes rastreados no coinciden.
- El texto escrito por el usuario fuera del bloque administrado se preserva.
- La integracion TUI/slash-command de `/gsr` es externa, propiedad del host y se maneja con el contrato de sincronizacion en vivo.

## Contrato Token Budget Hint

El contrato de session sync incluye un campo `tokenBudgetHint` que expone metadata de presupuesto de tokens por fase. Esto permite a los TUI hosts renderizar barras de ventana de contexto y estimadores de costo de sesion sin que gsr haga llamadas API.

### Forma del Contrato

```json
{
  "tokenBudgetHint": {
    "kind": "token-budget-hint",
    "contractVersion": "1",
    "catalogName": "default",
    "presetName": "multivendor",
    "phases": {
      "orchestrator": {
        "target": "anthropic/claude-opus",
        "contextWindow": 200000,
        "inputCostPerMillion": 15,
        "outputCostPerMillion": 75
      }
    },
    "policy": {
      "nonExecuting": true,
      "informationalOnly": true,
      "hostAccumulates": true
    }
  }
}
```

### Como Usar (TUI Host)

1. Leer `tokenBudgetHint.phases[faseActual].contextWindow` como denominador.
2. Acumular `input_tokens + output_tokens` de cada respuesta API en un contador local de sesion.
3. Renderizar la barra: `(tokens acumulados) / contextWindow`.
4. Para costo: `(input tokens x inputCostPerMillion / 1_000_000) + (output tokens x outputCostPerMillion / 1_000_000)`.

### Politica

- `nonExecuting`: gsr nunca hace llamadas API. Esto es solo metadata.
- `informationalOnly`: los valores de context window son hints informativos, no limites de ejecucion.
- `hostAccumulates`: el TUI host es responsable de rastrear el consumo real de tokens de las respuestas API.

### Superficie CLI

Usa `gsr setup apply opencode [--apply]` para generar o previsualizar el overlay de TAB-switching de OpenCode.

> **Nota**: El comando antiguo `gsr apply opencode` sigue funcionando como alias de compatibilidad.

`gsr status` muestra la ventana de contexto junto al pricing de cada fase:

```
- orchestrator: anthropic / claude-opus ($15/$75) [200K ctx]
- explore:      google / gemini-pro    ($1.25/$5) [2M ctx]
```

### Compatibilidad

El campo `contextWindow` en lanes y el campo `tokenBudgetHint` en el contrato de session sync son opcionales. Los perfiles sin `contextWindow` siguen funcionando igual, y `tokenBudgetHint` sera `null` cuando no haya datos de presupuesto disponibles.
