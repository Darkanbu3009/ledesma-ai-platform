# Auditoria 12 - Frontend: la consola y el widget embebible

**Bloque D (cierra el ciclo de 12 auditorias). Alcance: solo lectura. No se modifico codigo.**

- **Fecha:** 2026-07-03
- **Rama:** `audit/12-frontend`
- **Superficies auditadas:** consola React (`apps/console`, la app de `app.ledesma-ai-labs.com`) y el widget embebible (`packages/widget` + `packages/widget-react`).
- **Metodo:** lectura de las 17 paginas (`src/pages/*`), los ~45 componentes (`src/components/**`), el sistema de diseno (`tailwind.config.js`, `index.css`, `components/ui/*`), la capa de datos (`lib/*`) y el widget completo. Recorrido en paralelo de pantallas analogas para detectar inconsistencias. Calculo de contraste WCAG sobre los tokens reales. Builds locales de consola y widget (seguros, read-only) para confirmar compilacion y medir tamanos. Cada hallazgo esta verificado en `path:linea`.

---

## 1. Resumen ejecutivo

**Veredicto: solido y coherente en lo visual y en el manejo de estados, con barreras de accesibilidad reales y deuda de UX que conviene resolver ANTES de escalar a las fases UI intensivas (dashboard, perfiles, onboarding).**

La consola no es un conjunto de piezas sueltas: las seis pantallas de lista comparten un mismo patron de carga, error y vacio, el borrado esta universalmente protegido por dialogo de confirmacion, y el sistema editorial (cream/brasa/ink) se aplica con disciplina en la capa rediseniada. El widget embebible es, tecnicamente, la pieza mejor construida del frontend: aisla con Shadow DOM, renderiza el output del modelo de forma segura (nunca `innerHTML`), maneja el session token sin exponerlo al DOM, cumple la divulgacion de IA del EU AI Act y degrada con gracia ante fallos. Pesa 4.5 kB gzip.

El problema no es la apariencia sino **la accesibilidad de los formularios** (los inputs de gestion no tienen su etiqueta asociada programaticamente, una barrera dura para lectores de pantalla) y una **capa de primitivas compartidas inexistente**: cada pantalla y cada dialogo reimplementa por copia su estado de carga/error/vacio y su gestion de foco, lo que ya produjo divergencias medibles (un acento que aparece en 2 pantallas y falta en 4, un dialogo con trampa de foco y 13 sin ella, tres dialogos sin ninguna gestion de teclado). Construir tres fases UI-intensivas sobre esa base multiplicaria la divergencia.

### Hallazgos por severidad

| Severidad | Cantidad | Naturaleza |
|-----------|----------|-----------|
| **ALTA** | 2 | (1) Formularios de gestion sin etiquetas asociadas: barrera dura para lectores de pantalla en TODO el CRUD. (2) El widget depende de un `<style>` inline en el shadow root: una CSP estricta del anfitrion (`style-src` sin `'unsafe-inline'`) lo bloquea y rompe el render en sitios de terceros. |
| **MEDIA** | ~20 | Trampa de foco ausente en 13/14 dialogos; 3 dialogos sin gestion de teclado; contraste bajo AA del acento brasa y del texto muted-soft; foco no visible en controles editoriales; chat del Playground (y del widget) sin nombre accesible ni live region; errores de validacion/envio no anunciados; JWT en localStorage; drawer movil no accesible; credencial estatica del widget en atributo DOM; dialecto mixto (voseo/tuteo); error crudo del backend en ingles; inconsistencias de copy; fallo silencioso al rotar secreto. |
| **BAJA** | ~25 | Pulido: acentos, verbos de accion divergentes, `aria-pressed` en toggles, tokens legacy en 3 dialogos, sin CSP en el hosting, empty state de Actividad divergente, duraciones de toast, strings del widget sin i18n, `title` del widget colisiona con el atributo global, etc. |

**Nota sobre el widget:** en **seguridad** es solido (sin XSS, token fuera del DOM en el modo recomendado, divulgacion de IA que cumple, fallos contenidos). Su unico hallazgo ALTA es de **robustez**, no de seguridad: en un anfitrion con CSP estricta de estilos, el widget puede renderizar sin estilos y desacomodar el layout, en silencio. El resto de sus observaciones son de a11y (paralelas a las de la consola), i18n (strings hardcodeados) y guia de integracion (los modos de credencial estaticos dejan la credencial como atributo del DOM; el modo `token-url` la mantiene fuera).

---

## 2. Matriz de consistencia de pantallas (corazon del informe)

Seis pantallas de lista analogas. Las celdas divergentes son hallazgos.

| Pantalla | Loading | Error | Empty | a11y (avisos/roles) | Patron de borrado |
|----------|---------|-------|-------|---------------------|-------------------|
| **Agentes** `AgentsPage.tsx` | Skeleton 3x grid `h-[212px]` (solo `isLoading`) | Card "No pudimos cargar tus agentes" + "conexi**ó**n" (con acento) + Reintentar. Sin `aria-live`. | Editorial completo: hero + badge "EMPIEZA AQUI" + pill + link Configurador | Sin region de avisos (alta en otra pagina). Links de tarjeta con aria-label **nombrado** ("Editar {name}") | **N/A** — el borrado vive en la pagina de edicion |
| **Recetas** `RecipesPage.tsx` | Skeleton 3x `h-[112px]` (doble fase `me`→`list`) | Card + "conexi**o**n" (sin acento) + Reintentar. Sin `aria-live`. | Editorial + gate `RecipesLocked` por tier | Avisos en `aria-live=polite`. Toast 4500ms. aria-label de tarjeta **generico** ("Eliminar receta") | Dialogo `DeleteRecipeDialog` con busy/error |
| **Tareas** `ScheduledTasksPage.tsx` | Skeleton 3x `h-[104px]` (doble fase) | Card + "conexi**o**n" (sin acento) + Reintentar. Sin `aria-live`. | Editorial + gate `SchedulingLocked` | Avisos en `aria-live`. Toast 4000ms. aria-label **generico** | Dialogo `DeleteScheduledTaskDialog` (desc. legible) |
| **Triggers** `TriggersPage.tsx` | Skeleton 3x `h-[148px]` (doble fase) | Card + "conexi**o**n" (sin acento) + Reintentar. Sin `aria-live`. | Editorial + gate `TriggersLocked` | Avisos en `aria-live`. Toast 4000ms. aria-label **generico** | Dialogo `DeleteTriggerDialog` + confirma **rotacion** (`RotateTriggerDialog`) + `SecretRevealDialog` |
| **Credenciales** `CredentialsPage.tsx` | Skeleton 3x `h-[88px]` (solo `isLoading`) | Card + "conexi**ó**n" (con acento) + Reintentar. Sin `aria-live`. | Editorial | Avisos en `aria-live`. Toast 4000ms. aria-label **nombrado** ("Eliminar credencial {label}"). `notice` solo string de exito | Dialogo `DeleteCredentialDialog` |
| **Actividad** `ActivityPage.tsx` | Skeleton 3x `h-[104px]` + indicador "Actualizando" en refetch | Card + "conexi**o**n" (sin acento) + Reintentar. Sin `aria-live`. | **Divergente**: sin hero ni badge ni CTA (es solo lectura); se parece a los estados Locked | Chips de filtro con `aria-pressed`. **Sin** region `aria-live` ("Actualizando" no se anuncia) | **N/A** — historial de solo lectura |

