package app.tongue.language.feature.flashcards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.tongue.language.data.flashcards.Flashcard
import app.tongue.language.data.flashcards.FlashcardRepository
import app.tongue.language.data.flashcards.Grade
import app.tongue.language.data.model.Language
import app.tongue.language.data.model.Languages
import app.tongue.language.data.repo.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A running review session over the due queue. */
data class ReviewSession(
    val queue: List<Flashcard> = emptyList(),
    val index: Int = 0,
    val flipped: Boolean = false,
    val reviewedCount: Int = 0,
) {
    val current: Flashcard? get() = queue.getOrNull(index)
    val done: Boolean get() = index >= queue.size
    val total: Int get() = queue.size
}

data class FlashcardsUiState(
    val language: Language = Languages.DEFAULT,
    val addFront: String = "",
    val addBack: String = "",
    val addPronunciation: String = "",
    val addExample: String = "",
    val addError: String? = null,
    val addSuccess: Boolean = false,
    val session: ReviewSession? = null,
)

/**
 * Drives the flashcards feature: the SM-2 review session, the add-card form, and
 * exposes the persisted per-language deck + due count as [StateFlow]s from Room.
 */
@HiltViewModel
class FlashcardsViewModel @Inject constructor(
    private val repository: FlashcardRepository,
    authRepository: AuthRepository,
) : ViewModel() {

    private val language: Language = authRepository.profile?.language ?: Languages.DEFAULT

    private val _state = MutableStateFlow(FlashcardsUiState(language = language))
    val state: StateFlow<FlashcardsUiState> = _state.asStateFlow()

    /** The full deck for the current language (for the manage list). */
    val deck: StateFlow<List<Flashcard>> = repository.observeForLanguage(language.code)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Number of cards due right now. */
    val dueCount: StateFlow<Int> = repository.observeDueCount(language.code)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    // ── Add card ──────────────────────────────────────────────────────────────
    fun onFrontChange(v: String) = _state.update { it.copy(addFront = v, addError = null, addSuccess = false) }
    fun onBackChange(v: String) = _state.update { it.copy(addBack = v, addError = null, addSuccess = false) }
    fun onPronunciationChange(v: String) = _state.update { it.copy(addPronunciation = v) }
    fun onExampleChange(v: String) = _state.update { it.copy(addExample = v) }

    fun addCard() {
        val s = _state.value
        if (s.addFront.isBlank() || s.addBack.isBlank()) {
            _state.update { it.copy(addError = "Fill in both the word and its meaning.") }
            return
        }
        viewModelScope.launch {
            val ok = repository.add(
                lang = language.code,
                front = s.addFront,
                back = s.addBack,
                pronunciation = s.addPronunciation,
                example = s.addExample,
            )
            _state.update {
                if (ok) it.copy(
                    addFront = "", addBack = "", addPronunciation = "", addExample = "",
                    addError = null, addSuccess = true,
                ) else it.copy(addError = "That card already exists.")
            }
        }
    }

    fun deleteCard(card: Flashcard) {
        viewModelScope.launch { repository.delete(card) }
    }

    // ── Review session ──────────────────────────────────────────────────────────
    fun startReview() {
        viewModelScope.launch {
            val due = repository.dueCards(language.code)
            _state.update { it.copy(session = ReviewSession(queue = due)) }
        }
    }

    fun flip() = _state.update { st ->
        st.session?.let { st.copy(session = it.copy(flipped = !it.flipped)) } ?: st
    }

    fun grade(grade: Grade) {
        val session = _state.value.session ?: return
        val card = session.current ?: return
        viewModelScope.launch {
            repository.grade(card, grade)
            _state.update { st ->
                val s = st.session ?: return@update st
                st.copy(session = s.copy(index = s.index + 1, flipped = false, reviewedCount = s.reviewedCount + 1))
            }
        }
    }

    fun endReview() = _state.update { it.copy(session = null) }
}
