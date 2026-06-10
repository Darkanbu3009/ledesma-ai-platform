import type { ChatMessage } from './run-agent';

/**
 * Helpers puros del turno de chat del playground. El historial confirmado (chat) solo debe
 * incorporar mensajes via commitTurn cuando el turno termina bien: asi un turno fallido o
 * abortado nunca deja un user huerfano que rompa la alternancia user/assistant del proveedor.
 */

/** Historial para el request de un turno: el chat confirmado mas UN user nuevo, sin mutar. */
export function buildRequestChat(chat: ChatMessage[], userText: string): ChatMessage[] {
  return [...chat, { role: 'user', content: userText }];
}

/** Confirma un turno exitoso: incorpora el par (user, assistant) completo al historial. */
export function commitTurn(
  chat: ChatMessage[],
  userText: string,
  assistantText: string,
): ChatMessage[] {
  return [
    ...chat,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ];
}
