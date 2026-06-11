package com.ledesmaailabs.agent

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.writeFully
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LedesmaAgentClientTest {

    private val sseBody = "data: {\"type\":\"text_delta\",\"text\":\"hola\"}\n\n" +
        "event: done\ndata: {}\n\n"

    private fun sseEngine(onRequest: (HttpRequestData) -> Unit = {}): MockEngine = MockEngine { request ->
        onRequest(request)
        respond(
            content = sseBody,
            status = HttpStatusCode.OK,
            headers = headersOf(HttpHeaders.ContentType, "text/event-stream"),
        )
    }

    private suspend fun runCollecting(
        engine: MockEngine,
        credentials: Credentials,
        messages: List<ChatMessage> = listOf(ChatMessage("user", "hola")),
    ): List<SseMessage> {
        val received = mutableListOf<SseMessage>()
        LedesmaAgentClient("https://api.test", HttpClient(engine))
            .run("agente-1", messages, credentials) { received.add(it) }
        return received
    }

    @Test
    fun laUrlEsBaseUrlV1RunAgentId() = runTest {
        var url = ""
        var method: HttpMethod? = null
        val engine = sseEngine { request ->
            url = request.url.toString()
            method = request.method
        }
        runCollecting(engine, Credentials.SessionToken("tok-1"))
        assertEquals("https://api.test/v1/run/agente-1", url)
        assertEquals(HttpMethod.Post, method)
    }

    @Test
    fun conSessionTokenViajaXSessionTokenYNoXProviderKey() = runTest {
        var sessionToken: String? = null
        var providerKey: String? = null
        val engine = sseEngine { request ->
            sessionToken = request.headers["x-session-token"]
            providerKey = request.headers["x-provider-key"]
        }
        runCollecting(engine, Credentials.SessionToken("tok-1"))
        assertEquals("tok-1", sessionToken)
        assertNull(providerKey)
    }

    @Test
    fun conProviderKeyViajaXProviderKeyYNoXSessionToken() = runTest {
        var sessionToken: String? = null
        var providerKey: String? = null
        val engine = sseEngine { request ->
            sessionToken = request.headers["x-session-token"]
            providerKey = request.headers["x-provider-key"]
        }
        runCollecting(engine, Credentials.ProviderKey("sk-test"))
        assertEquals("sk-test", providerKey)
        assertNull(sessionToken)
    }

    @Test
    fun elBodyEsExactamenteMessagesConContentTypeJson() = runTest {
        var body: ByteArray? = null
        var contentType = ""
        val engine = MockEngine { request ->
            body = request.body.toByteArray()
            contentType = request.body.contentType.toString()
            respond(
                content = sseBody,
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "text/event-stream"),
            )
        }
        runCollecting(
            engine,
            Credentials.SessionToken("tok-1"),
            messages = listOf(ChatMessage("user", "hola"), ChatMessage("assistant", "buenas"), ChatMessage("user", "y?")),
        )
        assertEquals(
            "{\"messages\":[" +
                "{\"role\":\"user\",\"content\":\"hola\"}," +
                "{\"role\":\"assistant\",\"content\":\"buenas\"}," +
                "{\"role\":\"user\",\"content\":\"y?\"}]}",
            body?.decodeToString(),
        )
        assertTrue(contentType.startsWith("application/json"), "contentType era $contentType")
    }

    @Test
    fun unaRespuestaSseDeDosBloquesLlegaEnOrden() = runTest {
        val received = runCollecting(sseEngine(), Credentials.SessionToken("tok-1"))
        assertEquals(
            listOf(SseMessage.Event(AgentEvent.TextDelta("hola")), SseMessage.Done),
            received,
        )
    }

    @Test
    fun unMultibytePartidoEntreDosChunksDelStreamSeRearma() = runTest {
        val sse = ("data: {\"type\":\"text_delta\",\"text\":\"señor\"}\n\n" + "event: done\ndata: {}\n\n")
            .encodeToByteArray()
        // Corta justo despues del primer byte de la enie (0xC3 0xB1).
        val splitAt = sse.indexOfFirst { (it.toInt() and 0xFF) == 0xC3 } + 1
        val channel = ByteChannel()
        val engine = MockEngine {
            respond(
                content = channel,
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "text/event-stream"),
            )
        }
        launch {
            channel.writeFully(sse, 0, splitAt)
            channel.flush()
            channel.writeFully(sse, splitAt, sse.size)
            channel.flushAndClose()
        }
        val received = runCollecting(engine, Credentials.SessionToken("tok-1"))
        assertEquals(
            listOf(SseMessage.Event(AgentEvent.TextDelta("señor")), SseMessage.Done),
            received,
        )
    }

    @Test
    fun unStatus401EmiteErrorConElCodeDelBody() = runTest {
        val engine = MockEngine {
            respond(
                content = "{\"error\":{\"code\":\"AUTHENTICATION\"}}",
                status = HttpStatusCode.Unauthorized,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val received = runCollecting(engine, Credentials.SessionToken("tok-vencido"))
        assertEquals(listOf<SseMessage>(SseMessage.Error("AUTHENTICATION", "HTTP 401")), received)
    }
}
