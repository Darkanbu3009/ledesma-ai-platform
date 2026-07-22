# Traducciones al ingles marcadas para revision

Listado generado durante la extraccion masiva de textos a i18n (PR 2). Cada seccion
lista claves cuya traduccion al ingles es dudosa, tecnica o de terminos de negocio
sensibles. Formato: clave | texto en espanol | texto en ingles | motivo.

## Seccion: auth

# Review: claves dudosas / terminos de negocio (seccion auth + registro)

- auth.conectar.avisoKey | "La API key del proveedor es de tu cliente y debe vivir en su servidor. Nunca la incluyas en una app movil o pagina publica." | "The provider API key belongs to your client and must live on their server. Never include it in a mobile app or public page." | Ambiguo si "tu cliente" es el cliente (customer) del usuario o el software cliente; se tradujo como "your client".
- auth.conectar.comoFuncionaCuerpo | "...Si cambias el cerebro desde la consola..." | "...If you change the brain from the console..." | "cerebro" es metafora de producto; se tradujo literal como "brain". Confirmar tono.
- auth.conectar.widget.modoTokenCuerpo | "...el widget pide otro solo." | "...the widget requests a new one on its own." | "solo" (por si mismo) interpretado como automatico.
- auth.marca.titular | "Agentes que ejecutan trabajo real dentro de tus sistemas." | "Agents that do real work inside your systems." | Copy de marca; una traduccion mas literal seria "Agents that execute real work...". Confirmar con marketing.
- auth.marca.soporte | "Multi-tenant · BYOK · Trazabilidad completa" | "Multi-tenant · BYOK · Full traceability" | Copy de marca con siglas tecnicas; solo se tradujo "Trazabilidad completa".
- auth.errores.requisitosServidor | "La contraseña no cumple los requisitos del servidor: {{mensaje}}" | "The password doesn't meet the server requirements: {{mensaje}}" | {{mensaje}} es el error.message de Supabase (llega en ingles del servidor); en la UI en espanol quedara mezclado, igual que hoy.
- registro.form.persona | "Persona" | "Individual" | Termino de negocio del toggle de tipo de cuenta (contraparte de "Empresa"); en el codigo el modo interno se llama 'individual'.
- registro.form.nombreEmpresaPlaceholder | "Acme S.A." | "Acme Inc." | Placeholder de ejemplo con sufijo legal localizado (S.A. -> Inc.). Confirmar preferencia.
- auth.comun.divisorO | "o" | "or" | Divisor de una sola letra entre el formulario y el boton de Google; contexto minimo.
- auth.conectar.* (namespace) | - | - | ConnectPage no es una pantalla de autenticacion, pero los namespaces asignados eran solo `auth` y `registro`; sus claves quedaron bajo `auth.conectar`. Considerar moverlas a un namespace propio (p. ej. `conectar`) al fusionar.

## Seccion: landing

# Review: namespace `landing`

Claves con traduccion dudosa / termino de negocio sensible:

