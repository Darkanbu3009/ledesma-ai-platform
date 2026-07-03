# Auditoria #9 de 12 -- Calidad de codigo y deuda tecnica

- **Alcance**: CALIDAD DE CODIGO Y DEUDA TECNICA. Abre el Bloque C (calidad y rendimiento). A diferencia
  de las auditorias de seguridad (#1-#5) y de correctitud (#6-#8), esta NO busca bugs explotables ni
  corrupcion de datos: busca lo que hace el codebase mas FRAGIL, mas LENTO DE MANTENER y mas PROPENSO A
  FALLOS FUTUROS -- duplicacion, inconsistencias entre modulos analogos, divergencia de patrones,
  complejidad innecesaria, tipos que mienten, manejo de errores desparejo, acoplamiento filtrado y
  codigo muerto. Pregunta central: *"que me va a doler mantener, extender o depurar en 6 meses?"*.
- **Contexto que importa**: ~23 mil lineas de codigo fuente (8.4k backend, 14.5k consola, + worker/
  shared) construidas en ~25 PRs a lo largo de semanas, cada uno en aislamiento. Ese patron es
  exactamente el que acumula inconsistencias entre modulos que solo se ven mirando el CONJUNTO -- el
  foco de este informe.
- **Relacion con otras auditorias**: la #2 (tenancy) y la #5 (RLS) cubrieron el aislamiento por owner
  desde el angulo de SEGURIDAD; aqui se toca solo desde el angulo de CONSISTENCIA/MANTENIBILIDAD (que
  el patron sea uniforme y dificil de romper por descuido). La cobertura de tests (numeros, gaps) es la
  auditoria #10: aqui los tests se miran solo como INDICADOR DE CALIDAD del codigo (legibilidad,
  duplicacion, fragilidad), no de cobertura.
- **Fuente de verdad**: `apps/backend/src`, `apps/console/src`, `apps/worker/src`, `packages/shared/src`
  leidos comparando recursos analogos en paralelo (los 5 repositorios CRUD entre si, las 5 rutas entre
  si, los dialogos de la consola entre si), mas la salida del linter y del typechecker como insumo.
- **Fecha**: 2026-07-02.
- **Metodo**: (1) baseline automatico -- `tsc --noEmit` en todos los workspaces y `eslint .`; (2)
  lectura comparativa de modulos analogos por dimension (aislamiento, validacion, errores, shape de
  respuesta, naming, tests) para que las inconsistencias salten; (3) barridos read-only (`as unknown
  as`, `any`, `catch` vacios, TODO/FIXME, exports no usados, `console.*`, promesas sueltas); (4) cada
  hallazgo agrupado por TEMA y verificado con `path:linea`. Read-only: no se modifico codigo, tests ni
  configuracion; no se consulto produccion.
- **Tipo**: auditoria de deuda tecnica. Distingue deliberadamente **deuda REAL** (causara un bug,
  ralentizara una feature futura, o confundira a quien depure prod) de **preferencia estetica** (que el
  linter ya cubre o que no cambia nada real). Lo estetico se marca BAJA o se descarta.

---

## 1. Resumen ejecutivo

**Veredicto (una frase): el codebase es SOLIDO Y MANTENIBLE, con deuda de CONSISTENCIA acotada y bien
localizada -- el nucleo esta limpio (typecheck estricto sin errores, cero `any`, cero exports muertos,
manejo de errores central via `AppError`, cripto y worker ejemplarmente documentados), y la deuda que
existe es casi toda del MISMO tipo: patrones analogos que divergieron porque se construyeron en PRs
aislados, concentrados en (a) los contratos que NO se comparten entre backend/worker/consola y (b) el
recurso mas viejo (`agents`) que nunca se actualizo a las convenciones que adoptaron los recursos
nuevos.**

Ningun hallazgo es un bug hoy. Todos son FRAGILIDAD y FRICCION: cosas que haran que la proxima feature
(dashboard, onboarding, monetizacion) tarde mas de lo necesario, o que un mantenedor rompa por no ver
que un patron esta duplicado en 5 sitios y solo actualizo 4. La buena noticia: como casi toda la deuda
es del mismo tipo (divergencia de patron replicado), 3-4 consolidaciones puntuales (seccion 5) la
cierran casi entera.

### Conteo de hallazgos por severidad de deuda

| Severidad | Cantidad | IDs |
|---|---|---|
| ALTA (causara bug / ralentizara mucho / ya divergio el comportamiento) | 1 | H-01 |
| MEDIA (friccion de mantenimiento real) | 8 | H-02, H-03, H-04, H-05, H-06, H-07, H-08, H-10 |
| BAJA (consistencia menor / cosmetico) | 1 | H-09 |

*Nota: la banda MEDIA es amplia a proposito -- va desde un footgun con potencial de bug silencioso
(el orden de argumentos invertido de H-06) hasta friccion de lectura pura (naming). Ninguno rompe nada
HOY; todos aumentan la probabilidad de un bug o el costo de la proxima feature.*

### Calibracion (como leer las severidades)

- **ALTA** no significa "urgente hoy": significa que la ESTRUCTURA ya permite que el comportamiento
  diverja (y en H-01 ya divergio en un caso latente) y que cada feature futura paga el costo.
- **MEDIA** es friccion que un mantenedor sentira al extender el recurso 6, pero que no rompe nada solo.
- Lo que el linter ya cubre (formato, imports) NO esta aqui: seria ruido. El linter corre limpio salvo
  2 warnings benignos (seccion 4).

---

## 2. Mapa de consistencia entre recursos (el corazon del informe)

