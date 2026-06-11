export interface SnippetParams {
  apiUrl: string; // sin barra final
  agentId: string;
}

/** Endpoint de ejecucion del agente. */
export function agentEndpoint(p: SnippetParams): string {
  return `${p.apiUrl}/v1/run/${p.agentId}`;
}

/** Snippet cURL (servidor). La key es un placeholder, NUNCA una key real. */
export function curlSnippet(p: SnippetParams): string {
  return [
    `curl -N -X POST ${agentEndpoint(p)} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "x-provider-key: TU_API_KEY_DEL_PROVEEDOR" \\`,
    `  -d '{"messages":[{"role":"user","content":"Hola"}]}'`,
  ].join('\n');
}

/** Snippet Node.js (servidor) con lectura del stream SSE. */
export function nodeSnippet(p: SnippetParams): string {
  return `const response = await fetch('${agentEndpoint(p)}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // La key del proveedor vive en TU servidor (variable de entorno), nunca en el cliente.
    'x-provider-key': process.env.PROVIDER_API_KEY,
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hola' }],
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const blocks = buffer.split('\\n\\n');
  buffer = blocks.pop() ?? '';
  for (const block of blocks) {
    const data = block.split('\\n').find((l) => l.startsWith('data: '))?.slice(6);
    if (data) console.log(JSON.parse(data)); // text_delta | tool_use | tool_result | stop
  }
}`;
}

/** URL del bundle del widget servido por el backend. */
export function widgetScriptUrl(p: SnippetParams): string {
  return `${p.apiUrl}/widget/ledesma-agent.js`;
}

/** Modo directo: solo pruebas/herramientas internas (la key queda en el HTML). */
export function widgetDirectSnippet(p: SnippetParams): string {
  return `<script src="${widgetScriptUrl(p)}"></script>

<ledesma-agent
  endpoint="${agentEndpoint(p)}"
  provider-key="TU_API_KEY_DEL_PROVEEDOR"
  title="Asistente"
></ledesma-agent>`;
}

/** Endpoint de emision de tokens de la plataforma. */
export function sessionTokensEndpoint(p: SnippetParams): string {
  return `${p.apiUrl}/v1/session-tokens`;
}

/** Modo token: produccion. El widget pide tokens a TU backend y habla directo con la plataforma. */
export function widgetTokenSnippet(p: SnippetParams): string {
  return `<script src="${widgetScriptUrl(p)}"></script>

<ledesma-agent
  endpoint="${agentEndpoint(p)}"
  token-url="https://TU-BACKEND.com/api/token-agente"
  title="Asistente"
></ledesma-agent>`;
}

/** Servidor del cliente: emite tokens efimeros (la key vive en su entorno). */
export function tokenServerSnippet(p: SnippetParams): string {
  return `// POST /api/token-agente — emite un token efimero para el widget
app.post('/api/token-agente', async (req, res) => {
  // Aqui va TU autenticacion (sesion de usuario, rate limit, etc.).
  const upstream = await fetch('${sessionTokensEndpoint(p)}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-provider-key': process.env.PROVIDER_API_KEY,
    },
    body: JSON.stringify({ agentId: '${p.agentId}' }),
  });
  res.status(upstream.status).json(await upstream.json()); // { token, expiresAt }
});`;
}

/** Verificacion de firma en el servidor del cliente (el secreto vive en su entorno). */
export function webhookVerifySnippet(): string {
  return `const crypto = require('node:crypto');

function verifyLedesmaWebhook(req) {
  const timestamp = Number(req.headers['x-ledesma-timestamp']);
  const signature = String(req.headers['x-ledesma-signature'] ?? '').replace('v1=', '');
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // anti-replay
  const expected = crypto
    .createHmac('sha256', process.env.LEDESMA_WEBHOOK_SECRET)
    .update(\`\${timestamp}.\${req.rawBody}\`)
    .digest('hex');
  return expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}`;
}

/** Guia breve de integracion movil/web (texto, no codigo ejecutable). */
export function mobileWebGuide(p: SnippetParams): string {
  return `Tu app movil o web NO debe contener la API key del proveedor. El patron recomendado:

1. Tu app llama a TU backend (con tu propia autenticacion de usuarios).
2. Tu backend emite un token de sesion efimero con la key guardada como secreto en tu servidor:
   POST ${sessionTokensEndpoint(p)} (header x-provider-key, body { agentId })
3. Tu app llama directo a la plataforma con el header x-session-token:
   POST ${agentEndpoint(p)}

Asi la key nunca viaja al dispositivo del usuario final: solo viaja un token que expira solo y
tu app renueva pidiendo otro a tu backend.`;
}
