package com.ledesmaailabs.agent

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO

/**
 * HttpClient por defecto para jvm (engine CIO), con el timeout de request deshabilitado porque
 * un turno SSE puede durar mas que el limite por defecto del engine. P6b agrega las factories
 * equivalentes de los demas targets.
 */
fun LedesmaAgentClient.Companion.defaultClient(): HttpClient = HttpClient(CIO) {
    engine {
        requestTimeout = 0
    }
}
