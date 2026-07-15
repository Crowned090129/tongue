package app.tongue.language.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tongue.language.network.TokenProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Securely persists the JWT token and the user's access code using
 * [EncryptedSharedPreferences] (AES-256, key backed by the Android Keystore).
 *
 * Why persist the code as well as the token: the web app auto-signs returning
 * users in by re-POSTing their saved code once the short-lived JWT expires, so
 * they never re-enter it. We mirror that here. Both values are AES-encrypted at
 * rest; this file is also excluded from backups (see backup_rules.xml).
 *
 * Also implements [TokenProvider] so the OkHttp [AuthInterceptor] can read the
 * token synchronously on the network thread.
 */
@Singleton
class SecureAuthStore @Inject constructor(
    @ApplicationContext context: Context,
) : TokenProvider {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    // ── Token ──────────────────────────────────────────────────────────────

    override fun currentToken(): String? = prefs.getString(KEY_TOKEN, null)

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value)
        }.apply()

    var tokenExpiresAt: String?
        get() = prefs.getString(KEY_EXPIRES, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_EXPIRES) else putString(KEY_EXPIRES, value)
        }.apply()

    // ── Access code (for silent re-login) ────────────────────────────────────

    var accessCode: String?
        get() = prefs.getString(KEY_CODE, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_CODE) else putString(KEY_CODE, value)
        }.apply()

    val hasSavedCode: Boolean get() = !accessCode.isNullOrBlank()

    val hasToken: Boolean get() = !currentToken().isNullOrBlank()

    /** Persist a successful login: store both the token and the code used. */
    fun saveSession(token: String, code: String?, expiresAt: String?) {
        prefs.edit().apply {
            putString(KEY_TOKEN, token)
            if (code != null) putString(KEY_CODE, code)
            if (expiresAt != null) putString(KEY_EXPIRES, expiresAt)
        }.apply()
    }

    /** Sign out: wipe everything. Push-token deletion is handled by the repo. */
    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        // Referenced by backup_rules.xml — keep in sync.
        const val FILE_NAME = "tongue_secure_auth"
        private const val KEY_TOKEN = "jwt_token"
        private const val KEY_EXPIRES = "jwt_expires_at"
        private const val KEY_CODE = "access_code"
    }
}
