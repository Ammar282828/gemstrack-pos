pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "erp-android"

include(":app")
// core is written apart (pure Kotlin); the build works with or without it
if (file("core/build.gradle.kts").exists()) include(":core")
