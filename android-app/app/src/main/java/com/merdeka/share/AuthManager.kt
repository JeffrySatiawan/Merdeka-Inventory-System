package com.merdeka.share

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * AuthManager — small wrapper around EncryptedSharedPreferences to store
 * login token, user info, and base URL of the MIS backend.
 */
class AuthManager(context: Context) {

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Fallback to plain prefs if security-crypto initialization fails (e.g. on rooted devices).
            context.getSharedPreferences("merdeka_plain", Context.MODE_PRIVATE)
        }
    }

    var token: String?
        get() = prefs.getString("token", null)
        set(v) { prefs.edit().putString("token", v).apply() }

    var userName: String?
        get() = prefs.getString("user_name", null)
        set(v) { prefs.edit().putString("user_name", v).apply() }

    var userRole: String?
        get() = prefs.getString("user_role", null)
        set(v) { prefs.edit().putString("user_role", v).apply() }

    var baseUrl: String
        get() = prefs.getString("base_url", DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        set(v) { prefs.edit().putString("base_url", v.trimEnd('/')).apply() }

    fun isLoggedIn(): Boolean = !token.isNullOrEmpty()

    fun logout() {
        prefs.edit()
            .remove("token")
            .remove("user_name")
            .remove("user_role")
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "merdeka_secure_prefs"
        const val DEFAULT_BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"
    }
}
