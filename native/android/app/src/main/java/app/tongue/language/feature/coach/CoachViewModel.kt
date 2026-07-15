package app.tongue.language.feature.coach

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.common.remainingQuota
import app.tongue.language.common.str
import app.tongue.language.data.model.Language
import app.tongue.language.data.model.Languages
import app.tongue.language.data.repo.AuthRepository
import app.tongue.language.data.repo.CoachRepository
import app.tongue.language.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject

/** A single turn in the coach conversation. */
data class CoachMessage(
    val id: Long,
    val fromUser: Boolean,
    val text: String,
    /** Full raw JSON for AI turns, for optional richer rendering. */
    val raw: JsonObject? = null,
)

data class CoachUiState(
    val language: Language = Languages.DEFAULT,
    val messages: List<CoachMessage> = emptyList(),
    val input: String = "",
    val sending: Boolean = false,
    val error: String? = null,
    /** Remaining free-tier calls, if the backend reported it. */
    val remaining: Int? = null,
    /** True when a 429 upgrade paywall was hit. */
    val paywallHit: Boolean = false,
)

/**
 * Drives the AI Coach against the live `/api/claude` endpoint. Requests use
 * `featureType = "coach"` and read the arbitrary JSON response defensively —
 * we surface a `reply`/`message`/`text`/`feedback` field if present, else fall
 * back to a compact rendering of the JSON.
 */
@HiltViewModel
class CoachViewModel @Inject constructor(
    private val coachRepository: CoachRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private var nextId = 0L

    private val _state = MutableStateFlow(
        CoachUiState(language = authRepository.profile?.language ?: Languages.DEFAULT)
    )
    val state: StateFlow<CoachUiState> = _state.asStateFlow()

    fun onInputChange(value: String) = _state.update { it.copy(input = value, error = null) }

    fun send() {
        val prompt = _state.value.input.trim()
        if (prompt.isBlank() || _state.value.sending) return

        val userMsg = CoachMessage(id = nextId++, fromUser = true, text = prompt)
        _state.update {
            it.copy(
                messages = it.messages + userMsg,
                input = "",
                sending = true,
                error = null,
                paywallHit = false,
            )
        }

        viewModelScope.launch {
            val lang = _state.value.language
            when (val res = coachRepository.ask(
                prompt = prompt,
                language = lang.code,
                nativeLang = "en",
                featureType = "coach",
            )) {
                is ApiResult.Success -> {
                    val json = res.data
                    val reply = extractReply(json)
                    _state.update {
                        it.copy(
                            sending = false,
                            remaining = json.remainingQuota() ?: it.remaining,
                            messages = it.messages + CoachMessage(
                                id = nextId++,
                                fromUser = false,
                                text = reply,
                                raw = json,
                            ),
                        )
                    }
                }
                is ApiResult.Failure -> {
                    _state.update {
                        it.copy(
                            sending = false,
                            error = res.message,
                            paywallHit = res.isPaywall || res.code == 429,
                        )
                    }
                }
            }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    /** Read the most likely reply field defensively; fall back to compact JSON. */
    private fun extractReply(json: JsonObject): String {
        return json.str("reply")
            ?: json.str("message")
            ?: json.str("text")
            ?: json.str("feedback")
            ?: json.str("response")
            // Common exercise shape: { question, ... }
            ?: json.str("question")
            ?: json.entries
                .filter { it.key != "_meta" }
                .joinToString("\n") { (k, v) -> "$k: ${v.toString().trim('"')}" }
                .ifBlank { "…" }
    }
}
