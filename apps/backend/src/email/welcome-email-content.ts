/**
 * Contenido del correo de BIENVENIDA (asunto + texto + html), en espanol. PURO y sin efectos:
 * testeable sin red (igual que construirCorreoFallo del worker). Tono sobrio y acogedor, breve, sin
 * marketing pesado ni features que un plan free no pueda usar: da la bienvenida e INVITA a volver y
 * poner el primer agente a funcionar, con un enlace al panel (donde vive el checklist de primeros pasos).
 *
 * Sin acentos, coherente con el estilo de los correos existentes (las alertas del worker tampoco los
 * llevan) y con la casa.
 */

/** Nombre del producto para el asunto y el cuerpo. */
export const PRODUCTO = 'Ledesma AI Labs';

/** Escapa los caracteres especiales de HTML (el nombre del usuario es un dato de usuario). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Normaliza la base de la consola (quita barras finales) y arma el enlace al panel (checklist de onboarding). */
function urlPanel(consoleBaseUrl: string): string {
  return `${consoleBaseUrl.replace(/\/+$/, '')}/dashboard`;
}

export interface CorreoBienvenida {
  subject: string;
  text: string;
  html: string;
}

/**
 * Arma el correo de bienvenida. Si hay `fullName` (recortado no vacio) personaliza el saludo; si no,
 * saluda de forma generica. Si hay `consoleBaseUrl` incluye el enlace al panel; sin ella el correo sale
 * igual pero sin enlace (best-effort, mismo criterio que la alerta de fallo con /actividad).
 */
export function construirCorreoBienvenida(params: {
  fullName?: string;
  consoleBaseUrl?: string;
}): CorreoBienvenida {
  const nombre = params.fullName?.trim();
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  const enlace = params.consoleBaseUrl ? urlPanel(params.consoleBaseUrl) : null;

  const subject = `Bienvenido a ${PRODUCTO}`;

  const lineasTexto = [
    `${saludo},`,
    '',
    `Gracias por crear tu cuenta en ${PRODUCTO}. Ya tienes todo listo para poner tu primer agente a trabajar.`,
    '',
    'El siguiente paso es simple: entra a la consola y sigue la guia de primeros pasos: conecta una',
    'credencial, crea tu primer agente y ejecutalo. En pocos minutos lo ves en accion.',
    '',
    ...(enlace ? [`Abre tu panel y empieza: ${enlace}`, ''] : []),
    'Si tienes cualquier duda, respondenos a este correo. Bienvenido a bordo.',
    '',
    `-- El equipo de ${PRODUCTO}`,
  ];
  const text = lineasTexto.join('\n');

  const saludoHtml = escapeHtml(saludo);
  const enlaceHtml = enlace ? escapeHtml(enlace) : null;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;">',
    `<h2 style="font-size:18px;margin:0 0 12px;">Bienvenido a ${escapeHtml(PRODUCTO)}</h2>`,
    `<p style="margin:0 0 16px;">${saludoHtml}, gracias por crear tu cuenta. Ya tienes todo listo para poner tu primer agente a trabajar.</p>`,
    '<p style="margin:0 0 16px;">El siguiente paso es simple: entra a la consola y sigue la guia de primeros pasos: conecta una credencial, crea tu primer agente y ejecutalo. En pocos minutos lo ves en accion.</p>',
    ...(enlaceHtml
      ? [
          `<p style="margin:0 0 20px;"><a href="${enlaceHtml}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;">Abrir mi panel</a></p>`,
        ]
      : []),
    '<p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Si tienes cualquier duda, respondenos a este correo. Bienvenido a bordo.</p>',
    `<p style="color:#6b7280;font-size:13px;margin:0;">-- El equipo de ${escapeHtml(PRODUCTO)}</p>`,
    '</div>',
  ].join('');

  return { subject, text, html };
}