- landing.chatWidget.agentes.facturacion | "Facturación" | "Invoicing" | Nombre del agente demo; podria preferirse "Billing" o "Accounts Payable" segun el posicionamiento del producto.
- landing.chatWidget.validacion.pill | "Factura · CFDI" | "Invoice · CFDI" | CFDI es un termino fiscal mexicano sin equivalente en ingles; se dejo tal cual.
- landing.chatWidget.validacion.campos.folio | "Folio" | "Invoice no." | "Folio" es termino de facturacion mexicano; "Invoice no." es aproximacion (podria ser "Folio" tambien en EN).
- landing.chatWidget.validacion.campos.rfc | "RFC" | "RFC" | Identificador fiscal mexicano; se dejo identico (no existe equivalente; alternativa: "Tax ID").
- landing.chatWidget.validacion.campos.iva | "IVA 16%" | "VAT 16%" | IVA -> VAT; en contexto mexicano-EN a veces se conserva "IVA".
- landing.chatWidget.validacion.checks.rfcValido | "RFC válido ante el SAT" | "RFC valid with the SAT" | SAT (autoridad fiscal mexicana) sin traduccion; frase EN suena tecnica pero es fiel.
- landing.chatWidget.validacion.checks.montoCoincide | "Monto coincide con la OC-4471" | "Amount matches PO OC-4471" | OC (orden de compra) -> PO; se conservo el id "OC-4471" tal cual, anteponiendo "PO".
- landing.chatWidget.validacion.checks.ivaCorrecto | "IVA del 16% correcto" | "16% VAT correct" | Mismo caso IVA/VAT.
- landing.chatWidget.alerta.detalle | "Aceros del Norte facturó dos veces la OC-4471 (folios A-1182 y A-1207). Riesgo de doble pago: $48,200." | "Aceros del Norte invoiced PO OC-4471 twice (invoices A-1182 and A-1207). Double payment risk: $48,200." | "folios" -> "invoices" y OC -> PO; nombres/ids demo conservados.
- landing.chatWidget.guiones.facturacion.agente1 | "Sí: mismo proveedor y monto que el folio A-1182 del 03 de junio. Te recomiendo no pagar A-1207 hasta confirmarlo. ¿La marco en revisión?" | "Yes: same supplier and amount as invoice A-1182 from June 3. I recommend not paying A-1207 until it's confirmed. Should I flag it for review?" | "folio" -> "invoice"; "marcar en revisión" -> "flag for review".
- landing.chatWidget.guiones.customerSuccess.agente1 | "Tu pedido va en camino y llega mañana. Te comparto la guía de rastreo y el detalle de la orden." | "Your order is on its way and arrives tomorrow. Here is the tracking number and the order details." | "guía de rastreo" (termino de paqueteria MX) -> "tracking number".
- landing.chatWidget.reporte.kpis.ticketPromedio | "Ticket promedio" | "Average ticket" | Termino de retail; alternativa "Average order value".
- landing.chatWidget.reporte.etiqueta | "Análisis de ventas · 3 meses" | "Sales analysis · 3 months" | Directa, pero es etiqueta de negocio del demo.
- landing.hero.titulo | "Agentes verticales de IA, con el modelo que tú elijas" | "Vertical AI agents, with the model you choose" | "Agentes verticales" es termino de posicionamiento de marca.
- landing.footer.tagline | "Ledesma AI Labs - Agentes verticales de IA para empresas" | "Ledesma AI Labs - Vertical AI agents for companies" | Tagline de marca; conserva el nombre Ledesma AI Labs.
- landing.primitivas.eyebrow | "Independiente del modelo" | "Model-independent" | Alternativa: "Model-agnostic" (mas comun en la industria).
- landing.integracion.titulo | "Lo montas en tres líneas" | "Set it up in three lines" | "Montar" (mount del widget); alternativa "You mount it in three lines".
- landing.ejemplos.cuentanosTuCaso | "Cuéntanos tu caso" | "Tell us about your case" | Alternativa mas natural: "Tell us about your use case".

Notas estructurales:

- landing.ejemplos.otroProcesoIntro / otroProcesoDestacado / otroProcesoResto: la frase original ya estaba partida en el JSX por el `<strong>` intermedio; se mantuvieron tres claves que se concatenan visualmente (mismo orden ES/EN). Idem introDestacado/introResto.
- landing.integracion.superficies.{web,whatsapp,slack,api} y landing.chatWidget.agentes.{ventas,customerSuccess}, reporte.meses.{jul,oct,nov}, validacion.campos.{rfc,subtotal,total}: identicos en ES y EN; se extrajeron de todos modos porque viven en arrays/records renderizados junto a hermanos que si se traducen (Correo/Email, Móvil/Mobile, Facturación/Invoicing, Ago/Aug, Dic/Dec...), para no mezclar literales y claves en la misma estructura.

## Seccion: agentes

# Review: traducciones dudosas (namespaces `agentes` y `playground`)

