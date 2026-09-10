package tn.maawen.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tn.maawen.app.data.Session
import tn.maawen.app.data.ToolInfo
import tn.maawen.app.ui.AppsScreen
import tn.maawen.app.ui.ChatScreen
import tn.maawen.app.ui.LoginScreen
import tn.maawen.app.ui.MaawenTheme
import tn.maawen.app.ui.PlansScreen

/**
 * L'unique écran de l'app: une conversation, plus deux pages (les apps de
 * l'assistant et l'abonnement).
 *
 * L'activité s'occupe de ce qui relève du système: la connexion Google
 * ouverte dans le navigateur, les permissions Android demandées seulement
 * quand l'utilisateur autorise l'app correspondante, et le micro.
 */
class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    private var afterPermission: ((Boolean) -> Unit)? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        afterPermission?.invoke(granted.values.all { it })
        afterPermission = null
    }

    private val micLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) vm.listen() else vm.showMessage("لازم تسمح بالميكرو باش نسمعك.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleDeepLink(intent)

        setContent {
            MaawenTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Root()
                }
            }
        }
    }

    @Composable
    private fun Root() {
        val state by vm.state.collectAsState()
        var screen by remember { mutableStateOf(Screen.Chat) }

        when {
            !state.signedIn -> LoginScreen(onSignIn = { openUrl(vm.signInUrl()) })

            screen == Screen.Apps -> AppsScreen(
                tools = state.tools,
                onBack = { screen = Screen.Chat },
                onToggle = ::toggleTool,
                onConnect = { tool -> vm.connectAccount(tool, ::openUrl) },
            )

            screen == Screen.Plans -> PlansScreen(
                state = state,
                onBack = { screen = Screen.Chat },
                onSubscribe = { plan, provider -> vm.startCheckout(plan.key, provider, ::openUrl) },
                onSignOut = { vm.signOut() },
            )

            else -> ChatScreen(
                state = state,
                onSend = vm::send,
                onMic = ::startListening,
                onStopMic = vm::stopListening,
                onOpenApps = { screen = Screen.Apps },
                onOpenPlans = { screen = Screen.Plans },
            )
        }
    }

    /**
     * Autoriser une app de l'assistant = deux accords: le nôtre (en base) et
     * celui d'Android (la permission). On demande la permission d'abord: si
     * l'utilisateur la refuse, l'app reste éteinte plutôt que d'échouer plus
     * tard au milieu d'une phrase.
     */
    private fun toggleTool(tool: ToolInfo, granted: Boolean) {
        if (!granted || tool.permissions.isEmpty()) {
            vm.setTool(tool.key, granted)
            return
        }
        afterPermission = { ok ->
            vm.setTool(tool.key, ok)
            if (!ok) vm.showMessage("ما تسمحش بالإذن، التطبيق باقي مطفّي.")
        }
        permissionLauncher.launch(tool.permissions.toTypedArray())
    }

    private fun startListening() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            vm.listen()
        } else {
            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun openUrl(url: String) {
        runCatching {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, Uri.parse(url))
        }.onFailure {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    /** `maawen://auth#access_token=…` après Google, `maawen://payment/success` après le paiement. */
    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "maawen") return

        when (uri.host) {
            "auth" -> Session.tokensFrom(uri)?.let { (access, refresh) -> vm.onSignedIn(access, refresh) }
            "oauth" -> {
                if (uri.path?.contains("success") == true) {
                    vm.showMessage("الحساب تربط.")
                    vm.refresh()
                } else {
                    vm.showMessage("الربط ما كملش.")
                }
            }
            "payment" -> {
                if (uri.path?.contains("success") == true) {
                    vm.showMessage("الخلاص وصل. الاشتراك يتفعّل في ثواني.")
                    vm.refresh()
                } else {
                    vm.showMessage("الخلاص ما كملش.")
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        lifecycleScope.launch { vm.closeAppSession() }
    }

    private enum class Screen { Chat, Apps, Plans }
}