### Lo que la matriz confirma que esta BIEN (patron uniforme)
- **Loading:** las seis usan skeleton de 3 tarjetas `animate-pulse` con la altura de su tarjeta real. Nadie usa spinner suelto ni deja la pantalla en blanco.
- **Error:** las seis comparten una card editorial ("No pudimos cargar tus X" + subtitulo + boton Reintentar con `RefreshCw` → `refetch()`). El retry siempre esta disponible.
- **Empty con CTA sin callejon:** aunque el boton "Agregar/Crear" del header solo se muestra cuando ya hay items (`hasX &&`), **ningun empty state queda sin salida**: cada uno trae su propio pill que dispara la misma alta. El primer item siempre es alcanzable.
- **Borrado protegido:** universalmente confirmado con dialogo (busy/error). No hay borrado directo sin confirmar en ninguna lista.
- **Gate por tier coherente:** Recetas/Tareas/Triggers muestran un estado Locked sobrio que espeja el gate del backend, sin paywalls agresivos.

### Celdas divergentes (hallazgos, detallados en la seccion 4)
1. **Copy de error:** "conexi**ó**n" con acento en Agentes/Credenciales vs "conexi**o**n" sin acento en Recetas/Tareas/Triggers/Actividad. *(MEDIA, i18n)*
2. **Verbo de accion:** Recetas dice "Nueva receta" en header/footer pero "Crear receta" en el empty; las otras cinco usan un verbo unico. *(MEDIA, consistencia)*
3. **aria-label de tarjeta:** nombrado (con el item) en Agentes/Credenciales, generico en Recetas/Tareas/Triggers. *(BAJA, a11y)*
4. **Empty de Actividad** no sigue el sistema editorial. *(BAJA, consistencia — justificado por ser read-only, documentar)*
5. **`aria-live` ausente** para el indicador "Actualizando" de Actividad, presente en el resto. *(BAJA, a11y)*
6. **Tipo de `notice`:** Credenciales usa `string|null` (solo exito), las hermanas usan `{kind:'ok'|'error'}`. *(BAJA, consistencia)*
7. **Duracion de toast:** 4500ms en Recetas vs 4000ms en el resto. *(BAJA)*
8. **Hover del CTA de Agentes** usa un hex suelto `#C8460F` en vez del token `brasa-hover`. *(BAJA)*

> **Lectura de conjunto:** el usuario percibe UN producto en el 90% de la experiencia. Las divergencias son gratuitas — sintoma de que cada pantalla copia y pega el bloque de estado en vez de consumir un componente compartido. Con un `ErrorState`/`EmptyState`/`Notice` unico, ninguna de estas ocho celdas podria divergir. (Conecta con la seccion 5, Preparacion.)

---

## 3. Auditoria del widget embebible (por su criticidad en sitios de terceros)

El widget es un custom element `<ledesma-agent>` (`packages/widget/src/element.ts`, 615 lineas) con un wrapper React opcional (`packages/widget-react`). Se inyecta en el sitio del cliente. **Build: `dist/ledesma-agent.js` = 14.0 kB / 4.5 kB gzip** — excelente para un embed de terceros.

### 3.1 Aislamiento (Shadow DOM) — SOLIDO
- `attachShadow({ mode: 'open' })` en el constructor (`element.ts:235`). Todos los estilos viven dentro del `<style>` del shadow root (`element.ts:12-190`), asi que **los estilos del anfitrion no penetran** y **el widget no contamina el anfitrion**. La unica superficie que atraviesa el boundary es intencional: las CSS custom properties `--la-*` (bg, text, accent, radius, height, font) que el integrador puede setear para tematizar.
- Dimensionamiento responsive correcto: `:host { display:block; width:100% }` y `.root { height: var(--la-height, 480px) }`. El widget ocupa el ancho de su contenedor y una altura configurable; no rompe el layout del anfitrion. Las burbujas usan `overflow-wrap:anywhere` y el composer limita el `textarea` con `max-height`.

### 3.2 Render seguro del output del modelo — SOLIDO (sin XSS)
- **Todo el texto dinamico entra por `textContent`, nunca por `innerHTML`.** El delta del asistente (`appendDelta`, `element.ts:573`), la burbuja del usuario (`element.ts:561`), los chips de tool (`element.ts:581`), la linea de uso, y las burbujas de error (`element.ts:599-606`) usan `document.createElement` + `textContent`/`className`. **Un modelo o backend comprometido no puede inyectar HTML ni script en la pagina anfitriona.**
- El unico uso de `innerHTML` es el montaje del shadow (`element.ts:360-362`), con contenido **estatico** (`styles` + estructura + mensajes de configuracion que nunca interpolan valores de atributos). Los mensajes de config son literales fijos (`element.ts:351-354`). Seguro.
- La divulgacion de IA se arma con `createElement` + `textContent`/`setAttribute` (`renderDisclosure`, `element.ts:316-334`), nunca con `innerHTML`, aunque el texto venga de un atributo del integrador.

### 3.3 Session token en contexto de terceros — SOLIDO en el modo recomendado
- **Precedencia de credencial:** `token-url` > `session-token` > `provider-key` (`element.ts:453-496`).
- **Modo de produccion (`token-url`):** el `TokenManager` (`token-manager.ts`) hace POST al endpoint del cliente, cachea `{ token, expiresAtMs }` en **una variable de closure** (`token-manager.ts:29`) y renueva antes de expirar (margen de 30s). **El token efimero NUNCA se escribe a un atributo, al DOM ni a localStorage** — se pasa directo como header `x-session-token` (`client.ts:27-28`). Reintenta UNA vez ante un error `AUTHENTICATION` con token fresco (`element.ts:474-495`). Esto es exactamente lo correcto para un sitio de terceros.
- **Guia de integracion correcta** (`apps/console/src/lib/snippets.ts`): el snippet `token-url` esta marcado "produccion"; `provider-key` esta marcado "solo pruebas/herramientas internas (la key queda en el HTML)"; y `mobileWebGuide`/`tokenServerSnippet` explican el patron de token efimero con la key del proveedor viviendo solo en el servidor del cliente. La documentacion empuja al modo seguro.
- **Observacion (MEDIA, guia no defecto):** los modos estaticos `session-token` y `provider-key` se leen como **atributos del DOM** (`observedAttributes`, `element.ts:201-212`). Un atributo es visible en devtools y legible por cualquier script del anfitrion. No es un bug — es el tradeoff de esos modos, y la doc los desalienta — pero conviene que la documentacion del widget advierta explicitamente que **fuera de `token-url`, la credencial queda expuesta en el DOM del anfitrion**, y que `session-token` estatico solo es apto si es de muy corta vida y de un solo agente.

### 3.4 Divulgacion de IA (EU AI Act Art. 50) — CUMPLE
- La divulgacion se renderiza **SIEMPRE** bajo el header, este o no configurado el chat (`render()` siempre llama `renderDisclosure`, `element.ts:380`; el div `.disclosure` va siempre en el markup, `element.ts:362`).
- **No se puede vaciar:** `resolveAiNotice` nunca devuelve cadena vacia; si el atributo `ai-notice` falta o esta en blanco, cae al default `"Estas interactuando con un asistente de IA."` (`ai-disclosure.ts:13-17`).
- El enlace opcional al aviso de privacidad se agrega **solo si la URL es segura**: `isSafeDisclosureUrl` acepta `http(s)://` o rutas relativas y **rechaza `javascript:`, `data:` y demas esquemas peligrosos** (`ai-disclosure.ts:23-28`) que un integrador podria inyectar por atributo. El enlace lleva `rel="noopener noreferrer"` y `target="_blank"`.

