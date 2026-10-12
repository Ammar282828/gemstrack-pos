# android-twa: interim Android shell of the live ERP

A Trusted Web Activity (Chrome, full screen) around erp.taheri.shop and erp.houseofmina.store, one APK per house
(flavors `taheri` = `shop.taheri.erp`, `mina` = `store.houseofmina.erp`). It is a stopgap until `apps/android`, the
native app, ships under the same application IDs and the same signing key; its versionCode is 1 so the native app
(higher codes) upgrades it in place. Google sign-in works because the page runs in Chrome, not a WebView.
URLs and labels are read from `apps/iphone/houses.json`; colours and icons are baked into `app/src/<house>/res`.

## Build

```
source /opt/android-sdk/env.sh
./gradlew assembleTaheriRelease assembleMinaRelease      # app/build/outputs/apk/<house>/release/
```

Without the variables below the release APKs come out unsigned. To sign:

```
ERP_KEYSTORE=/path/to/upload.jks ERP_KEYSTORE_PASSWORD=... ./gradlew assembleTaheriRelease assembleMinaRelease
```

The key alias must be `upload`, with the same password as the keystore. For Play, use `bundleTaheriRelease` / `bundleMinaRelease`.

## Full screen needs Digital Asset Links

Each ERP host must serve `/.well-known/assetlinks.json` listing the app's package and its signing SHA-256
(for Play App Signing, the app signing certificate from the Play console; for a sideloaded APK, the upload key's).
Without it Chrome shows a URL bar above the page. Check with
`keytool -list -v -keystore upload.jks -alias upload`.

Note: androidbrowserhelper 2.7.x requires minSdk 24, so this uses 2.6.2 to keep minSdk 23.
