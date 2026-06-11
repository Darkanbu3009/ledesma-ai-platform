package com.ledesmaailabs.agent

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Evento del agente tal como lo emite el backend, con el discriminador "type"
 * (misma forma que packages/widget/src/sse.ts).
 */
@Serializable
sealed class AgentEvent {
    @Serializable
    @SerialName("text_delta")
    data class TextDelta(val text: String) : AgentEvent()

    @Serializable
    @SerialName("tool_use")
    data class ToolUse(
        val id: String,
        val name: String,
        val input: JsonObject = JsonObject(emptyMap()),
    ) : AgentEvent()

    @Serializable
    @SerialName("tool_result")
    data class ToolResult(
        val toolUseId: String,
        val content: String,
        val isError: Boolean = false,
    ) : AgentEvent()

    @Serializable
    @SerialName("stop")
    data class Stop(val reason: String, val usage: Usage) : AgentEvent()
}

@Serializable
data class Usage(val inputTokens: Int, val outputTokens: Int)

/** Mensaje ya interpretado del stream SSE del contrato publico. */
sealed class SseMessage {
    data class Event(val event: AgentEvent) : SseMessage()
    data object Done : SseMessage()
    data class Error(val code: String, val message: String) : SseMessage()
}

/** Mensaje del historial de chat. role: "user" | "assistant". */
@Serializable
data class ChatMessage(val role: String, val content: String)