- agentes.lista.crearConConfigurador | "Crear con el Configurador" | "Create with the Configurator" | "Configurador" es nombre de una feature propia; confirmar si se traduce o se mantiene como nombre de producto.
- agentes.vacio.configuradorLabel | "Configurador" | "Configurator" | Mismo caso: posible nombre de producto que quiza no deba traducirse.
- agentes.vacio.conversarConConfigurador | "Conversar con el Configurador" | "Chat with the Configurator" | Mismo caso del nombre "Configurador".
- agentes.vacio.paso3Titulo | "Lo sueltas" | "You set it loose" | Frase coloquial de marketing; alternativas: "You ship it" / "You let it run".
- agentes.vacio.paso3Descripcion | "Tareas, triggers, recetas o embebido." | "Tasks, triggers, recipes or embedded." | "embebido" refiere al widget embebido; en ingles quiza "or embed it" suene mas natural.
- agentes.card.usarAgente | "Usar agente" | "Use agent" | Nombre unificado de la accion que lleva al Playground (antes "Conversar" en la tarjeta y "Probar agente" en el form).
- agentes.form.modeloDescripcion | "El cerebro que mueve al agente. Es intercambiable." | "The brain that powers the agent. It is swappable." | Metafora de marketing; traduccion libre.
- agentes.rotarSecreto.descripcion | "Se generara un secreto nuevo..." | "A new secret will be generated..." | Contiene el identificador LEDESMA_WEBHOOK_SECRET (se dejo tal cual en ambos idiomas).
- playground.titulo | "Playground: {{name}}" | "Playground: {{name}}" | Identico en ambos idiomas ("Playground" es nombre de la seccion); se extrajo igualmente por ser el titulo de la pagina con variable.
- playground.usoTokens | "{{input}} in / {{output}} out tokens" | "{{input}} in / {{output}} out tokens" | El texto original ya esta en ingles tecnico; identico en ambos locales.
- playground.credencial.pegarTitulo | "Pegar al momento" | "Paste on the spot" | Termino de producto del flujo de credenciales; alternativa: "Paste a one-time key".
- playground.credencial.descripcion | "Con que key conversa el agente..." | "Which key the agent chats with..." | Redaccion coloquial; traduccion algo libre para que suene natural.
- playground.credencial.sinCredenciales | "No tenes credenciales de {{provider}}..." | "You don't have {{provider}} credentials..." | El ES original esta en voseo sin acentos ("No tenes", "agregala"); se copio tal cual.
- playground.eligeCredencial | "Elegi una credencial o pega tu API key para probar el agente." | "Choose a credential or paste your API key to test the agent." | Voseo sin acento en el original ("Elegi"); se copio tal cual.

## Seccion: recetas-triggers

# Review: claves dudosas / terminos de negocio (namespaces recetas, triggers)

- recetas.titulo | "Recetas" | "Recipes" | termino de negocio central del producto (glosario receta->recipe); confirmar que en ingles se quiere "Recipes" y no dejarlo como nombre propio.
- recetas.gate.titulo | "Una funcion de los planes con autonomia" | "A feature of the plans with autonomy" | "autonomia/autonomy" es concepto de negocio del pricing; la frase en ingles suena algo literal ("plans with autonomy").
- triggers.gate.titulo | "Una funcion de los planes con autonomia" | "A feature of the plans with autonomy" | mismo caso que arriba.
- recetas.form.errorPlan | "Las recetas requieren el plan Autonomo (tier autonomous)." | "Recipes require the Autonomous plan (autonomous tier)." | "plan Autonomo" y "tier autonomous" son nombres internos de plan; verificar el nombre comercial en ingles.
- triggers.form.errorPlan | "Crear triggers requiere el plan Autonomo (tier autonomous)." | "Creating triggers requires the Autonomous plan (autonomous tier)." | mismo caso.
- recetas.errores.ejecutarPlan | "Ejecutar recetas requiere un plan con autonomia (Pro o Business)." | "Running recipes requires a plan with autonomy (Pro or Business)." | "plan con autonomia" es copy de negocio.
- recetas.retry.detalle | "...un reintento vuelve a ejecutar toda la receta..." | "...a retry runs the whole recipe again..." | "checkpoint" se dejo igual en ambos idiomas (termino tecnico); revisar tono.
- triggers.card.hintToken | "URL base. El token va en la URL..." | "Base URL. The token goes in the URL..." | frase densa; verificar que "Base URL" comunica lo mismo que "URL base" (base sin token).
- triggers.rotarDialog.titulo / triggers.rotarDialog.cuerpo | "Rotar {{material}}" / "Se generara un {{material}} nuevo..." | "Rotate {{material}}" / "A new {{material}} will be generated..." | el material interpolado ("secreto HMAC"/"token" vs "HMAC secret"/"token") cambia de genero/orden; en ingles "a new HMAC secret" funciona, pero revisar concordancia si se agregan mas materiales.
- triggers.rotarDialog.cuerpo | "...que veras UNA sola vez." | "...which you will see only ONCE." | enfasis en mayusculas replicado; confirmar estilo.
- triggers.reveal.yaLoCopie | "Ya lo copie" | "I copied it" | boton de confirmacion coloquial; alternativa comun en ingles: "Done" o "I saved it".
- recetas.eliminarDialog.cuerpoAntes/cuerpoDespues | "Vas a eliminar la receta" + "Esta accion no se puede deshacer." | "You are about to delete the recipe" + "This action cannot be undone." | la frase original se parte en dos claves alrededor del nombre resaltado (span); el punto tras el nombre queda en JSX. Verificar orden de palabras si se agrega otro idioma.
- triggers.eliminarDialog.cuerpoAntes/cuerpoDespues | "Vas a eliminar el trigger de" + "La URL del webhook dejara de funcionar y esta accion no se puede deshacer." | "You are about to delete the trigger for" + "The webhook URL will stop working and this action cannot be undone." | mismo patron de particion alrededor del span; "de"/"for" antes de la descripcion (agente · modo auth) puede no encajar en otros idiomas.
- recetas.card.ultimaEjecucion | "Ultima ejecucion:" | "Last run:" | etiqueta separada del valor (span aparte); los dos puntos quedan dentro de la clave.
- triggers.card.ultimoDisparo | "Ultimo disparo:" | "Last fired:" | mismo patron; "disparo" traducido como "fired" (glosario trigger).
- triggers.guia.cuerpoFirmado | "Cuerpo firmado" | "Signed body" | termino tecnico de la guia HMAC; podria ser "Signed payload" (el valor mostrado es signature.signedPayload).
- triggers.form.authHmacTag / authTokenTag | "Recomendado - mas seguro" / "Simple - menos seguro" | "Recommended - more secure" / "Simple - less secure" | copy de producto con guion simple (no se uso guion largo por regla).
- recetas.form.nombrePlaceholder | "Ej: Resumen y respuesta de pedidos" | "E.g.: Order summary and reply" | ejemplo de negocio; la forma "E.g.:" podria preferirse como "e.g." segun guia de estilo.

