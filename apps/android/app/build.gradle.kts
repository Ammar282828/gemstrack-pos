import groovy.json.JsonSlurper
import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// ---- One source per fact: the iPhone's files, read here, never copied by hand -------------------

val iphoneDir = rootProject.file("../iphone")
val iphoneRes = File(iphoneDir, "App/Resources")
val xcassets = File(iphoneRes, "Assets.xcassets")

@Suppress("UNCHECKED_CAST")
fun json(f: File): Map<String, Map<String, Any?>> =
    JsonSlurper().parse(f) as Map<String, Map<String, Any?>>

val shared = json(File(iphoneDir, "houses.json"))
val androidOnly = json(rootProject.file("houses.json"))

fun q(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// ---- Generated resources and assets --------------------------------------------------------------

/** Xcode writes components as 0..1 floats, 0xNN hex, or 0..255 integers; read them all. */
fun component(v: Any?): Int {
    val s = v.toString().trim()
    val n = when {
        s.startsWith("0x", ignoreCase = true) -> s.substring(2).toInt(16).toDouble()
        s.contains('.') -> s.toDouble() * 255.0
        else -> s.toDouble().let { if (it <= 1.0) it * 255.0 else it } // a bare 0 or 1 is a float
    }
    return Math.round(n).toInt().coerceIn(0, 255)
}

@Suppress("UNCHECKED_CAST")
fun colorsetValue(file: File, dark: Boolean): String? {
    val colors = (JsonSlurper().parse(file) as Map<String, Any?>)["colors"] as List<Map<String, Any?>>
    val hit = colors.firstOrNull { c ->
        val isDark = (c["appearances"] as? List<Map<String, Any?>>)
            ?.any { it["appearance"] == "luminosity" && it["value"] == "dark" } == true
        isDark == dark
    } ?: return null
    val comps = (hit["color"] as Map<String, Any?>)["components"] as Map<String, Any?>
    val gray = comps["white"]
    val r = component(gray ?: comps["red"])
    val g = component(gray ?: comps["green"])
    val b = component(gray ?: comps["blue"])
    val a = component(comps["alpha"] ?: "1")
    return if (a == 255) "#%02X%02X%02X".format(r, g, b) else "#%02X%02X%02X%02X".format(a, r, g, b)
}

abstract class HouseResources : DefaultTask() {
    @get:Input abstract val house: Property<String>
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) abstract val colorsets: ConfigurableFileCollection
    @get:InputFile @get:PathSensitive(PathSensitivity.NAME_ONLY) abstract val font: RegularFileProperty
    @get:OutputDirectory abstract val outDir: DirectoryProperty
    // the colour reader lives in the script; it is handed in so the task stays a plain class
    @get:Internal var reader: (File, Boolean) -> String? = { _, _ -> null }

    @TaskAction fun run() {
        val out = outDir.get().asFile
        out.deleteRecursively()
        val names = mapOf(
            "Accent" to "house_accent", "Ground" to "house_ground", "Card" to "house_card", "Elevated" to "house_elevated",
            "OnAccent" to "house_on_accent", "Launch" to "house_launch",
        )
        for ((dark, dir) in listOf(false to "values", true to "values-night")) {
            val body = names.mapNotNull { (set, name) ->
                val f = colorsets.files.first { it.parentFile.name == "$set-${house.get()}.colorset" }
                reader(f, dark)?.let { "    <color name=\"$name\">$it</color>" }
            }
            if (body.isEmpty()) continue
            File(out, dir).mkdirs()
            File(out, "$dir/colors.xml").writeText(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!-- Generated from the iPhone's asset catalog; do not edit. -->\n" +
                    "<resources>\n${body.joinToString("\n")}\n</resources>\n",
            )
        }
        File(out, "font").mkdirs()
        font.get().asFile.copyTo(File(out, "font/futura_lt_light.ttf"), overwrite = true)
    }
}

abstract class HouseAssets : DefaultTask() {
    @get:Input abstract val house: Property<String>
    @get:InputFiles @get:PathSensitive(PathSensitivity.NAME_ONLY) abstract val files: ConfigurableFileCollection
    @get:OutputDirectory abstract val outDir: DirectoryProperty

    @TaskAction fun run() {
        val out = outDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        files.files.filter { it.exists() }.forEach { it.copyTo(File(out, it.name), overwrite = true) }
    }
}

