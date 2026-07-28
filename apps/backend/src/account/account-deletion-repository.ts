import type { Sql } from '../db/client.js';

/**
 * Que paso con la organizacion del owner al borrar su cuenta:
 *   - 'deleted'         -> el owner era el UNICO miembro: la org se borro con el.
 *   - 'retained_shared' -> la org tiene OTROS miembros: NO se borra (solo se removio al owner al borrar su
 *                          perfil). Protege los datos de los demas owners (punto de mayor riesgo).
 *   - 'none'            -> el owner no pertenecia a ninguna org (individuo).
 */
export type OrganizationOutcome = 'deleted' | 'retained_shared' | 'none';

/**
 * Conteo por tabla de lo que el motor borro/anonimizo para un owner. Sirve para la nota de resolucion del
 * erasure ARCO y para las aserciones de los tests. `adminActionsAnonymized` NO es un borrado: es la
 * cantidad de filas de admin_actions cuyo actor_id se nulifico (la fila se CONSERVA para el audit trail).
 */
export interface AccountDataDeletionResult {
  agents: number;
  agentRuns: number;
  jobs: number;
  scheduledTasks: number;
  triggers: number;
  recipes: number;
  processingRecords: number;
  providerCredentials: number;
  /**
   * Aceptaciones legales del titular. Suma las filas de `aceptaciones_legales` (V039, la tabla vigente) y
   * las de `consents` (V014, congelada como historico): el erasure tiene que llevarse las dos, y para el
   * titular es UN solo concepto, asi que se reporta como un solo numero.
   */
  consents: number;
  dataSubjectRequests: number;
  upgradeRequests: number;
  sitiosConectados: number;
  /** Trayectorias de tareas web (V030); sus pasos caen por el on delete cascade de la FK. */
  trayectoriasWeb: number;
  /** Recetas de tareas web (V035): lo aprendido de las navegaciones del owner. */
  recetasWeb: number;
  /**
   * contexto_externo_id de los sitios conectados borrados (los no nulos): referencias de contextos
   * de navegador que viven en un PROVEEDOR EXTERNO y que el borrado local no alcanza. El purgado en
   * el proveedor es de 7.1b; se devuelven desde ya para que ese paso tenga su insumo (borrado ARCO
   * en ambos lados).
   */
  sitiosConectadosContextosExternos: string[];
  adminActionsAnonymized: number;
  subscriptions: number;
  usageCounters: number;
  profiles: number;
  organization: OrganizationOutcome;
}

interface IdRow {
  id: string;
}

/**
 * MOTOR DE BORRADO DE DATOS DE CUENTA (atomico). Borra/anonimiza TODOS los datos de negocio de un owner en
 * UNA transaccion (this.sql.begin): todo o nada. Es el SUPERCONJUNTO ATOMICO del viejo
 * eraseOwnerOperationalData (6 DELETE sueltos, no atomico -> hallazgo H-01 de la auditoria 8): cubre las 18
 * tablas, respeta las FKs y protege a los demas owners.
 *
 * NO borra auth.users: eso vive en el sistema de autenticacion de Supabase (sin FK ni transaccion comun con
 * Postgres) y es un paso SEPARADO Y OPCIONAL del orquestador (account-deletion-service.ts).
 *
 * ORDEN de borrado (respeta cada FK; ver migraciones V001-V023):
 *   1. Se lee la pertenencia a la org ANTES de borrar el perfil (para decidir el destino de la org).
 *   2. Hijos de agents por owner_id: agent_runs, jobs, scheduled_tasks, triggers, recipes,
 *      processing_records. Se borran EXPLICITO por owner_id (no solo via el cascade de agents) porque
 *      processing_records.agent_id es NULLABLE: una fila con agent_id null no la alcanzaria el cascade.
 *   3. agents: el `on delete cascade` de sus 6 hijos limpia cualquier remanente (defensa en profundidad).
 *   4. Tablas sueltas por owner_id sin FK: provider_credentials, aceptaciones_legales (V039) y consents
 *      (V014, historica), data_subject_requests,
 *      upgrade_requests, sitios_conectados (V024; ademas recoge sus contexto_externo_id para el
 *      purgado en el proveedor externo, que ejecuta 7.1b), trayectorias_web (V030; su cascade
 *      arrastra pasos_trayectoria) y recetas_web (V035).
 *   5. admin_actions: se ANONIMIZA (UPDATE actor_id = null), NO se borra, para conservar el audit trail
 *      (guia de la tarea). target_id (NOT NULL) se retiene como id opaco: tras borrar el perfil ya no
 *      resuelve a una persona identificable, y ofuscarlo romperia la correlacion del log.
 *   6. Hijos de profiles: subscriptions, usage_counters (FK a profiles(id) SIN on delete -> antes que el
 *      perfil).
 *   7. profiles (FK a organizations(id) SIN on delete -> antes que la org).
 *   8. organizations: SOLO si, tras borrar este perfil, la org queda SIN miembros (protege orgs
 *      compartidas). Se toma un lock `for update` sobre la fila de la org y se RECUENTAN los miembros
 *      DESPUES de borrar el perfil, para SERIALIZAR borrados concurrentes de miembros de la misma org
 *      (evita el write-skew: dos miembros borrados a la vez que ambos "ven" al otro y dejan la org
 *      huerfana). Con el lock, el ultimo en borrarse ve al anterior ya ido y limpia la org.
 *
 * AISLAMIENTO: cada sentencia se acota por el ownerId dado (owner_id / id / profile_id / actor_id / org_id
 * del propio owner). El motor JAMAS toca datos de otro owner.
 */
