package app.tongue.language.feature.flashcards

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.common.LocalTts
import app.tongue.language.common.PlayButton
import app.tongue.language.common.rememberTtsController
import app.tongue.language.data.flashcards.Flashcard
import app.tongue.language.data.flashcards.Grade
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.Pill
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.TongueShapeTokens
import app.tongue.language.designsystem.tongue
import androidx.compose.runtime.CompositionLocalProvider

/**
 * Flashcards. Persistent SM-2 deck (Room), scoped to the user's current language.
 * Shows the due count + a review session, an add-card form, and a manage list.
 * The front (target language) always carries a [PlayButton].
 */
@Composable
fun FlashcardsScreen(
    onBack: () -> Unit,
    viewModel: FlashcardsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val deck by viewModel.deck.collectAsStateWithLifecycle()
    val dueCount by viewModel.dueCount.collectAsStateWithLifecycle()
    val colors = MaterialTheme.tongue
    val tts = rememberTtsController()
    val langTag = state.language.locale

    CompositionLocalProvider(LocalTts provides tts) {
        Box(Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = colors.text)
                    }
                    Column(Modifier.weight(1f).padding(start = 4.dp)) {
                        Text("Flashcards", style = MaterialTheme.typography.headlineMedium, color = colors.text)
                        Text(
                            "${state.language.flag}  ${state.language.englishName} · ${deck.size} cards",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.muted,
                        )
                    }
                }

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        DueCard(
                            dueCount = dueCount,
                            onStart = viewModel::startReview,
                        )
                    }
                    item {
                        AddCardForm(
                            front = state.addFront,
                            back = state.addBack,
                            pronunciation = state.addPronunciation,
                            example = state.addExample,
                            error = state.addError,
                            success = state.addSuccess,
                            onFront = viewModel::onFrontChange,
                            onBack = viewModel::onBackChange,
                            onPronunciation = viewModel::onPronunciationChange,
                            onExample = viewModel::onExampleChange,
                            onAdd = viewModel::addCard,
                        )
                    }
                    if (deck.isNotEmpty()) {
                        item {
                            Text(
                                "Your deck",
                                style = MaterialTheme.typography.titleSmall,
                                color = colors.text,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        items(deck, key = { it.id }) { card ->
                            DeckRow(card = card, langTag = langTag, onDelete = { viewModel.deleteCard(card) })
                        }
                    }
                }
            }

            // Review overlay
            state.session?.let { session ->
                ReviewOverlay(
                    session = session,
                    langTag = langTag,
                    onFlip = viewModel::flip,
                    onGrade = viewModel::grade,
                    onClose = viewModel::endReview,
                )
            }
        }
    }
}

