# GSR Plugin — Reporte de Estado y Requerimientos

> **Proyecto**: ArchonLord
> **Fecha**: 2026-04-01
> **GSR Version**: v0.1.0 (npm link gentle-sdd-router)
> **Estado**: Catálogo creado, contratos listos, sync no funciona para catálogos custom

---

## 1. Contexto

Estamos construyendo ArchonLord, un juego multiplayer mobile strategy, usando GSR como
router declarativo de modelos para orquestar un estudio virtual de desarrollo con IA.

Tenemos **8 catálogos GSR** diseñados (uno por departamento del estudio). El primero y
más crítico es `game-design`.

---

## 2. Estructura Actual de Archivos

```
router/
├── router.yaml                    # ✅ Configuración principal (v3)
│   ├── active_catalog: local-offline
│   ├── active_preset: ollama-archon
│   ├── catalogs.game-design       # ✅ Definido con 9 fases y matriz de modelos
│   ├── catalogs.local-offline     # ✅ Activo (SDD code workflow)
│   └── catalogs.default           # ✅ Multivendor fallback
│
├── catalogs/
│   └── game-design/
│       ├── sdd.yaml               # ⚠️ STUB — solo tiene 1 fase "main" placeholder
│       └── contracts/
│           ├── phases/            # ⚠️ 8 archivos — TODOS placeholders
│           │   ├── concept.md
│           │   ├── narrative.md
│           │   ├── systems.md
│           │   ├── tech-spec.md
│           │   ├── balance.md
│           │   ├── level-design.md
│           │   ├── multiplayer.md
│           │   └── ux.md
│           └── roles/             # ⚠️ 7 archivos — TODOS placeholders
│               ├── game-director.md
│               ├── systems-designer.md
│               ├── narrative-designer.md
│               ├── balance-designer.md
│               ├── level-designer.md
│               ├── multiplayer-architect.md
│               └── art-director.md
│
└── profiles/
    ├── local-offline/             # ✅ Preset ollama-archon
    ├── game-design/               # ✅ Preset game-design-team
    └── multivendor.router.yaml    # ✅ Preset multivendor
```

---

## 3. Lo que Funciona ✅

| Feature | Estado | Detalle |
|---------|--------|---------|
| `gsr status` | ✅ | Muestra estado correcto |
| `gsr sdd list` | ✅ | Reconoce `game-design` (1 fase) |
| `gsr sdd show game-design` | ✅ | Muestra detalles del SDD |
| `gsr catalog list` | ✅ | Lista catálogos con estado |
| `gsr route show` | ✅ | Muestra rutas resueltas del preset activo |
| `gsr profile list` | ✅ | Lista presets disponibles |
| Matriz de modelos en router.yaml | ✅ | game-design tiene 9 fases con modelos y fallbacks |
| Catálogo habilitado en router.yaml | ✅ | `availability: stable, enabled: false` |

---

## 4. Lo que NO Funciona ❌

### 4.1 `gsr sync` falla para catálogos custom

```
$ gsr sync
Sync failed: Contracts directory not found at /home/osmelpv/projects/archonlord/router/contracts
```

**Problema**: `gsr sync` busca contratos en `router/contracts/` (estructura global) pero
nuestros contratos están en `router/catalogs/game-design/contracts/` (estructura por catálogo).

**Impacto**: No se pueden sincronizar contratos de catálogos custom a Engram.

**Lo que debería pasar**: `gsr sync` debería detectar catálogos en `router/catalogs/*/`
y sincronizar sus contratos respectivos, o debería existir un comando específico como
`gsr sdd sync game-design`.

---

### 4.2 `gsr sdd show` solo ve la fase `main` placeholder

```
$ gsr sdd show game-design
SDD: game-design
Phases (1):
  main: Define the main phase intent here [sequential]
```

**Problema**: El `sdd.yaml` solo tiene 1 fase stub. GSR lee correctamente el archivo
pero el contenido está vacío.

**Impacto**: El SDD no tiene las 8 fases reales definidas.

**Solución**: Necesitamos llenar el `sdd.yaml` con las 8 fases reales. Esto es trabajo
nuestro (llenar contenido), no un bug de GSR.

---

