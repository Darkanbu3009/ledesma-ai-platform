package com.ledesmaailabs.agent

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.preparePost
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/** Body del contrato publico: exactamente { "messages": [...] }, sin campos extra. */
@Serializable
internal data class RunRequest(val messages: List<ChatMessage>)

/**
 * Cliente streaming del contrato publico POST {baseUrl}/v1/run/{agentId}, con la misma
 * semantica que packages/widget/src/client.ts: la credencial viaja en x-session-token o en
 * x-provider-key (nunca ambas), un status no exitoso se traduce a SseMessage.Error con el
 * code del body (fallback UNKNOWN) y la respuesta SSE se emite mensaje a mensaje via onMessage.
 */
class LedesmaAgentClient(
    private val baseUrl: String,
    private val httpClient: HttpClient,
) {
    suspend fun run(
        agentId: String,
        messages: List<ChatMessage>,
        credentials: Credentials,
        onMessage: (SseMessage) -> Unit,
    ) {
        httpClient.preparePost("$baseUrl/v1/run/$agentId") {
            contentType(ContentType.Application.Json)
            when (credentials) {
                is Credentials.SessionToken -> header("x-session-token", credentials.value)
                is Credentials.ProviderKey -> header("x-provider-key", credentials.value)
            }
            setBody(SseParser.json.encodeToString(RunRequest.serializer(), RunRequest(messages)))
        }.execute { response ->
            if (!response.status.isSuccess()) {
                onMessage(readErrorResponse(response))
                return@execute
            }

            // Lectura del canal en bloques de texto UTF-8: cada chunk de bytes se decodifica de
            // forma incremental (reteniendo un multibyte partido en el borde), se acumula el
            // buffer, se emiten los bloques completos y el resto incompleto se conserva.
            val channel = response.bodyAsChannel()
            val decoder = StreamingUtf8Decoder()
            val chunk = ByteArray(8192)
            var buffer = ""
            while (true) {
                val read = channel.readAvailable(chunk)
                if (read == -1) break
                if (read == 0) continue
                buffer += decoder.decode(chunk.copyOfRange(0, read))
                val result = SseParser.parseChunks(buffer)
                buffer = result.rest
                for (message in result.messages) onMessage(message)
            }
            // Un ultimo bloque sin \n\n de cierre quedaria en el buffer: lo parseamos para no
            // perder un done o un error con su code real.
            buffer += decoder.flush()
            for (message in SseParser.flushRest(buffer)) onMessage(message)
        }
    }

    /** Status no exitoso: intenta extraer error.code y error.message del body JSON. */
    private suspend fun readErrorResponse(response: HttpResponse): SseMessage.Error {
        var code = "UNKNOWN"
        var message = "HTTP ${response.status.value}"
        try {
            val body = SseParser.json.parseToJsonElement(response.bodyAsText())
            val error = body.jsonObject["error"]?.jsonObject
            (error?.get("code") as? JsonPrimitive)?.contentOrNull?.let { code = it }
            (error?.get("message") as? JsonPrimitive)?.contentOrNull?.let { message = it }
        } catch (_: Exception) {
            // sin body JSON: quedan los fallbacks
        }
        return SseMessage.Error(code = code, message = message)
    }

    /** Punto de anclaje para las factories por plataforma (p.ej. defaultClient() en jvmMain). */
    companion object {}
}
