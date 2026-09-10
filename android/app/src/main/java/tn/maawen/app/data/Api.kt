package tn.maawen.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import tn.maawen.app.BuildConfig
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

/**
 * Accès au backend Supabase: les tables (PostgREST) et les Edge Functions.
 *
 * Volontairement sans bibliothèque: quelques requêtes HTTP et `org.json`
 * suffisent, et l'app reste légère. La clé du fournisseur d'IA n'est jamais
 * ici — seule la clé publique (anon) de Supabase l'est, et c'est la RLS qui
 * décide de ce que chaque compte peut lire.
 */
class Api(private val session: Session) {

    private val base = BuildConfig.SUPABASE_URL.trimEnd('/')

    // ─────────────────────────────────────────────────────── l'assistant ──

    /** Un tour de parole. `deviceResults` sert à reprendre après les apps du téléphone. */
    suspend fun agent(
        message: String?,
        conversationId: String?,
        deviceResults: JSONArray? = null,
    ): JSONObject {
        val body = JSONObject()
        message?.let { body.put("message", it) }
        conversationId?.let { body.put("conversation_id", it) }
        deviceResults?.let { body.put("device_results", it) }
        return function("agent", body)
    }

    suspend fun checkout(plan: String, provider: String): String {
        val body = JSONObject().put("plan", plan).put("provider", provider)
        return function("checkout", body).optString("url")
    }

    // ───────────────────────────────────────────────── compte et formule ──

    suspend fun subscription(): SubscriptionInfo {
        val rows = select("subscriptions", "select=plan_key,status,credits_remaining,period_end")
        if (rows.length() == 0) return SubscriptionInfo.NONE
        val row = rows.getJSONObject(0)
        return SubscriptionInfo(
            plan = row.optString("plan_key").ifBlank { null },
            status = row.optString("status", "none"),
            creditsRemaining = row.optInt("credits_remaining"),
            periodEnd = row.optString("period_end").ifBlank { null },
        )
    }

    suspend fun plans(): List<PlanInfo> {
        val rows = select("plans", "select=key,name_ar,description_ar,price_dt,price_usd,monthly_credits&is_active=eq.true&order=sort")
        return (0 until rows.length()).map { i ->
            val row = rows.getJSONObject(i)
            PlanInfo(
                key = row.getString("key"),
                name = row.optString("name_ar"),
                description = row.optString("description_ar"),
                priceDt = row.optDouble("price_dt", 0.0),
                priceUsd = row.optDouble("price_usd", 0.0),
                credits = row.optInt("monthly_credits"),
            )
        }
    }

    suspend fun profileName(): String? {
        val rows = select("profiles", "select=full_name")
        return if (rows.length() == 0) null else rows.getJSONObject(0).optString("full_name").ifBlank { null }
    }

    // ─────────────────────────────────────────────────────────── les apps ──

    suspend fun tools(): List<ToolInfo> {
        val catalogue = select(
            "tools",
            "select=key,name_ar,description_ar,kind,icon,android_permissions,requires_consent,min_plan&order=sort",
        )
        val consents = select("user_tools", "select=tool_key,status")
        val byKey = (0 until consents.length()).associate {
            val row = consents.getJSONObject(it)
            row.getString("tool_key") to row.getString("status")
        }

        return (0 until catalogue.length()).map { i ->
            val row = catalogue.getJSONObject(i)
            val permissions = row.optJSONArray("android_permissions") ?: JSONArray()
            ToolInfo(
                key = row.getString("key"),
                name = row.optString("name_ar"),
                description = row.optString("description_ar"),
                kind = row.optString("kind"),
                icon = row.optString("icon"),
                permissions = (0 until permissions.length()).map { p -> permissions.getString(p) },
                requiresConsent = row.optBoolean("requires_consent", true),
                minPlan = row.optString("min_plan").ifBlank { null },
                status = byKey[row.getString("key")],
            )
        }
    }

    /** L'utilisateur autorise ou refuse une app. */
    suspend fun setToolStatus(userId: String, key: String, granted: Boolean) {
        val body = JSONArray().put(
            JSONObject()
                .put("user_id", userId)
                .put("tool_key", key)
                .put("status", if (granted) "granted" else "denied")
                .put("granted_at", if (granted) nowIso() else JSONObject.NULL)
                .put("updated_at", nowIso()),
        )
        request(
            "POST",
            "$base/rest/v1/user_tools",
            body.toString(),
            mapOf("Prefer" to "resolution=merge-duplicates,return=minimal"),
        )
    }

    // ──────────────────────────────────────────── temps passé dans l'app ──

    suspend fun openAppSession(userId: String, version: String): String? {
        val body = JSONArray().put(
            JSONObject().put("user_id", userId).put("platform", "android").put("app_version", version),
        )
        val res = request(
            "POST",
            "$base/rest/v1/app_sessions?select=id",
            body.toString(),
            mapOf("Prefer" to "return=representation"),
        )
        val rows = JSONArray(res)
        return if (rows.length() > 0) rows.getJSONObject(0).getString("id") else null
    }

    suspend fun pingAppSession(id: String, ended: Boolean) {
        val body = JSONObject().put("last_ping_at", nowIso())
        if (ended) body.put("ended_at", nowIso())
        request("PATCH", "$base/rest/v1/app_sessions?id=eq.$id", body.toString(), mapOf("Prefer" to "return=minimal"))
    }

    /** Identifiant de l'utilisateur connecté (lu dans le jeton). */
    suspend fun userId(): String? {
        val res = request("GET", "$base/auth/v1/user", null)
        return JSONObject(res).optString("id").ifBlank { null }
    }

    // ───────────────────────────────────────────────────────── plomberie ──

    private suspend fun select(table: String, query: String): JSONArray =
        JSONArray(request("GET", "$base/rest/v1/$table?$query", null))

    private suspend fun function(name: String, body: JSONObject): JSONObject =
        JSONObject(request("POST", "$base/functions/v1/$name", body.toString()))

    private suspend fun request(
        method: String,
        url: String,
        body: String?,
        extraHeaders: Map<String, String> = emptyMap(),
    ): String = withContext(Dispatchers.IO) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 120_000   // l'agent peut réfléchir un moment
            setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            session.accessToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            setRequestProperty("Accept", "application/json")
            extraHeaders.forEach { (k, v) -> setRequestProperty(k, v) }
            if (body != null) {
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                doOutput = true
            }
        }

        try {
            body?.let { connection.outputStream.use { out -> out.write(it.toByteArray()) } }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()

            if (status !in 200..299) {
                val parsed = runCatching { JSONObject(text) }.getOrNull()
                throw ApiException(
                    status,
                    parsed?.optString("error").orEmpty().ifBlank { parsed?.optString("reason").orEmpty() },
                    parsed?.optString("message").orEmpty().ifBlank { text.take(200) },
                )
            }
            text.ifBlank { "{}" }
        } finally {
            connection.disconnect()
        }
    }

    private fun nowIso(): String =
        java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC)
            .format(java.time.format.DateTimeFormatter.ISO_INSTANT)
}
