package app.tongue.language.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.data.model.AuthState
import app.tongue.language.data.repo.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * App-scoped view model that runs the launch bootstrap and exposes the observed
 * [AuthState] the [MainActivity] / nav host react to.
 */
@HiltViewModel
class RootViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    val authState: StateFlow<AuthState> = authRepository.authState

    init {
        viewModelScope.launch { authRepository.bootstrap() }
    }
}