### 3.5 Manejo de fallos con gracia — SOLIDO (no rompe la pagina anfitriona)
- HTTP no-ok → burbuja de error con `code` + `message` del backend, sin lanzar (`client.ts:40-52`).
- Fallo de red / excepcion → `catch` en `send()` pinta "No se pudo conectar con el agente." (`element.ts:436-438`). **Ninguna excepcion escapa al anfitrion.**
- Token invalido → reintento unico transparente; si vuelve a fallar, burbuja de error normal.
- Agente borrado / endpoint mal → error del backend en burbuja legible; el chat sigue usable.
- Desmontaje (`disconnectedCallback`) → aborta el stream en vuelo (`element.ts:243`). Navegar fuera no deja fetch colgado.
- El historial enviable es transaccional (`turns.ts` / `commitTurn`): un turno fallido o abortado no deja un `user` huerfano que rompa la alternancia del proveedor.

### 3.6 CSP / inyeccion — el punto debil (ver W1, ALTA)
- **No usa `eval` ni `new Function`.** Una CSP sin `script-src 'unsafe-eval'` no lo bloquea; compatible con `script-src 'self'`.
- **Problema (ALTA — ver W1):** el widget inyecta un bloque `<style>` inline dentro del shadow root via `innerHTML` (`element.ts:360`). Los `<style>` inline **estan sujetos a `style-src`** (el shadow DOM no los exime). Un anfitrion con CSP estricta (`style-src 'self'`, sin `'unsafe-inline'` — patron creciente en clientes enterprise, que son el publico natural de un B2B) hace que el navegador **descarte el `<style>`**. Sin el, `:host { display:block }`, `.root { height:var(--la-height) }` y `.messages { overflow-y:auto }` desaparecen: el custom element cae a `display:inline` por defecto y la lista de mensajes crece sin limite, **desacomodando el layout del anfitrion, en silencio y sin fallback**. Es justamente "el widget rompe en sitios de terceros".
- **`connect-src`:** el anfitrion tambien debe permitir el `endpoint` de la plataforma y el `token-url` del cliente (esto si degrada con gracia a burbuja de error). Ninguno de los dos requisitos esta documentado.
- Se usa `color-mix()` en CSS (navegadores modernos); degrada en navegadores viejos.

### 3.7 Accesibilidad e i18n del widget — mismas brechas que la consola
- **a11y (MEDIA — ver W3):** el `<textarea>` del composer solo tiene placeholder, sin nombre accesible (`element.ts:357/372`), y la zona `.messages` no es region viva (sin `role="log"`/`aria-live`, `element.ts:356`): las respuestas en streaming y los errores se agregan a un contenedor mudo. Un usuario de lector de pantalla en el sitio anfitrion **no percibe la respuesta del agente**. Es la misma brecha que el Playground (M8).
- **i18n (MEDIA — ver W5):** los textos de UI estan hardcodeados en espanol y no se pueden localizar: botones "Enviar"/"Detener" (`element.ts:612`), "No se pudo conectar con el agente." (`:437`), footer "Impulsado por Ledesma AI Labs" (`:362`), etiqueta "Aviso de privacidad" (`:327`) y el `DEFAULT_AI_NOTICE` (`ai-disclosure.ts:7`). Solo `title`/`placeholder`/`ai-notice` son configurables. Un sitio en otro idioma muestra botones y errores en espanol; y — relevante para cumplimiento — **la divulgacion de IA por defecto sale en espanol** salvo que el integrador recuerde fijar `ai-notice` en el idioma del end-user.
- **Aislamiento CSS (BAJA):** `:host` solo redefine `font-family`; no resetea propiedades heredables (`text-transform`, `letter-spacing`, `white-space`), asi que un anfitrion con estilos globales agresivos (`* { text-transform: uppercase }`) altera el texto del widget. Los selectores de clase si estan aislados por el shadow boundary.

### 3.8 Widget — veredicto
**Seguro en cuanto a datos y aislado en selectores; su punto debil es la robustez ante CSP estricta.** Render sin XSS, token fuera del DOM en el modo recomendado, divulgacion de IA que cumple y no se puede desactivar, fallos contenidos, y un bundle minusculo (4.5 kB gzip). Corregir W1 (migrar a `adoptedStyleSheets`/constructable stylesheets, que **no** gobierna `style-src`) es lo que lo vuelve verdaderamente robusto en cualquier sitio de terceros; el resto son mejoras de a11y, i18n y documentacion.

---

## 4. Hallazgos por severidad

### ALTA

#### A1. Los formularios de gestion no asocian su etiqueta con el control (barrera para lectores de pantalla)
- **Severidad:** ALTA · **Categoria:** a11y
- **Ubicacion:** `apps/console/src/components/ui/Field.tsx:16`
- **Evidencia:** `<label className="mb-2 block text-sm font-medium text-ink">{label}</label>` — el `<label>` no tiene `htmlFor`, y el control (`{children}`) es un **hermano**, no un hijo del label. No hay asociacion por `id` ni por envoltura. Confirmado por grep: los inputs de estos formularios no llevan `id`.
- **Impacto:** un usuario de lector de pantalla que enfoca el input **no escucha su etiqueta** (oye solo "cuadro de edicion"). Como `Field` es el patron dominante, quedan sin etiquetar practicamente todos los formularios de gestion: `CredentialFormDialog` (Etiqueta/Proveedor/API key/Base URL), `ScheduledTaskFormDialog` (Agente/Credencial/Mensaje), `TriggerFormDialog` (Agente/Credencial/Mensaje base), `RecipeFormDialog` (Nombre/Descripcion/Agente/Credencial), `AgentFormPage` (Nombre/Descripcion/Proveedor/Modelo/Max tokens/Temperature/Base URL/System prompt), `ToolsEditor` y `CredentialSessionForm`. Es una barrera dura y transversal: excluye a usuarios de lector de pantalla de crear/editar cualquier recurso.
- **Inconsistencia agravante:** conviven dos estandares. `LoginPage` (`:95`), `RegistrationPage` (`:89`,`:108`), `StepEditor` (`:53`) y `ScheduleSelector` (envoltura) **si** asocian el label; todo lo que pasa por `Field` no. Cada formulario nuevo que reuse `Field` hereda la regresion en silencio.
- **Recomendacion (sin implementar):** generar un `id` en `Field` (con `useId`), pasarlo como `htmlFor` del `<label>` y clonar el hijo para inyectar ese `id` (o exponer un render-prop `{ id }`, o envolver el control dentro del `<label>`). Un solo cambio en `Field` corrige todos los formularios de golpe.

#### W1. El widget se rompe en anfitriones con CSP de estilos estricta (depende de un `<style>` inline en el shadow root)
- **Severidad:** ALTA · **Categoria:** widget
- **Ubicacion:** `packages/widget/src/element.ts:360`
- **Evidencia:** `shadow.innerHTML = \`<style>${styles}</style>\` + \`<div class="root">...\`` — el bloque `styles` (con `:host{display:block;width:100%}`, `.root{height:var(--la-height)}`, `.messages{overflow-y:auto}`) vive dentro de ese `<style>` inline.
- **Impacto:** los `<style>` inline **estan sujetos a `style-src`**; el shadow DOM no los exime. Un sitio anfitrion con CSP moderna sin `'unsafe-inline'` en `style-src`/`style-src-elem` (patron de seguridad cada vez mas comun, especialmente en el enterprise que es el publico natural de este B2B) hace que el navegador **descarte el `<style>`**. El widget queda **sin estilos**: sin `--la-height` ni `overflow-y:auto`, el custom element cae a `display:inline` por defecto y la lista de mensajes crece sin limite, empujando y desacomodando el layout del anfitrion. **Falla silenciosa, sin fallback y no documentada** — exactamente el escenario "el widget rompe en un sitio de terceros" que esta pieza debe evitar. *(Prevalencia honesta: solo afecta a anfitriones con `style-src` estricta, hoy una minoria pero creciente; no es una falla de seguridad ni de datos, es de robustez visual; el fix es conocido.)*
- **Recomendacion:** migrar los estilos a una `CSSStyleSheet` construible aplicada por `shadowRoot.adoptedStyleSheets` (no la gobierna `style-src`), o soportar un nonce/hash; y documentar en `ConnectPage`/README los requisitos de CSP del anfitrion (`style-src` para el `<style>`, `connect-src` para `endpoint` y `token-url`).

