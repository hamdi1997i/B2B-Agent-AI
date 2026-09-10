package tn.maawen.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.util.Locale

/**
 * Pont `window.TnNative` exposé à la page web.
 *
 * Les méthodes @JavascriptInterface sont appelées depuis un thread du WebView:
 * tout ce qui touche à l'UI, au recognizer ou au TTS repasse par le thread
 * principal.
 */
class NativeBridge(private val activity: MainActivity, private val web: WebView) {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    init {
        main.post {
            tts = TextToSpeech(activity) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    val tunisian = Locale("ar", "TN")
                    val res = tts?.setLanguage(tunisian)
                    if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts?.language = Locale("ar")
                    }
                    ttsReady = true
                }
            }
        }
    }

    // ------------------------------------------------------------------ voix

    @JavascriptInterface
    fun startListening(lang: String?) {
        main.post {
            if (!activity.hasMicPermission()) {
                activity.requestMicPermission()
                toWeb("tnOnSpeechError", activity.getString(R.string.mic_denied))
                return@post
            }
            if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
                toWeb("tnOnSpeechError", "ما فماش خدمة تعرّف على الصوت في التليفون هذا.")
                return@post
            }
            stopSpeakingInternal()
            recognizer?.destroy()
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity).apply {
                setRecognitionListener(listener)
                startListening(
                    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(
                            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                        )
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang ?: "ar-TN")
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar")
                        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
                    },
                )
            }
        }
    }

    @JavascriptInterface
    fun stopListening() {
        main.post {
            recognizer?.stopListening()
            recognizer?.cancel()
        }
    }

    @JavascriptInterface
    fun speak(text: String?) {
        val t = text?.trim().orEmpty()
        if (t.isEmpty()) return
        main.post {
            if (ttsReady) tts?.speak(t, TextToSpeech.QUEUE_FLUSH, null, "maawen")
        }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        main.post { stopSpeakingInternal() }
    }

    // ------------------------------------------------------------------- SMS

    /**
     * Ouvre l'app de messages avec le texte pré-rempli. On n'envoie jamais
     * nous-mêmes: le commerçant appuie sur « envoyer » dans son app.
     */
    @JavascriptInterface
    fun sendSms(number: String?, message: String?) {
        main.post {
            val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${number.orEmpty()}")).apply {
                putExtra("sms_body", message.orEmpty())
            }
            try {
                activity.startActivity(intent)
            } catch (e: ActivityNotFoundException) {
                Toast.makeText(activity, R.string.no_sms_app, Toast.LENGTH_LONG).show()
            }
        }
    }

    @JavascriptInterface
    fun openSettings() {
        main.post { activity.askServerUrl() }
    }

    /** Permet à la page de savoir qu'elle tourne dans l'app Android. */
    @JavascriptInterface
    fun isNative(): Boolean = true

    // -------------------------------------------------------------- internes

    private fun stopSpeakingInternal() {
        if (ttsReady) tts?.stop()
    }

    private fun toWeb(fn: String, arg: String) {
        main.post { web.evaluateJavascript("window.$fn && window.$fn(${JSONObject.quote(arg)});", null) }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            first(partialResults)?.let { toWeb("tnOnSpeechPartial", it) }
        }

        override fun onResults(results: Bundle?) {
            val text = first(results)
            if (text.isNullOrBlank()) toWeb("tnOnSpeechError", "ما سمعتش حاجة، عاود احكي.")
            else toWeb("tnOnSpeechResult", text)
        }

        override fun onError(error: Int) {
            toWeb("tnOnSpeechError", message(error))
        }

        private fun first(bundle: Bundle?): String? =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

        private fun message(error: Int): String = when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "مشكل في الميكرو."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> activity.getString(R.string.mic_denied)
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "ما فماش connexion."
            SpeechRecognizer.ERROR_NO_MATCH -> "ما فهمتش، عاود احكي."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ما سمعتش حاجة."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "استنّى ثانية وعاود."
            else -> "مشكل في الصوت ($error)."
        }
    }

    fun release() {
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}
