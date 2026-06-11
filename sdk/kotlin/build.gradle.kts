// Raiz minima: declara los plugins con apply false para fijar sus versiones una sola vez
// (las versiones concretas viven en gradle/libs.versions.toml).
plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
