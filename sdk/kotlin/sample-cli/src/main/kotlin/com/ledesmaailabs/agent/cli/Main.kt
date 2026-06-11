package com.ledesmaailabs.agent.cli

import com.ledesmaailabs.agent.AgentEvent
import com.ledesmaailabs.agent.ChatMessage
import com.ledesmaailabs.agent.ChatTurns
import com.ledesmaailabs.agent.Credentials
import com.ledesmaailabs.agent.LedesmaAgentClient
import com.ledesmaailabs.agent.SseMessage
import com.ledesmaailabs.agent.defaultClient
import kotlinx.coroutines.runBlocking
import kotlin.system.exitProcess

private const val DEFAULT_BASE_URL = "https://api-plataforma.ledesma-ai-labs.com"

private fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

fun main() {
    val baseUrl = env("LEDESMA_BASE_URL") ?: DEFAULT_BASE_URL
    val agentId = env("LEDESMA_AGENT_ID") ?: run {
        System.err.println("Falta la variable de entorno LEDESMA_AGENT_ID")
        exitProcess(1)
    }
    val credentials = env("LEDESMA_SESSION_TOKEN")?.let { Credentials.SessionToken(it) }
        ?: env("LEDESMA_PROVIDER_KEY")?.let { Credentials.ProviderKey(it) }
        ?: run {
            System.err.println("Falta LEDESMA_SESSION_TOKEN o LEDESMA_PROVIDER_KEY")
            exitProcess(1)
        }

    val httpClient = LedesmaAgentClient.defaultClient()
    // Ctrl+C: cerrar el cliente http antes de salir para no dejar conexiones colgadas.
    Runtime.getRuntime().addShutdownHook(Thread { httpClient.close() })
    val client = LedesmaAgentClient(baseUrl, httpClient)

    println("Chat con el agente $agentId en $baseUrl (linea vacia o \"salir\" para terminar)")
    var chat = listOf<ChatMessage>()
    runBlocking {
        while (true) {
            print("> ")
            System.out.flush()
            val line = readlnOrNull()?.trim() ?: break
            if (line.isEmpty() || line.equals("salir", ignoreCase = true)) break

            val assistantText = StringBuilder()
            var done = false
            try {
                client.run(agentId, ChatTurns.buildRequestChat(chat, line), credentials) { message ->
                    when (message) {
                        is SseMessage.Event -> when (val event = message.event) {
                            is AgentEvent.TextDelta -> {
                                print(event.text)
                                System.out.flush()
                                assistantText.append(event.text)
                            }
                            is AgentEvent.ToolUse -> println("[tool: ${event.name}]")
                            is AgentEvent.ToolResult -> Unit
                            is AgentEvent.Stop ->
                                println("\n(in ${event.usage.inputTokens} / out ${event.usage.outputTokens} tokens)")
                        }
                        is SseMessage.Done -> done = true
                        is SseMessage.Error -> println("\n[error ${message.code}] ${message.message}")
                    }
                }
            } catch (e: Exception) {
                println("\n[error UNKNOWN] ${e.message}")
            }
            // Transaccionalidad del turno: solo se incorpora al historial si termino bien.
            if (done) chat = ChatTurns.commitTurn(chat, line, assistantText.toString())
        }
    }
    httpClient.close()
}
