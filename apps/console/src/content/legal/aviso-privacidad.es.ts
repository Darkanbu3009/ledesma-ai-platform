import type { DocumentoLegal } from './tipos';

/**
 * AVISO DE PRIVACIDAD INTEGRAL, version en espanol. Texto definitivo, revisado y validado legalmente.
 *
 * Todo lo que este texto afirma sobre el tratamiento sale de LEER EL CODIGO, no de una plantilla: las
 * categorias de datos son las columnas reales de las migraciones, los plazos de conservacion son los de
 * retention-policy.ts y las funciones de purga, y las medidas de seguridad son las que estan implementadas.
 * Si cambias el comportamiento de la plataforma, este texto deja de ser cierto y hay que actualizarlo.
 *
 * Para SUBIR DE VERSION ver el procedimiento en apps/backend/src/privacy/documents.ts.
 */
export const AVISO_PRIVACIDAD_ES: DocumentoLegal = {
  tipo: 'privacy_notice',
  version: '2026-07-30',
  fecha: '30 de julio de 2026',
  titulo: 'Aviso de Privacidad Integral',
  subtitulo:
    'Cómo tratamos tus datos personales en la plataforma Ledesma AI Labs, qué hacemos con ellos y cómo puedes controlarlos.',
  secciones: [
    {
      id: 'responsable',
      titulo: '1. Identidad y domicilio del responsable',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Omar Ledesma, persona física con actividad empresarial, que opera bajo el nombre comercial Ledesma AI Labs, es el responsable del tratamiento de tus datos personales. La constitución de la persona moral se encuentra en proceso; al constituirse se actualizará este aviso y se te solicitará aceptar la nueva versión.',
        },
        {
          tipo: 'definiciones',
          items: [
            { termino: 'Nombre comercial', descripcion: 'Ledesma AI Labs' },
            {
              termino: 'Responsable',
              descripcion:
                'Omar Ledesma, persona física con actividad empresarial, operando bajo el nombre comercial Ledesma AI Labs',
            },
            { termino: 'Ubicación', descripcion: 'Monterrey, Nuevo León, México' },
            { termino: 'Inicio de operaciones', descripcion: '2026' },
            {
              termino: 'Correo de contacto y para derechos ARCO',
              descripcion: 'contacto@ledesma-ai-labs.com',
            },
            { termino: 'Sitio', descripcion: 'https://www.ledesma-ai-labs.com' },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Este aviso se emite conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares publicada en marzo de 2025, que abrogó la ley de 2010, y su reglamento aplicable. Además incorporamos principios de buenas prácticas internacionales (minimización, limitación de la finalidad y portabilidad) porque la plataforma puede tener usuarios fuera de México.',
        },
      ],
    },
    {
      id: 'datos',
      titulo: '2. Datos personales que tratamos y de dónde provienen',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Todos los datos que tratamos los obtenemos de ti, de forma directa, cuando creas tu cuenta, configuras la plataforma o la usas. No compramos ni adquirimos datos personales de terceros ni de fuentes de acceso público.',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Datos de identificación y de cuenta',
              descripcion:
                'Correo electrónico, nombre completo, tipo de cuenta (persona o empresa), rol, nombre de la organización cuando aplica, país de operación, plan contratado y fechas de alta y actualización. Tu contraseña vive exclusivamente en el sistema de autenticación de Supabase, en forma cifrada; nunca llega a nuestras tablas ni la podemos leer.',
            },
            {
              termino: 'Credenciales de proveedores de modelo (esquema BYOK)',
              descripcion:
                'La llave de API del proveedor de inteligencia artificial que tú aportas, junto con una etiqueta que tú eliges y, cuando aplica, la URL base del servicio. La llave se guarda siempre cifrada con AES-256-GCM y nunca se muestra de vuelta en la interfaz.',
            },
            {
              termino: 'Contextos de sesión de los sitios que conectas',
              descripcion:
                'Cuando conectas un sitio, tú mismo inicias sesión en una vista en vivo del navegador y la plataforma hereda ese contexto de sesión (cookies y almacenamiento del navegador). Ese contexto se guarda siempre cifrado con AES-256-GCM. Guardamos también el dominio del sitio, el estado de la conexión, el país de salida que queda fijado a esa conexión y, con fines de observabilidad, la dirección IP de salida de la sesión del navegador remoto.',
            },
            {
              termino: 'Trayectorias de las tareas web',
              descripcion:
                'Por cada ejecución del motor de navegación registramos el dominio, el objetivo que escribiste en lenguaje natural, el desenlace, la duración y los tokens consumidos. Por cada acción registramos el tipo de acción, la instrucción, la estrategia de localización del elemento, la dirección donde ocurrió y el valor escrito ya censurado. La censura corre antes de escribir en la base: los valores de campos sensibles (contraseñas, tarjetas, tokens) no llegan a nuestros registros.',
            },
            {
              termino: 'Capturas de pantalla de los puntos de aprobación',
              descripcion:
                'Cuando una tarea se detiene para pedirte autorización antes de una acción relevante, guardamos una captura de lo que el agente veía en ese momento, junto con la descripción de la acción y tu decisión. Las capturas viven en un almacenamiento privado con control de acceso por usuario.',
            },
            {
              termino: 'Grabaciones y recetas de tareas',
              descripcion:
                'Cuando le enseñas una tarea a la plataforma haciéndola tú mismo una vez, guardamos los pasos de ese procedimiento. El inicio de sesión nunca se graba: si durante la grabación aparece un campo de contraseña, la captura se detiene, lo capturado se descarta y la grabación queda marcada como descartada. Al convertir una grabación en receta, los valores que marcas como variables se sustituyen por un marcador y el valor concreto se resuelve en cada ejecución.',
            },
            {
              termino: 'Datos de ejecución y de uso',
              descripcion:
                'Estado de cada tarea, marcas de tiempo, tokens consumidos y costo estimado, errores y metadatos de las corridas de tus agentes. Sirven para que puedas ver tu actividad, para facturación y para diagnosticar fallas.',
            },
            {
              termino: 'Contenido que tú envías a los agentes',
              descripcion:
                'Los mensajes que escribes en el configurador o en el playground, los archivos que adjuntas (de los que se extrae texto para dárselo al modelo) y, si usas el dictado por voz, el audio que grabas para transcribirlo. El audio se envía al servicio de transcripción y no se conserva; el texto transcrito se te devuelve para que lo revises antes de enviarlo.',
            },
            {
              termino: 'Pulsaciones de teclado desde el relay móvil',
              descripcion:
                'Si usas tu teléfono como teclado para escribir dentro de una sesión de navegador, el texto que tecleas viaja cifrado desde tu dispositivo hasta el servicio de relay. Ese texto no se almacena: solo se retransmite hacia la sesión del navegador. En la sección 8 explicamos con precisión hasta dónde llega ese cifrado.',
            },
            {
              termino: 'Evidencia de tus aceptaciones legales',
              descripcion:
                'Qué documento aceptaste, en qué versión, la fecha y hora, y un valor derivado de tu dirección IP mediante una función criptográfica de una sola vía. No conservamos tu dirección IP en claro asociada a esa aceptación: el valor derivado no se puede revertir.',
            },
            {
              termino: 'Solicitudes de derechos y registros de cumplimiento',
              descripcion:
                'Las solicitudes ARCO que nos envías, su estado y su resolución, así como el registro de actividades de tratamiento asociado a tus agentes.',
            },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'No solicitamos datos personales sensibles, y la plataforma no está diseñada para tratarlos. Si decides conectar un sitio o ejecutar tareas en servicios donde existan datos sensibles tuyos o de terceros, esa decisión y sus consecuencias son tuyas: revisa la sección de responsabilidades en los Términos de Servicio antes de hacerlo.',
        },
      ],
    },
    {
      id: 'finalidades-primarias',
      titulo: '3. Finalidades primarias (necesarias para prestarte el servicio)',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Estas finalidades son necesarias para la relación jurídica contigo. Si te opones a ellas, no podemos prestarte el servicio.',
        },
        {
          tipo: 'lista',
          items: [
            'Autenticarte, crear y administrar tu cuenta, tu organización y tu plan.',
            'Guardar de forma cifrada las credenciales de proveedor de modelo que tú aportas y usarlas para ejecutar las tareas que tú ordenas.',
            'Guardar de forma cifrada los contextos de sesión de los sitios que tú conectas, para poder retomar esas sesiones al ejecutar tus tareas.',
            'Ejecutar en tu nombre las tareas que tú ordenas dentro de los sitios que tú conectaste, incluida la navegación automatizada, la escritura en formularios y la lectura de las páginas necesarias para completar la tarea.',
            'Detener una tarea y pedirte autorización explícita antes de acciones relevantes, mostrándote la descripción y la captura de lo que el agente veía.',
            'Registrar el historial de actividad (tareas, trayectorias, aprobaciones y consumo) para que puedas consultarlo, auditarlo y diagnosticar fallas.',
            'Aprender de las tareas que tú enseñas o que tus agentes completan, para convertirlas en recetas reutilizables dentro de TU cuenta.',
            'Medir tu consumo y aplicar los límites de tu plan, y facturarte cuando corresponda.',
            'Atender tus solicitudes de soporte y de ejercicio de derechos, y conservar la evidencia de tus aceptaciones legales.',
            'Cumplir obligaciones legales aplicables y atender requerimientos de autoridad competente.',
          ],
        },
      ],
    },
    {
      id: 'finalidades-secundarias',
      titulo: '4. Finalidades secundarias (no necesarias, puedes oponerte)',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Estas finalidades no son necesarias para prestarte el servicio. Puedes oponerte a ellas en cualquier momento escribiendo a contacto@ledesma-ai-labs.com sin que eso afecte tu uso de la plataforma.',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Aprendizaje estructural agregado sobre sitios web',
              descripcion:
                'Mejorar la fiabilidad del servicio para todos los usuarios aprendiendo cómo están construidos los sitios web. Lo que se agrega es exclusivamente estructura: el dominio del sitio, el tipo de elemento con el que se interactuó (por ejemplo, campo de búsqueda o botón de envío) y la estrategia que funcionó para localizar ese elemento en la página. Nunca se agregan los contenidos de las páginas, los valores que escribiste, los textos que leíste ni ningún dato personal, y los identificadores de origen se convierten en valores derivados mediante una función criptográfica de una sola vía, de modo que la estructura aprendida no se puede volver a asociar contigo. Esta finalidad está en operación: la plataforma agrega estructura de los sitios web sobre los que se ejecutan tareas, con el alcance descrito arriba y ninguno mayor.',
            },
            {
              termino: 'Alertas operativas y comunicaciones del servicio por correo',
              descripcion:
                'Enviarte a tu correo mensajes de bienvenida, avisos de estado del servicio y alertas operativas sobre tu cuenta.',
            },
          ],
        },
      ],
    },
    {
      id: 'decisiones-automatizadas',
      titulo: '5. Agentes de inteligencia artificial y decisiones automatizadas',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'La plataforma opera agentes de inteligencia artificial que actúan de forma autónoma dentro de los sitios que tú conectas: navegan, leen páginas, escriben en formularios y ejecutan acciones para completar la tarea que tú les encomendaste. Estás interactuando con un sistema automatizado, no con una persona.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Tú controlas el alcance de esa autonomía mediante tu política de ejecución, y la plataforma detiene la tarea y te pide autorización explícita antes de acciones relevantes, mostrándote qué está por hacer y una captura de lo que el agente ve. Tu decisión queda registrada. En cualquier momento puedes detener una tarea en curso, desconectar un sitio o revocar la credencial de tu proveedor de modelo.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Si consideras que una decisión automatizada te produce un efecto significativo, puedes solicitar intervención humana y oponerte a ella escribiendo a contacto@ledesma-ai-labs.com.',
        },
      ],
    },
    {
      id: 'transferencias',
      titulo: '6. Encargados y transferencias',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'No vendemos tus datos personales ni los cedemos con fines comerciales. Para operar la plataforma nos apoyamos en los siguientes proveedores, que actúan como encargados y tratan los datos únicamente conforme a nuestras instrucciones y a sus propios términos:',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Supabase (Estados Unidos)',
              descripcion:
                'Autenticación, base de datos y almacenamiento de archivos. Aquí viven tu cuenta, tus tablas de datos y las capturas de los puntos de aprobación.',
            },
            {
              termino: 'Railway (Estados Unidos)',
              descripcion:
                'Alojamiento de los servicios de backend, del worker de navegación y del servicio de relay.',
            },
            {
              termino: 'Vercel (Estados Unidos)',
              descripcion: 'Alojamiento y entrega de la interfaz web de la plataforma.',
            },
            {
              termino: 'Browserbase (Estados Unidos)',
              descripcion:
                'Provisión de los navegadores remotos donde ocurren tus sesiones y tus tareas web, incluida la salida a internet a través de la región que quedó fijada a cada conexión.',
            },
            {
              termino: 'Proveedor de modelo que tú eliges, bajo esquema BYOK',
              descripcion:
                'Anthropic (Estados Unidos), OpenAI (Estados Unidos) u otro proveedor compatible que tú configures. Bajo el esquema BYOK, tú aportas tu propia llave de API y la relación con ese proveedor es tuya: el contenido que se le envía se rige también por los términos y el aviso de privacidad de ese proveedor, que te corresponde revisar. Nosotros no elegimos ese proveedor por ti ni podemos modificar sus políticas.',
            },
            {
              termino: 'OpenAI (Estados Unidos), para el dictado por voz',
              descripcion:
                'Si usas el dictado por voz, el audio se envía a este servicio para transcribirlo. Esta función usa una llave de la plataforma, no la tuya, y es opcional: si no dictas por voz, no se envía audio a ningún lado.',
            },
            {
              termino: 'Resend (Estados Unidos)',
              descripcion:
                'Envío de los correos de la plataforma (bienvenida y alertas operativas). Recibe tu dirección de correo y el contenido del mensaje.',
            },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Como estos proveedores operan desde el extranjero, el uso de la plataforma implica una transferencia internacional de datos necesaria para prestarte el servicio que tú solicitaste. Además de las transferencias anteriores, podremos comunicar datos cuando lo exija una autoridad competente o una disposición legal.',
        },
      ],
    },
    {
      id: 'conservacion',
      titulo: '7. Plazos de conservación y purga',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Conservamos cada dato el tiempo necesario para su finalidad. Estos son los plazos que la plataforma tiene implementados hoy:',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Trayectorias de tareas web y sus pasos: 30 días',
              descripcion:
                'Es el plazo más corto a propósito, porque aunque los valores estén censurados los pasos describen tu actividad dentro de tus sitios.',
            },
            {
              termino: 'Tareas ya terminadas: 90 días desde que finalizaron',
              descripcion:
                'Solo se purgan las tareas en estado terminal. Las que están pendientes o en curso nunca se tocan.',
            },
            {
              termino: 'Metadatos de corridas de agentes: 365 días',
              descripcion:
                'Son metadatos de uso (sin el contenido de los mensajes), y un año permite consultar tu consumo anual antes de purgarlos.',
            },
            {
              termino: 'Coordinación del relay de teclado: minutos',
              descripcion:
                'Los registros de coordinación viven una ventana de quince minutos como máximo y un barrido los elimina cada diez minutos.',
            },
            {
              termino:
                'Cuenta, credenciales cifradas, sitios conectados y recetas: mientras tengas cuenta',
              descripcion:
                'Se conservan mientras la relación esté vigente. Se eliminan cuando tú los borras o cuando eliminas tu cuenta.',
            },
            {
              termino:
                'Evidencia de aceptaciones legales: mientras tengas cuenta y tras su cierre lo necesario',
              descripcion:
                'Es la prueba de tu consentimiento y se conserva mientras pueda ser exigible. Se elimina al borrar tu cuenta.',
            },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Al eliminar tu cuenta borramos, en una sola operación que se ejecuta por completo o no se ejecuta, todos tus datos de negocio: agentes, corridas, tareas, recetas, credenciales cifradas, sitios conectados con sus contextos cifrados, trayectorias, aceptaciones legales, solicitudes de derechos, suscripción y perfil. Los registros de acciones administrativas se conservan sin poder asociarse a ti, para mantener la trazabilidad de la operación. Cuando existan referencias a contextos que viven en el proveedor de navegadores remotos, se recogen para purgarlos también de su lado.',
        },
      ],
    },
    {
      id: 'seguridad',
      titulo: '8. Medidas de seguridad',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Aplicamos las siguientes medidas, que describimos con precisión para que sepas exactamente qué protegen y qué no. No contamos con certificaciones de seguridad de terceros, y no afirmamos tenerlas.',
        },
        {
          tipo: 'lista',
          items: [
            'Las credenciales de proveedor de modelo que tú aportas se guardan cifradas con AES-256-GCM bajo un secreto maestro que vive solo en el entorno del servidor, y nunca se devuelven a la interfaz.',
            'Los contextos de sesión de los sitios que conectas se guardan cifrados con AES-256-GCM bajo ese mismo esquema, en una columna binaria, y solo se descifran en memoria al ejecutar una tarea tuya.',
            'Aislamiento por usuario en todas las capas: cada consulta a la base acota por el identificador del titular que viene del token de sesión, y las tablas tienen además políticas de seguridad a nivel de fila que solo permiten leer lo propio. La escritura de datos sensibles ocurre siempre del lado del servidor.',
            'El país de salida a internet queda fijado a cada sitio que conectas, y una tarea se aborta si la sesión sale por un país distinto al fijado.',
            'Los valores que el agente escribe pasan por una censura antes de guardarse: contraseñas, tarjetas y tokens no llegan a los registros de trayectorias ni de grabaciones. El inicio de sesión nunca se graba.',
            'Las capturas de los puntos de aprobación viven en un almacenamiento privado, no público, con control de acceso por usuario.',
            'La evidencia de tus aceptaciones legales no guarda tu dirección IP: guarda un valor derivado mediante una función criptográfica de una sola vía con un secreto del servidor.',
            'Tu contraseña vive exclusivamente en el sistema de autenticación de Supabase, cifrada; nunca llega a nuestras tablas.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Sobre el relay de teclado móvil, con precisión: el texto que escribes desde tu teléfono viaja cifrado desde tu dispositivo hasta el servicio de relay, con un intercambio de llaves efímero por sesión y cifrado autenticado. Eso protege el texto frente al proxy que termina la conexión segura y frente a los registros de la plataforma, que nunca lo ven en claro. Sin embargo, el navegador remoto donde se escribe el texto sí lo recibe en claro, porque tiene que escribirlo en la página. Dicho de otro modo: el cifrado protege el trayecto, no el destino. No afirmamos que se trate de cifrado de extremo a extremo hasta el sitio final, porque no lo es.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Ninguna medida de seguridad es absoluta. Si ocurriera una vulneración que afecte de forma significativa tus derechos patrimoniales o morales, te lo informaremos para que puedas tomar medidas.',
        },
      ],
    },
    {
      id: 'derechos',
      titulo: '9. Tus derechos ARCO, revocación y portabilidad',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Tienes derecho a acceder a tus datos personales, a rectificarlos cuando sean inexactos o incompletos, a cancelarlos cuando consideres que no se requieren para las finalidades de este aviso y a oponerte a su tratamiento para fines específicos. También puedes revocar tu consentimiento en cualquier momento y solicitar tus datos en un formato que puedas llevarte.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Puedes ejercer estos derechos por dos vías. La primera, desde la propia plataforma, en la sección de privacidad de tu cuenta, donde puedes enviar tu solicitud, seguir su estado y descargar tus datos. La segunda, escribiendo a contacto@ledesma-ai-labs.com. En ambos casos necesitamos poder acreditar tu identidad y que nos indiques con claridad qué datos quieres acceder, rectificar, cancelar o a qué tratamiento te opones; si pides una rectificación, acompaña la documentación que sustente el cambio.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Responderemos tu solicitud en los plazos que fija la ley vigente, comunicándote la determinación adoptada y, cuando proceda, haciéndola efectiva dentro del plazo legal. Si no quedas conforme con nuestra respuesta, o si no recibes respuesta, puedes acudir ante la autoridad competente en materia de protección de datos personales, que a partir de la extinción del INAI es la Secretaría Anticorrupción y Buen Gobierno.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Además, en cualquier momento puedes limitar el uso de tus datos por tu cuenta: eliminar una credencial de proveedor de modelo, desconectar un sitio, borrar una tarea o una receta, detener una tarea en curso o eliminar tu cuenta por completo desde la configuración. La revocación del consentimiento respecto de las finalidades primarias implica que ya no podemos prestarte el servicio.',
        },
      ],
    },
    {
      id: 'cambios',
      titulo: '10. Cambios a este aviso',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Este aviso está versionado. Cuando lo modifiquemos publicaremos la nueva versión en esta misma dirección, con su número de versión y su fecha, y la plataforma te pedirá aceptarla la próxima vez que entres: sin esa aceptación no podrás continuar usando el servicio. Así te enteras del cambio en el momento en que te afecta, y no en un correo que se pierde. Cuando el cambio sea sustantivo también te lo notificaremos al correo de tu cuenta.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Puedes consultar en la sección de privacidad de tu cuenta qué documentos aceptaste, en qué versión y en qué fecha.',
        },
      ],
    },
    {
      id: 'contacto',
      titulo: '11. Contacto',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Para cualquier duda sobre este aviso o sobre el tratamiento de tus datos personales, escríbenos a contacto@ledesma-ai-labs.com. Este aviso corresponde a la versión 2026-07-30, con fecha 30 de julio de 2026.',
        },
      ],
    },
  ],
};
