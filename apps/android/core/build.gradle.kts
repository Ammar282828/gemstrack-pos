plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

// JDK 21 builds it, the bytecode is 17's, so no toolchain download is needed.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.junit)
}

tasks.test {
    // The contract tests find the repo's two cases files from here (the Gradle project dir), wherever the test JVM starts.
    systemProperty("erp.coreDir", projectDir.absolutePath)
}

// `./gradlew :core:contractCases` writes apps/android/contract/cases.json: the New order / New sale contract the
// Kotlin entry code produces (the iPhone's is `swift run ContractCases`). ContractTests holds it equal to the iPhone's.
tasks.register<JavaExec>("contractCases") {
    group = "verification"
    description = "Regenerates apps/android/contract/cases.json from the New order / New sale code"
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("erp.core.contract.ContractCasesKt")
    args(rootProject.projectDir.resolve("contract/cases.json").absolutePath)
}
