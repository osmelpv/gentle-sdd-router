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
