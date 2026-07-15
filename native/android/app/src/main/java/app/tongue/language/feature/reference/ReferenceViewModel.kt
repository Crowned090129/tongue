package app.tongue.language.feature.reference

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.data.model.ContentTab
import app.tongue.language.data.model.Language
import app.tongue.language.data.model.Languages
import app.tongue.language.data.repo.AuthRepository
import app.tongue.language.data.repo.ContentRepository
import app.tongue.language.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ReferenceUiState(
    val language: Language = Languages.DEFAULT,
    val tab: ContentTab = ContentTab.GRAMMAR,
    val loading: Boolean = false,
    val content: ReferenceContent? = null,
    /** Friendly notice for the French-not-available / error state. */
    val notice: String? = null,
    val reportState: ReportState = ReportState.Idle,
)

sealed interface ReportState {
    data object Idle : ReportState
    data object Sending : ReportState
    data object Sent : ReportState
    data class Failed(val message: String) : ReportState
}

/**
 * Backs a single reference tab screen (Grammar / Vocab / Structures / Cheatsheet /
 * Dialogues). Fetches `/api/content/{lang}/{tab}` for the signed-in user's current
 * language, degrading gracefully to a notice when the content API isn't available
 * (e.g. French). Parses the dynamic JSON into typed [ReferenceContent].
 */
@HiltViewModel
class ReferenceViewModel @Inject constructor(
    private val contentRepository: ContentRepository,
    authRepository: AuthRepository,
) : ViewModel() {

    private val language: Language = authRepository.profile?.language ?: Languages.DEFAULT

    private val _state = MutableStateFlow(ReferenceUiState(language = language))
    val state: StateFlow<ReferenceUiState> = _state.asStateFlow()

    private var loadedTab: ContentTab? = null

    /** Idempotent per tab — safe to call from a LaunchedEffect on every recompose. */
    fun load(tab: ContentTab) {
        if (loadedTab == tab && _state.value.content != null) return
        loadedTab = tab
        _state.update {
            it.copy(tab = tab, loading = true, notice = null, content = null, reportState = ReportState.Idle)
        }
        viewModelScope.launch {
            when (val res = contentRepository.fetch(language, tab)) {
                is ApiResult.Success -> {
                    val parsed = parse(tab, res.data.content)
                    _state.update { it.copy(loading = false, content = parsed, notice = null) }
                }
                is ApiResult.Failure -> {
                    _state.update { it.copy(loading = false, content = null, notice = res.message) }
                }
            }
        }
    }

    fun retry() {
        loadedTab = null
        load(_state.value.tab)
    }

    fun reportError() {
        if (_state.value.reportState == ReportState.Sending) return
        _state.update { it.copy(reportState = ReportState.Sending) }
        viewModelScope.launch {
            val res = contentRepository.report(language, _state.value.tab)
            _state.update {
                it.copy(
                    reportState = when (res) {
                        is ApiResult.Success -> ReportState.Sent
                        is ApiResult.Failure -> ReportState.Failed(res.message)
                    }
                )
            }
        }
    }

    private fun parse(tab: ContentTab, content: kotlinx.serialization.json.JsonObject?): ReferenceContent =
        when (tab) {
            ContentTab.GRAMMAR -> parseGrammar(content)
            ContentTab.CHEATSHEET -> parseCheatsheet(content)
            ContentTab.STRUCTURES -> parseStructures(content)
            ContentTab.VOCAB -> parseVocab(content)
            ContentTab.DIALOGUES -> parseDialogues(content)
        }
}
