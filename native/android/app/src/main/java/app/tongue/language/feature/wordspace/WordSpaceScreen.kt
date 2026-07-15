package app.tongue.language.feature.wordspace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.common.PlayButton
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.tongue

/**
 * Word Space. A single word/phrase → translation, literal breakdown, examples,
 * tip. Audio on every target-language string.
 */
@Composable
fun WordSpaceScreen(
    onBack: () -> Unit,
    onUpgrade: () -> Unit,
    viewModel: WordSpaceViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MaterialTheme.tongue
    val langTag = state.language.locale

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = colors.text)
            }
            Column(Modifier.weight(1f).padding(start = 4.dp)) {
                Text("Word Space", style = MaterialTheme.typography.headlineMedium, color = colors.text)
                Text(
                    "Translate & break down any word or phrase",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = state.input,
                onValueChange = viewModel::onInputChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("Type a word or phrase…") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { viewModel.lookup() }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.accent,
                    unfocusedBorderColor = colors.line,
                    cursorColor = colors.accent,
                    focusedTextColor = colors.text,
                    unfocusedTextColor = colors.text,
                ),
            )
            GradientButton(
                text = "Look up",
                onClick = viewModel::lookup,
                loading = state.loading,
                enabled = state.input.isNotBlank() && !state.loading,
                modifier = Modifier.fillMaxWidth(),
            )

            if (state.error != null) {
                Text(state.error!!, style = MaterialTheme.typography.bodyMedium, color = colors.red)
                if (state.paywallHit) {
                    TextButton(onClick = onUpgrade) { Text("See subscription options", color = colors.accent) }
                }
            }

            state.result?.let { WordResultView(it, langTag, onReset = viewModel::reset) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun WordResultView(result: WordResult, langTag: String, onReset: () -> Unit) {
    val colors = MaterialTheme.tongue

    // Primary translation
    TongueCard(modifier = Modifier.fillMaxWidth()) {
        if (!result.inputLang.isNullOrBlank()) {
            Text(
                "Detected: ${result.inputLang}",
                style = MaterialTheme.typography.labelMedium,
                color = colors.muted,
            )
            Spacer(Modifier.height(4.dp))
        }
        if (!result.translationTarget.isNullOrBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    result.translationTarget,
                    style = MaterialTheme.typography.headlineSmall,
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                PlayButton(text = result.translationTarget, langTag = langTag)
            }
        }
        if (!result.pronunciation.isNullOrBlank()) {
            Text("/${result.pronunciation}/", style = MaterialTheme.typography.bodyMedium, color = colors.muted)
        }
        if (!result.translationRef.isNullOrBlank()) {
            Text(result.translationRef, style = MaterialTheme.typography.bodyLarge, color = colors.muted)
        }
    }

    if (result.literalBreakdown.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        SectionLabel("Literal breakdown")
        Spacer(Modifier.height(8.dp))
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            result.literalBreakdown.forEachIndexed { i, part ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        part.word,
                        style = MaterialTheme.typography.bodyLarge,
                        color = colors.text,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (!part.meaning.isNullOrBlank()) {
                        Text(
                            "  —  ${part.meaning}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.muted,
                            modifier = Modifier.weight(1f),
                        )
                    } else {
                        Spacer(Modifier.weight(1f))
                    }
                    PlayButton(text = part.word, langTag = langTag)
                }
            }
        }
    }

    if (!result.explanation.isNullOrBlank() || !result.refComparison.isNullOrBlank()) {
        Spacer(Modifier.height(12.dp))
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            if (!result.explanation.isNullOrBlank()) {
                Text("How it works", style = MaterialTheme.typography.labelMedium, color = colors.muted, fontWeight = FontWeight.SemiBold)
                Text(result.explanation, style = MaterialTheme.typography.bodyMedium, color = colors.text)
            }
            if (!result.refComparison.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text("Compared to English", style = MaterialTheme.typography.labelMedium, color = colors.muted, fontWeight = FontWeight.SemiBold)
                Text(result.refComparison, style = MaterialTheme.typography.bodyMedium, color = colors.text)
            }
        }
    }

    if (result.examples.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        SectionLabel("Examples")
        result.examples.forEach { ex ->
            if (ex.target.isNullOrBlank() && ex.ref.isNullOrBlank() && ex.en.isNullOrBlank()) return@forEach
            Spacer(Modifier.height(8.dp))
            TongueCard(modifier = Modifier.fillMaxWidth()) {
                if (!ex.target.isNullOrBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(ex.target, style = MaterialTheme.typography.bodyLarge, color = colors.text, modifier = Modifier.weight(1f))
                        PlayButton(text = ex.target, langTag = langTag)
                    }
                }
                val gloss = ex.ref?.takeIf { it.isNotBlank() } ?: ex.en
                if (!gloss.isNullOrBlank()) {
                    Text(gloss, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                }
            }
        }
    }

    if (!result.tip.isNullOrBlank()) {
        Spacer(Modifier.height(12.dp))
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            Text("Tip", style = MaterialTheme.typography.labelMedium, color = colors.accent, fontWeight = FontWeight.SemiBold)
            Text(result.tip, style = MaterialTheme.typography.bodyMedium, color = colors.text)
        }
    }

    Spacer(Modifier.height(12.dp))
    TextButton(onClick = onReset) { Text("Look up another", color = colors.accent) }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.tongue.text,
        fontWeight = FontWeight.SemiBold,
    )
}
