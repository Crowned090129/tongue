package app.tongue.language.di

import android.content.Context
import androidx.room.Room
import app.tongue.language.BuildConfig
import app.tongue.language.auth.SecureAuthStore
import app.tongue.language.data.flashcards.FlashcardDao
import app.tongue.language.data.flashcards.FlashcardDatabase
import app.tongue.language.network.AuthInterceptor
import app.tongue.language.network.TokenProvider
import app.tongue.language.network.TongueApi
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/**
 * Hilt module wiring the networking + storage singletons. Kept intentionally
 * small and explicit — one graph, one place to reason about it.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true   // backend adds fields (e.g. _meta) we don't model
        isLenient = true
        explicitNulls = false
        coerceInputValues = true
    }

    // SecureAuthStore has an @Inject constructor, so Hilt builds it directly.
    // We just bind it as the TokenProvider used by the OkHttp interceptor.
    @Provides
    fun provideTokenProvider(store: SecureAuthStore): TokenProvider = store

    @Provides
    @Singleton
    fun provideOkHttp(tokenProvider: TokenProvider): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenProvider))
            .addInterceptor(logging)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)   // /api/claude can be slow
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient, json: Json): Retrofit {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
    }

    @Provides
    @Singleton
    fun provideTongueApi(retrofit: Retrofit): TongueApi =
        retrofit.create(TongueApi::class.java)

    // ── On-device flashcard storage (Room) ───────────────────────────────────
    @Provides
    @Singleton
    fun provideFlashcardDatabase(@ApplicationContext context: Context): FlashcardDatabase =
        Room.databaseBuilder(context, FlashcardDatabase::class.java, "tongue-flashcards.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provideFlashcardDao(db: FlashcardDatabase): FlashcardDao = db.flashcardDao()
}
