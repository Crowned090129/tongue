package app.tongue.language.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.data.model.Language
import app.tongue.language.data.model.Languages
import app.tongue.language.data.model.Plan
import app.tongue.language.data.repo.AuthRepository
import app.tongue.language.data.repo.ContentRepository
import app.tongue.language.data.repo.PushRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val email: String? = null,
    val plan: Plan = Plan.FREE,
    val language: Language = Languages.DEFAULT,
    val languagePickerOpen: Boolean = false,
    val signingOut: Boolean = false,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val contentRepository: ContentRepository,
    private val pushRepository: PushRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(
        authRepository.profile.let { p ->
            SettingsUiState(
                email = p?.email,
                plan = p?.plan ?: Plan.FREE,
                language = p?.language ?: Languages.DEFAULT,
            )
        }
    )
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    fun openLanguagePicker() = _state.update { it.copy(languagePickerOpen = true) }
    fun dismissLanguagePicker() = _state.update { it.copy(languagePickerOpen = false) }

    fun selectLanguage(language: Language) {
        _state.update { it.copy(language = language, languagePickerOpen = false) }
        viewModelScope.launch { contentRepository.savePreferences(language = language.code) }
    }

    /** Sign out: DELETE the push token, then wipe the secure store. */
    fun signOut() {
        _state.update { it.copy(signingOut = true) }
        viewModelScope.launch {
            val token = pushRepository.cachedToken()
            authRepository.signOut(token)
            pushRepository.clearCached()
            // authState flips to LoggedOut → nav host swaps to the auth graph.
        }
    }
}