## Seccion: tareas-actividad

# Review: claves dudosas / terminos de negocio (namespaces `tareas`, `actividad`)

- tareas.gate.titulo | "Una funcion de los planes con autonomia" | "A feature of the autonomy plans" | "planes con autonomia" es termino de negocio; alternativa: "plans with autonomy".
- tareas.errores.requierePlan | "Programar tareas requiere el plan Autonomo (tier autonomous)." | "Scheduling tasks requires the Autonomous plan (autonomous tier)." | "plan Autonomo" y "tier autonomous" son nombres de plan/tier del producto; confirmar nomenclatura oficial en ingles.
- tareas.card.activar / tareas.avisos.activada | "Activar" / "Tarea activada." | "Activate" / "Task activated." | Podria preferirse "Resume"/"Task resumed" ya que es el opuesto de pausar.
- tareas.horario.proximoRun | "Proximo run estimado: {{fecha}}" | "Estimated next run: {{fecha}}" | El original mezcla espanol e ingles ("run"); se conservo el anglicismo en es y se tradujo natural en en.
- tareas.form.sinAgentes / tareas.form.sinCredenciales | "...<enlace>Crea uno en Agentes</enlace>." | "...<enlace>Create one in Agents</enlace>." | "Agentes"/"Credenciales" dentro del texto son nombres de secciones de la app; se tradujeron como "Agents"/"Credentials".
- actividad.fantasma.filas.origenTrigger | "Trigger factura-recibida" | "Trigger factura-recibida" | "factura-recibida" es un slug de ejemplo (dato demo); se dejo identico en ingles. Alternativa: "factura-recibida trigger".
- actividad.fantasma.filas.agenteCierre | "Cierre de facturas" | "Invoice closing" | Nombre demo de agente con termino contable; alternativa: "Invoice close-out".
- actividad.fantasma.filas.agenteCuentas | "Cuentas por pagar" | "Accounts payable" | Termino contable de negocio.
- actividad.fantasma.estados.enCurso | "En curso" | "Running" | Debe quedar consistente con el label del estado `running` que vive en lib/jobs.ts (fuera de este alcance).
- actividad.header.subtitulo | "Historial de ejecuciones de tus agentes: recetas, tareas programadas y triggers." | "Run history of your agents: recipes, scheduled tasks and triggers." | "triggers" se mantuvo igual (termino del producto).

Notas de implementacion (no son claves dudosas):
- "Playground" en la fila fantasma NO se extrajo (termino/nombre de producto identico en ambos idiomas, string completo); queda literal en ActivityGhostTable con `origenKey: null`.
- Se uso `Trans` de react-i18next en 4 textos con markup embebido (confirmacion de borrado, sinAgentes, sinCredenciales, ayuda de cron) para no partir frases.

## Seccion: cred-priv

# Review: cred-priv (namespaces `credenciales`, `privacidad`)

Claves con traduccion dudosa, terminos de negocio o texto legal a revisar:

