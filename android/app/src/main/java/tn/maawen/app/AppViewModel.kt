package tn.maawen.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import tn.maawen.app.data.*
import tn.maawen.app.tools.DeviceTools
import tn.maawen.app.voice.Voice

data class UiState(
    val signedIn: Boolean = false,
    val loading: Boolean = true,
    val userName: String? = null,
    val lines: List<ChatLine> = emptyList(),
    val thinking: Boolean = false,
    val listening: Boolean = false,
    val partial: String = "",
    val subscription: SubscriptionInfo = SubscriptionInfo.NONE,
    val plans: List<PlanInfo> = emptyList(),
    val tools: List<ToolInfo> = emptyList(),
    val message: String? = null,
    /** Motif du blocage: no_subscription, no_credits, daily_cap, blocked. */
    val blockedReason: String? = null,
) {
    val pendingApps: List<ToolInfo> get() = tools.filter { it.undecided }
}

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val session = Session(app)
    private val api = Api(session)
    val voice = Voice(app)

    private val _state = MutableStateFlow(UiState(signedIn = session.isSignedIn))
    val state: StateFlow<UiState> = _state

    private var conversationId: String? = null
    private var userId: String? = null
    private var appSessionId: String? = null
    private var heartbeat: Job? = null

    init {
        voice.prepare()
        voice.onPartial = { text -> _state.update { it.copy(partial = text) } }
        voice.onListeningChanged = { on -> _state.update { it.copy(listening = on) } }
        voice.onError = { msg -> _state.update { it.copy(listening = false, message = msg) } }
        voice.onResult = { text -> send(text) }
        if (session.isSignedIn) refresh()
    }

    // ─────────────────────────────────────────────────────────── session ──

    fun signInUrl(): String = session.signInUrl()

    fun onSignedIn(access: String, refreshToken: String?) {
        session.save(access, refreshToken)
        _state.update { it.copy(signedIn = true, loading = true) }
        refresh()
    }

    fun signOut() {
        viewModelScope.launch { closeAppSession() }
        session.clear()
        conversationId = null
        _state.value = UiState(signedIn = false, loading = false)
    }

    fun refresh() = viewModelScope.launch {
        try {
            userId = api.userId()
            val subscription = api.subscription()
            _state.update {
                it.copy(
                    loading = false,
                    signedIn = true,
                    userName = api.profileName(),
                    subscription = subscription,
                    tools = api.tools(),
                    plans = api.plans(),
                    blockedReason = if (subscription.isActive) null else "no_subscription",
                )
            }
            startAppSession()
        } catch (e: ApiException) {
            if (e.status == 401) signOut() else showMessage(e.message)
            _state.update { it.copy(loading = false) }
        } catch (e: Exception) {
            showMessage("ما نجّمتش نوصل للسرفور.")
            _state.update { it.copy(loading = false) }
        }
    }

    /** Temps passé dans l'app: une séance ouverte, un ping toutes les minutes. */
    private fun startAppSession() {
        val id = userId ?: return
        if (heartbeat != null) return
        heartbeat = viewModelScope.launch {
            appSessionId = runCatching { api.openAppSession(id, BuildConfig.VERSION_NAME) }.getOrNull()
            while (true) {
                delay(60_000)
                val sessionId = appSessionId ?: break
                runCatching { api.pingAppSession(sessionId, ended = false) }
            }
        }
    }

    suspend fun closeAppSession() {
        val id = appSessionId ?: return
        runCatching { api.pingAppSession(id, ended = true) }
        appSessionId = null
        heartbeat?.cancel()
        heartbeat = null
    }

    // ───────────────────────────────────────────────────────── la parole ──

    fun listen() {
        voice.stopSpeaking()
        _state.update { it.copy(partial = "") }
        voice.listen()
    }

    fun stopListening() = voice.stopListening()

    fun send(text: String) {
        val clean = text.trim()
        if (clean.isEmpty() || _state.value.thinking) return

        _state.update {
            it.copy(
                lines = it.lines + ChatLine(fromUser = true, text = clean),
                thinking = true,
                partial = "",
                message = null,
            )
        }

        viewModelScope.launch {
            try {
                var response = api.agent(clean, conversationId)

                // L'agent peut demander plusieurs fois le téléphone dans un même tour.
                var guard = 0
                while (response.optString("status") == "needs_device" && guard++ < 4) {
                    conversationId = response.optString("conversation_id").ifBlank { conversationId }
                    response = api.agent(null, conversationId, runDeviceCalls(response))
                }

                conversationId = response.optString("conversation_id").ifBlank { conversationId }
                val reply = response.optString("reply")
                val credits = response.optInt("credits_remaining", _state.value.subscription.creditsRemaining)

                _state.update {
                    it.copy(
                        lines = it.lines + ChatLine(fromUser = false, text = reply),
                        thinking = false,
                        subscription = it.subscription.copy(creditsRemaining = credits),
                    )
                }
                voice.speak(reply)
            } catch (e: ApiException) {
                _state.update { it.copy(thinking = false) }
                when {
                    e.status == 402 -> _state.update { it.copy(blockedReason = e.code.ifBlank { "no_credits" }) }
                    e.status == 401 -> signOut()
                    else -> showMessage(e.message)
                }
            } catch (e: Exception) {
                _state.update { it.copy(thinking = false) }
                showMessage("ما نجّمتش نوصل للسرفور.")
            }
        }
    }

    /** Exécute sur le téléphone les apps demandées par l'agent. */
    private suspend fun runDeviceCalls(response: JSONObject): JSONArray {
        val calls = response.optJSONArray("device_calls") ?: JSONArray()
        val used = mutableListOf<String>()
        val results = JSONArray()

        for (i in 0 until calls.length()) {
            val call = calls.getJSONObject(i)
            val tool = call.optString("tool")
            used += tool
            val output = DeviceTools.run(
                getApplication<Application>(),
                DeviceCall(call.optString("call_id"), tool, call.optJSONObject("input") ?: JSONObject()),
            )
            results.put(JSONObject().put("call_id", call.optString("call_id")).put("output", output))
        }

        val say = response.optString("say")
        _state.update {
            it.copy(lines = it.lines + ChatLine(fromUser = false, text = say, tools = used, pending = true))
        }
        return results
    }

    // ─────────────────────────────────────────────────────────── les apps ─

    fun setTool(key: String, granted: Boolean) = viewModelScope.launch {
        val id = userId ?: return@launch
        try {
            api.setToolStatus(id, key, granted)
            _state.update { s ->
                s.copy(
                    tools = s.tools.map {
                        if (it.key == key) it.copy(status = if (granted) "granted" else "denied") else it
                    },
                )
            }
        } catch (e: Exception) {
            showMessage("ما تسجّلش التغيير.")
        }
    }

    // ───────────────────────────────────────────────────────── abonnement ─

    fun startCheckout(plan: String, provider: String, open: (String) -> Unit) = viewModelScope.launch {
        try {
            val url = api.checkout(plan, provider)
            if (url.isBlank()) showMessage("ما نجّمناش نحضّرو الخلاص.") else open(url)
        } catch (e: ApiException) {
            showMessage(e.message)
        } catch (e: Exception) {
            showMessage("ما نجّمناش نحضّرو الخلاص.")
        }
    }

    fun showMessage(text: String?) = _state.update { it.copy(message = text) }

    fun newConversation() {
        conversationId = null
        _state.update { it.copy(lines = emptyList()) }
    }

    override fun onCleared() {
        voice.release()
        super.onCleared()
    }
}