Los cinco recursos CRUD del producto (`agents`, `credentials`, `scheduled-tasks`, `triggers`,
`recipes`) son el caso de estudio: hacen lo MISMO (guardar un recurso del owner, listarlo, editarlo,
borrarlo) y se construyeron uno por PR. La tabla compara como cada uno resuelve las dimensiones clave.
**Las celdas marcadas [!] son donde uno diverge de los demas: cada una es un hallazgo de la seccion 3.**

| Dimension | agents | credentials | scheduled-tasks | triggers | recipes |
|---|---|---|---|---|---|
| Metodo repo "crear" | `create` [!] | `create` [!] | `createTask` | `createTrigger` | `createRecipe` |
| Metodo repo "leer uno del owner" | `getByIdForOwner` | (n/a) | `getTaskForOwner` | `getForOwner` [!] | `getRecipeForOwner` |
| Metodo repo "borrar del owner" | `removeForOwner` [!] | `deleteForOwner` | `deleteTaskForOwner` | `deleteForOwner` | `deleteRecipeForOwner` |
| Superficie del repo | owner-scoped **+ metodos globales sin owner** [!] | solo owner-scoped | solo owner-scoped | solo owner-scoped (+dispatch) | solo owner-scoped |
| Orden de args repo owner-scoped | `(id, ownerId)` | **`(ownerId, id)` invertido** [!] | `(id, ownerId)` | `(id, ownerId)` | `(id, ownerId)` |
| Helper de fecha defensivo (`toIso`) | **NO** (naive, puede lanzar) [!] | **NO** (naive) [!] | SI | SI | SI |
| Validacion Zod del `:id` en la ruta | **NO** [!] | SI | SI | SI | SI |
| Inyeccion de repos en la ruta (test seam) | solo `verifier` [!] | solo `verifier` [!] | repos completos (`Pick<>`) | repos completos | repos completos |
| Verbo de edicion | **PUT** (reemplazo) [!] | (sin edicion) | PATCH (merge) | PATCH (merge) | PATCH (merge) |
| Gate por tier | ninguno (free) | ninguno (free) | `!== 'autonomous'` x1 | `!== 'autonomous'` x1 | `!== 'autonomous'` x2 |
| Shape de respuesta CRUD | `{ agent(s) }` | `{ credential(s) }` | `{ task(s) }` | `{ trigger(s) }` | `{ recipe(s) }` |
| Dialogo de borrado (consola) | copia ~identica | copia ~identica | copia ~identica | copia ~identica | copia ~identica |
| Traductor de error backend (consola) | copia | copia (parcial) [!] | copia | copia | copia |
| Origen de los tipos en la consola | redefinido | redefinido | redefinido | redefinido | redefinido |

**Lectura del mapa.** Hay dos patrones claros en las divergencias:

1. **`agents` es el outlier sistematico.** Es el recurso mas viejo (migracion V001) y quedo "congelado"
   en las convenciones de su epoca: es el UNICO sin validacion Zod del `:id`, el UNICO con `PUT` en vez
   de `PATCH`, el UNICO con `removeForOwner` (los demas dicen `delete...`), el UNICO cuyo repo conserva
   metodos globales sin owner, y (junto con `credentials`) el UNICO sin el helper `toIso` defensivo y
   sin inyeccion de repos. Nadie "backfilleo" `agents` cuando los recursos nuevos definieron el patron
   mejor. **-> H-02, H-03, H-05.**

2. **Lo replicado tiende a divergir.** El gate por tier, los dialogos de borrado, los traductores de
   error, la guarda de admin (`requireAdmin`, definida 3 veces) y el schema del agente (forkeado en
   `admin-agents`) se copiaron; varias copias ya se apartaron de las demas (el traductor de
   `credentials` cubre menos casos, un dialogo perdio un comentario, el schema de admin no reserva el
   prefijo `platform_`). **-> H-04, H-07, H-10.**

3. **`credentials` invierte el orden de argumentos** de sus metodos owner-scoped (`(ownerId, id)` vs el
   `(id, ownerId)` de todos los demas): un footgun silencioso porque ambos son uuid string y un swap no
   da error de tipo. **-> H-06.**

Las celdas que NO estan marcadas confirman salud real: el shape de respuesta `{ recurso }` es uniforme
en los 5; el aislamiento por owner en el `where` esta presente en TODOS los repos (es una divergencia de
NOMBRE, no de comportamiento de seguridad). Eso importa: la inconsistencia es de forma, no de fondo.

---

## 3. Hallazgos por tema

Formato de cada hallazgo: **Severidad · Categoria** (letra del checklist) · **Ubicacion** · **Evidencia**
· **Impacto** (costo concreto de mantenibilidad) · **Recomendacion** (que consolidar, sin hacerlo aqui).

---

### H-01 -- Los contratos se redefinen en cada frontera (backend / worker / consola) y pueden diverger en silencio

**Severidad: ALTA · Categoria: F (tipado/contratos), H (acoplamiento)**

**Ubicacion (patron en varias fronteras):**
- Consola redefine cada tipo en vez de importarlo: `apps/console/src/lib/agents.ts:1-11`
  (`ProviderId`, `StoredTool`, `AgentConfig`), `apps/console/src/lib/recipes.ts:12-45`
  (`Recipe`, `RecipeStep`), `apps/console/src/lib/scheduled-tasks.ts:11-39`
  (`ScheduledTask`, `ScheduledTaskPayload`). La consola NO depende de `@ledesma-platform/shared`.
- Esquemas de validacion espejo con LIMITES duplicados como literales: `apps/console/src/lib/recipes.ts:88-90`
  (`RECIPE_NAME_MAX = 200`, `RECIPE_STEP_MAX = 10_000`) vs `apps/backend/src/routes/recipes.ts:16-19`
  (`MAX_NAME_CHARS = 200`, `MAX_STEP_CHARS = 10_000`); `apps/console/src/lib/agent-schema.ts:4-22`
  ("Espejo del AgentInputSchema del backend") vs `apps/backend/src/routes/agents.ts:45-55`.