### 4.3 Los contratos de fases y roles son placeholders

Todos los archivos `.md` en `contracts/phases/` y `contracts/roles/` tienen contenido
template con tokens `{...}` sin reemplazar.

**Impacto**: Aunque GSR pudiera leerlos, no tendrían contenido útil.

**Solución**: Necesitamos llenar los contratos con contenido real. Esto es trabajo
nuestro, no un bug de GSR.

---

## 5. Lo que Necesitamos del Plugin GSR

### 5.1 URGENTE: Sync de contratos por catálogo

Necesitamos que `gsr sync` soporte catálogos custom. Opciones:

**Opción A** (preferida): `gsr sync` detecta automáticamente todos los catálogos en
`router/catalogs/*/` y sincroniza sus contratos.

**Opción B**: Nuevo comando `gsr sdd sync <name>` para sincronizar un SDD específico.

```
$ gsr sdd sync game-design
Syncing contracts for SDD: game-design
  Phases: 8 contracts synced
  Roles: 7 contracts synced
  Engram: updated
```

**Opción C**: `gsr sync --catalog game-design` como flag opcional.

---

### 5.2 URGENTE: Soporte para sub-SDD invocations en sdd.yaml

Necesitamos que el schema de `sdd.yaml` soporte el bloque `sub_sdd_invocations` dentro
de cada fase. Esto permite que una fase de un catálogo invoque fases de otro catálogo.

**Formato propuesto**:

```yaml
phases:
  client-impl:
    phase_order: 2
    intent: "Is the Unity client fully implemented?"
    depends_on: [backend-spec, client-spec]
    execution_mode: parallel
    sub_sdd_invocations:
      - name: generate-unit-art
        invocation_type: single_phase    # full_sdd | single_phase | parallel | conditional
        catalog: art-production
        phase: 3d-modeling
        trigger: missing_artifact
        condition: "unit.fbx_model == null"
        input_context:
          - artifact: balance-sheet
            field: unit.{unit_name}.stats
        output_expected:
          - artifact: fbx-model
            format: "FBX rigged"
        on_failure: block               # block | escalate_to_human | log_and_continue
        return_to: client-impl          # null = fire-and-forget
```

**Campos necesarios**:
- `invocation_type`: tipo de invocación
- `catalog`: catálogo target
- `phase`: fase específica (opcional, si no va todas)
- `trigger`: cuándo se dispara
- `condition`: condición booleana
- `input_context`: qué contexto pasar
- `output_expected`: qué se espera recibir
- `on_failure`: qué hacer si falla
- `return_to`: a dónde volver

---

### 5.3 IMPORTANTE: Soporte para triggers declarativos

Necesitamos que GSR soporte los campos `trigger_from` y `return_to` en las fases para
definir flujos circulares entre catálogos.

```yaml
phases:
  tech-spec:
    phase_order: 2
    trigger_from: [systems]      # esta fase se activa cuando systems completa
    return_to: systems           # al completar, notifica a systems
```

---

### 5.4 IMPORTANTE: Validación de sdd.yaml

Necesitamos un comando `gsr sdd validate <name>` que verifique:
- Todas las fases declaradas tienen contrato `.md` correspondiente
- Todos los roles declarados tienen contrato `.md` correspondiente
- Las dependencias entre fases son válidas (no hay ciclos no resueltos)
- Los `sub_sdd_invocations` referencian catálogos y fases existentes
- Los `input_context` y `output_expected` tienen formato válido

```
$ gsr sdd validate game-design
Validating SDD: game-design
  ✅ 8 phases — all have contracts
  ✅ 8 roles — all have contracts
  ✅ Dependency graph — no cycles
  ✅ 4 sub-SDD invocations — all targets valid
  ✅ Input/output contracts — all valid
SDD is valid.
```

---

### 5.5 DESEABLE: Comando para listar invocaciones

```
$ gsr sdd invocations game-design
Outbound invocations from game-design:
  systems → engineering/architecture (always, critical path)
  systems → art-production/concept-art (always, fire-and-forget)
  level-design → art-production/3d-modeling (conditional: no FBX)
  multiplayer → engineering/backend-spec (always, critical path)
```

---

