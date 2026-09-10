package tn.maawen.app.data

import android.content.Context
import android.net.Uri
import tn.maawen.app.BuildConfig

/**
 * La session de l'utilisateur: jetons Supabase gardés sur l'appareil.
 *
 * La connexion se fait par Google, dans le navigateur (onglet personnalisé):
 * Supabase gère l'échange OAuth et nous renvoie sur `maawen://auth`. L'app
 * n'a donc aucune bibliothèque Google à embarquer, et aucun secret.
 */
class Session(context: Context) {

    private val prefs = context.getSharedPreferences("maawen", Context.MODE_PRIVATE)

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS, null)
        private set(value) = prefs.edit().putString(KEY_ACCESS, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH, null)
        private set(value) = prefs.edit().putString(KEY_REFRESH, value).apply()

    val isSignedIn: Boolean get() = !accessToken.isNullOrBlank()

    fun save(access: String, refresh: String?) {
        accessToken = access
        if (!refresh.isNullOrBlank()) refreshToken = refresh
    }

    fun clear() = prefs.edit().remove(KEY_ACCESS).remove(KEY_REFRESH).apply()

    /** Page de connexion Google hébergée par Supabase. */
    fun signInUrl(): String =
        "${BuildConfig.SUPABASE_URL}/auth/v1/authorize" +
            "?provider=google&redirect_to=${Uri.encode(REDIRECT)}"

    companion object {
        const val REDIRECT = "maawen://auth"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"

        /**
         * Supabase renvoie les jetons dans le fragment de l'URL:
         * `maawen://auth#access_token=...&refresh_token=...`
         */
        fun tokensFrom(uri: Uri): Pair<String, String?>? {
            val fragment = uri.fragment ?: uri.query ?: return null
            val values = fragment.split('&').mapNotNull {
                val (k, v) = it.split('=', limit = 2).let { p -> p.getOrNull(0) to p.getOrNull(1) }
                if (k != null && v != null) k to Uri.decode(v) else null
            }.toMap()
            val access = values["access_token"] ?: return null
            return access to values["refresh_token"]
        }
    }
}
