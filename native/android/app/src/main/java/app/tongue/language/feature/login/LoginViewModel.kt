package app.tongue.language.feature.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.data.repo.AuthRepository
import app.tongue.language.network.ApiResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val code: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    /** True when the backend indicated this code belongs to an unpaid account. */
    val showSubscribeHint: Boolean = false,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onCodeChange(value: String) {
        // Access codes are short; keep it tidy and clear stale errors as they type.
        _state.update { it.copy(code = value.trimStart(), error = null, showSubscribeHint = false) }
    }

    fun submit() {
        val code = _state.value.code.trim()
        if (code.isBlank()) {
            _state.update { it.copy(error = "Enter your access code.") }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            when (val result = authRepository.loginWithCode(code, persistOnSuccess = true)) {
                is ApiResult.Success -> {
                    // AuthRepository flips global authState → Authenticated; the
                    // nav host swaps graphs. Nothing else to do here.
                    _state.update { it.copy(loading = false) }
                }
                is ApiResult.Failure -> {
                    _state.update {
                        it.copy(
                            loading = false,
                            error = result.message,
                            // hasPaid == false → they need to subscribe on the web.
                            showSubscribeHint = result.isPaywall,
                        )
                    }
                }
            }
        }
    }
}
