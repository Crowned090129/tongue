package app.tongue.language.feature.analyzer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.common.array
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

/** A key word/phrase from the analysis. */
data class AnalyzedWord(
    val word: String,
    val meaning: String?,
    val grammar: String?,
    val ref: String?,
)

data class GrammarPoint(val pattern: String, val explanation: String?, val example: String?)

data class Analysis(
    val language: String?,
    val translation: String?,
    val summary: String?,
    val difficulty: String?,
    val words: List<AnalyzedWord>,
    val grammarPoints: List<GrammarPoint>,
    val tip: String?,
)

data class AnalyzerUiState(
    val language: Language = Languages.DEFAULT,
    val input: String = "",
    val loading: Boolean = false,
    val analysis: Analysis? = null,
    val error: String? = null,
    val paywallHit: Boolean = false,
)

/**
 * Text Analyzer — mirrors the web "Analyze Any Text" tool. Sends a prompt to
 * `/api/claude` (featureType "analyzer") requesting a structured JSON breakdown,
 * then reads it defensively into an [Analysis].
 */
@HiltViewModel
class AnalyzerViewModel @Inject constructor(
    private val coachRepository: CoachRepository,
    authRepository: AuthRepository,
) : ViewModel() {

    private val language: Language = authRepository.profile?.language ?: Languages.DEFAULT

    private val _state = MutableStateFlow(AnalyzerUiState(language = language))
    val state: StateFlow<AnalyzerUiState> = _state.asStateFlow()

    fun onInputChange(value: String) = _state.update { it.copy(input = value, error = null) }

    fun analyze() {
        val text = _state.value.input.trim()
        if (text.isBlank() || _state.value.loading) return
        _state.update { it.copy(loading = true, error = null, analysis = null, paywallHit = false) }

        viewModelScope.launch {
            val prompt = buildPrompt(text, language)
            when (val res = coachRepository.ask(
                prompt = prompt,
                language = language.code,
                nativeLang = "en",
                featureType = "analyzer",
                maxTokens = 1500,
            )) {
                is ApiResult.Success -> _state.update {
                    it.copy(loading = false, analysis = parse(res.data))
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(
                        loading = false,
                        error = res.message,
                        paywallHit = res.isPaywall || res.code == 429,
                    )
                }
            }
        }
    }

    fun reset() = _state.update { it.copy(analysis = null, input = "", error = null) }
    fun dismissError() = _state.update { it.copy(error = null) }

    private fun buildPrompt(text: String, language: Language): String {
        val tName = language.englishName
        val refName = "English"
        val clipped = text.take(600)
        return "You are a $tName language expert. A learner who speaks $refName pasted this text:\n\n" +
            "\"$clipped\"\n\n" +
            "Analyze it deeply. Return JSON:\n" +
            "{\"language\":\"$tName or note if different\",\"translation\":\"natural $refName translation\"," +
            "\"summary\":\"what this is in 1 sentence\",\"difficulty\":\"A1/A2/B1/B2/C1/C2\"," +
            "\"words\":[{\"word\":\"target word or phrase\",\"meaning\":\"$refName meaning\"," +
            "\"grammar\":\"part of speech and grammatical form explanation\"," +
            "\"ref\":\"how this relates to $refName — cognate? false friend? no equivalent?\"}]," +
            "\"grammar_points\":[{\"pattern\":\"grammar structure used\"," +
            "\"explanation\":\"what it is and how it works — 2-3 sentences\"," +
            "\"example\":\"new example using the same structure\"}]," +
            "\"tip\":\"one cultural or linguistic insight\"}"
    }

    private fun parse(json: JsonObject): Analysis = Analysis(
        language = json.str("language"),
        translation = json.str("translation"),
        summary = json.str("summary"),
        difficulty = json.str("difficulty"),
        words = json.array("words")?.mapNotNull { it as? JsonObject }?.mapNotNull { w ->
            val word = w.str("word") ?: return@mapNotNull null
            AnalyzedWord(word, w.str("meaning"), w.str("grammar"), w.str("ref"))
        }.orEmpty(),
        grammarPoints = json.array("grammar_points")?.mapNotNull { it as? JsonObject }?.mapNotNull { g ->
            val pattern = g.str("pattern") ?: return@mapNotNull null
            GrammarPoint(pattern, g.str("explanation"), g.str("example"))
        }.orEmpty(),
        tip = json.str("tip"),
    )
}
