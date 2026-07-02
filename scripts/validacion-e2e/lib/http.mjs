/**
 * Cliente HTTP minimo sobre fetch global (Node >= 20): JSON con timeout + consumidor de SSE.
 * Sin dependencias. Todas las respuestas devuelven { status, body } y NUNCA lanzan por status
 * (las fases deciden que status esperaban); solo lanzan por red/timeout.
 */

const TIMEOUT_JSON_MS = 30_000;
const TIMEOUT_SSE_MS = 120_000;

async function conTimeout(ms, fn) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), ms);
  try {
    return await fn(controlador.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Request JSON generico. `headers` extra se fusionan; body objeto se serializa. */
export async function pedirJson(url, { method = 'GET', headers = {}, body, timeoutMs = TIMEOUT_JSON_MS } = {}) {
  return conTimeout(timeoutMs, async (signal) => {
    const res = await fetch(url, {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const texto = await res.text();
    let json;
    try {
      json = texto === '' ? null : JSON.parse(texto);
    } catch {
      json = { crudo: texto.slice(0, 500) };
    }
    return { status: res.status, body: json };
  });
}

/**
 * Consume un stream SSE de /v1/run/:agentId hasta el evento `done` (o `error`, o fin del stream).
 * Devuelve { status, texto, stop, error, eventos } donde texto es la concatenacion de text_delta,
 * stop es el AgentEvent {type:'stop', reason, usage} y error el payload del evento error si hubo.
 */
export async function consumirSse(url, { headers = {}, body, timeoutMs = TIMEOUT_SSE_MS } = {}) {
  return conTimeout(timeoutMs, async (signal) => {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
      const texto = await res.text();
      let json;
      try {
        json = JSON.parse(texto);
      } catch {
        json = { crudo: texto.slice(0, 500) };
      }
      return { status: res.status, texto: '', stop: null, error: json, eventos: [] };
    }

    const decodificador = new TextDecoder();
    let buffer = '';
    const eventos = [];
    let texto = '';
    let stop = null;
    let errorEvento = null;
    let done = false;

    const procesarBloque = (bloque) => {
      let nombreEvento = null;
      const datas = [];
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith('event: ')) nombreEvento = linea.slice(7).trim();
        else if (linea.startsWith('data: ')) datas.push(linea.slice(6));
      }
      if (datas.length === 0) return;
      let data;
      try {
        data = JSON.parse(datas.join('\n'));
      } catch {
        data = { crudo: datas.join('\n').slice(0, 200) };
      }
      eventos.push({ evento: nombreEvento, data });
      if (nombreEvento === 'done') done = true;
      else if (nombreEvento === 'error') errorEvento = data;
      else if (data && data.type === 'text_delta') texto += data.text;
      else if (data && data.type === 'stop') stop = data;
    };

    for await (const chunk of res.body) {
      buffer += decodificador.decode(chunk, { stream: true });
      let corte;
      while ((corte = buffer.indexOf('\n\n')) !== -1) {
        const bloque = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        procesarBloque(bloque);
      }
      if (done || errorEvento) break;
    }
    return { status: res.status, texto, stop, error: errorEvento, eventos };
  });
}

/** Espera generica con poll: llama a `fn` cada `intervaloMs` hasta que devuelva no-null o venza el plazo. */
export async function esperarHasta(fn, { plazoMs, intervaloMs = 5_000 }) {
  const limite = Date.now() + plazoMs;
  for (;;) {
    const resultado = await fn();
    if (resultado !== null && resultado !== undefined && resultado !== false) return resultado;
    if (Date.now() >= limite) return null;
    await new Promise((r) => setTimeout(r, Math.min(intervaloMs, Math.max(0, limite - Date.now()))));
  }
}
