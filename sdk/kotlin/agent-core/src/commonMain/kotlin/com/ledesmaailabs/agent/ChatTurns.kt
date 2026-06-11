package com.ledesmaailabs.agent

/**
 * Helpers puros del turno de chat, con la misma transaccionalidad que
 * packages/widget/src/turns.ts: el historial confirmado (chat) solo incorpora mensajes via
 * commitTurn cuando el turno termina bien. Asi un turno fallido o abortado nunca deja un user
 * huerfano que rompa la alternancia user/assistant del proveedor.
 */
object ChatTurns {
    /** Historial para el request de un turno: el chat confirmado mas UN user nuevo, sin mutar. */
    fun buildRequestChat(chat: List<ChatMessage>, userText: String): List<ChatMessage> =
        chat + ChatMessage(role = "user", content = userText)

    /** Confirma un turno exitoso: incorpora el par (user, assistant) completo al historial. */
    fun commitTurn(chat: List<ChatMessage>, userText: String, assistantText: String): List<ChatMessage> =
        chat +
            ChatMessage(role = "user", content = userText) +
            ChatMessage(role = "assistant", content = assistantText)
}
