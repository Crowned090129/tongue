package app.tongue.language.network

import app.tongue.language.data.model.ApiError
import kotlinx.serialization.json.Json
import retrofit2.Response

/**
 * Typed outcome of an API call. Decodes the backend `{error}` envelope on
 * non-2xx responses and surfaces useful flags (paywall / upgrade / auth).
 */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>

    /**
     * A structured failure.
     * @param code HTTP status (0 for connectivity/serialization failures).
     * @param message human-readable error (from `{error}` when present).
     * @param isAuthError 401/403 — caller should treat the session as invalid.
     * @param isPaywall the response indicated an upgrade is required (429 upgrade,
     *        or login rejection with `hasPaid=false`).
     * @param upgrade the raw `upgrade` flag from a 429 rate-limit response.
     */
    data class Failure(
        val code: Int,
        val message: String,
        val isAuthError: Boolean = false,
        val isPaywall: Boolean = false,
        val upgrade: Boolean = false,
        val raw: ApiError? = null,
    ) : ApiResult<Nothing>
}

private val errorJson = Json { ignoreUnknownKeys = true }

/** Maps a Retrofit [Response] into an [ApiResult], decoding `{error}` on failure. */
fun <T> Response<T>.toApiResult(): ApiResult<T> {
    if (isSuccessful) {
        val body = body()
        return if (body != null) {
            ApiResult.Success(body)
        } else {
            ApiResult.Failure(code(), "Empty response from server.")
        }
    }

    val rawBody = runCatching { errorBody()?.string() }.getOrNull()
    val parsed = rawBody
        ?.takeIf { it.isNotBlank() }
        ?.let { runCatching { errorJson.decodeFromString<ApiError>(it) }.getOrNull() }

    val status = code()
    val message = parsed?.error ?: defaultMessageFor(status)

    return ApiResult.Failure(
        code = status,
        message = message,
        isAuthError = status == 401 || status == 403,
        isPaywall = status == 429 && parsed?.upgrade == true ||
            (status in 400..403 && parsed?.hasPaid == false),
        upgrade = parsed?.upgrade == true,
        raw = parsed,
    )
}

/** Wraps a suspend network call, converting thrown exceptions into a Failure. */
suspend inline fun <T> apiCall(crossinline block: suspend () -> Response<T>): ApiResult<T> =
    try {
        block().toApiResult()
    } catch (t: Throwable) {
        ApiResult.Failure(
            code = 0,
            message = t.message?.takeIf { it.isNotBlank() }
                ?: "Network error. Check your connection and try again.",
        )
    }

private fun defaultMessageFor(status: Int): String = when (status) {
    in 500..599 -> "Server error. Please try again in a moment."
    401, 403 -> "Your session has expired. Please sign in again."
    429 -> "You've reached your free limit for now."
    else -> "Something went wrong ($status)."
}
