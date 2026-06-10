import { describe, it, expect } from 'vitest';
import { buildRequestChat, commitTurn } from '../src/lib/chat-turn';
import type { ChatMessage } from '../src/lib/run-agent';

function tieneRolesConsecutivos(chat: ChatMessage[]): boolean {
  return chat.some((message, i) => i > 0 && message.role === chat[i - 1]?.role);
}

describe('buildRequestChat', () => {
  it('agrega UN solo user al final sin mutar el chat original', () => {
    const chat: ChatMessage[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'que tal' },
    ];

    const request = buildRequestChat(chat, 'sigue');

    expect(request).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'que tal' },
      { role: 'user', content: 'sigue' },
    ]);
    expect(chat).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'que tal' },
    ]);
  });

  it('tras un turno fallido sin commit, reintentar no produce dos user consecutivos', () => {
    const chat: ChatMessage[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'que tal' },
    ];

    // Primer intento: el turno falla, asi que NO hay commitTurn y chat queda igual.
    const fallido = buildRequestChat(chat, 'pregunta');
    expect(tieneRolesConsecutivos(fallido)).toBe(false);

    // Reintento con el MISMO chat original: un solo user nuevo, alternancia valida.
    const reintento = buildRequestChat(chat, 'pregunta');
    expect(reintento).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'que tal' },
      { role: 'user', content: 'pregunta' },
    ]);
    expect(tieneRolesConsecutivos(reintento)).toBe(false);
  });
});

describe('commitTurn', () => {
  it('agrega el par (user, assistant) completo', () => {
    const chat: ChatMessage[] = [];

    const confirmado = commitTurn(chat, 'hola', 'que tal');

    expect(confirmado).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'que tal' },
    ]);
    expect(chat).toEqual([]);
  });

  it('mantiene la alternancia user/assistant tras N turnos exitosos', () => {
    let chat: ChatMessage[] = [];
    for (let turno = 0; turno < 5; turno += 1) {
      chat = commitTurn(chat, `pregunta ${turno}`, `respuesta ${turno}`);
    }

    expect(chat).toHaveLength(10);
    expect(tieneRolesConsecutivos(chat)).toBe(false);
    chat.forEach((message, i) => {
      expect(message.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
    });
  });
});