### MEDIA

#### M1. Los errores de validacion y de envio no se asocian ni se anuncian
- **Ubicacion:** `apps/console/src/components/ui/Field.tsx:19` (validacion) y `CredentialFormDialog.tsx:128` (banner de envio).
- **Evidencia:** `{error && <p className="mt-1.5 text-sm text-brasa">{error}</p>}` — sin `id`, sin `role="alert"`, sin `aria-live`; el input no recibe `aria-describedby`. El banner de fallo del backend tampoco lleva `role="alert"`.
- **Impacto:** al enviar con datos invalidos (o si falla la mutacion), el lector de pantalla **no anuncia nada**; recorriendo el campo tampoco escucha el mensaje. El usuario queda atascado sin saber que fallo. Mismo patron sin `role`/`aria-live` en `ScheduledTaskFormDialog.tsx:153/241`, `TriggerFormDialog.tsx:175/308`, `RecipeFormDialog.tsx:196`, `AgentFormPage.tsx:152`, `ScheduleSelector.tsx:267`, `StepEditor.tsx:115`. Contrasta con `LoginPage`/`RegistrationPage`, que **si** usan `role="alert"`.
- **Recomendacion:** dar `id` al mensaje de error, referenciarlo desde el control con `aria-describedby` y anunciarlo con `role="alert"`; envolver los banners de envio en `role="alert"`. Idealmente centralizado en `Field`.

#### M2. Solo un dialogo (de 14) atrapa el foco; el Tab escapa a la pagina de fondo
- **Ubicacion:** `apps/console/src/components/triggers/DeleteTriggerDialog.tsx:33` (representativo).
- **Evidencia:** el unico handler de teclado es `if (e.key === 'Escape') ...`; no hay rama para `Tab`. Solo `SecretRevealDialog.tsx:41-62` cicla el foco.
- **Impacto:** en 13 dialogos (borrado, rotacion y formularios) el usuario de teclado/lector que tabula **sale del modal hacia los controles de fondo** (que siguen en el DOM, no inertes), pudiendo interactuar con lo que el modal deberia bloquear.
- **Recomendacion:** extraer la trampa ya implementada en `SecretRevealDialog` a un hook/primitivo `Dialog` compartido y aplicarlo a todos.

#### M3. Tres dialogos de `agents/` no tienen NINGUNA gestion de foco ni teclado
- **Ubicacion:** `apps/console/src/components/agents/DeleteAgentDialog.tsx:16` (y `RotateSecretDialog.tsx`, `TestToolDialog.tsx`).
- **Evidencia:** el archivo no importa `useEffect` ni `useRef`: cero manejo de foco/teclado.
- **Impacto:** `DeleteAgentDialog` (borrado destructivo), `RotateSecretDialog` (rotacion destructiva) y `TestToolDialog` (formulario con textarea) **no enfocan nada al abrir, no cierran con Escape y no devuelven el foco**. El foco queda detras del backdrop; en `TestToolDialog` ni el textarea recibe foco. Es una regresion frente a los dialogos editoriales equivalentes.
- **Recomendacion:** alinearlos con el patron de los dialogos editoriales (foco inicial seguro, Escape, retorno de foco), idealmente migrandolos al mismo primitivo `Dialog`.

#### M4. El foco no vuelve al disparador al cerrar en 9 dialogos (inconsistencia)
- **Ubicacion:** `apps/console/src/components/scheduled-tasks/DeleteScheduledTaskDialog.tsx:39`.
- **Evidencia:** el cleanup solo remueve el listener; nunca capturo `document.activeElement`.
- **Impacto:** al cerrar (Delete*/Rotate*/TestTool/RecipeForm) el foco cae al inicio del documento, obligando a re-tabular. En contraste, `CredentialFormDialog.tsx:59`, `ScheduledTaskFormDialog.tsx:70`, `TriggerFormDialog.tsx:98` y `SecretRevealDialog.tsx:67` **si** restauran. La convivencia evidencia la inconsistencia.
- **Recomendacion:** estandarizar captura/restauracion de `previous = document.activeElement` en todos.

#### M5. El acento de marca (brasa) como texto y relleno no alcanza contraste AA
- **Ubicacion:** `apps/console/src/components/layout/Sidebar.tsx:41` (nav activa) y `apps/console/src/components/ui/CopyButton.tsx` (boton primario de copiar secreto).
- **Evidencia:** `brasa #E5511E`. Ratios calculados: brasa como texto sobre blanco/cream = **3.45:1**; blanco sobre brasa = **3.80:1**. WCAG AA para texto normal (<18.66px bold / <24px) exige 4.5:1; solo pasan como texto grande (3:1).
- **Impacto:** el indicador de **nav activa** (14px), los enlaces de accion de tarjeta ("Conversar" 13px, "Ejecutar" 13px), los **mensajes de error** en `text-brasa` (Playground `:483`, adjuntoError `:538`, Configurator `:85`, AgentPreview `:98`) y — el mas critico — el **boton primario blanco-sobre-brasa del modal "copia esto ahora"** quedan por debajo de AA, justo en momentos que exigen precision.
- **Recomendacion:** usar un tono mas oscuro (p.ej. `brasa-hover #D2481A` o mas) para texto/relleno con texto, o subir peso/tamano a texto grande; verificar >=4.5:1.

#### M6. El texto secundario `muted-soft` no alcanza contraste AA
- **Ubicacion:** `apps/console/tailwind.config.js:14`.
- **Evidencia:** `muted.soft = '#8A8984'`. Ratios: sobre cream = **3.18:1**, sobre surface blanco = **3.50:1**, sobre field = **3.36:1**. AA normal exige 4.5:1.
- **Impacto:** se usa a 12-12.5px en texto informativo real: email del usuario (`Sidebar.tsx:53`), pie de tarjetas ("N herramientas"/"Activo" `AgentCard.tsx:80`, "Ultima ejecucion" `RecipeCard.tsx:77`, `ScheduledTaskCard.tsx:75`), y ayuda del webhook (`TriggerCard.tsx:132`). Ninguno califica como texto grande. Usuarios con baja vision no lo leen bien. *(Nota honesta: el token `muted #6B6A66`, el texto secundario principal, SI cumple: 4.9:1 sobre cream. El problema es solo `muted-soft`.)*
- **Recomendacion:** oscurecer `muted-soft` hasta >=4.5:1 (aprox `#6F6E69` o mas oscuro), o reservarlo solo para texto >=24px.

