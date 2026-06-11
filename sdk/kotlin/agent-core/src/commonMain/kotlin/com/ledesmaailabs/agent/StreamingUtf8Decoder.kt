package com.ledesmaailabs.agent

/**
 * Decodificador UTF-8 incremental, como TextDecoder con stream: true en el widget web:
 * decodifica el prefijo completo de cada chunk de bytes y retiene la cola de una secuencia
 * multibyte incompleta hasta que lleguen los bytes que faltan en el proximo chunk. Sin esto,
 * un caracter multibyte partido en el borde de dos chunks del socket se corrompe.
 */
internal class StreamingUtf8Decoder {
    private var carry = ByteArray(0)

    fun decode(chunk: ByteArray): String {
        if (chunk.isEmpty()) return ""
        val bytes = if (carry.isEmpty()) chunk else carry + chunk
        val completeLength = completeUtf8PrefixLength(bytes)
        carry = bytes.copyOfRange(completeLength, bytes.size)
        return bytes.decodeToString(startIndex = 0, endIndex = completeLength)
    }

    /** Cierre del stream: lo retenido se decodifica igual (con reemplazo si quedo invalido). */
    fun flush(): String {
        if (carry.isEmpty()) return ""
        val rest = carry
        carry = ByteArray(0)
        return rest.decodeToString()
    }

    /** Largo del prefijo decodificable: corta antes de una secuencia multibyte incompleta final. */
    private fun completeUtf8PrefixLength(bytes: ByteArray): Int {
        var leadIndex = bytes.size - 1
        var continuations = 0
        // Retrocede sobre los bytes de continuacion (10xxxxxx) del final; una secuencia valida
        // tiene a lo sumo 3.
        while (leadIndex >= 0 && continuations < 3 && (bytes[leadIndex].toInt() and 0xC0) == 0x80) {
            leadIndex--
            continuations++
        }
        if (leadIndex < 0) return bytes.size
        val lead = bytes[leadIndex].toInt() and 0xFF
        val expectedLength = when {
            lead < 0x80 -> 1
            lead and 0xE0 == 0xC0 -> 2
            lead and 0xF0 == 0xE0 -> 3
            lead and 0xF8 == 0xF0 -> 4
            // Byte invalido como lider: se decodifica todo y el decodificador lo reemplaza.
            else -> 1
        }
        val available = continuations + 1
        return if (available < expectedLength) leadIndex else bytes.size
    }
}
