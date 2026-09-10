package tn.maawen.app.data

import org.json.JSONObject

/** Une « app » du catalogue, avec la décision de l'utilisateur. */
data class ToolInfo(
    val key: String,
    val name: String,
    val description: String,
    val kind: String,               // device | server | oauth
    val icon: String,
    val permissions: List<String>,
    val requiresConsent: Boolean,
    val minPlan: String?,
    val status: String?,            // granted | denied | null (pas encore répondu)
    val oauthProvider: String?,     // 'google' pour les apps à connecter
    val connected: Boolean,         // le compte correspondant est relié
) {
    val granted: Boolean get() = status == "granted" || !requiresConsent
    val undecided: Boolean get() = requiresConsent && status == null

    /** Une app Google inutilisable tant que le compte n'est pas relié. */
    val needsConnection: Boolean get() = kind == "oauth" && !connected
}

data class PlanInfo(
    val key: String,
    val name: String,
    val description: String,
    val priceDt: Double,
    val priceUsd: Double,
    val credits: Int,
)

data class SubscriptionInfo(
    val plan: String?,
    val status: String,
    val creditsRemaining: Int,
    val periodEnd: String?,
) {
    val isActive: Boolean get() = status == "active"

    companion object {
        val NONE = SubscriptionInfo(null, "none", 0, null)
    }
}

/** Un message affiché dans la conversation. */
data class ChatLine(
    val fromUser: Boolean,
    val text: String,
    val tools: List<String> = emptyList(),
    val pending: Boolean = false,
)

/** Un appel d'outil que le téléphone doit exécuter. */
data class DeviceCall(val callId: String, val tool: String, val input: JSONObject)