/**
 * The art of both built-in businesses, in every flavor: one app holds Taheri and House of Mina (docs/features/android-app.md), so
 * the wordmark and the round badge of each are resources of the app, not of its flavor. Copied from the iPhone's asset catalog
 * (BrandLogo-<id>, BadgeMark-<id>) so a change to the art there is a change here.
 */
abstract class BusinessArt : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) abstract val imagesets: ConfigurableFileCollection
    @get:OutputDirectory abstract val outDir: DirectoryProperty

    @TaskAction fun run() {
        val out = outDir.get().asFile
        out.deleteRecursively()
        for (art in listOf("taheri", "mina")) {
            fun set(name: String) = imagesets.files.first { it.parentFile.name == "$name-$art.imageset" }.parentFile
            File(out, "drawable-nodpi").mkdirs()
            File(out, "drawable-night-nodpi").mkdirs()
            File(set("BrandLogo"), "logo.png").copyTo(File(out, "drawable-nodpi/brand_logo_$art.png"), overwrite = true)
            File(set("BrandLogo"), "logo-dark.png").copyTo(File(out, "drawable-night-nodpi/brand_logo_$art.png"), overwrite = true)
            File(set("BadgeMark"), "badge.png").copyTo(File(out, "drawable-nodpi/badge_mark_$art.png"), overwrite = true)
        }
    }
}

// ---- The app ---------------------------------------------------------------------------------------