- privacidad.avisoIntegral.titulo | "Aviso de Privacidad Integral" | "Comprehensive Privacy Notice" | termino legal LFPDPPP ("integral"); alternativas: "Full Privacy Notice". Texto legal: revisar traduccion.
- privacidad.avisoIntegral.subtitulo | "Detalle completo del tratamiento de tus datos personales conforme a la LFPDPPP y el GDPR." | "Full details of how your personal data is processed under the LFPDPPP and the GDPR." | texto legal: revisar traduccion.
- privacidad.avisoIntegral.secciones.* (titulo y placeholder de responsable, datos, finalidades, derechos, limitar-uso, ia, transferencias, cambios) | encabezados y placeholders exigidos por la LFPDPPP | traducciones EN correspondientes | texto legal: revisar traduccion completa por abogado; terminos como "responsable" -> "data controller", "titular" -> "data subject", "finalidades" -> "purposes" siguen la terminologia GDPR pero la LFPDPPP no tiene traduccion oficial.
- privacidad.avisoSimplificado.titulo | "Aviso de Privacidad Simplificado" | "Simplified Privacy Notice" | termino legal LFPDPPP. Texto legal: revisar traduccion.
- privacidad.avisoSimplificado.secciones.* (titulos y placeholders) | ver es.json | ver en.json | texto legal: revisar traduccion.
- privacidad.avisoSimplificado.secciones.integral.titulo | "Donde consultar el aviso integral" | "Where to read the comprehensive notice" | texto legal: revisar traduccion.
- privacidad.solicitudes.tipo.opposition | "Oposicion" | "Opposition" | derecho ARCO; en GDPR el equivalente usual es "objection" (right to object). Se mantuvo "Opposition" por ser el nombre ARCO. Termino de negocio/legal.
- privacidad.solicitudes.tipo.cancellation | "Cancelacion" | "Cancellation" | derecho ARCO; no confundir con "erasure" del GDPR (existe como tipo aparte). Termino de negocio/legal.
- privacidad.solicitudes.tipo.erasure | "Supresion" | "Erasure" | termino GDPR; revisar consistencia con textos legales.
- privacidad.solicitudes.estado.completed | "Resuelta" | "Resolved" | podria ser "Completed" segun el enum del backend; se eligio "Resolved" por fidelidad al espanol "Resuelta".
- privacidad.consentimiento.consultaIntegral | "Consulta el <integral>aviso de privacidad integral</integral>." | "See the <integral>comprehensive privacy notice</integral>." | depende de como se fije el titulo del aviso integral en EN.
- privacidad.consentimiento.aceptacion | "He leido y acepto el Aviso de Privacidad de la plataforma." | "I have read and accept the platform's Privacy Notice." | texto legal (declaracion de consentimiento): revisar traduccion.
- privacidad.consentimiento.intro | "La plataforma opera agentes de IA de forma autonoma que procesan datos. Para continuar, necesitamos tu consentimiento sobre como los tratamos." | "The platform operates AI agents autonomously that process data. To continue, we need your consent regarding how we handle it." | texto legal-adyacente (consentimiento informado): revisar traduccion.
- privacidad.aviso.placeholderTag | "Revision legal pendiente" | "Legal review pending" | etiqueta de estado legal; confirmar wording.
- credenciales.vacio.garantias.cifradaTitulo | "Cifrada al guardar" | "Encrypted when saved" | alternativa comun: "Encrypted at rest".
- credenciales.vacio.ejemploCifrada | "cifrada" | "encrypted" | badge en minusculas estilo codigo; confirmar que se quiere traducir (es visual/mono).
- credenciales.form.baseUrlPlaceholder | "https://api.miproveedor.com/v1" | "https://api.myprovider.com/v1" | placeholder tipo URL de ejemplo; se extrajo porque "miproveedor" se lee en espanol, confirmar si debe quedar fijo.
- credenciales.vacio.ejemploNombre | "Anthropic · produccion" | "Anthropic · production" | contiene nombre de marca (Anthropic) que no se traduce.
- credenciales.form.errorRechazo | "El backend rechazo la credencial. Revisa los datos." | "The backend rejected the credential. Check the data." | "backend" como termino tecnico visible al usuario; confirmar tono.

## Seccion: configurador

# Review: namespace `configurador`

