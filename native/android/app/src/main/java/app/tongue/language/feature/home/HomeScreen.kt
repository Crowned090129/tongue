package app.tongue.language.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.common.asDisplayString
import app.tongue.language.data.model.ContentTab
import app.tongue.language.data.model.Language
import app.tongue.language.data.model.Languages
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.LoadingState
import app.tongue.language.designsystem.Pill
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.tongue
import kotlinx.serialization.json.JsonObject

/**
 * Explore / Home. Proves the content stack end-to-end: language picker, tab
 * switch, live fetch from `/api/content/{lang}/{tab}` with defensive JSON
 * rendering, and a graceful "coming soon" notice for French (content is web-only).
 */
@Composable
fun HomeScreen(
    onOpenCoach: () -> Unit,
    onLocked: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MaterialTheme.tongue

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Explore", style = MaterialTheme.typography.headlineMedium, color = colors.text)
                Text(
                    "Reference for ${state.language.englishName}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
            LanguageChip(language = state.language, onClick = viewModel::openLanguagePicker)
        }

        // Tab row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ContentTab.entries.forEach { tab ->
                TabPill(
                    label = tab.label,
                    selected = tab == state.selectedTab,
                    onClick = { viewModel.selectTab(tab) },
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                state.loading -> LoadingState(
                    modifier = Modifier.align(Alignment.Center),
                    label = "Loading ${state.selectedTab.label.lowercase()}…",
                )

                state.notice != null -> NoticeState(
                    message = state.notice!!,
                    onOpenCoach = onOpenCoach,
                    modifier = Modifier.align(Alignment.Center),
                )

                state.content != null -> ContentList(
                    content = state.content!!.content,
                    isPaid = state.isPaid,
                    onLocked = onLocked,
                )

                else -> Unit
            }
        }
    }

    if (state.languagePickerOpen) {
        LanguagePickerSheet(
            selected = state.language,
            onSelect = viewModel::selectLanguage,
            onDismiss = viewModel::dismissLanguagePicker,
        )
    }
}

@Composable
private fun LanguageChip(language: Language, onClick: () -> Unit) {
    val colors = MaterialTheme.tongue
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = colors.surface2,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Country flag is the only allowed emoji in the UI.
            Text(language.flag, style = MaterialTheme.typography.titleMedium)
            Text(
                language.englishName,
                style = MaterialTheme.typography.labelLarge,
                color = colors.text,
            )
        }
    }
}

@Composable
private fun TabPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = MaterialTheme.tongue
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (selected) colors.accent else colors.surface2,
        modifier = Modifier.clip(RoundedCornerShape(999.dp)).clickable(onClick = onClick),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) colors.onAccent else colors.muted,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
        )
    }
}

@Composable
private fun ContentList(content: JsonObject?, isPaid: Boolean, onLocked: () -> Unit) {
    val colors = MaterialTheme.tongue
    // Render each top-level key of the content object as a titled card. This is
    // deliberately generic since the content schema varies across tabs.
    val entries = content?.entries?.toList().orEmpty()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (entries.isEmpty()) {
            item {
                Text(
                    "No content to show yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
        }
        items(entries) { (key, value) ->
            TongueCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    key.replaceFirstChar { it.uppercase() }.replace('_', ' '),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    value.asDisplayString().take(600),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
        }
        if (!isPaid) {
            item {
                TongueCard(modifier = Modifier.fillMaxWidth(), onClick = onLocked) {
                    Text(
                        "Unlock everything",
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.text,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Subscribe to access all reference content and unlimited AI Coach.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted,
                    )
                }
            }
        }
    }
}

@Composable
private fun NoticeState(message: String, onOpenCoach: () -> Unit, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.tongue
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        GradientButton(text = "Practice with the AI Coach", onClick = onOpenCoach)
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun LanguagePickerSheet(
    selected: Language,
    onSelect: (Language) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = MaterialTheme.tongue
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
    ) {
        Text(
            "Choose a language",
            style = MaterialTheme.typography.titleLarge,
            color = colors.text,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
        )
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            items(Languages.ALL) { lang ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(lang) }
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(lang.flag, style = MaterialTheme.typography.headlineSmall)
                    Column(Modifier.weight(1f)) {
                        Text(lang.englishName, style = MaterialTheme.typography.bodyLarge, color = colors.text)
                        if (!lang.hasContentApi) {
                            Text(
                                "Reference content coming soon",
                                style = MaterialTheme.typography.labelMedium,
                                color = colors.muted,
                            )
                        }
                    }
                    if (lang.code == selected.code) {
                        Pill(text = "Selected", background = colors.accent, contentColor = colors.onAccent)
                    }
                }
            }
        }
    }
}
