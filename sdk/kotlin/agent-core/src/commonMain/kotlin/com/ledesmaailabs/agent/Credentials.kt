package com.ledesmaailabs.agent

/**
 * Credencial del contrato publico: exactamente UNA viaja por request
 * (x-session-token o x-provider-key, nunca ambas).
 */
sealed class Credentials {
    /** Token de sesion efimero emitido por el backend del cliente (modo produccion). */
    data class SessionToken(val value: String) : Credentials()

    /** Key directa del proveedor: solo pruebas/servidor, nunca en un cliente distribuido. */
    data class ProviderKey(val value: String) : Credentials()
}