#### M7. Los controles editoriales con `className` directo no definen `focus-visible`
- **Ubicacion:** `apps/console/src/components/layout/Sidebar.tsx:39` (y AppLayout, todas las tarjetas, CopyButton).
- **Evidencia:** ninguno de Sidebar/AppLayout/AgentCard/RecipeCard/ScheduledTaskCard/TriggerCard/CredentialCard/CopyButton declara `focus-visible`/`focus:ring`. Solo el componente `Button` (`button.tsx:13`) trae el anillo brasa.
- **Impacto:** foco de teclado **inconsistente**: nav, "Cerrar sesion", hamburguesa, enlaces y botones de accion de todas las tarjetas quedan con el outline nativo del navegador (mas debil y facilmente poco visible sobre estos fondos claros), mientras la landing con `Button` tiene anillo de alto contraste.
- **Recomendacion:** anadir la misma cadena `focus-visible:ring-2 ring-brasa ring-offset-2` (o reutilizar `Button`) en los controles editoriales.

#### M8. El chat del Playground no tiene nombre accesible ni live region
- **Ubicacion:** `apps/console/src/pages/PlaygroundPage.tsx:552` (textarea) y `:409` (transcripto).
- **Evidencia:** `<textarea ... placeholder="Escribe un mensaje..." />` sin `id`/`label`/`aria-label`; el contenedor del transcripto `<div ref={scrollRef} ...>` no tiene `role="log"` ni `aria-live`.
- **Impacto:** en la superficie de prueba mas importante de la app, el campo de envio queda **sin nombre programatico** (el placeholder no cuenta) y **todo el output en streaming** (texto, tools, uso, errores) llega **en silencio** para tecnologia asistiva. El agravante es que el **Configurador hace ambas cosas bien** (`ConfiguratorChat.tsx:105-107` label sr-only, `:52-57` `role="log" aria-live="polite" aria-busy`): la pantalla mas rica es la menos accesible, y el patron correcto ya existe en el repo.
- **Recomendacion:** replicar el patron del Configurador: `aria-label`/label sr-only en el textarea y `role="log"`+`aria-live="polite"` en el transcripto.

#### M9. El drawer movil no es un dialogo accesible
- **Ubicacion:** `apps/console/src/components/layout/AppLayout.tsx:15`.
- **Evidencia:** `{mobileOpen && (<div className="fixed inset-0 z-40 md:hidden">...` — grep confirma cero `role="dialog"`/`aria-modal`/Escape/trampa de foco en `components/layout`.
- **Impacto:** en movil, el foco no se mueve al drawer al abrir ni se atrapa (se puede tabular al contenido detras), el fondo no queda inerte, solo cierra clicando el backdrop (`div` con `onClick`, no operable por teclado) o eligiendo un item — no hay Escape — y la hamburguesa (`AppLayout.tsx:26`) no expone `aria-expanded`/`aria-controls`.
- **Recomendacion:** convertir el drawer en dialogo modal (role/aria-modal, mover y atrapar foco, Escape, fondo inerte) y anadir `aria-expanded`/`aria-controls` a la hamburguesa.

#### M10. No hay indicador de "pensando"/streaming en el Playground antes del primer token
- **Ubicacion:** `apps/console/src/pages/PlaygroundPage.tsx:191`.
- **Evidencia:** `appendDelta` crea la burbuja del asistente recien con el primer delta; el unico feedback inmediato es el boton que muta a "Detener" (un `Square` estatico).
- **Impacto:** tras enviar hay una ventana (latencia del modelo, o turnos solo-tool antes de texto) donde el transcripto no muestra nada: se percibe como que "no paso nada". El Configurador cubre esto con `TypingIndicator` (`ConfiguratorChat.tsx:81,152-162`); el Playground no tiene equivalente.
- **Recomendacion:** mostrar una burbuja con indicador de escritura mientras `running` y aun no llego texto.

#### M11. La rotacion del webhook secret en `/conectar` no maneja el error: fallo silencioso
- **Ubicacion:** `apps/console/src/pages/ConnectPage.tsx:45`.
- **Evidencia:** `rotateSecret.mutate(undefined, { onSuccess: ... })` — no hay `onError`; el componente nunca lee `rotateSecret.isError` y `RotateSecretDialog` no recibe prop de error.
- **Impacto:** si la rotacion falla (500/timeout/red), `busy` vuelve a false, el dialogo queda abierto y **el usuario no recibe ninguna senal**: parece que no paso nada. El exito si avisa (`role="status"`, `ConnectPage.tsx:197-201`), pero el fallo es invisible en una accion de seguridad sensible.
- **Recomendacion:** surface del error de la mutacion dentro del dialogo o como aviso.

#### M12. El JWT de Supabase (access + refresh) se persiste en localStorage
- **Ubicacion:** `apps/console/src/lib/supabase.ts:7`.
- **Evidencia:** `auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }` sin sobreescribir `storage`.
- **Impacto:** supabase-js guarda la sesion completa (access **y** refresh token de larga vida) en `localStorage` bajo `sb-<ref>-auth-token`, legible por cualquier JS del mismo origen. Ante un futuro XSS, un unico script exfiltraria la sesion entera, y el refresh_token permitiria renovar acceso mucho despues. **Mitigante real y verificado:** la consola NO tiene `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.cookie` en todo `apps/console/src` (grep sin resultados), asi que la superficie de XSS hoy es minima; y es el patron estandar de supabase-js. No es una fuga activa (el token nunca se renderiza ni loguea), sino una decision de almacenamiento con radio de impacto alto.
- **Recomendacion:** dejar el tradeoff explicito en el modelo de amenaza; endurecer defensa en profundidad con CSP (B3). Evaluar si el refresh_token de larga vida en localStorage es aceptable; alternativa de mayor costo: storage en memoria + cookie httpOnly emitida por el backend.

#### M13. Recetas nombra la MISMA accion de dos formas
- **Ubicacion:** `apps/console/src/pages/RecipesPage.tsx:194` ("Nueva receta") vs `:85` ("Crear receta").
- **Impacto:** el usuario ve la misma alta con dos etiquetas segun donde este. Las otras cinco pantallas usan un verbo unico (Crear agente / Programar tarea / Crear trigger / Agregar credencial) en header, empty y footer.
- **Recomendacion:** unificar a un solo verbo en Recetas.

#### M14. Copy de error con acento inconsistente (mismo string, dos ortografias)
- **Ubicacion:** `RecipesPage.tsx:231` ("conexion") vs `CredentialsPage.tsx:132` / `AgentsPage.tsx:138` ("conexión").
- **Impacto:** en un producto en un solo idioma, 4 de 6 pantallas muestran una falta ortografica ("conexion" sin tilde) en el estado de error. Visible y mina la percepcion de pulido. (Es el ejemplo canonico de por que falta un componente compartido.)
- **Recomendacion:** estandarizar el string a "conexión" en las seis, idealmente extrayendolo a una constante compartida.

#### M15. Avisos de privacidad publicos con placeholders legales visibles
- **Ubicacion:** `apps/console/src/lib/privacy.ts` (secciones `placeholder`), renderizadas por `LegalDocument` en `PrivacyNoticePage.tsx` / `PrivacySimplifiedNoticePage.tsx` (rutas publicas `/aviso-de-privacidad`).
- **Evidencia:** el texto legal son placeholders marcados `[REVISION LEGAL PENDIENTE]` (documentado en `App.tsx:32` y `privacy.ts:5`).
- **Impacto:** un usuario (o un end-user del widget, cuyo `privacy-url` puede apuntar aqui) que visita el aviso de privacidad ve **andamiaje legal, no texto real**. Es una decision deliberada y marcada (no un olvido), pero es contenido incompleto orientado al usuario y con implicancia de cumplimiento; conviene rastrearlo como bloqueante de lanzamiento, no como deuda de UI.
- **Recomendacion:** completar la redaccion legal antes de exponer el aviso como definitivo; mientras tanto, considerar un banner "borrador" explicito. *(Nota honesta: el placeholder se muestra de forma responsable — bloque con borde punteado y badge "Revision legal pendiente" en `LegalDocument.tsx:11-19` — nunca texto legal inventado. Es la decision correcta dado que falta la redaccion; el hallazgo es que no debe exponerse como definitivo ni pedir consentimiento sobre el.)*