- El shape del payload de job SIMPLE definido en 3 sitios sin compartir: `apps/backend/src/routes/scheduled-tasks.ts:19-25`,
  el body de `/v1/run/:agentId`, y `apps/worker/src/execution.ts:125-131`.
- `ProviderId` (`'anthropic' | 'openai' | 'openai-compatible'`) declarado al menos 4 veces:
  `packages/shared/src/provider/types.ts`, el enum de `AgentInputSchema` (backend), `agents.ts:1` y
  `agent-schema.ts:7` (consola).

**Evidencia (divergencia YA presente, latente):** el worker valida `content: z.string()` SIN `.min(1)`
(`execution.ts:127`), mientras la ruta que produce esos payloads exige `content: z.string().min(1)`
(`scheduled-tasks.ts:21`). Es decir: el worker ACEPTA un mensaje de contenido vacio que la API RECHAZA.
Hoy no es alcanzable por un usuario (todo pasa por la ruta), pero es exactamente la clase de divergencia
que este patron produce -- dos definiciones del mismo contrato que ya no coinciden.

**Impacto:** cada cambio de contrato (agregar un proveedor, subir un limite, agregar un campo al
payload) obliga a tocar N copias no vinculadas por el compilador. Un olvido no da error de tipo: da un
cliente que valida contra una regla vieja, o un worker que acepta lo que la API prohibe. Esto ralentiza
DIRECTAMENTE las features que vienen (dashboard consume mas shapes del backend; monetizacion agrega
tiers y limites), y es la deuda mas propensa a un bug silencioso de las que hay en el repo.

**Recomendacion:** single-source de lo mas volatil en `packages/shared`: el union `ProviderId`, los
limites del payload y el shape del job simple (un tipo + un validador puro, como ya se hizo bien con
`recipe-payload.ts`). La consola puede seguir con su propio Zod para UX pero importando los TIPOS y las
CONSTANTES de limite en vez de reescribirlos. No hace falta un refactor grande: empezar por `ProviderId`
y el contrato de payload cubre el 80% del riesgo.

**Relacionado (BAJA, misma familia):** `packages/shared/src/index.ts:11` exporta `FakeProvider` (un
helper de TEST, de `./testing/`) en el barrel PUBLICO del paquete de produccion. Filtra una utilidad de
test a la API compartida; deberia vivir en un subpath `@ledesma-platform/shared/testing`, no en el
index.

---

### H-02 -- `AgentRepository` mantiene una superficie dual (owner-scoped + metodos globales sin owner) que invita a un bypass de tenancy por descuido

**Severidad: MEDIA · Categoria: A (divergencia), H (abstraccion filtrada), E (resto historico)**

**Ubicacion:** `apps/backend/src/agents/agent-repository.ts` -- metodos GLOBALES sin filtro de owner:
`list()` (51), `getById()` (60), `update()` (92), `remove()` (114); conviven con los owner-scoped
`listByOwner()` (121), `getByIdForOwner()` (130), `updateForOwner()` (140), `removeForOwner()` (175).
Los repositorios nuevos (`provider-credential-repository.ts`, `scheduled-tasks-repository.ts`,
`triggers-repository.ts`, `recipes-repository.ts`) exponen SOLO metodos owner-scoped.

**Evidencia:** los globales se usan hoy en contextos legitimos (`admin-agents.ts:43-81` bajo gate de
admin; `run-agent-by-id.ts:182` y `session-tokens.ts:33` que resuelven el agente sin usuario). Pero la
firma `getById(id)` esta a un autocompletado de distancia de `getByIdForOwner(id, ownerId)`, y llamarla
por error en una ruta de usuario devuelve el agente de CUALQUIER owner sin ningun error de tipo ni de
lint.

**Impacto:** es la unica capa de datos del repo donde la estructura NO previene el error de tenancy que
los demas repos previenen por diseno. Un dev que extienda `agents` (p.ej. una nueva vista) puede
introducir un leak cross-tenant sin que nada lo frene. Es fragilidad latente, no un bug actual, pero es
justo el tipo de trampa que cuesta un incidente en 6 meses.

**Recomendacion:** renombrar los globales para que su falta de scope sea EXPLICITA en el call site
(`getByIdUnscoped`, `getForDispatch`) o segregarlos detras de una interfaz aparte
(`AgentAdminRepository` / `AgentDispatchReader`) que las rutas de usuario no reciban. Alinear el naming
con la convencion owner-only del resto.

---

### H-03 -- El helper de fecha defensivo (`toIso` / `EPOCH_ISO`) esta copiado identico en 4 repos y AUSENTE en 2 (divergencia de robustez)

**Severidad: MEDIA · Categoria: A (duplicacion que divergio), D (logica critica sin abstraer)**

**Ubicacion:**
- Presente, copiado casi verbatim: `scheduled-tasks-repository.ts:72-80`, `triggers-repository.ts:102-110`,
  `recipes-repository.ts:79-87`, `run-repository.ts:48-71` (este ultimo ademas duplica `toCount`).
- Ausente (usan `new Date(row.created_at).toISOString()` naive): `agent-repository.ts:42-43`,
  `provider-credential-repository.ts:62-63`.