- configurador.pagina.titulo | "Configurador" | "Configurator" | Nombre de la feature; podria ser nombre de producto que no se traduce. Se traduce por consistencia con el resto del ingles, confirmar con negocio.
- configurador.pagina.sesionAlMomento | "{{provider}} (al momento)" | "{{provider}} (on the spot)" | "al momento" es un termino propio del producto (key pegada, no guardada); alternativas: "one-time", "pasted". Se uso "on the spot" de forma consistente en todo el namespace.
- configurador.credencial.pegarTitulo | "Pegar al momento" | "Paste on the spot" | Mismo termino de negocio "al momento".
- configurador.errores.credencialNoDisponible | "La credencial guardada no esta disponible. Elegi otra o pega una al momento." | "The saved credential is not available. Choose another or paste one on the spot." | Mismo termino "al momento".
- configurador.credencial.sinCredenciales | "No tenes credenciales guardadas todavia. Pega una al momento o" | "You have no saved credentials yet. Paste one on the spot or" | Frase partida por un <Link> JSX (el link `sinCredencialesLink` y el punto final quedan fuera de la clave). En ingles el orden funciona igual, pero es fragil para otros idiomas; idealmente migrar a <Trans>.
- configurador.credencial.sinCredencialesLink | "agregala en Credenciales" | "add it in Credentials" | "Credenciales" es el nombre de la seccion/ruta de la app (/credenciales); debe coincidir con como se traduzca esa seccion en su namespace.
- configurador.errores.agenteRechazado | "El backend rechazo el agente. Revisa el preview." | "The backend rejected the agent. Check the preview." | "backend" y "preview" son terminos tecnicos; en el resto del namespace "vista previa" se tradujo como "preview", consistente.
- configurador.preview.faltaParaCrear | "Falta para poder crear:" | "Still needed before creating:" | Encabezado eliptico sin equivalente literal natural en ingles.
- configurador.pagina.modoAsistenteHint | "reviso y confirmo" | "I review and confirm" | Hint en primera persona del usuario; en ingles requiere el pronombre explicito.
- configurador.credencial.guardadaDescripcion | "Reusa una de tu boveda" | "Reuse one from your vault" | "boveda" es el termino de negocio para el almacen de credenciales; confirmar que "vault" es el termino elegido.
- configurador.demo.configurador4 | "Perfecto. Agente listo: lee el PDF, extrae proveedor, monto y fecha, y lo registra vía HTTP. ¿Lo probamos?" | "Perfect. Agent ready: it reads the PDF, extracts vendor, amount, and date, and records it via HTTP. Shall we try it?" | Texto de demo animada; "proveedor" aqui es proveedor de factura (vendor), no proveedor de modelo (provider).

## Seccion: panel-planes

# Review: panel-planes (namespaces panel, uso, planes, gates, onboarding)

Claves con traduccion dudosa, ambigua o termino de negocio sensible:

- panel.actividad.corridas | "Corridas" | "Runs" | termino de negocio; glosario dice corrida->run, pero "Corridas" vs "Ejecuciones" colapsan ambas en "Runs" en ingles
- panel.actividad.conError | "Con error" | "With errors" | singular/plural ambiguo en espanol; se eligio plural natural en ingles
- panel.gasto.descripcion | "Consumo estimado sobre la propia key del proveedor, desglosado por modelo." | "Estimated usage on your own provider key, broken down by model." | "la propia key" (BYOK) es concepto de negocio; se parafraseo como "your own provider key"
- panel.gasto.cacheLectura | "Cache lectura" | "Cache reads" | etiqueta compacta; podria ser "Cache read tokens"
- panel.gasto.cacheEscritura | "Cache escritura" | "Cache writes" | idem
- panel.gasto.sinTarifa_one/_other | "... (no se estima su costo en dinero) ..." | "... (its/their money cost is not estimated) ..." | giro "costo en dinero" (vs tokens) es concepto del producto; el posesivo cambia entre one/other en ingles
- uso.titulo | "Uso: {{nombre}}" | "Usage: {{nombre}}" | "Uso" como titulo de pantalla; alternativa "Consumption"
- planes.tarjeta.runsEquipos | "Ejecuciones ampliadas para equipos" | "Expanded runs for teams" | copy comercial del plan Business; "ampliadas" no tiene equivalente exacto
- planes.features.termModoUso | "Modo de uso" | "Usage mode" | termino de la tarjeta de planes; alternativa "How you use it"
- planes.features.playgroundYWidget | "Playground y embebido con tu widget" | "Playground and embedded with your widget" | "embebido" (feature embedded/widget) es termino de negocio
- planes.features.soporteAcompanamiento | "Prioritario con acompañamiento" | "Priority with hands-on guidance" | "acompañamiento" no tiene equivalente directo; se interpreto como acompanamiento cercano del equipo
- planes.dialogo.perdidasSeparador | " y a " | " and " | separador de lista con preposicion; en ingles la preposicion "to" ya vive en "access to", por eso solo " and "
- planes.dialogo.cambiarA | "Cambiar a {{plan}}" | "Switch to {{plan}}" | CTA de downgrade; alternativa "Change to {{plan}}"
- planes.perdidas.autonomia | "recetas, tareas programadas y triggers (autonomia)" | "recipes, scheduled tasks, and triggers (autonomy)" | "autonomia" es el nombre del pilar de producto
- gates.solicitarAcceso.nota | "Registra tu interes en el plan Autonomo..." | "Registers your interest in the Autonomous plan..." | "plan Autonomo" es nombre comercial del tier 'autonomous'; se tradujo como "Autonomous plan"
- gates.solicitarAcceso.enviada | "Solicitud enviada · te contactaremos" | "Request sent · we'll contact you" | separador con punto medio conservado tal cual
- gates.tareas.leyendaEjecutada | "ejecutada" | "completed" | marca de leyenda; literal seria "executed", se prefirio "completed" por naturalidad; revisar consistencia con panel.operaciones.completadas
- gates.tareas.tarea1Horario | "dias habiles 7:30" | "weekdays 7:30" | formato de horario de la maqueta; en ingles se dejaria 7:30 AM normalmente, pero se conservo el formato 24h de la demo
- gates.tareas.tarea3Horario | "diario 23:00" | "daily 23:00" | idem (23:00 vs 11:00 PM)
- gates.triggers.agenteCotizaciones | "Cotizaciones" | "Quotes" | nombre demo de agente; podria ser "Quoting"
- gates.triggers.resumen | "31 eventos este mes, 0 perdidos" | "31 events this month, 0 missed" | "perdidos" = eventos no atendidos; se eligio "missed" (alternativa "lost")
- onboarding.pasos.credencial.cta | "Poner credencial" | "Add credential" | "Poner" coloquial; "Add" es lo natural en ingles
- onboarding.pasos.agente.descripcion | "...Podes crearlo conversando con el Configurador." | "...You can create it by chatting with the Configurator." | voseo rioplatense ("Podes") sin marca equivalente en ingles; "Configurador" tratado como nombre de feature -> "Configurator"
- onboarding.pasos.ejecutar.descripcion | "Probalo en el Playground y observa tu primera corrida." | "Try it in the Playground and watch your first run." | voseo ("Probalo"); corrida->run
- onboarding.bienvenida.subtitulo | "Tu primer agente funcionando en 3 pasos · ~4 min" | "Your first agent up and running in 3 steps · ~4 min" | punto medio y "~4 min" conservados
- onboarding.primerosPasos | "Primeros pasos" | "Getting started" | literal seria "First steps"; "Getting started" es la convencion de producto en ingles