## 6. Arquitectura de Referencia

### 6.1 Los 8 Catálogos Diseñados

| # | Catálogo | Fases | Roles | Estado |
|---|----------|-------|-------|--------|
| 1 | `game-design` | 8 | 8 | ⚠️ Stub — necesita contenido |
| 2 | `engineering` | 9 | 4 | ❌ No creado |
| 3 | `art-production` | 8 | 6 | ❌ No creado |
| 4 | `qa-testing` | 7 | 4 | ❌ No creado |
| 5 | `production` | 6 | 3 | ❌ No creado |
| 6 | `marketing` | 7 | 4 | ❌ No creado |
| 7 | `live-ops` | 7 | 4 | ❌ No creado |
| 8 | `data-analytics` | 6 | 3 | ❌ No creado |

**Total**: 58 fases, 34 roles, 26 invocaciones cruzadas entre catálogos.

### 6.2 Principio Fundamental

**GSR es DECLARATIVO (non-executing)**:
- GSR declara la intención de invocar un sub-SDD
- El HOST (opencode/agent-teams-lite) orquesta la ejecución
- GSR NO ejecuta, NO switchea catálogos, NO maneja timeouts
- GSR solo señala: "esta fase necesita invocar este otro SDD"

### 6.3 Infraestructura Existente

- `identity.inherit_agents_md` → herencia automática de contexto para sub-agentes
- Engram → maneja estado cross-session (no necesita checkpoint custom)
- Custom phases ya soportan: `depends_on`, `input/output`, `composition`
- Solo falta extender con: `sub_sdd_invocations`, `trigger_from`, `return_to`

---

## 7. Archivos de Referencia

| Archivo | Ubicación | Propósito |
|---------|-----------|-----------|
| Process Manual | `router/PROCESS-MANUAL.md` | Decision tree, invocaciones, escenarios |
| Org Report | `router/ORGANIZATIONAL-REPORT.md` | Diseño completo de los 8 catálogos |
| Project Context | `DESCRIPTION.md` | Contexto completo de ArchonLord |
| Router Config | `router/router.yaml` | Configuración actual de GSR |

---

## 8. Prioridad de Requerimientos

| Prioridad | Requerimiento | Impacto |
|-----------|--------------|---------|
| 🔴 **P0** | `gsr sdd sync` o `gsr sync --catalog` | Bloqueante para usar catálogos custom |
| 🔴 **P0** | Soporte `sub_sdd_invocations` en sdd.yaml | Bloqueante para inter-department workflows |
| 🟠 **P1** | `gsr sdd validate` | Necesario para validar contratos antes de usar |
| 🟠 **P1** | Soporte `trigger_from` / `return_to` | Necesario para flujos circulares |
| 🟡 **P2** | `gsr sdd invocations` | Nice-to-have para debugging |
| 🟡 **P2** | Validación de input_context/output_expected | Nice-to-have para prevenir errores |

---

## 9. Comandos de Verificación

Para verificar que los cambios funcionan:

```bash
# 1. Verificar que el sync funciona para catálogos custom
gsr sdd sync game-design

# 2. Verificar que el SDD muestra las 8 fases
gsr sdd show game-design

# 3. Verificar que las invocaciones están registradas
gsr sdd invocations game-design

# 4. Validar el SDD completo
gsr sdd validate game-design

# 5. Verificar que el catálogo está habilitado
gsr catalog list

# 6. Verificar las rutas resueltas
gsr route show
```

---

## 10. Notas Adicionales

- El `sdd.yaml` actual tiene solo 6 líneas con 1 fase placeholder. El diseño completo
  de las 8 fases con dependencias está documentado en `router/ORGANIZATIONAL-REPORT.md`.
- Los 8 contratos de fases y 7 contratos de roles existen como archivos `.md` pero con
  contenido placeholder. El contenido real está diseñado y listo para ser escrito.
- La matriz de modelos para `game-design` ya está definida en `router/router.yaml` con
  9 fases, modelos primarios (claude-opus, gpt-5, claude-sonnet) y fallbacks a free/local.
- El catálogo `game-design` está configurado como `enabled: false` en router.yaml —
  necesita ser habilitado cuando esté listo.
