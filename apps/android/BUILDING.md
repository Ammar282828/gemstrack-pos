# Building the Android app

Linux only; nothing here needs a Mac. JDK 17 or newer (21 is what the cloud container has).

## 1. The SDK

```sh
apps/android/scripts/setup-sdk.sh        # idempotent; ANDROID_HOME defaults to /opt/android-sdk
source /opt/android-sdk/env.sh           # ANDROID_HOME, ANDROID_SDK_ROOT, PATH
```

What it does, by hand, if you want to run the steps yourself:

```sh
mkdir -p /opt/android-sdk/cmdline-tools && cd /tmp
curl -fsSLO https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
unzip -q commandlinetools-linux-16111833_latest.zip
mv cmdline-tools /opt/android-sdk/cmdline-tools/latest
yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/opt/android-sdk "platform-tools" "platforms;android-37.0" "build-tools;37.0.0"
```

(The newest `sdkmanager` prints a deprecation notice and takes the licences with the first install; the script also
runs `--licenses`.) `repository2-3.xml` at `https://dl.google.com/android/repository/` lists the current revision.
`local.properties` is gitignored; Gradle finds the SDK through `ANDROID_HOME`.

Maven Central answers 429 now and then from some networks. Re-run the build: what was fetched is cached, and
`--max-workers=2` makes it gentler.

## 2. Building

From `apps/android`:

```sh
./gradlew :app:assembleTaheriDebug      # shop.taheri.erp, "Taheri ERP"
./gradlew :app:assembleMinaDebug        # store.houseofmina.erp, "Mina ERP"
./gradlew :app:assembleTaheriRelease    # minified, unsigned until the signing step lands
./gradlew :app:assembleMinaRelease
```

APKs land in `app/build/outputs/apk/<house>/<debug|release>/`. `:core` (pure Kotlin, written apart) joins the build
the moment `core/build.gradle.kts` exists (`settings.gradle.kts`).

Gradle 9.8.1 (the wrapper, committed) with AGP 9.4.1.

## 3. Where each shared source comes from

Nothing is copied by hand; Gradle reads these at build time (`app/build.gradle.kts`):

| What | Source | Becomes |
|---|---|---|
| Names, URL, metal, Firebase project/key/sender/bucket | `apps/iphone/houses.json` | per-flavor `BuildConfig` fields (`HOUSE`, `STORE_NAME`, `HOME_NAME`, `SERVER_URL`, `METAL`, `FIREBASE_*`), `app_name`, the `erpHost` manifest placeholder |
| Firebase Android app ID, web OAuth client, testers group | `apps/android/houses.json` | `FIREBASE_ANDROID_APP_ID`, `GOOGLE_WEB_CLIENT_ID` (empty until the owner registers the Android apps) |
| Palette | `apps/iphone/App/Resources/Assets.xcassets/{Accent,Ground,Card,OnAccent,Launch}-<house>.colorset` | `house_accent/ground/card/on_accent/launch` in generated `values/` and `values-night/` (task `generate<House>HouseRes`, reruns when a colorset changes) |
| Font | `apps/iphone/App/Resources/Fonts/FuturaLT-Light.ttf` | `R.font.futura_lt_light` (same task) |
| Design bundle, menus, demo data | `Resources/Design/design-<house>.js`, `Resources/nav-<house>.json`, `Resources/demo.json` | `assets/` of the APK under the same names (task `generate<House>HouseAssets`). Each flavor carries its own house's design and menu only. |
| Launcher icons, `brand_logo`, `launch_logo`, `splash_icon` | `AppIcon-<house>.appiconset`, `BrandLogo-<house>.imageset`, `LaunchLogo-<house>.imageset` | **committed** in `app/src/<house>/res`, rendered by `scripts/icons.sh` (ImageMagick + python3); rerun it when the iPhone's art changes |

Icons: the adaptive background is the art's own flat colour, the foreground is the wordmark inside the 66% safe zone,
the monochrome layer (themed icons) is the wordmark's difference from that colour, and the legacy mipmaps are a
rounded square and a circle at every density.

## 4. Versions chosen

| | |
|---|---|
| Gradle / AGP | 9.8.1 / 9.4.1 (AGP 9 compiles Kotlin itself, so the `kotlin-android` plugin is declared in the catalog but not applied) |
| Kotlin | 2.4.21, with the Compose compiler plugin and kotlinx.serialization plugin at the same version |
| SDK | compile and target 37 (platform `android-37.0`, build-tools 37.0.0), minSdk 26, JVM 17 |
| Compose | BOM 2026.09.00 |
| **Material 3** | **1.5.0-beta01** (`material3`, `-adaptive-navigation-suite`, `-window-size-class`), see below |
| AndroidX | activity-compose 1.13.0, lifecycle 2.11.0, navigation3 1.2.0, adaptive 1.3.0 (+ adaptive-navigation3 1.3.0), core-ktx 1.19.1 |
| Kotlin libraries | coroutines 1.11.0, serialization-json 1.11.0, okhttp 5.5.0, coil3 3.6.3 (compose + network-okhttp) |
| Firebase and sign-in | Firebase BOM 35.0.0 (auth, firestore, messaging), credentials 1.6.0, googleid 1.2.1 |
| Device | Glance 1.2.0, biometric 1.1.0, browser 1.10.0, work 2.12.0, ML Kit document scanner 16.0.0 |
| Other | splashscreen 1.2.0, datastore 1.2.1, webkit 1.17.1, JUnit 4.13.2, kotlin-test |

**Why a beta for Material 3.** The expressive API (`MaterialExpressiveTheme`, `MotionScheme.expressive()`, the
expressive components) is *internal* in the stable 1.4.0 (the classes are in the jar, but the compiler refuses them: "it
is internal in file"). It is public from 1.5.0, which is beta (`1.5.0-beta01`) at the time of writing. The catalog's
`material3` version overrides the BOM for the three material3 artifacts; put it at the BOM's `1.4.0` to go back to
stable (the theme then has to use `MaterialTheme` and lose the expressive motion). Move to 1.5.0 stable when it ships.

Firebase is configured in code with `FirebaseOptions` from `House`; the `google-services` plugin is not applied and
there is no `google-services.json`.