## Notas de implementacion (para quien fusiona)

- `planes.dialogo.cuerpo` usa markup de `<Trans>`: `<nombre>{{plan}}</nombre>` debe conservarse identico en ambos idiomas.
- Claves con plural i18next: `panel.gasto.masModelos`, `panel.gasto.sinTarifa`, `panel.grafica.ejecuciones`, `uso.grafica.tooltip` (sufijos `_one`/`_other` en ambos locales).
- `planes.avisoLanzamiento` (es) debe quedar EXACTAMENTE igual a la constante `LAUNCH_NOTICE` de `apps/console/src/lib/plans.ts` (el dom-test compara contra la constante).
- NO extraidos a proposito: `plan.price` ("Gratis") y `plan.priceSuffix` ("/mes") en `lib/plans.ts` porque `test/plans.test.ts` fija esos literales como invariantes de datos (prohibido editar tests). En ingles la tarjeta seguira mostrando "Gratis /mes" hasta que se decida como destrabarlo.

## Seccion: admin-cuenta-ui

# Review: admin-cuenta-ui (claves con traduccion dudosa / termino de negocio)

- admin.tier.autonomo | "Autónomo" | "Autonomous" | Nombre del tier/plan de pago: termino de negocio. Free/Pro quedan identicos.
- admin.cambioTier.titulo | "Cambiar tier" | "Change tier" | "Tier" es anglicismo de negocio ya usado en ES; se dejo "tier" en ambos idiomas (aplica a todo admin.cambioTier.*).
- admin.comun.registro | "Registro" | "Signed up" | Encabezado de columna y label de fecha de alta; alternativas: "Registered" / "Sign-up date".
- admin.ficha.datosTitulo | "Datos" | "Details" | Titulo de seccion; literal seria "Data" pero "Details" es mas natural para una ficha.
- admin.ficha.cargandoFicha | "Cargando la ficha del usuario..." | "Loading the user's record..." | "Ficha" no tiene equivalente exacto; se uso "record" (tambien en admin.ficha.errorFicha).
- admin.ficha.licenciaTitulo | "Licencia" | "License" | Termino de negocio: la seccion en realidad opera el plan/tier del usuario.
- admin.ficha.actividadDescripcion | "Operaciones, ejecuciones y gasto del usuario. El gasto es consumo sobre la propia key del usuario (BYOK), no un cobro de Ledesma." | "The user's operations, runs and spend. Spend is consumption on the user's own key (BYOK), not a charge from Ledesma." | Contiene terminos de negocio (BYOK, key, Ledesma).
- admin.usuarios.sinResultados | "No encontramos usuarios que coincidan con <destacado>«{{termino}}»</destacado>." | "We didn't find any users matching <destacado>“{{termino}}”</destacado>." | Se adaptaron las comillas «» a “ ” en ingles; confirmar preferencia tipografica.
- admin.comun.usuarioNoExiste | "No encontramos a este usuario. Es posible que ya no exista." | "We couldn't find this user. It may no longer exist." | Clave reutilizada en dos contextos (404 del cambio de tier y ficha no encontrada); en ES eran el mismo texto exacto.
- configuracion.subtitulo | "Administra los datos de tu cuenta y el plan de tu espacio." | "Manage your account details and your workspace plan." | "Espacio" se tradujo como "workspace" (interpretacion de producto).
- cuenta.uso.titulo | "Uso del periodo" | "Usage this period" | Alternativa mas literal: "Period usage".
- cuenta.uso.deLimite | "de {{limite}}" | "of {{limite}}" | Fragmento de la frase visible "{usadas} de {limite}" que queda partida por un <span> de estilo; no se pudo unificar sin cambiar el JSX/estilos.
- cuenta.eliminar.emailPlaceholder | "tu@email.com" | "you@email.com" | Placeholder de ejemplo; el equivalente en ingles es inventado.
- ui.menuUsuario.mejorarPlan | "Mejorar Plan" | "Upgrade Plan" | Nombre de item de menu de producto (capitalizacion de titulo intencional en ambos).
- admin.etiquetas.empresa | "Empresa" | "Company" | Es la etiqueta del account_type `empresa_member`; podria preferirse "Business" u "Organization".
- admin.ficha.si | "Si" | "Yes" | El original en ES viene sin acento ("Si", no "Sí"); se copio tal cual por regla.

