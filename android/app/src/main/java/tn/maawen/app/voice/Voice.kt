package tn.maawen.app.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * La voix: écoute en derja et lecture des réponses.
 *
 * `SpeechRecognizer` d'Android accepte l'étiquette « ar-TN »; si le moteur
 * du téléphone ne l'a pas, il retombe sur l'arabe standard — c'est pour ça
 * qu'on donne aussi une préférence de langue.
 */
class Voice(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    var onPartial: (String) -> Unit = {}
    var onResult: (String) -> Unit = {}
    var onError: (String) -> Unit = {}
    var onListeningChanged: (Boolean) -> Unit = {}

    fun prepare() {
        if (tts != null) return
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val result = tts?.setLanguage(Locale("ar", "TN"))
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts?.language = Locale("ar")
                }
                ttsReady = true
            }
        }
    }

    val isAvailable: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    fun listen() {
        stopSpeaking()
        recognizer?.destroy()

        if (!isAvailable) {
            onError("ما فماش خدمة تعرّف على الصوت في التليفون هذا.")
            return
        }

        recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(listener)
            startListening(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-TN")
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar")
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
                },
            )
        }
        onListeningChanged(true)
    }

    fun stopListening() {
        recognizer?.stopListening()
        recognizer?.cancel()
        onListeningChanged(false)
    }

    fun speak(text: String) {
        if (!ttsReady || text.isBlank()) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "maawen")
    }

    fun stopSpeaking() {
        if (ttsReady) tts?.stop()
    }

    fun release() {
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            first(partialResults)?.let(onPartial)
        }

        override fun onResults(results: Bundle?) {
            onListeningChanged(false)
            val text = first(results)
            if (text.isNullOrBlank()) this@Voice.onError("ما سمعتش حاجة، عاود احكي.") else onResult(text)
        }

        override fun onError(error: Int) {
            onListeningChanged(false)
            this@Voice.onError(message(error))
        }

        private fun first(bundle: Bundle?): String? =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

        private fun message(error: Int): String = when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "مشكل في الميكرو."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "لازم تسمح بالميكرو."
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "ما فماش connexion."
            SpeechRecognizer.ERROR_NO_MATCH -> "ما فهمتش، عاود احكي."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ما سمعتش حاجة."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "استنّى ثانية وعاود."
            else -> "مشكل في الصوت ($error)."
        }
    }
}
