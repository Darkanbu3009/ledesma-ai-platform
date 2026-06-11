package com.ledesmaailabs.agent

import kotlin.test.Test
import kotlin.test.assertEquals

class StreamingUtf8DecoderTest {

    @Test
    fun asciiPasaDirecto() {
        val decoder = StreamingUtf8Decoder()
        assertEquals("hola", decoder.decode("hola".encodeToByteArray()))
        assertEquals("", decoder.flush())
    }

    @Test
    fun unDosBytesPartidoEntreChunksSeRearma() {
        val bytes = "señor".encodeToByteArray()
        val splitAt = bytes.indexOfFirst { (it.toInt() and 0xFF) == 0xC3 } + 1
        val decoder = StreamingUtf8Decoder()
        assertEquals("se", decoder.decode(bytes.copyOfRange(0, splitAt)))
        assertEquals("ñor", decoder.decode(bytes.copyOfRange(splitAt, bytes.size)))
        assertEquals("", decoder.flush())
    }

    @Test
    fun unCuatroBytesPartidoEnTresChunksSeRearma() {
        val bytes = "ok😀!".encodeToByteArray() // emoji de 4 bytes
        val decoder = StreamingUtf8Decoder()
        assertEquals("ok", decoder.decode(bytes.copyOfRange(0, 3)))
        assertEquals("", decoder.decode(bytes.copyOfRange(3, 5)))
        assertEquals("😀!", decoder.decode(bytes.copyOfRange(5, bytes.size)))
        assertEquals("", decoder.flush())
    }

    @Test
    fun flushConSecuenciaIncompletaUsaElReemplazo() {
        val decoder = StreamingUtf8Decoder()
        assertEquals("se", decoder.decode(byteArrayOf(0x73, 0x65, 0xC3.toByte())))
        assertEquals("�", decoder.flush())
        assertEquals("", decoder.flush())
    }
}
