# Ledesma Agent SDK (Kotlin Multiplatform)

Nucleo del SDK movil de la plataforma. Es un proyecto Gradle independiente (NO forma parte de
los npm workspaces del monorepo) que replica la semantica del widget web (`packages/widget`):
mismos eventos, misma transaccionalidad de turnos y mismos headers del contrato publico.

## Modulos

- `agent-core`: codigo comun KMP con los eventos (`AgentEvent`, `SseMessage`), el parser SSE
  (`SseParser`), los turnos transaccionales (`ChatTurns`) y el cliente streaming
  (`LedesmaAgentClient`) del contrato publico `POST {baseUrl}/v1/run/{agentId}`.
  Target actual: `jvm`.
- `sample-cli`: CLI de muestra para chatear con un agente real desde la terminal.

## Requisitos

- JDK 21
- Gradle: el wrapper esta commiteado (`./gradlew`); si no podes usar el wrapper, cualquier
  Gradle 8.14+ del sistema funciona corriendo `gradle` en lugar de `./gradlew` desde este
  directorio.

## Comandos

Todos desde `sdk/kotlin/`:

```sh
./gradlew check                # tests de ambos modulos
./gradlew :agent-core:jvmTest  # solo los tests del nucleo
```

### Correr la CLI de muestra

```sh
LEDESMA_AGENT_ID=<id-del-agente> \
LEDESMA_PROVIDER_KEY=<key-del-proveedor> \
./gradlew :sample-cli:run --console=plain --quiet
```

| Variable | Requerida | Descripcion |
| --- | --- | --- |
| `LEDESMA_AGENT_ID` | si | Id del agente publicado contra el que se chatea. |
| `LEDESMA_SESSION_TOKEN` | una de las dos | Token de sesion efimero (header `x-session-token`). Tiene precedencia. |
| `LEDESMA_PROVIDER_KEY` | una de las dos | Key directa del proveedor (header `x-provider-key`), solo pruebas/servidor. |
| `LEDESMA_BASE_URL` | no | Base de la API. Default: `https://api-plataforma.ledesma-ai-labs.com`. |

En el chat: linea vacia o `salir` termina. El texto del agente se imprime en streaming, las
herramientas como `[tool: nombre]` y al final el uso como `(in X / out Y tokens)`.

Alternativa sin stdin via Gradle: `./gradlew :sample-cli:installDist` y despues
`./sample-cli/build/install/sample-cli/bin/sample-cli`.

## P6b

En P6b se agregan `androidTarget()` y los targets `ios*` en `agent-core` sobre el MISMO codigo
comun: solo hay que declarar los targets y el engine de Ktor de cada plataforma
(OkHttp/Darwin) en su source set. Nada del nucleo cambia.
