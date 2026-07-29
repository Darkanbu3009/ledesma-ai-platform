import type { DocumentoLegal } from './tipos';

// AVISO DE PRIVACIDAD SIMPLIFICADO, en los dos idiomas. La ley mexicana lo exige cuando los datos se
// recaban por medios electronicos, que es exactamente el caso de esta plataforma. Es un RESUMEN: no puede
// decir nada que el aviso integral no diga, y siempre remite a el.
//
// Vive en un solo archivo (y no en uno por idioma como el integral y los terminos) porque es corto y
// mantener las dos versiones a la vista hace evidente cuando una se queda atras de la otra.
//
// Comparte VERSION con el aviso integral: es el mismo documento en dos niveles de detalle, y aceptar el
// aviso de privacidad cubre a los dos.

const VERSION = '2026-07-29';

export const AVISO_SIMPLIFICADO_ES: DocumentoLegal = {
  tipo: 'privacy_notice',
  version: VERSION,
  fecha: '29 de julio de 2026',
  titulo: 'Aviso de Privacidad Simplificado',
  subtitulo:
    'Resumen de cómo tratamos tus datos personales. El aviso integral tiene el detalle completo y es el que rige.',
  secciones: [
    {
      id: 'responsable',
      titulo: '1. Quién es el responsable',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Omar Ledesma, persona física con actividad empresarial, que opera bajo el nombre comercial Ledesma AI Labs, con ubicación en Monterrey, Nuevo León, México. Contacto y derechos ARCO: contacto@ledesma-ai-labs.com.',
        },
      ],
    },
    {
      id: 'datos',
      titulo: '2. Qué datos tratamos',
      bloques: [
        {
          tipo: 'lista',
          items: [
            'Datos de tu cuenta: correo, nombre, tipo de cuenta, organización, país y plan.',
            'La llave de API de tu proveedor de inteligencia artificial, guardada cifrada.',
            'Los contextos de sesión de los sitios que conectas, guardados cifrados.',
            'El historial de tus tareas: objetivo, pasos con los valores ya censurados, capturas de los puntos de aprobación y consumo.',
            'El contenido que envías a los agentes y, si lo usas, el audio del dictado por voz.',
            'La evidencia de tus aceptaciones legales, con un valor derivado de tu IP que no se puede revertir.',
          ],
        },
        {
          tipo: 'parrafo',
          texto: 'No solicitamos datos personales sensibles.',
        },
      ],
    },
    {
      id: 'finalidades',
      titulo: '3. Para qué los usamos',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Finalidades necesarias: autenticarte, guardar cifradas tus credenciales y tus sesiones, ejecutar las tareas que ordenas en los sitios que conectas, pedirte autorización antes de acciones relevantes, mantener tu historial de actividad, medir tu consumo y atender tus solicitudes.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Finalidades no necesarias, a las que puedes oponerte: aprendizaje estructural agregado sobre sitios web (solo dominio, tipo de elemento y estrategia de localización, nunca contenidos ni valores ni datos personales, con los identificadores de origen convertidos en valores no reversibles) y alertas operativas por correo.',
        },
      ],
    },
    {
      id: 'limitar-uso',
      titulo: '4. Cómo limitar el uso de tus datos',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Desde la plataforma puedes eliminar una credencial, desconectar un sitio, borrar una tarea o receta, detener una tarea en curso y eliminar tu cuenta. Para oponerte a las finalidades no necesarias o revocar tu consentimiento, escribe a contacto@ledesma-ai-labs.com.',
        },
      ],
    },
    {
      id: 'integral',
      titulo: '5. Dónde consultar el aviso integral',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'El aviso de privacidad integral, con el detalle de las categorías de datos, los encargados, las transferencias, los plazos de conservación, las medidas de seguridad y el procedimiento para ejercer tus derechos ARCO, está publicado en https://www.ledesma-ai-labs.com/privacidad.',
        },
      ],
    },
  ],
};

export const AVISO_SIMPLIFICADO_EN: DocumentoLegal = {
  tipo: 'privacy_notice',
  version: VERSION,
  fecha: 'July 29, 2026',
  titulo: 'Short Form Privacy Notice',
  subtitulo:
    'A summary of how we process your personal data. The full notice has the complete detail and is the one that governs.',
  secciones: [
    {
      id: 'responsable',
      titulo: '1. Who the controller is',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Omar Ledesma, an individual with business activity, operating under the trade name Ledesma AI Labs, located in Monterrey, Nuevo Leon, Mexico. Contact and data subject rights: contacto@ledesma-ai-labs.com.',
        },
      ],
    },
    {
      id: 'datos',
      titulo: '2. What data we process',
      bloques: [
        {
          tipo: 'lista',
          items: [
            'Your account data: email, name, account type, organization, country and plan.',
            'The API key of your artificial intelligence provider, stored encrypted.',
            'The session contexts of the sites you connect, stored encrypted.',
            'Your task history: goal, steps with values already redacted, approval checkpoint screenshots and consumption.',
            'The content you send to the agents and, if you use it, the audio from voice dictation.',
            'Evidence of your legal acceptances, with a value derived from your IP that cannot be reversed.',
          ],
        },
        {
          tipo: 'parrafo',
          texto: 'We do not request sensitive personal data.',
        },
      ],
    },
    {
      id: 'finalidades',
      titulo: '3. What we use it for',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Necessary purposes: authenticating you, storing your credentials and sessions encrypted, running the tasks you order on the sites you connect, asking for your authorization before significant actions, keeping your activity history, measuring your consumption and handling your requests.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Non necessary purposes, which you may object to: aggregated structural learning about websites (domain, element type and location strategy only, never contents, values or personal data, with origin identifiers converted into non reversible values) and operational alerts by email.',
        },
      ],
    },
    {
      id: 'limitar-uso',
      titulo: '4. How to limit the use of your data',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'From the platform you can delete a credential, disconnect a site, delete a task or recipe, stop a running task and delete your account. To object to the non necessary purposes or withdraw your consent, write to contacto@ledesma-ai-labs.com.',
        },
      ],
    },
    {
      id: 'integral',
      titulo: '5. Where to read the full notice',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'The full privacy notice, with the detail of data categories, processors, transfers, retention periods, security measures and the procedure to exercise your rights, is published at https://www.ledesma-ai-labs.com/privacidad.',
        },
      ],
    },
  ],
};
