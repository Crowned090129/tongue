package app.tongue.language.network

import app.tongue.language.data.model.AuthResponse
import app.tongue.language.data.model.ClaudeRequest
import app.tongue.language.data.model.ContentReportRequest
import app.tongue.language.data.model.ContentResponse
import app.tongue.language.data.model.LoginRequest
import app.tongue.language.data.model.OkResponse
import app.tongue.language.data.model.OnboardingRequest
import app.tongue.language.data.model.PreferencesRequest
import app.tongue.language.data.model.PushRegisterRequest
import app.tongue.language.data.model.PushTokenRequest
import app.tongue.language.data.model.SavedResponse
import app.tongue.language.data.model.SignupRequest
import app.tongue.language.data.model.ValidateResponse
import kotlinx.serialization.json.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Retrofit interface for the shared Tongue backend. Returns [Response] so
 * callers can decode the `{error}` envelope on 4xx/5xx via [ApiResult].
 *
 * Auth header injection is handled by [AuthInterceptor]; endpoints that must
 * NOT carry the (possibly stale) stored token — login / signup / the very first
 * auto-login — pass an explicit [Header] to override, or rely on there being no
 * token yet.
 */
interface TongueApi {

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<AuthResponse>

    @POST("api/auth/signup")
    suspend fun signup(@Body body: SignupRequest): Response<AuthResponse>

    @GET("api/auth/validate")
    suspend fun validate(): Response<ValidateResponse>

    @POST("api/auth/onboarding")
    suspend fun onboarding(@Body body: OnboardingRequest): Response<SavedResponse>

    @POST("api/auth/preferences")
    suspend fun preferences(@Body body: PreferencesRequest): Response<SavedResponse>

    /** Dynamic AI response — decode defensively into a [JsonObject]. */
    @POST("api/claude")
    suspend fun claude(@Body body: ClaudeRequest): Response<JsonObject>

    @GET("api/content/{lang}/{tab}")
    suspend fun content(
        @Path("lang") lang: String,
        @Path("tab") tab: String,
    ): Response<ContentResponse>

    @POST("api/content/report")
    suspend fun reportContent(@Body body: ContentReportRequest): Response<OkResponse>

    @POST("api/push/register")
    suspend fun registerPush(@Body body: PushRegisterRequest): Response<OkResponse>

    @HTTP(method = "DELETE", path = "api/push/token", hasBody = true)
    suspend fun deletePushToken(@Body body: PushTokenRequest): Response<OkResponse>
}