@Composable
private fun DueCard(dueCount: Int, onStart: () -> Unit) {
    val colors = MaterialTheme.tongue
    TongueCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (dueCount > 0) "$dueCount due for review" else "All caught up",
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    if (dueCount > 0) "Review now to keep them in memory."
                    else "New cards you add appear here right away.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
        }
        if (dueCount > 0) {
            Spacer(Modifier.height(12.dp))
            GradientButton(text = "Start review", onClick = onStart, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun AddCardForm(
    front: String,
    back: String,
    pronunciation: String,
    example: String,
    error: String?,
    success: Boolean,
    onFront: (String) -> Unit,
    onBack: (String) -> Unit,
    onPronunciation: (String) -> Unit,
    onExample: (String) -> Unit,
    onAdd: () -> Unit,
) {
    val colors = MaterialTheme.tongue
    TongueCard(modifier = Modifier.fillMaxWidth()) {
        Text("Add a card", style = MaterialTheme.typography.titleMedium, color = colors.text, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Field(front, onFront, "Word or phrase (target language)")
        Spacer(Modifier.height(8.dp))
        Field(back, onBack, "Meaning")
        Spacer(Modifier.height(8.dp))
        Field(pronunciation, onPronunciation, "Pronunciation (optional)")
        Spacer(Modifier.height(8.dp))
        Field(example, onExample, "Example (optional)")
        if (error != null) {
            Spacer(Modifier.height(6.dp))
            Text(error, style = MaterialTheme.typography.bodyMedium, color = colors.red)
        }
        if (success) {
            Spacer(Modifier.height(6.dp))
            Text("Card added.", style = MaterialTheme.typography.bodyMedium, color = colors.green)
        }
        Spacer(Modifier.height(12.dp))
        GradientButton(
            text = "Add card",
            onClick = onAdd,
            enabled = front.isNotBlank() && back.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String) {
    val colors = MaterialTheme.tongue
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = { Text(placeholder) },
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = colors.accent,
            unfocusedBorderColor = colors.line,
            cursorColor = colors.accent,
            focusedTextColor = colors.text,
            unfocusedTextColor = colors.text,
        ),
    )
}

@Composable
private fun DeckRow(card: Flashcard, langTag: String, onDelete: () -> Unit) {
    val colors = MaterialTheme.tongue
    TongueCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(card.front, style = MaterialTheme.typography.bodyLarge, color = colors.text, fontWeight = FontWeight.SemiBold)
                Text(card.back, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
            }
            PlayButton(text = card.front, langTag = langTag)
            IconButton(onClick = onDelete) {
                Icon(Icons.Outlined.Delete, contentDescription = "Delete card", tint = colors.muted)
            }
        }
    }
}

@Composable
private fun ReviewOverlay(
    session: ReviewSession,
    langTag: String,
    onFlip: () -> Unit,
    onGrade: (Grade) -> Unit,
    onClose: () -> Unit,
) {
    val colors = MaterialTheme.tongue
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = colors.bg,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (session.done) "Session complete" else "Card ${session.index + 1} of ${session.total}",
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onClose) { Text(if (session.done) "Done" else "Close", color = colors.accent) }
            }

            Spacer(Modifier.height(16.dp))

            val card = session.current
            if (session.done || card == null) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        "Reviewed ${session.reviewedCount} card${if (session.reviewedCount == 1) "" else "s"}.",
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.text,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(20.dp))
                    GradientButton(text = "Back to deck", onClick = onClose)
                }
                return@Column
            }

            // Card face
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .clip(TongueShapeTokens.Card)
                    .background(colors.surface)
                    .clickableNoRipple(onFlip)
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Pill(
                        text = if (session.flipped) "Meaning" else "Word",
                        background = colors.surface2,
                        contentColor = colors.muted,
                    )
                    Spacer(Modifier.height(16.dp))
                    if (!session.flipped) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                card.front,
                                style = MaterialTheme.typography.headlineMedium,
                                color = colors.text,
                                textAlign = TextAlign.Center,
                            )
                            PlayButton(text = card.front, langTag = langTag)
                        }
                        if (card.pronunciation.isNotBlank()) {
                            Text("/${card.pronunciation}/", style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                        }
                    } else {
                        Text(
                            card.back,
                            style = MaterialTheme.typography.headlineSmall,
                            color = colors.text,
                            textAlign = TextAlign.Center,
                        )
                        if (card.example.isNotBlank()) {
                            Spacer(Modifier.height(12.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    card.example,
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = colors.muted,
                                    textAlign = TextAlign.Center,
                                )
                                PlayButton(text = card.example, langTag = langTag)
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Text(
                        if (session.flipped) "Tap to flip back" else "Tap to reveal",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.muted,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            if (session.flipped) {
                GradeRow(onGrade = onGrade)
            } else {
                GradientButton(text = "Show answer", onClick = onFlip, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun GradeRow(onGrade: (Grade) -> Unit) {
    val colors = MaterialTheme.tongue
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            GradeButton("Again", "Forgot", colors.red, Modifier.weight(1f)) { onGrade(Grade.AGAIN) }
            GradeButton("Hard", "Struggled", colors.muted, Modifier.weight(1f)) { onGrade(Grade.HARD) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            GradeButton("Good", "Knew it", colors.accent, Modifier.weight(1f)) { onGrade(Grade.GOOD) }
            GradeButton("Easy", "Too easy", colors.green, Modifier.weight(1f)) { onGrade(Grade.EASY) }
        }
    }
}

@Composable
private fun GradeButton(
    label: String,
    hint: String,
    tint: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.tongue
    Surface(
        modifier = modifier
            .heightIn(min = 60.dp)
            .clip(TongueShapeTokens.Button)
            .clickableNoRipple(onClick),
        color = colors.surface,
        border = BorderStroke(1.5.dp, tint),
        shape = TongueShapeTokens.Button,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = tint, fontWeight = FontWeight.SemiBold)
            Text(hint, style = MaterialTheme.typography.labelMedium, color = colors.muted)
        }
    }
}

/** Ripple-free clickable to match the borderless brand look. */
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier =
    this.composed {
        clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = onClick,
        )
    }