**Evidencia:** `toIso` existe precisamente para NO lanzar `RangeError: Invalid time value` ante un
timestamp null o no parseable (ver el comentario en `run-repository.ts:62-66`), degradando a `null`/epoch
en vez de tumbar el endpoint con un 500. Los repos que lo tienen estan blindados; `agents` y
`credentials`, no: una fila con un `created_at` corrupto o incompleto (posible dado que las migraciones
se aplican a mano, ver auditoria #8) haria que `GET /v1/agents` responda 500 en vez de degradar.

**Impacto:** doble costo. (1) Divergencia de robustez: dos recursos carecen de una defensa que los otros
tres tienen. (2) Divergencia de mantenimiento: el helper esta copiado 4 veces; una mejora o correccion a
uno (p.ej. manejar un formato de fecha nuevo) no se propaga a los otros. Es el ejemplo canonico de "una
copia se actualizo y las otras no".

**Recomendacion:** extraer `toIso`, `EPOCH_ISO` y `toCount` a un util compartido (p.ej.
`apps/backend/src/db/row-mappers.ts`) y adoptarlo en los 6 repos. Cierra la divergencia de robustez y
elimina 4 copias de una.

---

### H-04 -- El gate por tier (`tier !== 'autonomous'`) esta hand-codeado en 5 sitios con mensajes divergentes; el tier `'pro'` no desbloquea nada

**Severidad: MEDIA · Categoria: A (duplicacion de politica), E (feature a medio construir)**

**Ubicacion:** el mismo bloque `getProfileTier -> if (tier !== 'autonomous') throw AppError('FORBIDDEN',
403, ...)` en: `scheduled-tasks.ts:100-103`, `recipes.ts:129-132`, `recipes.ts:251-253`,
`triggers.ts:130-132`, y de nuevo en el worker `apps/worker/src/execution.ts:246-247`. Cada copia lleva
un mensaje 403 distinto ("Scheduling requires...", "Recipes require...", "Triggers require...").

**Evidencia:** `ProfileTier = 'free' | 'pro' | 'autonomous'` (`registration/types.ts:16`), pero TODO gate
es binario `!== 'autonomous'`. Un usuario `'pro'` queda bloqueado exactamente igual que uno `'free'`:
hoy `'pro'` no desbloquea ninguna feature (el propio comentario del tipo lo admite, `types.ts:12-14`).

**Impacto:** (1) La politica de entitlement esta encodeada como un literal repetido en 5 lugares (4
rutas + worker). Si el modelo cambia -- y con monetizacion cambiara: p.ej. `'pro'` habilita
scheduled-tasks pero no recipes -- hay que editar los 5 en lockstep; olvidar uno da un usuario que puede
crear un recurso pero cuyo worker luego lo rechaza (o viceversa). (2) `'pro'` es un valor de enum
"muerto": un mantenedor que vea 3 tiers asumira que los 3 hacen algo. Es una trampa de comprension.

**Recomendacion:** un predicado/helper unico (`assertAutonomousTier(tier)` o
`requireTier(tier, 'autonomous', mensaje)`) que centralice la politica y el 403. Documentar
explicitamente que `'pro'` hoy es equivalente a `'free'`, o removerlo del union hasta que signifique
algo. La RE-verificacion del worker (defensa en profundidad) es CORRECTA y debe quedar: lo que se
consolida es el literal de la politica, no las dos capas.

---

### H-05 -- El andamiaje de ruta CRUD esta duplicado ~5x y `agents` quedo con validacion/seam/verbo divergentes

**Severidad: MEDIA · Categoria: A (duplicacion), B (inconsistencia entre modulos)**

**Ubicacion y sub-divergencias:**

- **(a) Validacion del `:id`.** `agents.ts` NO valida el parametro `:id` con Zod: usa `request.params.id`
  crudo en 75, 113, 121, 130, 150. Los demas si (`recipes.ts:164`, `scheduled-tasks.ts:144`,
  `triggers.ts:199`, `credentials.ts:72` via `*IdParamSchema.safeParse`). Como `agents.id` es columna
  `uuid` (`migrations/V001__agents.sql:3`), `GET /v1/agents/no-es-uuid` llega a `where id = 'no-es-uuid'`
  contra una columna uuid -> Postgres lanza `invalid input syntax for type uuid` -> **500 INTERNAL_ERROR**,
  mientras `GET /v1/recipes/no-es-uuid` devuelve un **400 VALIDATION_ERROR** limpio. Comportamiento de
  error observable y divergente para el mismo tipo de input malo.
- **(b) Seam de test (inyeccion de repos).** `agents.ts:61` y `credentials.ts:34` solo permiten inyectar
  `{ verifier }` (los repos se instancian inline con `new`); `scheduled-tasks.ts:68-79`, `recipes.ts:90-107`
  y `triggers.ts` inyectan los repos completos como `Pick<...>`. Son DOS filosofias de testeo conviviendo:
  para probar `agents` se mockea a nivel `getSql`; para `recipes` se inyecta un repo fake.
- **(c) Verbo de edicion.** `agents` usa `PUT` (reemplazo total, `agents.ts:109`); `scheduled-tasks`,
  `recipes` y `triggers` usan `PATCH` con merge (leer actual + fusionar). `credentials` no tiene edicion.

**Evidencia:** el esqueleto de handler (`requireUser` -> `safeParse` -> chequeo de pertenencia -> llamada
al repo -> `404`/respuesta) se repite casi identico en las 5 rutas; las tres divergencias de arriba son
lo que quedo distinto porque `agents` no se re-alineo.

**Impacto:** (a) un cliente recibe 500 donde deberia recibir 400 para un id malformado en `agents`
(ruido en logs de error, y un cliente que no puede distinguir "id invalido" de "el server se cayo"). (b)
quien escriba el recurso 6 no sabe que patron de test seguir (mira `agents` y hace fakes de sql; mira
`recipes` y inyecta repos). (c) el dev debe recordar por recurso si edita con PUT o PATCH.

**Recomendacion:** backfillear a `agents` un `AgentIdParamSchema` (arreglo de 3 lineas que uniforma el
400). Estandarizar el seam de inyeccion de repos hacia el patron nuevo (`Pick<>` deps) para que todos los
recursos se testeen igual. Considerar un pequeno helper de ruta CRUD (factory que arme el skeleton comun);
no es imprescindible, pero un `IdParamSchema` compartido y un patron unico de merge PATCH ya bajan la
friccion.

---

### H-06 -- Cinco convenciones de nombres distintas para el MISMO CRUD entre repositorios

**Severidad: MEDIA · Categoria: G (consistencia de convenciones)**

**Ubicacion (matriz de nombres):**

| Operacion | agents | credentials | scheduled-tasks | triggers | recipes | jobs |
|---|---|---|---|---|---|---|
| crear | `create` | `create` | `createTask` | `createTrigger` | `createRecipe` | `createJob` |
| listar del owner | `listByOwner` | `listByOwner` | `listTasksByOwner` | `listByOwner` | `listRecipesByOwner` | `listByOwner` |
| leer uno del owner | `getByIdForOwner` | -- | `getTaskForOwner` | `getForOwner` | `getRecipeForOwner` | -- |
| editar del owner | `updateForOwner` | -- | `updateTaskForOwner` | `updateForOwner` | `updateRecipeForOwner` | -- |
| borrar del owner | `removeForOwner` | `deleteForOwner` | `deleteTaskForOwner` | `deleteForOwner` | `deleteRecipeForOwner` | -- |

(`agent-repository.ts`, `provider-credential-repository.ts`, `scheduled-tasks-repository.ts`,
`triggers-repository.ts`, `recipes-repository.ts`, `packages/shared/src/jobs/jobs-repository.ts`.)

**Evidencia:** para "crear" hay 5 nombres (`create`, `createTask`, `createTrigger`, `createRecipe`,
`createJob`); para "borrar del owner" hay 3 verbos (`remove` vs `delete` vs `deleteX`); "leer uno"
alterna `getByIdForOwner` / `getForOwner` / `getXForOwner`. Cada repo invento su convencion.

**Sub-hallazgo mas grave -- orden de argumentos INVERTIDO (footgun con potencial de bug):**
`ProviderCredentialRepository` ordena sus metodos owner-scoped como `(ownerId, id)`:
`deleteForOwner(ownerId, credentialId)` (`provider-credential-repository.ts:127`),
`existsForOwner(ownerId, credentialId)` (142), `getDecryptedKeyForOwner(ownerId, credentialId, ...)`
(105). TODOS los demas repos usan `(id, ownerId)`: `AgentRepository.getByIdForOwner(id, ownerId)`,
`TriggersRepository.deleteForOwner(id, ownerId)` (llamado asi en `triggers.ts:257`),
`ScheduledTaskRepository.getTaskForOwner(id, ownerId)`, `RecipeRepository.deleteRecipeForOwner(id,
ownerId)`. Los llamadores de hoy pasan el orden correcto para cada repo, pero como AMBOS argumentos son
`string` (uuid), invertirlos NO da error de tipo ni de lint: la query simplemente busca una fila cuyo
`id` == ownerId y `owner_id` == id -> no encuentra nada y devuelve `false`/`null` en silencio. Un dev que
copie el patron de `agents` (`(id, ownerId)`) hacia una llamada nueva a `credentials` introduce un bug
silencioso de "el borrado/lookup nunca funciona" sin ninguna senal del compilador.

**Impacto:** el naming en si es friccion (el autocompletado enganya; hay que recordar el dialecto de cada
repo). Pero el orden de argumentos invertido de `credentials` es una TRAMPA real: es el unico caso de la
capa de repos donde una llamada incorrecta compila y falla en silencio en runtime. Es el sintoma mas
claro del "escrito por varias personas distintas" (que efectivamente paso: Claude Code en PRs distintos).

**Recomendacion:** adoptar UN verbo por operacion en toda la capa de repos (sugerido, el mas comun ya en
uso: `create` / `listByOwner` / `getForOwner` / `updateForOwner` / `deleteForOwner`) y UN orden de
argumentos unico (`(id, ownerId)`, el mayoritario) -- alinear `credentials` cierra el footgun. Es mecanico
y de bajo riesgo (typecheck respalda el rename; el cambio de orden hay que hacerlo con cuidado y su test).
Alto retorno de legibilidad y seguridad por poco costo.

---

### H-07 -- Dialogos de la consola: el `ConfirmDialog` base y el traductor de error estan copiados por recurso y ya divergen

**Severidad: MEDIA · Categoria: A (duplicacion que divergio)**

**Ubicacion:**
- Cinco `Delete*Dialog.tsx` casi verbatim (~85 lineas c/u): `agents/DeleteAgentDialog.tsx`,
  `credentials/DeleteCredentialDialog.tsx`, `scheduled-tasks/DeleteScheduledTaskDialog.tsx`,
  `triggers/DeleteTriggerDialog.tsx`, `recipes/DeleteRecipeDialog.tsx`. Los comentarios lo admiten:
  "Espeja DeleteScheduledTaskDialog" (`DeleteRecipeDialog.tsx:6`), "Espeja DeleteCredentialDialog"
  (`DeleteScheduledTaskDialog.tsx:6`).
- Cada `*FormDialog.tsx` reimplementa un traductor `backendMessage(error)` status->mensaje:
  `triggers/TriggerFormDialog.tsx:20`, `recipes/RecipeFormDialog.tsx:28`,
  `scheduled-tasks/ScheduledTaskFormDialog.tsx:19`, `credentials/CredentialFormDialog.tsx:14`.

**Evidencia de divergencia ya iniciada:** (1) `DeleteTriggerDialog.tsx:25-29` perdio el comentario
explicativo del patron `onCancelRef` que si esta en `DeleteRecipeDialog.tsx:25-30` y
`DeleteScheduledTaskDialog.tsx:25-27`. (2) El traductor de `CredentialFormDialog.tsx:14-17` solo maneja
401 y 400, mientras los otros manejan ademas 403 y 404 -- las copias ya cubren conjuntos distintos de
codigos.

**Impacto:** la logica de accesibilidad del dialogo (focus al abrir, cierre con Escape, ref al ultimo
`onCancel` para no re-adjuntar el listener) es sutil y esta replicada 5 veces: un arreglo o mejora en una
copia (p.ej. un focus-trap ciclico, o deshabilitar el backdrop mientras `busy`) no llega a las otras 4 ->
UX inconsistente y bugs de a11y latentes. Igual con el mapeo de errores: agregar el manejo de un status
nuevo (p.ej. 429) exige tocar 5 copias; una se olvidara.

**Recomendacion:** un `<ConfirmDialog>` base parametrizado por titulo/cuerpo/label (mata ~340 lineas
duplicadas y unifica la a11y en un solo lugar) y un helper compartido `backendMessage(error, { recurso })`
que centralice el mapeo status->mensaje. La consola ya tiene primitivas compartidas (`ui/Field`,
`ui/button`): el dialogo base es la pieza que falta.

---

### H-08 -- Taxonomia de errores: dos codigos para el mismo 401 y codigos de wire fuera del tipo `ErrorCode`

**Severidad: MEDIA · Categoria: F (tipos que mienten), C (manejo de errores desparejo)**

**Ubicacion:**
- `AUTHENTICATION` vs `UNAUTHORIZED` para el mismo fallo de auth 401: `auth/session-token.ts:40` lanza
  `AppError('AUTHENTICATION', 401, ...)`, mientras `auth/require-user.ts:9,13,18` y
  `auth/require-admin.ts:13` lanzan `AppError('UNAUTHORIZED', 401, ...)`.
- `errors/error-handler.ts:42-45` emite los codigos `'PAYLOAD_TOO_LARGE'`, `'UNSUPPORTED_MEDIA_TYPE'` y
  `'BAD_REQUEST'` como strings literales que NO estan en el union `ErrorCode` (`errors/app-error.ts:1-8`).
- Existe ademas una taxonomia PARALELA para errores de proveedor: `providers/errors.ts` define
  `ProviderErrorCode` (AUTHENTICATION, PROVIDER_UNAVAILABLE, TIMEOUT, RATE_LIMIT, ...), independiente de
  `ErrorCode`.

**Evidencia:** un cliente que haga `switch (error.code)` sobre respuestas de auth recibe `AUTHENTICATION`
en un endpoint y `UNAUTHORIZED` en otro para exactamente el mismo caso (token invalido/ausente, 401). Y
el tipo `ErrorCode` (7 valores) NO describe el contrato de wire real: por el error-handler salen al menos
3 codigos mas que el tipo no lista, asi que es imposible hacer un `switch` exhaustivo tipado sobre los
codigos que el backend realmente manda.

**Impacto:** el contrato de errores es la superficie que mas consume el frontend (y consumira mas el
dashboard). Que el tipo mienta sobre los codigos posibles, y que el mismo caso tenga dos codigos, obliga
a manejar errores "a la defensiva" (comparar mensajes, listar codigos a mano) en vez de confiar en el
tipo. Es friccion recurrente y una fuente de sutiles inconsistencias de UX.

**Recomendacion:** unificar el codigo de fallo de auth (elegir `UNAUTHORIZED`, que es el mayoritario -- 7
usos vs 1). Incluir en `ErrorCode` (o en un union de wire dedicado) los codigos que el handler emite, de
modo que el tipo sea la verdad del contrato. Documentar en una linea la frontera entre `ErrorCode` (HTTP
del backend) y `ProviderErrorCode` (fallos del modelo) para que quede claro que son dos ejes, no un
descuido.

---

### H-09 -- Naming y granularidad de los archivos de test inconsistentes entre recursos

**Severidad: BAJA · Categoria: I (tests como indicador), G (convenciones)**

**Ubicacion:** `apps/backend/test/` -- coexisten `agent-route.test.ts` (singular) y `agents-route.test.ts`
(plural); los tests de la ruta de agentes estan fragmentados en 6 archivos
(`agent-route.test.ts`, `agents-route.test.ts`, `agent-route-cors.test.ts`, `agent-route-limits.test.ts`,
`agents-test-tool-route.test.ts`, `agents-usage-route.test.ts`), mientras `credentials-route.test.ts` y
`scheduled-tasks-route.test.ts` son un archivo cada uno.

**Evidencia:** los tests de repositorio SI siguen una convencion uniforme (`*-repository.test.ts`,
verificado en los 6). La divergencia esta solo en los tests de RUTA: singular/plural mezclados y
granularidad dispar (uno-por-operacion vs uno-por-recurso).

**Impacto:** menor -- friccion al buscar "donde esta el test de X" y al decidir en que archivo agregar un
caso nuevo. No afecta el comportamiento ni la calidad de las aserciones (que son buenas, ver seccion 4).

**Recomendacion:** estandarizar el naming de tests de ruta a `<recurso>-route.test.ts` (plural,
consistente con `*-repository.test.ts`) y consolidar/renombrar los de `agents`. Puramente organizativo.

---

### H-10 -- Las rutas admin duplican la guarda `requireAdmin` (3 copias) y forkean el schema del agente en vez de reusar la fuente unica

**Severidad: MEDIA · Categoria: A (duplicacion que divergio), B (inconsistencia), F (validacion mas debil)**

**Ubicacion:**
- `requireAdmin` definido IDENTICO 3 veces: el centralizado `apps/backend/src/auth/require-admin.ts:10`
  (cuyo propio doc dice "Se centraliza aqui ... sin re-implementarlo en cada ruta") + copias locales en
  `apps/backend/src/routes/admin-agents.ts:30-35` y `apps/backend/src/routes/registration.ts:32`. Solo
  `retention.ts:4` usa el compartido.
- `admin-agents.ts:8-13` redefine su propio `StoredToolSchema` y `admin-agents.ts:17-28` su propio
  `AgentInputSchema`, en vez de importar los que `agents.ts:16` y `agents.ts:45` **exportan
  explicitamente como fuente unica** (el comentario de `agents.ts:13-15` dice literalmente: "Exportado ...
  para que el validador del agent-spec REUSE el mismo schema ... una unica fuente de verdad").

**Evidencia de divergencia real:** el `StoredToolSchema` de admin (`admin-agents.ts:9`) usa
`name: z.string().min(1)` SIN el `.refine()` que reserva el prefijo `platform_` que si tiene el publico
(`agents.ts:19-24`). Es decir: por el endpoint admin se puede crear una tool llamada `platform_x`
(reservada para las tools nativas de la plataforma) que el endpoint publico RECHAZA. La validacion del
mismo concepto es mas debil en la copia admin. Ademas el `AgentInputSchema` de admin agrega un campo
`ownerId` (`admin-agents.ts:27`) que el publico no tiene, y ambas rutas admin usan los metodos globales
sin owner del repo (`repo.list/getById/create/update/remove`, ver H-02) y no validan el `:id` como uuid
(ver H-05a).

**Impacto:** es el ejemplo mas nitido de "la duplicacion causo divergencia" del repo, porque la fuente
unica EXISTE y esta documentada como tal, pero dos rutas la ignoran. Si el mecanismo de auth admin cambia
(p.ej. comparacion en tiempo constante contra timing, u otro header) hay que tocar 3 copias de
`requireAdmin`; si una regla de tool nueva se agrega al schema publico, la ruta admin queda con la regla
vieja (ya pasa con `platform_`). Un mantenedor razonablemente asume que "el schema del agente" es uno solo.

**Recomendacion:** migrar `admin-agents.ts` y `registration.ts` al `requireAdmin` compartido de
`auth/require-admin.ts` (borrar las 2 copias locales), e importar `StoredToolSchema` / `AgentInputSchema`
desde `routes/agents.ts` (la fuente unica ya exportada) en `admin-agents.ts` en vez de redefinirlos. Es
bajo riesgo y termina una consolidacion que ya estaba a medio hacer.

---

## 4. Lo que SI esta bien estructurado (honesto)

No todo es deuda; buena parte del codebase es solida y merece decirse:

- **Typecheck estricto sin errores.** Con `tsc --noEmit` en todos los workspaces (tras construir
  `shared`), todo compila bajo `strict + noUnusedLocals + noUnusedParameters + noUncheckedIndexedAccess`
  (`tsconfig.base.json`). El linter corre limpio salvo **2 warnings benignos** (un export de contexto en
  `AuthProvider.tsx:11` y una memoizacion de `watch()` de react-hook-form en `AgentFormPage.tsx:77`,
  ambos falsos-positivos aceptables).
- **Cero `any`.** No hay un solo `: any` / `as any` / `<any>` en el codebase. Los `as unknown as` son
  solo **14 en codigo de produccion** (casi todos el cast necesario de `this.sql.json(...)`); los otros
  114 estan en tests (mocks parciales, uso legitimo).
- **Cero codigo muerto detectable.** Barrido de exports: 0 exports sin usar en backend/worker/shared. Sin
  TODO/FIXME/HACK reales (los "TODO" que aparecen son la palabra espanola). Sin `console.*` sueltos (los
  10 usos son fallbacks documentados o el logger propio del worker). `noUnusedLocals/Parameters` caza el
  resto en compilacion.
- **Manejo de errores central y consistente.** `AppError` con codigos + `error-handler.ts` unico; ~97
  construcciones de `AppError` en el backend siguen el mismo patron. El shape de error
  `{ error: { code, message, details? }, requestId }` es uniforme. (Los matices estan en H-08, pero el
  esqueleto es solido.)
- **Disciplina de "columnas explicitas" en TODOS los repos.** Nunca `select *` / `returning *`, con el
  razonamiento documentado (una migracion faltante falla ruidosamente en vez de devolver campos
  undefined). Es una decision de robustez consistente y bien justificada.
- **Aislamiento por owner uniforme en el fondo.** Pese al naming divergente (H-06), TODOS los repos
  ponen `owner_id` en el `where` de lectura/escritura por id. La inconsistencia es de forma, no de
  seguridad.
- **El acoplamiento worker<->backend esta LIMPIO y documentado.** El subpath curado
  `@ledesma-platform/backend/execution` (`apps/backend/src/execution/index.ts`) re-exporta un conjunto
  acotado (motor, `AgentRepository`, boveda, gate de tier) con una explicacion clara de POR QUE es un
  subpath y no `shared`. Es un ejemplo de acoplamiento gestionado bien, no filtrado.
- **El worker (`apps/worker/src/execution.ts`) es codigo de alta calidad.** Clasificacion de fallos con
  clases dedicadas (`PermanentExecutionError`, `RunTimeoutError`, `ShutdownAbortError`), decision de
  reintento/permanente/apagado explicita y documentada, notificacion best-effort envuelta en try/catch
  que nunca bloquea el cierre del job. La concurrencia (claim atomico `FOR UPDATE SKIP LOCKED`) y el
  deadline de pared estan claramente explicados.
- **La cripto esta ejemplarmente documentada.** `crypto/aes-gcm.ts`: formato del token especificado,
  error uniforme para no dar un oraculo, unica fuente de derivacion de clave. Codigo critico que un
  mantenedor puede tocar sin adivinar.
- **El discriminador de payload de receta esta bien modelado.** `packages/shared/src/jobs/recipe-payload.ts`:
  `kind: 'recipe'` con mutua exclusividad, validador puro sin dependencias, snapshot autocontenido
  documentado. (El unico matiz: `isRecipeJobPayload` devuelve `boolean` y no un type-guard
  `value is RecipeJobPayload`, y `Job.payload` es `unknown` -- el "union discriminado" es una convencion
  de runtime, no de compilacion; aceptable para una columna jsonb, mencionado en H-01.)
- **Los clientes de la consola comparten un unico `apiFetch`/`ApiError`** (`lib/api.ts`) usado
  consistentemente, y la logica de formulario pura (`validate*Draft`, `to*ApiInput`, reordenamiento de
  pasos) esta bien factorizada y es testeable sin React.

---

## 5. Las 5 consolidaciones de mayor impacto (para priorizar el tratamiento)

Ordenadas por retorno (robustez + velocidad de desarrollo ganada) sobre costo. Como casi toda la deuda es
del mismo tipo, estas pocas acciones la cierran en gran parte.

1. **Single-source de los contratos volatiles en `shared` (H-01).** El de mayor impacto: mover `ProviderId`,
   los limites de payload/agente y el shape del job simple a `packages/shared`, y que consola/worker los
   importen. Elimina la clase entera de bug "una copia del contrato quedo vieja" y acelera cada feature que
   toca shapes del backend. *Costo: medio; retorno: el mas alto (previene bugs silenciosos).*

2. **Backfillear `agents` (y las rutas admin) a las convenciones nuevas (H-02, H-05, H-10, y el orden de
   args de H-06).** Agregar el `AgentIdParamSchema` (arregla el 500->400), segregar/renombrar los metodos
   globales del repo, uniformar el seam de inyeccion, alinear el orden de argumentos de `credentials` a
   `(id, ownerId)`, migrar las rutas admin al `requireAdmin` compartido e importar el schema unico del
   agente. Elimina a los dos outliers sistematicos (el recurso viejo `agents` y las rutas admin) del mapa
   de consistencia. *Costo: bajo; retorno: alto (cierra una trampa de tenancy, un footgun de argumentos y
   un error de contrato de wire).*

3. **Un `<ConfirmDialog>` base + `backendMessage` compartido en la consola (H-07).** Mata ~340 lineas
   duplicadas y unifica la accesibilidad y el mapeo de errores en un lugar. *Costo: bajo; retorno: alto
   (UX consistente, menos superficie de bug de a11y).*

4. **Centralizar el gate por tier y el helper de fecha (H-04, H-03).** Un `requireTier`/`assertAutonomousTier`
   unico (politica de entitlement en un solo sitio, clave para monetizacion) y un util `toIso/toCount`
   compartido adoptado en los 6 repos. *Costo: bajo; retorno: medio-alto (prepara el terreno para
   monetizacion y cierra la divergencia de robustez).*

5. **Unificar la taxonomia de errores y el naming de repos/tests (H-08, H-06, H-09).** Elegir un codigo de
   auth, hacer que `ErrorCode` refleje el wire real, y estandarizar los verbos de repo y el naming de
   tests. *Costo: bajo (mecanico, typecheck respalda); retorno: medio (legibilidad y un contrato de
   errores confiable para el dashboard).*

---

## 6. Cobertura y alcance

**Analizado (lectura comparativa completa):**
- Los 6 repositorios de acceso a datos (`agents`, `credentials`, `scheduled-tasks`, `triggers`,
  `recipes`, `jobs`) + `run-repository`, `registration-repository`, comparados dimension por dimension.
- Las 5 rutas CRUD (`agents`, `credentials`, `scheduled-tasks`, `triggers`, `recipes`) + `admin-agents`,
  comparadas (validacion, seam de test, verbo, gate, shape).
- La capa de datos de la consola (`lib/api`, `agents`, `recipes`, `scheduled-tasks`, `credentials`) y los
  dialogos/formularios por recurso.
- Los contratos compartidos (`packages/shared`: `agent-spec`, `recipe-payload`, `jobs/types`, provider
  types) y el acoplamiento `worker<->backend` (subpath curado) y `console` (tipos redefinidos).
- Manejo de errores (`app-error`, `error-handler`, `providers/errors`, auth), gate por tier, worker
  (`execution.ts`), cripto (`aes-gcm.ts`).
- Baseline automatico: `eslint .` (limpio salvo 2 warnings) y `tsc --noEmit` por workspace (limpio tras
  construir `shared`).
- Barridos read-only: `any`, `as unknown as`, `catch` vacios, TODO/FIXME, `console.*`, promesas sueltas,
  exports no usados.

**Fuera de alcance (otras auditorias):**
- Cobertura de tests / gaps de casos: **auditoria #10**. Aqui los tests se miraron solo como indicador de
  CALIDAD del codigo (H-09 y la nota de salud), no de cobertura.
- Rendimiento / N+1 / indices: **auditoria #11-12** (Bloque C sigue).
- Bugs explotables, RLS, integridad de datos: auditorias #1-#8 (no se re-auditan; H-02 se menciona solo
  desde el angulo de fragilidad de mantenimiento, no de seguridad).
- La landing (`components/landing/*`) y el widget embebido se revisaron por encima: son superficie de
  producto con menos recursos analogos que comparar; no se hallo deuda estructural relevante alli.

**Metodo de verificacion:** el analisis combino lectura comparativa directa (el autor abrio y confirmo
cada `path:linea` citado) con un barrido paralelo de agentes read-only por tema (rutas, repositorios,
capa de datos de la consola) que corroboro los hallazgos de forma independiente; las divergencias nuevas
que ese barrido sugirio (orden de args invertido en `credentials`, fork de schema en `admin-agents`,
triplicacion de `requireAdmin`) se re-verificaron a mano antes de incluirlas. Read-only estricto: no se
modifico codigo, tests, configuracion ni migraciones, y no se consulto produccion.

---

*Fin del informe de la auditoria #9. Alimenta el backlog consolidado; ningun hallazgo se corrige aqui.*
