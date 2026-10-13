# kotlinx.serialization: keep the generated serializers and the companions that find them
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class **
-keep class <1> { *; }

# Firestore maps documents onto our classes by reflection
-keepclassmembers class erp.app.** { @com.google.firebase.firestore.PropertyName *; }
-keep class com.google.firebase.firestore.** { *; }

# The WebView bridge's callbacks are called by name from the page
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# OkHttp's optional TLS providers are not on Android
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

# core decodes its models through companions found by type: keep them whole, they are small
-keep class erp.core.** { *; }
