package tn.maawen.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast

/**
 * المعاون — coquille Android de l'agent vocal.
 *
 * L'interface est la PWA servie par le serveur du commerçant; cette activité
 * lui ajoute ce qu'un WebView ne sait pas faire tout seul: la reconnaissance
 * vocale en derja, la lecture à voix haute, et l'ouverture de l'app SMS.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var bridge: NativeBridge? = null

    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    private val serverUrl: String
        get() = prefs.getString(KEY_SERVER, BuildConfig.DEFAULT_SERVER) ?: BuildConfig.DEFAULT_SERVER

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#08201D"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
            }
            webChromeClient = object : WebChromeClient() {
                // getUserMedia depuis la page (chemin de secours si le pont natif n'est pas utilisé)
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { request.grant(request.resources) }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    val scheme = url.scheme ?: return false
                    if (scheme == "http" || scheme == "https") {
                        val host = Uri.parse(serverUrl).host
                        if (url.host == host) return false // navigation interne
                    }
                    return openExternally(url)
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) {
                        Toast.makeText(this@MainActivity, R.string.load_error, Toast.LENGTH_LONG).show()
                        askServerUrl()
                    }
                }
            }
        }
        setContentView(web)

        bridge = NativeBridge(this, web).also { web.addJavascriptInterface(it, "TnNative") }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        }

        if (prefs.contains(KEY_SERVER)) web.loadUrl(serverUrl) else askServerUrl()
    }

    /** Boîte de dialogue: adresse du serveur de l'agent. */
    fun askServerUrl() {
        val field = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(serverUrl)
            setHint(R.string.server_hint)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.server_title)
            .setView(field)
            .setPositiveButton(R.string.save) { _, _ ->
                val url = field.text.toString().trim().trimEnd('/')
                if (url.isNotEmpty()) {
                    prefs.edit().putString(KEY_SERVER, url).apply()
                    web.loadUrl(url)
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** Laisse le système gérer sms:, tel:, mailto: et les liens hors serveur. */
    private fun openExternally(url: Uri): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: Exception) {
            Toast.makeText(this, url.toString(), Toast.LENGTH_SHORT).show()
            true
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == REQ_MIC && (results.isEmpty() || results[0] != PackageManager.PERMISSION_GRANTED)) {
            Toast.makeText(this, R.string.mic_denied, Toast.LENGTH_LONG).show()
        }
    }

    fun hasMicPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun requestMicPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        }
    }

    // Un seul écran: le « retour » navigue dans l'historique du WebView.
    @Suppress("DEPRECATION", "MissingSuperCall")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        bridge?.release()
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val PREFS = "maawen"
        const val KEY_SERVER = "server"
        const val REQ_MIC = 42
    }
}