android {
    namespace = "erp.app"
    compileSdk { version = release(37) }

    defaultConfig {
        minSdk = 26
        targetSdk = 37
        versionCode = 7 // above the interim web app (apps/android-twa, 1), so this installs over it
        versionName = "0.4.0"
    }

    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    flavorDimensions += "house"
    productFlavors {
        for (id in listOf("taheri", "mina")) {
            create(id) {
                dimension = "house"
                val s = shared.getValue(id)
                val a = androidOnly.getValue(id)
                @Suppress("UNCHECKED_CAST") val fb = s["firebase"] as Map<String, Any?>
                val url = s["url"] as String
                applicationId = s["bundleId"] as String // the iPhone's id, so the two phones match
                // -Ppreview: a demo build beside the installed app (its own id, "Preview" in its name, the demo books).
                val preview = project.hasProperty("preview")
                if (preview) applicationIdSuffix = ".preview"
                resValue("string", "app_name", (s["homeName"] as String) + if (preview) " Preview" else "")
                // The launcher shortcut (xml/shortcuts.xml) names the package it opens; an XML file cannot read the applicationId.
                resValue("string", "erp_package", (s["bundleId"] as String) + if (preview) ".preview" else "")
                buildConfigField("boolean", "PREVIEW_DEMO", preview.toString())
                buildConfigField("String", "HOUSE", q(id))
                buildConfigField("String", "STORE_NAME", q(s["storeName"] as String))
                buildConfigField("String", "HOME_NAME", q(s["homeName"] as String))
                buildConfigField("String", "SERVER_URL", q(url))
                buildConfigField("String", "METAL", q(s["metal"] as String))
                buildConfigField("String", "FIREBASE_PROJECT_ID", q(fb["projectId"] as String))
                buildConfigField("String", "FIREBASE_API_KEY", q(fb["apiKey"] as String))
                buildConfigField("String", "FIREBASE_SENDER_ID", q(fb["senderId"] as String))
                buildConfigField("String", "FIREBASE_STORAGE_BUCKET", q(fb["storageBucket"] as String))
                buildConfigField("String", "FIREBASE_ANDROID_APP_ID", q(a["firebaseAndroidAppId"] as? String ?: ""))
                buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", q(a["googleWebClientId"] as? String ?: ""))
                manifestPlaceholders["erpHost"] = URI(url).host
                // The one app holds both houses: the other house's address opens here too (the Mina flavor, deprecated, repeats its own).
                manifestPlaceholders["erpHostOther"] = URI((shared.getValue(if (id == "taheri") "mina" else id)["url"]) as String).host
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // The app's own code stays exactly as written (only the libraries are shrunk): nothing of ours can be
            // stripped by a missing rule until release builds have been tried on phones for a while.
            proguardFiles("proguard-preview.pro")
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    testOptions {
        // The pure parts are tested on the JVM; an Android call they happen to touch answers its default, not an error.
        unitTests.isReturnDefaultValues = true
        // Robolectric reads the app's resources, assets and manifest: the screenshot tests draw the real screens.
        unitTests.isIncludeAndroidResources = true
        // Robolectric reaches into the JDK's file descriptors (Android 16 shared memory); Java 17+ closes them unless told.
        unitTests.all { test ->
            // Hundreds of Robolectric screenshots in one JVM outgrow its default 512 MB: a larger heap, and a fresh JVM now and then.
            test.maxHeapSize = "2g"
            test.setForkEvery(100)
            test.jvmArgs(
                "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.nio=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
            )
        }
    }
}

// The review baseline: recorded screenshots are kept in the repo (./gradlew :app:recordRoborazziTaheriDebug records,
// :app:verifyRoborazziTaheriDebug checks). The tests name each flavor's own folder, so the houses never overwrite each other.
roborazzi {
    outputDir.set(layout.projectDirectory.dir("src/test/screenshots"))
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Each house's generated resources and assets, wired to every variant of that flavor.
val houseRes = HashMap<String, TaskProvider<HouseResources>>()
val houseAssets = HashMap<String, TaskProvider<HouseAssets>>()
val businessArt = tasks.register<BusinessArt>("generateBusinessArt") {
    imagesets.from(fileTree(xcassets) { include("BrandLogo-*.imageset/logo*.png", "BadgeMark-*.imageset/badge.png") })
    outDir.set(layout.buildDirectory.dir("generated/business/res"))
}

androidComponents.onVariants { variant ->
    variant.sources.res?.addGeneratedSourceDirectory(businessArt, BusinessArt::outDir)
    val house = variant.productFlavors.first { it.first == "house" }.second
    val cap = house.replaceFirstChar { it.uppercase() }

    val res = houseRes.getOrPut(house) {
        tasks.register<HouseResources>("generate${cap}HouseRes") {
            this.house.set(house)
            colorsets.from(fileTree(xcassets) { include("*-$house.colorset/Contents.json") })
            font.set(File(iphoneRes, "Fonts/FuturaLT-Light.ttf"))
            outDir.set(layout.buildDirectory.dir("generated/house/$house/res"))
            reader = ::colorsetValue
        }
    }
    variant.sources.res?.addGeneratedSourceDirectory(res, HouseResources::outDir)

    val assets = houseAssets.getOrPut(house) {
        tasks.register<HouseAssets>("generate${cap}HouseAssets") {
            this.house.set(house)
            // this house's design bundle and menus, plus the demo data; names stay as on the iPhone
            // The one app (taheri) holds House of Mina too, so it carries Mina's bundle and menu as well.
            for (art in if (house == "taheri") listOf("taheri", "mina") else listOf(house)) {
                files.from(File(iphoneRes, "Design/design-$art.js"), File(iphoneRes, "nav-$art.json"))
            }
            files.from(File(iphoneRes, "demo.json"))
            outDir.set(layout.buildDirectory.dir("generated/house/$house/assets"))
        }
    }
    variant.sources.assets?.addGeneratedSourceDirectory(assets, HouseAssets::outDir)
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(platform(libs.firebase.bom))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.window.size)
    implementation(libs.compose.material3.adaptive.navigation.suite)
    implementation(libs.material.color.utilities) // the business's colour as a whole Material 3 scheme (ui/theme/Scheme.kt)
    implementation(libs.compose.adaptive)
    implementation(libs.compose.adaptive.layout)
    implementation(libs.compose.adaptive.navigation)
    implementation(libs.compose.adaptive.navigation3)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.compose.ui.tooling.preview)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.webkit)

    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.messaging) // not used by code yet (alerts, a later phase); here so the manifest merges
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    // Not used by code yet (widgets, a later phase); here so they resolve from the first build.
    implementation(libs.androidx.glance.appwidget)
    implementation(libs.androidx.glance.material3)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.work.runtime)
    implementation(libs.mlkit.document.scanner)
    implementation(libs.mlkit.code.scanner) // Scan a tag: Google's code scanner, no camera permission of its own
    implementation(libs.zxing.core) // The tag designer draws QR and bar codes as the printer will (patterns, not the printer's own)

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest) // the ComponentActivity the compose rule starts
}
