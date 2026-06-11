plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass = "com.ledesmaailabs.agent.cli.MainKt"
    // Salida UTF-8 estable aunque el locale de la terminal no lo sea.
    applicationDefaultJvmArgs = listOf("-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8")
}

dependencies {
    implementation(project(":agent-core"))
    implementation(libs.kotlinx.coroutines.core)
}

tasks.named<JavaExec>("run") {
    // La CLI es interactiva: engancha el stdin de la terminal al proceso lanzado por Gradle.
    standardInput = System.`in`
}
