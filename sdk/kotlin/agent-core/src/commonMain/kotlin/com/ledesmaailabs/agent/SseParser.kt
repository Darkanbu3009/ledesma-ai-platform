package com.ledesmaailabs.agent

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/**
 * Acumulador de SSE sobre chunks de texto, con la misma semantica que
 * packages/widget/src/sse.ts: junta el buffer, separa bloques por doble salto de linea y
 * devuelve los mensajes completos mas el resto del buffer todavia incompleto. Funciones puras.
 */
object SseParser {
    internal val json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "type"
    }

    data class ParseResult(val messages: List<SseMessage>, val rest: String)

    /** El spec de SSE admite un unico espacio opcional despues de los dos puntos del campo. */
    private fun fieldValue(line: String, field: String): String {
        val raw = line.substring(field.length + 1)
        return if (raw.startsWith(" ")) raw.substring(1) else raw
    }

    fun parseChunks(buffer: String): ParseResult {
        val messages = mutableListOf<SseMessage>()
        val parts = buffer.split("\n\n")
        val rest = parts.last()
        for (block in parts.dropLast(1)) {
            if (block.isBlank()) continue
            var eventName = "message"
            var data = ""
            for (line in block.split("\n")) {
                if (line.startsWith("event:")) {
                    eventName = fieldValue(line, "event").trim()
                } else if (line.startsWith("data:")) {
                    data = fieldValue(line, "data")
                }
            }
            when {
                eventName == "done" -> messages.add(SseMessage.Done)
                eventName == "error" -> messages.add(parseError(data))
                data != "" -> parseEvent(data)?.let { messages.add(it) }
            }
        }
        return ParseResult(messages, rest)
    }

    /**
     * Cierre del stream: parsea lo que quedo en el buffer cuando el ultimo bloque llego sin la
     * linea en blanco final, para no perder un done o un error con su code.
     */
    fun flushRest(rest: String): List<SseMessage> {
        if (rest.isBlank()) return emptyList()
        return parseChunks(rest + "\n\n").messages
    }

    private fun parseError(data: String): SseMessage.Error = try {
        val parsed = json.parseToJsonElement(data).jsonObject
        SseMessage.Error(
            code = (parsed["code"] as? JsonPrimitive)?.contentOrNull ?: "UNKNOWN",
            message = (parsed["message"] as? JsonPrimitive)?.contentOrNull ?: "Error",
        )
    } catch (_: Exception) {
        SseMessage.Error(code = "UNKNOWN", message = "Error")
    }

    private fun parseEvent(data: String): SseMessage.Event? = try {
        SseMessage.Event(json.decodeFromString<AgentEvent>(data))
    } catch (_: Exception) {
        // bloque corrupto: ignorar
        null
    }
}
