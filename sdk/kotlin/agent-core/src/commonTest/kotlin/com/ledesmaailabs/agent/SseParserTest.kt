package com.ledesmaailabs.agent

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SseParserTest {

    @Test
    fun bloqueDataCompletoEmiteElEvento() {
        val result = SseParser.parseChunks("data: {\"type\":\"text_delta\",\"text\":\"hola\"}\n\n")
        assertEquals(listOf<SseMessage>(SseMessage.Event(AgentEvent.TextDelta("hola"))), result.messages)
        assertEquals("", result.rest)
    }

    @Test
    fun eventDoneEmiteDone() {
        val result = SseParser.parseChunks("event: done\ndata: {}\n\n")
        assertEquals(listOf<SseMessage>(SseMessage.Done), result.messages)
    }

    @Test
    fun eventErrorConCodeEmiteEseCode() {
        val result = SseParser.parseChunks(
            "event: error\ndata: {\"code\":\"RATE_LIMITED\",\"message\":\"despacio\"}\n\n",
        )
        assertEquals(listOf<SseMessage>(SseMessage.Error("RATE_LIMITED", "despacio")), result.messages)
    }

    @Test
    fun eventErrorSinDataUsaLosFallbacks() {
        val result = SseParser.parseChunks("event: error\n\n")
        assertEquals(listOf<SseMessage>(SseMessage.Error("UNKNOWN", "Error")), result.messages)
    }

    @Test
    fun chunkPartidoEnDosLlamadasCompletaElEvento() {
        val first = SseParser.parseChunks("data: {\"type\":\"text_del")
        assertTrue(first.messages.isEmpty())
        assertEquals("data: {\"type\":\"text_del", first.rest)

        val second = SseParser.parseChunks(first.rest + "ta\",\"text\":\"hola\"}\n\n")
        assertEquals(listOf<SseMessage>(SseMessage.Event(AgentEvent.TextDelta("hola"))), second.messages)
        assertEquals("", second.rest)
    }

    @Test
    fun multiplesBloquesEnUnChunkSalenEnOrden() {
        val result = SseParser.parseChunks(
            "data: {\"type\":\"text_delta\",\"text\":\"a\"}\n\n" +
                "data: {\"type\":\"text_delta\",\"text\":\"b\"}\n\n" +
                "event: done\ndata: {}\n\n",
        )
        assertEquals(
            listOf(
                SseMessage.Event(AgentEvent.TextDelta("a")),
                SseMessage.Event(AgentEvent.TextDelta("b")),
                SseMessage.Done,
            ),
            result.messages,
        )
    }

    @Test
    fun jsonCorruptoSeIgnoraSinLanzar() {
        val result = SseParser.parseChunks(
            "data: {esto no es json}\n\ndata: {\"type\":\"text_delta\",\"text\":\"ok\"}\n\n",
        )
        assertEquals(listOf<SseMessage>(SseMessage.Event(AgentEvent.TextDelta("ok"))), result.messages)
    }

    @Test
    fun stopConUsageParseaLosNumeros() {
        val result = SseParser.parseChunks(
            "data: {\"type\":\"stop\",\"reason\":\"end_turn\"," +
                "\"usage\":{\"inputTokens\":12,\"outputTokens\":34}}\n\n",
        )
        val event = (result.messages.single() as SseMessage.Event).event
        assertIs<AgentEvent.Stop>(event)
        assertEquals("end_turn", event.reason)
        assertEquals(12, event.usage.inputTokens)
        assertEquals(34, event.usage.outputTokens)
    }

    @Test
    fun toolUseSinInputUsaElObjetoVacio() {
        val result = SseParser.parseChunks("data: {\"type\":\"tool_use\",\"id\":\"tu_1\",\"name\":\"buscar\"}\n\n")
        val event = (result.messages.single() as SseMessage.Event).event
        assertIs<AgentEvent.ToolUse>(event)
        assertEquals("tu_1", event.id)
        assertEquals("buscar", event.name)
        assertTrue(event.input.isEmpty())
    }

    @Test
    fun flushRestRecuperaUnBloqueFinalSinCierre() {
        assertEquals(emptyList(), SseParser.flushRest("  \n"))
        assertEquals(listOf<SseMessage>(SseMessage.Done), SseParser.flushRest("event: done\ndata: {}"))
    }
}