#### M16. La credencial estatica del widget (`session-token`/`provider-key`) queda como atributo del DOM
- **Ubicacion:** `packages/widget/src/element.ts:286-296`.
- **Evidencia:** `get providerKey() { return this.readAttribute('provider-key'); }` (idem `session-token`) — el valor **ES** el atributo del host element; cualquier script del anfitrion lo lee con `element.getAttribute('provider-key')`.
- **Impacto:** en una pagina de terceros con multiples scripts (analytics, tag managers, terceros comprometidos) la credencial estatica es exfiltrable trivialmente y visible en devtools. La doc advierte fuerte que `provider-key` es solo demo (`ConnectPage.tsx:262-268`, README, demo.html), **bien**, pero `session-token` se lista sin nota de que tambien queda visible en el DOM (README lo describe solo como "Token de sesion estatico"). El modo seguro (`token-url`) existe y esta bien recomendado.
- **Recomendacion:** documentar explicitamente que `session-token` estatico tambien es legible en el DOM y reservarlo a entornos controlados / de muy corta vida; reforzar que produccion en sitios publicos = `token-url`.

#### M17. El chat del widget no tiene nombre accesible ni region viva
- **Ubicacion:** `packages/widget/src/element.ts:356-357`.
- **Evidencia:** `<div class="messages"></div>` sin `role="log"`/`aria-live`; `<textarea>` con solo `placeholder` (`:372`), sin `aria-label`.
- **Impacto:** en el sitio anfitrion, un usuario de lector de pantalla no recibe nombre estable para el campo de entrada y **no percibe la respuesta en streaming ni las burbujas de error** (se agregan via `textContent` a un contenedor mudo). El chat es inusable con tecnologia asistiva. Misma brecha que el Playground (M8), replicada en la superficie que corre en sitios ajenos.
- **Recomendacion:** `aria-label` en el textarea y `role="log" aria-live="polite" aria-relevant="additions"` en `.messages` (`assertive` para la burbuja de error).

#### M18. Los textos de UI del widget estan hardcodeados en espanol (sin i18n)
- **Ubicacion:** `packages/widget/src/element.ts:612` (y `:362`, `:437`, `:327`, `ai-disclosure.ts:7`).
- **Evidencia:** `action.textContent = this.running ? 'Detener' : 'Enviar'`; footer, error de red, etiqueta "Aviso de privacidad" y `DEFAULT_AI_NOTICE` tambien fijos en espanol. Solo `title`/`placeholder`/`ai-notice` son configurables.
- **Impacto:** el widget se embebe en sitios de cualquier idioma, pero muestra botones y errores en espanol; y — relevante para cumplimiento EU AI Act — **la divulgacion de IA por defecto sale en espanol** salvo que el integrador fije `ai-notice` en el idioma del end-user. La etiqueta "Aviso de privacidad" no es configurable en absoluto.
- **Recomendacion:** exponer un atributo de idioma/locale (o derivar de `:host` `lang`) y atributos para los textos de botones/errores/footer, y documentar que `ai-notice` debe fijarse en el idioma del end-user.

#### M19. Dialecto mixto: voseo argentino en el Configurador vs tuteo mexicano en el resto
- **Ubicacion:** `apps/console/src/components/configurator/ConfiguratorChat.tsx:114` (y `:66`, `ConfiguratorPage.tsx:176`, `AgentPreview.tsx:152-153`, `PlaygroundPage.tsx:416`, `CredentialSessionForm.tsx:68`).
- **Evidencia:** `placeholder="Escribi lo que queres que haga tu agente..."`, "Conta que agente queres crear... lo arma con vos", "Vos confirmas", "Elegi una credencial" — vs tuteo neutro en el resto ("Escribe un mensaje...", "Describe tu solicitud...").
- **Impacto:** la consola es para Mexico (LFPDPPP, textos "en Mexico") y el registro dominante es tuteo. El voseo (Escribi/queres/Elegi/Vos) suena regional argentino y rompe el registro para el usuario objetivo; se percibe como producto sin localizar.
- **Recomendacion:** unificar a tuteo neutro/mexicano en las cadenas del Configurador y los selectores de credencial (Escribe/quieres/Elige/Tu confirmas).

#### M20. El error crudo del backend se muestra sin traducir (posible ingles) en el Playground
- **Ubicacion:** `apps/console/src/pages/PlaygroundPage.tsx:486` (+ `:484` el `code` de maquina).
- **Evidencia:** `{item.message ?? 'Revisa tu key o el identificador del modelo.'}` con `{item.code}` en mono; ese `message` viene sin mapear desde `run-agent.ts:77`. No existe tabla `code→espanol` (grep de `ERROR_MESSAGES`/`mapError`: sin resultados).
- **Impacto:** si el backend reenvia un error de proveedor (Anthropic/OpenAI) verbatim, el usuario ve un mensaje en ingles y un codigo tecnico en mayusculas (p.ej. `MODEL_NOT_FOUND`) dentro de una consola en espanol. El Configurador **si** traduce 401/403/404/400 (`ConfiguratorPage.tsx:23-42`): otra vez, el patron correcto ya existe. *(Camino principal de API si esta protegido: `apiFetch` construye `API ${status}: ${code}` y las vistas renderizan copy fijo en espanol — ver seccion 6.)*
- **Recomendacion:** mapear los codes conocidos a copy en espanol y usar el `message` del backend solo como respaldo; ocultar o traducir el `code` tecnico. Usar un fallback neutro de conexion para errores de red/timeout (el fallback actual "Revisa tu key o el identificador del modelo" enganna cuando fue la red).

### BAJA (pulido — lista consolidada)

