/**
 * Punto de entrada REUTILIZABLE de la capa de ejecucion, expuesto como subpath de paquete
 * (`@ledesma-platform/backend/execution`, ver el campo `exports` de package.json) para que el WORKER
 * de ejecucion autonoma (apps/worker) reuse el MISMO motor, repos y boveda que el backend, sin
 * duplicar logica ni acoplarse por rutas relativas entre apps.
 *
 * Por que un subpath del backend y no mover todo a packages/shared: el worker necesita CUATRO cosas
 * que viven en el backend y estan cableadas a modulos internos suyos (los SDK de proveedor, el cripto
 * de la boveda, los errores): el motor (assembleAgentRun + runAgent), el AgentRepository, la boveda
 * (ProviderCredentialRepository + resolveStoredCredential) y el gate por tier (getProfileTier).
 * Reubicar todo eso en `shared` seria un refactor enorme y arrastraria los SDK de Anthropic/OpenAI a
 * `shared` (que tambien consume el widget de browser). Este barrel SOLO re-exporta; no agrega
 * comportamiento. El backend sigue importando estos modulos por su ruta interna (cero cambios) y el
 * worker los consume por aca. Se construye antes que el worker en CI (orden: shared -> backend ->
 * worker), asi sus declaraciones (.d.ts) ya existen cuando el worker compila/typechequea.
 */

// Motor de ensamblado (sin HTTP) + loop agentico generico.
export { assembleAgentRun } from './assemble-agent-run.js';
export type {
  AssembleAgentRunParams,
  AssembledAgentRun,
  ResolvedCredential,
  NativeToolsConfig,
  RunLimitsConfig,
} from './assemble-agent-run.js';
export {
  runAgent,
  DEFAULT_MAX_ITERATIONS,
  AGENT_LIMITS,
  DEFAULT_RUN_TIMEOUT_SECONDS,
  DEFAULT_RUN_MAX_TOKENS,
} from '../agent/index.js';
export type {
  AgentRunInput,
  AgentDeps,
  ToolCall,
  ToolExecutionResult,
  ToolExecutor,
} from '../agent/index.js';

// Config del agente (autoritativa) + su repo de acceso a datos.
export { AgentRepository } from '../agents/agent-repository.js';
export type { AgentConfig, AgentConfigInput, AgentTool, StoredTool } from '../agents/types.js';

// Registro de corridas: la MISMA tabla (agent_runs) y el MISMO metodo (record) que usa la ruta sincrona
// (/v1/run/:agentId), reexpuestos para que el WORKER de ejecucion autonoma persista el usage de sus jobs
// por la misma via -- unificando ambas en una sola fuente de verdad de ejecuciones. Es data-access puro
// (solo necesita el cliente sql), sin acoplarse a HTTP ni a los SDK de proveedor.
export { AgentRunRepository } from '../agents/run-repository.js';
export type { AgentRunRecord } from '../agents/run-repository.js';

// Boveda de credenciales: repo + resolucion server-side (descifra por owner + credential).
export { ProviderCredentialRepository } from '../credentials/provider-credential-repository.js';
export type {
  DecryptedProviderCredential,
  ProviderCredentialMetadata,
  CreateProviderCredentialInput,
} from '../credentials/provider-credential-repository.js';
export { resolveStoredCredential } from '../credentials/resolve-stored-credential.js';

// Gate por tier: el modo autonomo (correr jobs sin humano) exige tier 'autonomous'.
export { RegistrationRepository } from '../registration/registration-repository.js';
export type { ProfileTier } from '../registration/types.js';

// Puerta de entrada UNICA a la capa de modelo (BYOK por llamada), la MISMA que usa la ruta sincrona.
// La reusa el worker para la UNICA consulta puntual que hace fuera del motor de navegacion: elegir,
// entre las tareas que el usuario ya enseno, cual corresponde a lo que acaba de pedir. Es una sola
// llamada sin tools y sin bucle; el motor de navegacion sigue siendo el unico camino con agente.
export { runModel } from '../providers/run-model.js';
export type { ModelCallInput } from '../providers/run-model.js';
