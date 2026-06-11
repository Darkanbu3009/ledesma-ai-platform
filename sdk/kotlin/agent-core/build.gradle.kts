plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)

    jvm {
        testRuns["test"].executionTask.configure {
            useJUnitPlatform()
        }
    }
    // P6b: aca se agregan androidTarget() y los targets ios* sobre el MISMO codigo comun;
    // solo hace falta sumar el engine de Ktor de cada plataforma en su source set.

    sourceSets {
        commonMain.dependencies {
            // api: HttpClient y JsonObject forman parte de la superficie publica del SDK.
            api(libs.ktor.client.core)
            api(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.coroutines.core)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        jvmMain.dependencies {
            implementation(libs.ktor.client.cio)
        }
    }
}