## Seccion: barrido final de lib/ (coordinador)

- tareas.cron.dias.* | "domingos/lunes/..." (plural) | "Sunday/Monday/..." (singular) | en ingles la frase "Every Monday at 09:00" usa el dia en singular; revisar que suene natural con tareas.cron.cadaSemana
- tareas.cron.cadaSemana | "Todos los {{dia}} a las {{hora}}" | "Every {{dia}} at {{hora}}" | composicion de frase con dia interpolado
- tareas.cron.cadaMes | "El dia {{dia}} de cada mes a las {{hora}}" | "On day {{dia}} of every month at {{hora}}" | fraseo tecnico de horarios
- triggers.authModeEtiqueta.hmac | "HMAC (firma)" | "HMAC (signature)" | termino tecnico
- uso.estado.detenida | "Detenida" | "Stopped" | podria ser "Aborted" segun la terminologia que prefieras
- landing.ejemplos.agentes.quotations.nombre | "Cotizaciones" | "Quotes" | nombre de agente demo; podria ser "Quoting" o "Quotations"
- Nota: formatRunAt (lib/schedule.ts) y formatWhen (lib/usage.ts) ahora formatean fechas con el locale del idioma activo (antes fijo "es"/"es-MX"); en espanol el resultado es identico
- Nota: lib/privacy.ts conserva sus labels en espanol como constantes (los tests los fijan y la UI ya no los renderiza: las paginas resuelven las claves privacidad.* en el render)

## Notas de la revision adversarial (post-extraccion)

- Plurales: el espanol moderno tiene categoria "many" (Intl.PluralRules) para >= 1,000,000 y i18next no cae de _other cuando falta _many; se agregaron claves _many (copia de _other) a los 9 pares plurales en ambos idiomas para que un contador de un millon no renderice la clave cruda.
- Animaciones con guion traducido (chat de la landing y demo del Configurador): se remontan con key por idioma al cambiar de idioma, para que el guion arranque de cero en vez de mezclar corridas.
- Fechas: formatRunAt, formatWhen/formatRunDate, formatDayLabel y formatDate (admin) siguen el idioma activo; en espanol el resultado es identico al de antes. PrivacyRightsPage conserva toLocaleDateString() sin locale (comportamiento previo, por navegador).
- Variantes preexistentes del mensaje de sesion expirada (con acentos, sin acentos y con voseo en NewPasswordForm) se extrajeron TAL CUAL del codigo original en claves separadas; unificar el wording queda como decision de producto fuera de este PR.
- lib/plans.ts conserva LAUNCH_NOTICE (los tests lo importan y la pagina debe renderizar exactamente ese texto via planes.avisoLanzamiento).