| # | Hallazgo | Ubicacion | Cat |
|---|----------|-----------|-----|
| B1 | Toggles Pausar/Activar sin `aria-pressed`/`role=switch` (solo exponen la accion, no el estado) | `ScheduledTaskCard.tsx:87`, `RecipeCard.tsx:97`, `TriggerCard.tsx:91` | a11y |
| B2 | Pill de estado verde `text-ok` sobre `bg-ok/10` a 10px falla AA (~3.4:1) | `ScheduledTaskCard.tsx:12` | a11y |
| B3 | Sin Content-Security-Policy ni cabeceras de seguridad en el hosting | `apps/console/vercel.json:1` (no hay bloque `headers`) | seguridad |
| B4 | `aria-label` de botones de tarjeta generico en Recetas/Tareas/Triggers vs nombrado en Agentes/Credenciales | `RecipeCard.tsx:122` | a11y |
| B5 | Empty state de Actividad no sigue el sistema editorial (justificado por read-only; documentar) | `ActivityPage.tsx:41` | consistencia |
| B6 | Indicador "Actualizando" de Actividad fuera de region `aria-live`/`role=status` | `ActivityPage.tsx:100` | a11y |
| B7 | Hover del CTA "Crear agente" usa hex suelto `#C8460F` en vez de `brasa-hover` | `AgentsPage.tsx:13` | consistencia |
| B8 | Auto-descarte de toast 4500ms en Recetas vs 4000ms en el resto | `RecipesPage.tsx:116` | consistencia |
| B9 | `notice` de Credenciales es `string` (solo exito) vs `{kind:'ok'\|'error'}` de las hermanas | `CredentialsPage.tsx:69` | consistencia |
| B10 | Fondo nunca marcado `inert`/`aria-hidden` (solo el overlay); sistemico a los 14 dialogos | `DeleteCredentialDialog.tsx:39` | a11y |
| B11 | `RecipeFormDialog` atipico: no restaura foco y sus estados carga/error no gestionan foco | `RecipeFormDialog.tsx:59` | consistencia |
| B12 | Foco inicial no-op cuando no hay agentes (el `select` objetivo no se monta) | `ScheduledTaskFormDialog.tsx:64`, `TriggerFormDialog.tsx:91` | estados |
| B13 | `ConsentScreen`: titulo es `<p>` no `<h1>` y no mueve el foco al montar | `ConsentScreen.tsx:37` | a11y |
| B14 | 3 dialogos de `agents/` usan tokens legacy (grafito/hueso) y backdrop `bg-black/60` mas oscuro | `DeleteAgentDialog.tsx:20` | consistencia |
| B15 | Errores del run del Playground mostrados crudos (code+message del backend) y fallback enganoso para timeout/red | `PlaygroundPage.tsx:485` | consistencia |
| B16 | Estado vacio con CTA de Uso solo aparece en preset `all`; el preset inicial es `30d` (agente nuevo no ve el onboarding) | `UsagePage.tsx:170` | estados |
| B17 | El Configurador no ofrece boton "Detener" para abortar un turno en curso (el Playground si) | `ConfiguratorChat.tsx:117` | consistencia |
| B18 | Reintentar tras error duplica la burbuja del usuario en el transcripto del Playground | `PlaygroundPage.tsx:490` | estados |
| B19 | Errores de subida de adjuntos concatenan el mensaje de Supabase (en ingles) a texto en espanol → cadena mixta | `apps/console/src/lib/attachments.ts:96` | i18n |
| B20 | El mismo label se muestra "Descripci**ó**n" en un form y "Descripci**o**n" en otros; omision generalizada de acentos en labels/copy | `AgentFormPage.tsx:179` vs `ToolsEditor.tsx:158`, `RecipeFormDialog.tsx:216` | consistencia |
| B21 | Widget: `:host` no resetea propiedades CSS heredables (text-transform/letter-spacing), el anfitrion puede alterar el texto | `packages/widget/src/element.ts:13` | widget |
| B22 | Widget: `attachShadow({mode:'open'})` deja que cualquier script del anfitrion lea el DOM de la conversacion; evaluar `closed` | `packages/widget/src/element.ts:235` | seguridad |
| B23 | Widget: `title` colisiona con el atributo global HTML → tooltip nativo del navegador sobre todo el widget | `packages/widget/src/element.ts:299` | widget |
| B24 | Widget: el mensaje "Falta el atributo endpoint" (dev-facing) se pinta en el area visible → el end-user de un embed mal configurado ve nombres de atributos internos | `packages/widget/src/element.ts:351` | estados |
| B25 | Widget: `isSafeDisclosureUrl` admite URLs protocol-relative (`//host`) y backslash, mas laxo que su comentario ("http(s) o ruta relativa"); rechaza bien `javascript:`/`data:` | `packages/widget/src/ai-disclosure.ts:27` | seguridad |

---

## 5. Preparacion para dashboard, perfiles y onboarding

Las tres fases que vienen son UI-intensivas. Evaluacion honesta de si el frontend actual acelera o frena.

### Lo que ACELERA (bases solidas ya presentes)
- **Sistema de diseno con tokens** (`tailwind.config.js`, `index.css`): paleta editorial coherente (cream/brasa/ink/line), tipografia (Archivo/Hanken Grotesk), sombras y escalas. Un dashboard nuevo hereda el lenguaje visual sin reinventarlo.
- **Capa de datos madura:** react-query con hooks (`lib/queries.ts`, `lib/mutations.ts`), `apiFetch` autenticado con traduccion de errores (`api.ts`), SSE robusto (`sse.ts`, `run-agent.ts`). Perfiles y dashboard son mayormente lectura → encajan directo en este patron.
- **Patron de pagina de lista bien establecido:** el esqueleto header + loading + error + empty + lista es replicable; una pantalla nueva de dashboard ya tiene molde.
- **Layout con routing gateado** (`App.tsx`, `ProtectedRoute`/`RegistrationGate`/`ConsentGate`/`AppLayout`): agregar rutas de perfil/dashboard es trivial y ya quedan protegidas por construccion.
- **Onboarding parcialmente resuelto:** `RegistrationPage` y `ConsentScreen` ya existen y — notablemente — son de los pocos lugares con a11y correcta (labels asociados, `role="alert"`, `aria-pressed`). Sirven de referencia.

### La DEUDA que conviene resolver ANTES (o se multiplica)
1. **No existe una capa de primitivas compartidas de UI.** Hoy en `components/ui/` solo hay `Button`, `Badge`, `Field`, `CopyButton`. **Faltan** los componentes que toda pantalla necesita y que hoy estan **copiados inline en cada pagina**. Evidencia concreta del copy-paste y su drift ya medido:
   - **`ErrorState`:** el bloque "No pudimos cargar" esta reimplementado inline — grep `'No pudimos cargar'` = **16 coincidencias en 13 archivos**, con clases mezcladas (`text-ink` en unas, `text-hueso` en otras) y el acento de "conexi(ó)n" divergente (M14).
   - **Boton primario duplicado:** la constante `addButtonClass` (~200 caracteres) esta copiada literal en `ScheduledTasksPage.tsx:11`, `CredentialsPage.tsx:10`, `TriggersPage.tsx:19` y `RecipesPage.tsx:11`. Peor: existe `Button` pero su variante `default` usa `bg-accent`, no `bg-brasa` → **hay DOS estilos de boton primario en paralelo** en el sistema.
   - **`Dialog` accesible:** 13 dialogos copian overlay + `role`/`aria-modal` + foco + Escape (grep `aria-modal="true"` = 13 archivos), y ya **divergen**: `DeleteCredentialDialog.tsx:33` reengancha el listener de Escape en cada render (`[open, onCancel]`) mientras `DeleteScheduledTaskDialog.tsx:27-40` usa un `ref` y `[open]` con el comentario "asi no se re-adjunta". La misma logica tiene dos implementaciones (una mejor) por copiarse a mano.
   - **`SkeletonList`, `EmptyState`, `PageHeader`, `Notice`:** cada pantalla redefine su skeleton de 3 pulse-cards (solo cambia la altura), su `*EmptyState`, su contenedor `mx-auto ... max-w-4xl` + `h1` + subtitulo, y su region de aviso.
   
   **Construir dashboard + perfiles + onboarding sobre esta base multiplica cada divergencia por cada pantalla nueva.**
2. **Arreglar `Field` y el `Dialog` compartido primero rinde compuesto:** corregir A1/M1 en `Field` y M2/M3/M4 en un `Dialog` unico (con foco, trampa, Escape, retorno, `inert`, scroll-lock) sanea retroactivamente todo el CRUD y evita que las fases nuevas nazcan con la misma deuda.
3. **Dos familias de tokens conviven:** el sistema editorial (cream/brasa/ink) y el legacy remapeado (grafito/hueso/carbon) que aun usan Playground, Conectar, Uso, Login y 3 dialogos de agents (documentado en `tailwind.config.js:27-32`). Antes de sumar dashboard conviene terminar de migrar o el nuevo codigo tendra que elegir entre dos vocabularios.
4. **Contraste del acento (M5/M6):** si dashboard y perfiles van a usar mucho `brasa` como texto/CTA y `muted-soft` para metadatos, ajustar esos dos tokens **antes** evita repintar decenas de pantallas nuevas por a11y.