export class AccountDeletionRepository {
  constructor(private readonly sql: Sql) {}

  async deleteAccountData(ownerId: string): Promise<AccountDataDeletionResult> {
    // begin: si CUALQUIER paso lanza, postgres.js hace ROLLBACK y re-propaga -> la cuenta queda intacta.
    // Las consultas corren en SERIE: dentro de la transaccion el sql usa una sola conexion y no admite
    // consultas concurrentes (mismo criterio que registration-repository.ts).
    return this.sql.begin(async (tx) => {
      // --- (1) Pertenencia a la org, ANTES de borrar el perfil (necesitamos su org_id; el perfil se
      //         borra en el paso 7, asi que hay que leerlo ahora). La decision de borrar la org se toma
      //         al final (paso 8), con lock y recuento, para ser correcta bajo concurrencia. ---
      const profileOrgRows = await tx<Array<{ org_id: string | null }>>`
        select org_id from profiles where id = ${ownerId}
      `;
      const orgId = profileOrgRows[0]?.org_id ?? null;

      // --- (2) Hijos de agents por owner_id (antes que agents) ---
      const agentRuns = await tx<IdRow[]>`delete from agent_runs where owner_id = ${ownerId} returning id`;
      const jobs = await tx<IdRow[]>`delete from jobs where owner_id = ${ownerId} returning id`;
      const scheduledTasks = await tx<IdRow[]>`delete from scheduled_tasks where owner_id = ${ownerId} returning id`;
      const triggers = await tx<IdRow[]>`delete from triggers where owner_id = ${ownerId} returning id`;
      const recipes = await tx<IdRow[]>`delete from recipes where owner_id = ${ownerId} returning id`;
      const processingRecords = await tx<IdRow[]>`delete from processing_records where owner_id = ${ownerId} returning id`;

      // --- (3) agents (el cascade limpia hijos remanentes) ---
      const agents = await tx<IdRow[]>`delete from agents where owner_id = ${ownerId} returning id`;

      // --- (4) Tablas sueltas por owner_id (sin FK) ---
      const providerCredentials = await tx<IdRow[]>`delete from provider_credentials where owner_id = ${ownerId} returning id`;
      // Aceptaciones legales: la tabla VIGENTE (V039) y la historica (V014). Las dos se borran; la
      // historica sigue existiendo hasta que una migracion posterior la retire.
      const aceptacionesLegales = await tx<IdRow[]>`delete from aceptaciones_legales where owner_id = ${ownerId} returning id`;
      const consents = await tx<IdRow[]>`delete from consents where owner_id = ${ownerId} returning id`;
      const dataSubjectRequests = await tx<IdRow[]>`delete from data_subject_requests where owner_id = ${ownerId} returning id`;
      const upgradeRequests = await tx<IdRow[]>`delete from upgrade_requests where owner_id = ${ownerId} returning id`;
      // sitios_conectados (V024): borra la sesion heredada CIFRADA del owner y recoge los
      // contexto_externo_id para que el purgado en el proveedor externo (7.1b) tenga su insumo.
      const sitiosConectados = await tx<Array<{ id: string; contexto_externo_id: string | null }>>`
        delete from sitios_conectados where owner_id = ${ownerId} returning id, contexto_externo_id
      `;
      // trayectorias_web (V030): la traza censurada de las tareas web del owner. Sin FK a jobs a
      // proposito (retencion independiente), por eso se borra EXPLICITO por owner_id; el on delete
      // cascade de pasos_trayectoria arrastra los pasos de cada trayectoria.
      const trayectoriasWeb = await tx<IdRow[]>`
        delete from trayectorias_web where owner_id = ${ownerId} returning id
      `;
      // recetas_web (V035): lo APRENDIDO de las tareas web del owner (como localizar cada elemento
      // de sus flujos). Sin FK a nada a proposito, por eso se borra explicito por owner_id. NO es la
      // tabla `recipes` de V013, que se borra aparte mas arriba.
      const recetasWeb = await tx<IdRow[]>`
        delete from recetas_web where owner_id = ${ownerId} returning id
      `;

      // --- (5) admin_actions: ANONIMIZAR (no borrar). Conserva la fila, quita el vinculo personal actor. ---
      const adminActions = await tx<IdRow[]>`
        update admin_actions set actor_id = null where actor_id = ${ownerId} returning id
      `;

      // --- (6) Hijos de profiles (antes que profiles) ---
      const subscriptions = await tx<IdRow[]>`delete from subscriptions where profile_id = ${ownerId} returning id`;
      const usageCounters = await tx<IdRow[]>`delete from usage_counters where profile_id = ${ownerId} returning id`;

      // --- (7) profiles (antes que organizations) ---
      const profiles = await tx<IdRow[]>`delete from profiles where id = ${ownerId} returning id`;

      // --- (8) organizations: solo si, ya borrado este perfil, la org quedo SIN miembros. Se toma un
      //         lock `for update` sobre la fila de la org para SERIALIZAR borrados concurrentes de sus
      //         miembros, y se recuenta DESPUES de borrar el perfil (el propio perfil ya no cuenta). Asi,
      //         si dos miembros de una org de dos se borran a la vez, el segundo ve al primero ya ido y
      //         limpia la org (sin write-skew que la deje huerfana). ---
      let organization: OrganizationOutcome = 'none';
      if (orgId !== null) {
        await tx`select id from organizations where id = ${orgId} for update`;
        const memberRows = await tx<Array<{ n: number }>>`
          select count(*)::int as n from profiles where org_id = ${orgId} and id <> ${ownerId}
        `;
        const remainingMembers = memberRows[0]?.n ?? 0;
        if (remainingMembers === 0) {
          await tx`delete from organizations where id = ${orgId}`;
          organization = 'deleted';
        } else {
          organization = 'retained_shared';
        }
      }

      return {
        agents: agents.length,
        agentRuns: agentRuns.length,
        jobs: jobs.length,
        scheduledTasks: scheduledTasks.length,
        triggers: triggers.length,
        recipes: recipes.length,
        processingRecords: processingRecords.length,
        providerCredentials: providerCredentials.length,
        consents: aceptacionesLegales.length + consents.length,
        dataSubjectRequests: dataSubjectRequests.length,
        upgradeRequests: upgradeRequests.length,
        sitiosConectados: sitiosConectados.length,
        trayectoriasWeb: trayectoriasWeb.length,
        recetasWeb: recetasWeb.length,
        sitiosConectadosContextosExternos: sitiosConectados
          .map((r) => r.contexto_externo_id)
          .filter((x): x is string => typeof x === 'string' && x.length > 0),
        adminActionsAnonymized: adminActions.length,
        subscriptions: subscriptions.length,
        usageCounters: usageCounters.length,
        profiles: profiles.length,
        organization,
      };
    });
  }
}
