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

/** Guia breve de integracion movil/web (texto, no codigo ejecutable). */
export function mobileWebGuide(p: SnippetParams): string {
  return `Tu app movil o web NO debe contener la API key del proveedor. El patron correcto:

1. Tu app llama a TU backend (con tu propia autenticacion de usuarios).
2. Tu backend agrega el header x-provider-key (guardado como secreto en tu servidor) y reenvia a:
   POST ${agentEndpoint(p)}
3. Tu backend retransmite el stream SSE a tu app.

Asi la key nunca viaja al dispositivo del usuario final. Proximamente: tokens publicables por
agente para integracion directa desde clientes.`;
}
