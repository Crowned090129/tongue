package app.tongue.language.feature.wordspace

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

data class LiteralPart(val word: String, val meaning: String?)
data class WordExample(val target: String?, val en: String?, val ref: String?)

data class WordResult(
    val inputLang: String?,
    val translationTarget: String?,
    val translationRef: String?,
    val pronunciation: String?,
    val literalBreakdown: List<LiteralPart>,
    val explanation: String?,
    val refComparison: String?,
    val examples: List<WordExample>,
    val tip: String?,
)

data class WordSpaceUiState(
    val language: Language = Languages.DEFAULT,
    val input: String = "",
    val loading: Boolean = false,
    val result: WordResult? = null,
    val error: String? = null,
    val paywallHit: Boolean = false,
)

/**
 * Word Space — mirrors the web "Translator & Word Space". A single word/phrase in
 * any language → translation, pronunciation, literal breakdown, examples, tip,
 * from `/api/claude` (featureType "wordspace"). Read defensively.
 */
@HiltViewModel
class WordSpaceViewModel @Inject constructor(
    private val coachRepository: CoachRepository,
    authRepository: AuthRepository,
) : ViewModel() {

    private val language: Language = authRepository.profile?.language ?: Languages.DEFAULT

    private val _state = MutableStateFlow(WordSpaceUiState(language = language))
    val state: StateFlow<WordSpaceUiState> = _state.asStateFlow()

    fun onInputChange(value: String) = _state.update { it.copy(input = value, error = null) }

    fun lookup() {
        val text = _state.value.input.trim()
        if (text.isBlank() || _state.value.loading) return
        _state.update { it.copy(loading = true, error = null, result = null, paywallHit = false) }

        viewModelScope.launch {
            val prompt = buildPrompt(text, language)
            when (val res = coachRepository.ask(
                prompt = prompt,
                language = language.code,
                nativeLang = "en",
                featureType = "wordspace",
                maxTokens = 1400,
            )) {
                is ApiResult.Success -> _state.update { it.copy(loading = false, result = parse(res.data)) }
                is ApiResult.Failure -> _state.update {
                    it.copy(loading = false, error = res.message, paywallHit = res.isPaywall || res.code == 429)
                }
            }
        }
    }

    fun reset() = _state.update { it.copy(result = null, input = "", error = null) }
    fun dismissError() = _state.update { it.copy(error = null) }

    private fun buildPrompt(text: String, language: Language): String {
        val tName = language.englishName
        val refNames = "English"
        return "You are a $tName language coach for $refNames speakers. The user typed: \"$text\". " +
            "This could be in any language. Detect the language, translate to $tName if not already in $tName " +
            "(and also to $refNames if it was in $tName), and provide rich learning content. " +
            "Return ONLY valid JSON: {\"input_lang\":\"language detected\",\"input_text\":\"$text\"," +
            "\"translation_fr\":\"translation in $tName\",\"translation_ref\":\"translation in $refNames\"," +
            "\"pronunciation\":\"phonetic guide for the $tName version\"," +
            "\"literal_breakdown\":[{\"word\":\"each $tName word\",\"meaning\":\"what it means\"}]," +
            "\"explanation\":\"grammar and usage explanation — why is it structured this way in $tName?\"," +
            "\"ref_comparison\":\"how does this compare to $refNames? same structure? different?\"," +
            "\"examples\":[{\"fr\":\"example 1 in $tName\",\"en\":\"English\",\"ref\":\"in $refNames\"}," +
            "{\"fr\":\"example 2\",\"en\":\"English\",\"ref\":\"ref\"}," +
            "{\"fr\":\"example 3\",\"en\":\"English\",\"ref\":\"ref\"}]," +
            "\"tip\":\"one key thing to remember about this word or phrase\"}"
    }

    private fun parse(json: JsonObject): WordResult = WordResult(
        inputLang = json.str("input_lang"),
        translationTarget = json.str("translation_fr"),
        translationRef = json.str("translation_ref"),
        pronunciation = json.str("pronunciation"),
        literalBreakdown = json.array("literal_breakdown")?.mapNotNull { it as? JsonObject }?.mapNotNull { p ->
            val w = p.str("word") ?: return@mapNotNull null
            LiteralPart(w, p.str("meaning"))
        }.orEmpty(),
        explanation = json.str("explanation"),
        refComparison = json.str("ref_comparison"),
        examples = json.array("examples")?.mapNotNull { it as? JsonObject }?.map { e ->
            WordExample(e.str("fr"), e.str("en"), e.str("ref"))
        }.orEmpty(),
        tip = json.str("tip"),
    )
}
