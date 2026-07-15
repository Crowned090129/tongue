# kotlinx.serialization — keep generated serializers and @Serializable metadata.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

# Keep the serializer companions and the serializable classes' fields.
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class app.tongue.language.**$$serializer { *; }
-keepclassmembers class app.tongue.language.data.model.** {
    *** Companion;
}
-keepclasseswithmembers class app.tongue.language.data.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit — keep service interfaces and generics for reflection-based typing.
-keepattributes Signature, Exceptions
-keep,allowobfuscation interface app.tongue.language.network.TongueApi
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Retrofit converter reflection helpers
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# Firebase Messaging
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
