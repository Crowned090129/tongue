package app.tongue.language.feature.analyzer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.common.PlayButton
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.Pill
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.tongue

/**
 * Text Analyzer. Paste any target-language text → structured breakdown from
 * `/api/claude`. Every target-language string carries a [PlayButton].
 */
@Composable
fun AnalyzerScreen(
    onBack: () -> Unit,
    onUpgrade: () -> Unit,
    viewModel: AnalyzerViewModel = hiltViewModel(),
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
                Text("Analyze text", style = MaterialTheme.typography.headlineMedium, color = colors.text)
                Text(
                    "Paste ${state.language.englishName} — get a word-by-word breakdown",
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
                modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
                placeholder = { Text("Paste lyrics, a menu, a message…") },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.accent,
                    unfocusedBorderColor = colors.line,
                    cursorColor = colors.accent,
                    focusedTextColor = colors.text,
                    unfocusedTextColor = colors.text,
                ),
            )
            GradientButton(
                text = "Analyze",
                onClick = viewModel::analyze,
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

            state.analysis?.let { AnalysisView(it, langTag, onReset = viewModel::reset) }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun AnalysisView(analysis: Analysis, langTag: String, onReset: () -> Unit) {
    val colors = MaterialTheme.tongue

    // Overview
    TongueCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                analysis.language ?: "Analysis",
                style = MaterialTheme.typography.titleMedium,
                color = colors.text,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (!analysis.difficulty.isNullOrBlank()) {
                Pill(text = analysis.difficulty, background = colors.accent, contentColor = colors.onAccent)
            }
        }
        if (!analysis.summary.isNullOrBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(analysis.summary, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
        }
        if (!analysis.translation.isNullOrBlank()) {
            Spacer(Modifier.height(10.dp))
            Text("Translation", style = MaterialTheme.typography.labelMedium, color = colors.muted)
            Text(analysis.translation, style = MaterialTheme.typography.bodyLarge, color = colors.text)
        }
    }

    if (analysis.words.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        SectionLabel("Key words")
        analysis.words.forEach { word ->
            Spacer(Modifier.height(8.dp))
            TongueCard(modifier = Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        word.word,
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.text,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    PlayButton(text = word.word, langTag = langTag)
                }
                if (!word.meaning.isNullOrBlank()) {
                    Text(word.meaning, style = MaterialTheme.typography.bodyMedium, color = colors.text)
                }
                if (!word.grammar.isNullOrBlank()) {
                    Text(word.grammar, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                }
                if (!word.ref.isNullOrBlank()) {
                    Text(word.ref, style = MaterialTheme.typography.bodyMedium, color = colors.accent)
                }
            }
        }
    }

    if (analysis.grammarPoints.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        SectionLabel("Grammar points")
        analysis.grammarPoints.forEach { gp ->
            Spacer(Modifier.height(8.dp))
            TongueCard(modifier = Modifier.fillMaxWidth()) {
                Text(gp.pattern, style = MaterialTheme.typography.titleMedium, color = colors.text, fontWeight = FontWeight.SemiBold)
                if (!gp.explanation.isNullOrBlank()) {
                    Text(gp.explanation, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                }
                if (!gp.example.isNullOrBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(gp.example, style = MaterialTheme.typography.bodyLarge, color = colors.text, modifier = Modifier.weight(1f))
                        PlayButton(text = gp.example, langTag = langTag)
                    }
                }
            }
        }
    }

    if (!analysis.tip.isNullOrBlank()) {
        Spacer(Modifier.height(12.dp))
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            Text("Tip", style = MaterialTheme.typography.labelMedium, color = colors.accent, fontWeight = FontWeight.SemiBold)
            Text(analysis.tip, style = MaterialTheme.typography.bodyMedium, color = colors.text)
        }
    }

    Spacer(Modifier.height(12.dp))
    TextButton(onClick = onReset) { Text("Analyze another text", color = colors.accent) }
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
