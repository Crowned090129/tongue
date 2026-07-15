package app.tongue.language.common

import android.content.Context
import android.speech.tts.TextToSpeech
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.tongue.language.designsystem.tongue
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lifecycle-safe wrapper around the platform [TextToSpeech] engine. One instance
 * is created per composition subtree (via [rememberTtsController]) and shut down
 * automatically when it leaves the composition.
 *
 * The engine initializes asynchronously; [speak] calls made before init completes
 * are queued and flushed once the engine is ready.
 */
class TtsController(context: Context) {
    private val ready = AtomicBoolean(false)
    private var pending: Pair<String, String>? = null

    private val engine = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            ready.set(true)
            pending?.let { (text, langTag) -> speak(text, langTag) }
            pending = null
        }
    }

    /**
     * Speak [text] using the BCP-47 [langTag] (e.g. "fr-FR"). Falls back to the
     * language-only locale if the exact region isn't available; if the whole
     * language is missing, speaks with the current default rather than crashing.
     */
    fun speak(text: String, langTag: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        if (!ready.get()) {
            pending = trimmed to langTag
            return
        }
        val locale = Locale.forLanguageTag(langTag)
        val availability = engine.isLanguageAvailable(locale)
        if (availability >= TextToSpeech.LANG_AVAILABLE) {
            engine.language = locale
        } else {
            val langOnly = Locale(locale.language)
            if (engine.isLanguageAvailable(langOnly) >= TextToSpeech.LANG_AVAILABLE) {
                engine.language = langOnly
            }
            // else: keep whatever default the engine has — best effort.
        }
        engine.speak(trimmed, TextToSpeech.QUEUE_FLUSH, null, trimmed.hashCode().toString())
    }

    fun stop() {
        if (ready.get()) engine.stop()
    }

    fun shutdown() {
        runCatching { engine.stop() }
        runCatching { engine.shutdown() }
        ready.set(false)
    }
}

/** No-op default so previews / non-provided subtrees don't crash. */
val LocalTts = staticCompositionLocalOf<TtsController?> { null }

/**
 * Creates (and disposes) a [TtsController] bound to the current composition.
 * Place high in a feature screen and read via [LocalTts] or pass directly.
 */
@Composable
fun rememberTtsController(): TtsController {
    val context = LocalContext.current
    val controller = remember { TtsController(context) }
    DisposableEffect(controller) {
        onDispose { controller.shutdown() }
    }
    return controller
}

/**
 * A small speaker button that voices [text] in [langTag] (BCP-47). Reuses the
 * ambient [LocalTts] controller if one is provided, else creates its own.
 * Icon only — no emoji, per brand rules.
 */
@Composable
fun PlayButton(
    text: String,
    langTag: String,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.tongue
    val ambient = LocalTts.current
    val controller = ambient ?: rememberTtsController()
    IconButton(
        onClick = { controller.speak(text, langTag) },
        modifier = modifier.size(36.dp),
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.VolumeUp,
            contentDescription = "Play pronunciation",
            tint = colors.accent,
            modifier = Modifier.size(20.dp),
        )
    }
}
