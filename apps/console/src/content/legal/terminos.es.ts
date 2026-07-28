import type { DocumentoLegal } from './tipos';

/**
 * TERMINOS DE SERVICIO, version en espanol. BORRADOR asistido por IA, pendiente de revision legal.
 *
 * La clausula de aprendizaje colectivo (seccion 7) tiene que decir EXACTAMENTE lo mismo que la finalidad
 * secundaria del aviso de privacidad (aviso-privacidad.es.ts, seccion 4). Si una cambia, la otra cambia en
 * el mismo commit: si se contradicen, el consentimiento deja de ser informado.
 *
 * Para SUBIR DE VERSION ver el procedimiento en apps/backend/src/privacy/documents.ts.
 */
export const TERMINOS_ES: DocumentoLegal = {
  tipo: 'terms',
  version: '2026-07-28',
  fecha: '28 de julio de 2026',
  titulo: 'Términos de Servicio',
  subtitulo:
    'Las reglas del acuerdo entre tú y Ledesma AI Labs para usar la plataforma: qué te damos, qué te toca a ti y qué pasa cuando algo sale mal.',
  secciones: [
    {
      id: 'aceptacion',
      titulo: '1. Aceptación de estos términos',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Estos Términos de Servicio son un acuerdo entre tú, como usuario, y Omar Ledesma, persona física con actividad empresarial, que opera bajo el nombre comercial Ledesma AI Labs, con ubicación en Monterrey, Nuevo León, México. La constitución de la persona moral está en proceso; al constituirse se actualizarán estos términos.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Al aceptar estos términos y el Aviso de Privacidad en la plataforma, aceptas quedar obligado por ambos. Si no estás de acuerdo, no puedes usar el servicio. Debes ser mayor de edad y tener capacidad legal para obligarte. Si aceptas en nombre de una empresa, declaras que tienes facultades para obligarla.',
        },
      ],
    },
    {
      id: 'servicio',
      titulo: '2. Descripción del servicio',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Ledesma AI Labs es una plataforma que te permite crear y operar agentes de inteligencia artificial que ejecutan tareas por ti, entre ellas navegar y actuar dentro de sitios web de terceros en los que tú previamente iniciaste sesión.',
        },
        {
          tipo: 'lista',
          items: [
            'Conectas un sitio iniciando sesión tú mismo en una vista en vivo del navegador; la plataforma hereda ese contexto de sesión y lo guarda cifrado.',
            'Le encargas tareas a un agente en lenguaje natural, o le enseñas un procedimiento haciéndolo tú una vez para que quede como receta reutilizable.',
            'Defines una política de ejecución que determina qué puede hacer el agente por su cuenta y qué requiere tu autorización explícita antes de ejecutarse.',
            'Consultas el historial de lo que se ejecutó, con su trayectoria paso a paso y las capturas de los puntos de aprobación.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'El servicio se presta en su estado actual y evoluciona. Podemos agregar, modificar o retirar funcionalidades. Cuando un cambio reduzca de forma sustantiva lo que el servicio te ofrece, procuraremos avisarte con antelación razonable.',
        },
      ],
    },
    {
      id: 'cuenta',
      titulo: '3. Tu cuenta',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Eres responsable de mantener la confidencialidad de tus credenciales de acceso y de toda la actividad que ocurra bajo tu cuenta. Debes darnos información veraz al registrarte y mantenerla actualizada. Avísanos de inmediato a contacto@ledesma-ai-labs.com si detectas un uso no autorizado de tu cuenta.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Puedes eliminar tu cuenta en cualquier momento desde la configuración. Al hacerlo se borran tus datos conforme a lo descrito en el Aviso de Privacidad.',
        },
      ],
    },
    {
      id: 'byok',
      titulo: '4. Esquema BYOK y tus cuentas de terceros',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'La plataforma opera bajo un esquema BYOK, es decir, tú aportas tu propia llave de API del proveedor de inteligencia artificial que elijas. Esto tiene consecuencias que conviene que tengas claras:',
        },
        {
          tipo: 'lista',
          items: [
            'La relación contractual con ese proveedor de modelo es tuya, no nuestra. El uso que hagas de él se rige también por los términos y el aviso de privacidad de ese proveedor, que te corresponde leer y cumplir.',
            'El consumo que tus tareas generen con esa llave se factura a tu cuenta con ese proveedor, y ese costo es tuyo. Nosotros no lo controlamos ni lo reembolsamos.',
            'Eres responsable de la custodia de tu llave, de rotarla cuando corresponda y de revocarla si sospechas que fue comprometida. Nosotros la guardamos cifrada y no la mostramos de vuelta, pero tú decides cuándo darla de alta y cuándo eliminarla.',
            'Eres responsable de las cuentas de terceros que conectas a la plataforma y de tener derecho a usarlas de esta manera. Verifica que automatizar el acceso a esas cuentas no contravenga los términos del sitio en cuestión.',
            'Si un sitio de terceros bloquea, suspende o cancela tu cuenta por el uso que hiciste de agentes automatizados, esa consecuencia es tuya. Nosotros no podemos revertirla ni responder por ella.',
          ],
        },
      ],
    },
    {
      id: 'uso-aceptable',
      titulo: '5. Uso aceptable',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Los agentes actúan por instrucción tuya y bajo tu responsabilidad. Al usar la plataforma te obligas a no emplearla para:',
        },
        {
          tipo: 'lista',
          items: [
            'Cualquier actividad ilícita conforme a la legislación mexicana o a la que te resulte aplicable, ni para facilitarla.',
            'Acceder a sistemas, cuentas o datos sobre los que no tengas autorización, ni para eludir controles de acceso, autenticación o verificación de identidad.',
            'Enviar comunicaciones masivas no solicitadas, ni ninguna otra forma de spam, ni para inflar métricas, votos, reseñas o interacciones de forma artificial.',
            'Operar en contravención de los términos de servicio, del archivo de exclusión de robots o de los límites técnicos de los sitios de terceros donde conectes tus cuentas.',
            'Suplantar la identidad de una persona u organización, ni generar o difundir contenido engañoso, difamatorio, o que infrinja derechos de terceros.',
            'Extraer datos personales de terceros de forma masiva, ni construir perfiles de personas sin fundamento legal para hacerlo.',
            'Intentar vulnerar, sobrecargar o revertir la ingeniería de la plataforma, ni evadir sus límites de uso, cuotas o mecanismos de seguridad.',
            'Reventa del servicio o acceso a él por terceros no autorizados, salvo acuerdo escrito con nosotros.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Podemos suspender o cancelar tu acceso, de inmediato y sin reembolso, si detectamos un uso que infrinja esta sección o que ponga en riesgo la plataforma, a otros usuarios o a terceros. Cuando las circunstancias lo permitan, te lo notificaremos y te daremos oportunidad de corregirlo.',
        },
      ],
    },
    {
      id: 'propiedad',
      titulo: '6. Propiedad intelectual',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'La plataforma, su software, su arquitectura, su interfaz, su documentación, sus marcas y sus signos distintivos son propiedad de Ledesma AI Labs o de sus licenciantes, y están protegidos por la legislación aplicable. Estos términos te otorgan una licencia limitada, revocable, no exclusiva y no transferible para usar el servicio conforme a lo aquí pactado. No se te transfiere ningún otro derecho.',
        },
        {
          tipo: 'parrafo',
          texto:
            'El contenido que tú aportas (tus instrucciones, tus archivos, tus configuraciones, tus recetas y los resultados de tus tareas) sigue siendo tuyo. Nos otorgas únicamente la licencia necesaria para alojarlo, procesarlo y mostrártelo con el fin de prestarte el servicio, y para la finalidad de aprendizaje estructural agregado descrita en la sección siguiente. Esa licencia termina cuando eliminas el contenido o tu cuenta.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Si nos envías comentarios o sugerencias sobre el producto, podemos usarlos para mejorarlo sin obligación de compensarte y sin que ello te otorgue derechos sobre el resultado.',
        },
      ],
    },
    {
      id: 'aprendizaje-colectivo',
      titulo: '7. Aprendizaje colectivo',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Para que la plataforma funcione de forma más confiable para todos, podemos aprender de la ESTRUCTURA de los sitios web sobre los que se ejecutan tareas y agregar ese aprendizaje en un repositorio común. Esta cláusula corresponde a la finalidad secundaria declarada en el Aviso de Privacidad y tiene exactamente el mismo alcance que allí se describe.',
        },
        {
          tipo: 'parrafo',
          texto: 'Lo que sí se agrega, y nada más que esto:',
        },
        {
          tipo: 'lista',
          items: [
            'El dominio del sitio web.',
            'El tipo o clase del elemento con el que se interactuó, por ejemplo un campo de búsqueda o un botón de envío.',
            'La estrategia que funcionó para localizar ese elemento dentro de la página.',
          ],
        },
        {
          tipo: 'parrafo',
          texto: 'Lo que nunca se agrega:',
        },
        {
          tipo: 'lista',
          items: [
            'El contenido de las páginas que el agente leyó.',
            'Los valores que se escribieron en los formularios.',
            'Tus objetivos, tus instrucciones o cualquier dato personal tuyo o de terceros.',
            'Cualquier credencial, token o contexto de sesión.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Los identificadores de origen se convierten en valores derivados mediante una función criptográfica de una sola vía, de manera que el aprendizaje agregado no se puede volver a asociar contigo ni con tu cuenta. Puedes oponerte a esta finalidad en cualquier momento escribiendo a contacto@ledesma-ai-labs.com, sin que ello afecte tu uso del servicio.',
        },
      ],
    },
    {
      id: 'planes',
      titulo: '8. Planes, límites y pagos',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'El servicio se ofrece en distintos planes, con límites de uso asociados a cada uno. Los límites vigentes y su alcance se muestran en la plataforma. Al agotar el límite de tu plan, la ejecución de nuevas tareas puede quedar restringida hasta la renovación del periodo o hasta que cambies de plan.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Recuerda que el consumo con tu proveedor de modelo es independiente de tu plan en la plataforma y se factura por separado, directamente a tu cuenta con ese proveedor, conforme a la sección 4.',
        },
      ],
    },
    {
      id: 'garantias',
      titulo: '9. Ausencia de garantías',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'El servicio se presta en el estado en que se encuentra y según disponibilidad. En la medida en que la ley lo permita, no otorgamos garantías de que el servicio sea ininterrumpido, libre de errores, ni de que un agente complete correctamente una tarea determinada.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Los sistemas de inteligencia artificial pueden cometer errores, malinterpretar una instrucción o actuar sobre un elemento equivocado de una página. Por eso la plataforma te ofrece una política de ejecución y puntos de aprobación: úsalos. Revisa los resultados antes de darlos por buenos, y reserva la ejecución sin supervisión para tareas cuyo eventual error puedas asumir.',
        },
      ],
    },
    {
      id: 'responsabilidad',
      titulo: '10. Limitación de responsabilidad',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'En la medida máxima que permita la ley aplicable, Ledesma AI Labs no será responsable por daños indirectos, incidentales, especiales o consecuenciales, ni por lucro cesante, pérdida de datos, pérdida de oportunidades de negocio o daño reputacional, derivados del uso o de la imposibilidad de uso del servicio.',
        },
        {
          tipo: 'parrafo',
          texto:
            'En particular, no respondemos por las consecuencias de las acciones que un agente ejecute siguiendo tus instrucciones y dentro de la política de ejecución que tú configuraste, ni por decisiones que tomes con base en los resultados que produzca, ni por el bloqueo o la cancelación de tus cuentas en sitios de terceros.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Nuestra responsabilidad total acumulada, por cualquier concepto, no excederá el monto que nos hayas pagado por el servicio en los tres meses anteriores al hecho que origine la reclamación. Nada en esta sección limita responsabilidades que la ley no permite limitar, incluidas las derivadas de dolo o negligencia grave.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Te obligas a sacarnos en paz y a salvo de reclamaciones de terceros que deriven de tu uso del servicio en contravención de estos términos o de la ley.',
        },
      ],
    },
    {
      id: 'terminacion',
      titulo: '11. Vigencia y terminación',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Estos términos rigen mientras uses el servicio. Puedes terminarlos en cualquier momento eliminando tu cuenta. Nosotros podemos suspender o terminar tu acceso conforme a la sección 5, o al descontinuar el servicio, avisándote con antelación razonable cuando las circunstancias lo permitan. Las secciones sobre propiedad intelectual, ausencia de garantías, limitación de responsabilidad y jurisdicción sobreviven a la terminación.',
        },
      ],
    },
    {
      id: 'cambios',
      titulo: '12. Cambios a estos términos',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Estos términos están versionados. Cuando los modifiquemos publicaremos la nueva versión en esta misma dirección, con su número de versión y su fecha, y la plataforma te pedirá aceptarla la próxima vez que entres: sin esa aceptación no podrás continuar usando el servicio. Puedes consultar en la sección de privacidad de tu cuenta qué versión aceptaste y en qué fecha.',
        },
      ],
    },
    {
      id: 'jurisdiccion',
      titulo: '13. Ley aplicable y jurisdicción',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para la interpretación y el cumplimiento de este acuerdo, las partes se someten a la jurisdicción de los tribunales competentes de Monterrey, Nuevo León, México, renunciando a cualquier otro fuero que pudiera corresponderles por razón de su domicilio presente o futuro, salvo por los derechos que la legislación de protección al consumidor te reconozca de forma irrenunciable.',
        },
      ],
    },
    {
      id: 'contacto',
      titulo: '14. Contacto',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Para cualquier duda sobre estos términos, escríbenos a contacto@ledesma-ai-labs.com o visita https://www.ledesma-ai-labs.com. Estos términos corresponden a la versión 2026-07-28, con fecha 28 de julio de 2026.',
        },
      ],
    },
  ],
  notaBorrador: 'Borrador generado con asistencia de IA, pendiente de revisión legal profesional.',
};
