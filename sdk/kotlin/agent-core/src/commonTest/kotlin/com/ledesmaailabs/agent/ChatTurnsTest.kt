package com.ledesmaailabs.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ChatTurnsTest {

    @Test
    fun buildRequestChatAgregaUnSoloUserSinMutar() {
        val chat = listOf(ChatMessage("user", "hola"), ChatMessage("assistant", "buenas"))
        val request = ChatTurns.buildRequestChat(chat, "como va?")
        assertEquals(chat + ChatMessage("user", "como va?"), request)
        assertEquals(2, chat.size)
    }

    @Test
    fun commitTurnAgregaElParCompleto() {
        val committed = ChatTurns.commitTurn(emptyList(), "hola", "buenas")
        assertEquals(
            listOf(ChatMessage("user", "hola"), ChatMessage("assistant", "buenas")),
            committed,
        )
    }

    @Test
    fun falloSinCommitYReintentoNoDejaDosUserConsecutivos() {
        var chat = emptyList<ChatMessage>()

        // Primer intento: el turno falla, el chat confirmado NO se toca.
        ChatTurns.buildRequestChat(chat, "hola")

        // Reintento: el request se arma de nuevo desde el chat confirmado, con UN solo user.
        val retry = ChatTurns.buildRequestChat(chat, "hola")
        assertEquals(1, retry.count { it.role == "user" })

        // El reintento termina bien y recien ahi se commitea; el siguiente turno alterna bien.
        chat = ChatTurns.commitTurn(chat, "hola", "buenas")
        val next = ChatTurns.buildRequestChat(chat, "y ahora?")
        assertEquals(listOf("user", "assistant", "user"), next.map { it.role })
        next.zipWithNext().forEach { (a, b) ->
            assertTrue(!(a.role == "user" && b.role == "user"), "dos user consecutivos")
        }
    }
}
