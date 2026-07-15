package app.tongue.language.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.data.model.ContentResponse
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

data class HomeUiState(
    val language: Language = Languages.DEFAULT,
    val selectedTab: ContentTab = ContentTab.GRAMMAR,
    val loading: Boolean = false,
    val content: ContentResponse? = null,
    /** Non-null when content is unavailable — includes the friendly French note. */
    val notice: String? = null,
    val languagePickerOpen: Boolean = false,
    val isPaid: Boolean = false,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val contentRepository: ContentRepository,
    authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(
        HomeUiState(
            language = authRepository.profile?.language ?: Languages.DEFAULT,
            isPaid = authRepository.profile?.plan?.isPaid ?: false,
        )
    )
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        loadContent()
    }

    fun selectTab(tab: ContentTab) {
        if (tab == _state.value.selectedTab) return
        _state.update { it.copy(selectedTab = tab) }
        loadContent()
    }

    fun openLanguagePicker() = _state.update { it.copy(languagePickerOpen = true) }
    fun dismissLanguagePicker() = _state.update { it.copy(languagePickerOpen = false) }

    fun selectLanguage(language: Language) {
        _state.update { it.copy(language = language, languagePickerOpen = false) }
        // Persist server-side so the choice follows the account (fire-and-forget).
        viewModelScope.launch { contentRepository.savePreferences(language = language.code) }
        loadContent()
    }

    fun retry() = loadContent()

    private fun loadContent() {
        val current = _state.value
        _state.update { it.copy(loading = true, notice = null, content = null) }
        viewModelScope.launch {
            when (val res = contentRepository.fetch(current.language, current.selectedTab)) {
                is ApiResult.Success -> _state.update {
                    it.copy(loading = false, content = res.data, notice = null)
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(loading = false, content = null, notice = res.message)
                }
            }
        }
    }
}
