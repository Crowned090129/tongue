package app.tongue.language.network

import okhttp3.Interceptor
import okhttp3.Response

/** Supplies the current bearer token (or null when logged out). */
fun interface TokenProvider {
    fun currentToken(): String?
}

/**
 * Injects `Authorization: Bearer <token>` on every request when a token exists.
 * Login / signup requests don't need it (and none exists yet at that point), so
 * this is safe to apply globally. A request may opt out by carrying the
 * [NO_AUTH_HEADER] marker header, which is stripped before the call goes out.
 */
class AuthInterceptor(private val tokenProvider: TokenProvider) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()

        if (original.header(NO_AUTH_HEADER) != null) {
            val stripped = original.newBuilder().removeHeader(NO_AUTH_HEADER).build()
            return chain.proceed(stripped)
        }

        val token = tokenProvider.currentToken()
        val request = if (token.isNullOrBlank()) {
            original
        } else {
            original.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(request)
    }

    companion object {
        const val NO_AUTH_HEADER = "X-Tongue-No-Auth"
    }
}
