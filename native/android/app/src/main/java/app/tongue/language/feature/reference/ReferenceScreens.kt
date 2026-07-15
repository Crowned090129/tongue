package app.tongue.language.feature.reference

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.common.LocalTts
import app.tongue.language.common.rememberTtsController
import app.tongue.language.data.model.ContentTab
import androidx.compose.runtime.CompositionLocalProvider
import app.tongue.language.designsystem.tongue

/**
 * Reference tab screens. Each hosts its own [ReferenceViewModel], provides a
 * single shared [TtsController] to its subtree, and renders expandable cards with
 * a [PlayButton] on every target-language string.
 *
 * There is one entry point per tab so they can be wired as distinct nav routes,
 * but they share [ReferenceScaffold] + the content-specific list bodies.
 */
@Composable
fun ReferenceScreen(
    tab: ContentTab,
    onBack: () -> Unit,
    viewModel: ReferenceViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val tts = rememberTtsController()
    LaunchedEffect(tab) { viewModel.load(tab) }

    CompositionLocalProvider(LocalTts provides tts) {
        ReferenceScaffold(
            title = tab.label,
            language = state.language,
            loading = state.loading,
            notice = state.notice,
            onBack = onBack,
            onRetry = viewModel::retry,
            reportState = state.reportState,
            onReport = viewModel::reportError,
        ) { padding ->
            val langTag = state.language.locale
            when (val content = state.content) {
                is ReferenceContent.Grammar -> GrammarBody(content, langTag)
                is ReferenceContent.Cheatsheet -> CheatsheetBody(content, langTag)
                is ReferenceContent.Structures -> StructuresBody(content, langTag)
                is ReferenceContent.Vocab -> VocabBody(content, langTag)
                is ReferenceContent.Dialogues -> DialoguesBody(content, langTag)
                ReferenceContent.Empty, null -> ReferenceEmpty()
            }
        }
    }
}

// ── Bodies ──────────────────────────────────────────────────────────────────────

@Composable
private fun GrammarBody(content: ReferenceContent.Grammar, langTag: String) {
    if (content.sections.isEmpty()) { ReferenceEmpty(); return }
    RefList(content.sections) { section ->
        ExpandableCard(title = section.title, level = section.level) {
            if (!section.rule.isNullOrBlank()) {
                RuleText(section.rule)
                Spacer(Modifier.height(8.dp))
            }
            TargetLine(target = section.exampleTarget, langTag = langTag, ref = section.exampleRef, label = "Example")
            TargetLine(target = section.exampleTarget2, langTag = langTag, label = "Also")
            if (!section.note.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                NoteText(section.note)
            }
        }
    }
}

@Composable
private fun CheatsheetBody(content: ReferenceContent.Cheatsheet, langTag: String) {
    if (content.categories.isEmpty()) { ReferenceEmpty(); return }
    RefList(content.categories) { category ->
        ExpandableCard(title = category.name, subtitle = "${category.items.size} items", startExpanded = true) {
            category.items.forEach { item ->
                TargetLine(target = item.target, langTag = langTag, ref = item.ref, note = item.note)
            }
        }
    }
}

@Composable
private fun StructuresBody(content: ReferenceContent.Structures, langTag: String) {
    if (content.structures.isEmpty()) { ReferenceEmpty(); return }
    RefList(content.structures) { s ->
        ExpandableCard(title = s.title, subtitle = s.pattern) {
            if (!s.explanation.isNullOrBlank()) {
                RuleText(s.explanation)
                Spacer(Modifier.height(8.dp))
            }
            TargetLine(target = s.ex1Target, langTag = langTag, ref = s.ex1Ref, label = "Example 1")
            TargetLine(target = s.ex2Target, langTag = langTag, ref = s.ex2Ref, label = "Example 2")
        }
    }
}

@Composable
private fun VocabBody(content: ReferenceContent.Vocab, langTag: String) {
    if (content.categories.isEmpty()) { ReferenceEmpty(); return }
    RefList(content.categories) { category ->
        ExpandableCard(title = category.name, subtitle = "${category.words.size} words", startExpanded = true) {
            category.words.forEach { word ->
                TargetLine(
                    target = word.target,
                    langTag = langTag,
                    ref = word.ref,
                    note = word.pronunciation?.let { "/$it/" },
                )
            }
        }
    }
}

@Composable
private fun DialoguesBody(content: ReferenceContent.Dialogues, langTag: String) {
    if (content.dialogues.isEmpty()) { ReferenceEmpty(); return }
    RefList(content.dialogues) { d ->
        val subtitle = listOfNotNull(d.scene, d.level).joinToString(" · ").ifBlank { null }
        ExpandableCard(title = d.title, subtitle = subtitle, level = d.level) {
            d.lines.forEach { line ->
                TargetLine(
                    target = line.target,
                    langTag = langTag,
                    ref = line.ref,
                    label = line.speaker,
                )
            }
            if (!d.vocab.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                LabeledBlock("Vocabulary", d.vocab)
            }
            if (!d.note.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                NoteText(d.note)
            }
        }
    }
}

// ── Shared bits ───────────────────────────────────────────────────────────────

@Composable
private fun <T> RefList(items: List<T>, itemContent: @Composable (T) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(items) { itemContent(it) }
    }
}

@Composable
private fun RuleText(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.tongue.text)
}

@Composable
private fun NoteText(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.tongue.accent,
    )
}

@Composable
private fun LabeledBlock(label: String, text: String) {
    val colors = MaterialTheme.tongue
    Text(label, style = MaterialTheme.typography.labelMedium, color = colors.muted, fontWeight = FontWeight.SemiBold)
    Text(text, style = MaterialTheme.typography.bodyMedium, color = colors.text)
}