### La falta de tests de UI — riesgo concreto para lo que viene
- **Estado actual (verificado):** los ~23 archivos de `apps/console/test/` son **todos de logica pura** (`lib/*`: schemas, cron, snippets, sse, jobs, etc.). No hay `@testing-library/react`, no hay jsdom render de paginas ni componentes. La UI real (estados de carga/error/vacio, foco de modales, `aria-*`) **no tiene ninguna cobertura automatizada**. `vitest run --passWithNoTests`.
- **Por que importa AHORA:** las tres fases que vienen son las mas UI-intensivas del roadmap. Sin tests de render, cada una de las regresiones de este informe (un `aria-live` que se cae, un foco que no vuelve, un empty state que diverge) reaparecera sin deteccion, y el volumen de UI nuevo hara imposible auditarlo a mano cada vez.
- **Recomendacion:** introducir infra minima de tests de componentes (`@testing-library/react` + jsdom, ya hay Vitest) **antes** de dashboard/onboarding, empezando por: (a) `Field` etiqueta y anuncia errores, (b) el `Dialog` compartido atrapa foco/cierra con Escape/devuelve foco, (c) cada pantalla de lista renderiza sus estados loading/error/empty. Es la inversion que hace sostenibles las tres fases.

---

## 6. Lo que SI esta bien (honesto)

- **Widget seguro y aislado** (seccion 3): sin XSS, token fuera del DOM en produccion, divulgacion de IA que cumple y no se puede desactivar, fallos contenidos, 4.5 kB gzip. Es la pieza mejor construida del frontend.
- **XSS confirmado limpio en toda la consola:** grep de `dangerouslySetInnerHTML|innerHTML|eval|document.cookie` sobre `apps/console/src` → **0 resultados**. Todo el output del modelo se pinta con interpolacion JSX escapada (`PlaygroundPage.tsx:454`, `ConfiguratorChat.tsx:145`, `AgentPreview.tsx:303`).
- **Secreto HMAC / token de trigger verdaderamente efimero:** `revealFromCreate`/`revealFromUpdate` (`triggers.ts:126-158`) viven solo en estado React; se muestran una vez en `SecretRevealDialog` (con trampa de foco, foco inicial seguro, `aria-describedby`) y al cerrar se purgan con `setReveal(null)` + `rotateTrigger.reset()`. No se persiste ni se loguea.
- **JWT solo en `Authorization: Bearer`** (`api.ts:36`, `run-agent.ts:44`); nunca al DOM, atributo ni consola. El unico `console.*` del codigo es un ejemplo dentro de un snippet mostrado al usuario (`snippets.ts:46`).
- **El gate de tier es cosmetico y la UI no confia en el para seguridad:** `isAutonomous` deriva de `useMe().tier` y solo muestra/oculta formularios; el submit igual golpea el backend, que responde 403 y se traduce a mensaje. `ConfiguratorPage.tsx:87-89` lo dice explicito: "el gate real es server-side".
- **Config `VITE_*` solo expone claves publicas** (Supabase URL, anon key, API URL); no hay `service_role` ni secreto de servidor en el bundle.
- **Estados bien cubiertos:** loading (skeleton), error (con retry), vacio (guiado) en las seis listas y en las pantallas de agente; un `id` inexistente cae en la card de error, no en pantalla en blanco.
- **Manejo transaccional del chat** (Playground y widget): un turno fallido/abortado no rompe la alternancia user/assistant; los streams se cancelan al desmontar.
- **El Configurador es el exemplar de a11y de chat** (`role="log"`, `aria-live`, `aria-busy`, textarea etiquetado, `radiogroup`/`tablist`): la referencia correcta ya existe en el repo para replicar en el Playground.
- **Iconos-solo bien nombrados:** todos los botones de icono (borrar/rotar/editar/hamburguesa/menu adjuntar) llevan `aria-label`; los chips de filtro usan `aria-pressed`; los decorativos llevan `aria-hidden`.
- **Login/Registro con a11y correcta** (labels asociados, `role="alert"`, `aria-pressed`): demuestran que el equipo sabe hacerlo; es cuestion de estandarizar.
- **El camino principal de errores de API NO filtra el mensaje crudo del backend:** `apiFetch` (`api.ts:57`) construye `API ${status}: ${code}` y las vistas renderizan copy fijo en espanol (`PrivacyRightsPage.tsx:172`, `ConsentScreen.tsx:99`, y los `backendMessage`/`runErrorMessage`/`turnErrorMessage` de forms y Configurador). Las fugas de ingles crudo (M20, B19) son excepciones puntuales, no la regla. Los mensajes de validacion (zod) estan en espanol.
- **El placeholder legal se muestra honestamente:** borde punteado + badge "Revision legal pendiente" (`LegalDocument.tsx:11-19`), nunca texto legal inventado. Es la decision responsable; el hallazgo (M15) es no exponerlo como definitivo.
- **La landing publica y `AgentFormPage` estan correctamente acentuadas y en espanol neutro bien escrito** ("Cómo funciona", "configuración", "a través", "válido"): el problema de acentos es de las vistas rediseniadas mas nuevas, no de todo el producto.

---

## 7. Cobertura y alcance

- **Auditado:** las 17 paginas de `apps/console/src/pages`, ~45 componentes de `apps/console/src/components` (layout, ui, agents, credentials, scheduled-tasks, triggers, recipes, activity, configurator, privacy), el sistema de diseno (`tailwind.config.js`, `index.css`, `components/ui/*`), la capa de datos relevante (`lib/api.ts`, `lib/triggers.ts`, `lib/supabase.ts`, `lib/env.ts`, `lib/snippets.ts`, `lib/run-agent.ts`, `lib/chat-turn.ts`, `lib/sse.ts`), y el widget completo (`packages/widget/src/*` + `packages/widget-react`).
- **Metodo:** lectura directa + recorrido en paralelo de pantallas analogas para consistencia + calculo de contraste WCAG sobre tokens reales + greps de patrones de riesgo (XSS, storage, foco, labels) + **builds locales**:
  - Consola: `vite build` OK → `index.js` **877.7 kB / 233.3 kB gzip** (chunk unico; Vite advierte >500 kB, sin code-splitting por ruta — ver nota de rendimiento) + CSS 44.2 kB / 8.9 kB gzip.
  - Widget: `vite build` OK → `ledesma-agent.js` **14.0 kB / 4.5 kB gzip**.
- **Rendimiento percibido (complementa auditoria 11 desde la UX):** el bundle de la consola es un unico chunk de 233 kB gzip que se carga entero en el arranque; no hay `import()` dinamico ni code-splitting por ruta. Para una app con landing publica + dashboard, dividir por ruta reduciria el costo del primer paint. No se observaron saltos de layout graves (los skeletons reservan altura, las regiones `aria-live` reservan espacio); el CLS principal a vigilar es la carga de fuentes (Google Fonts sin `font-display` explicito verificado).
- **No auditado / fuera de alcance:** el backend (cubierto por auditorias 1-8), el motor de ejecucion (7), rendimiento profundo (11), y el codigo de la landing publica de marketing (`components/landing/*`) salvo su relacion con el widget. No se ejecuto contra produccion. No se corrieron herramientas de a11y dinamicas (axe) por no haber runtime de navegador con la app montada; los hallazgos de a11y son por inspeccion de codigo y calculo de contraste, no por escaneo automatizado.
- **No se modifico ningun archivo de producto.** Entregable unico: este informe. Backlog consolidado alimentado; no se corrigio nada aqui.
