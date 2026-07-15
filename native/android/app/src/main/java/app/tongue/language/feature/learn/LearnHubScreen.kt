package app.tongue.language.feature.learn

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material.icons.outlined.TextSnippet
import androidx.compose.foundation.background
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.tongue.language.data.model.ContentTab
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.tongue

/** A tool entry in the Learn hub. */
private data class Tool(
    val label: String,
    val description: String,
    val icon: ImageVector,
    val route: String,
)

/**
 * "Learn" tab — a hub linking to the reference screens (per content tab), the
 * Text Analyzer, Word Space, and Flashcards. Replaces the old "coming soon" stub.
 */
@Composable
fun LearnHubScreen(onOpen: (route: String) -> Unit) {
    val colors = MaterialTheme.tongue

    val practice = listOf(
        Tool("Flashcards", "Spaced-repetition review of your saved words", Icons.Outlined.Style, app.tongue.language.app.nav.Routes.FLASHCARDS),
        Tool("Word Space", "Translate & break down any word or phrase", Icons.Outlined.Search, app.tongue.language.app.nav.Routes.WORD_SPACE),
        Tool("Analyze text", "Decode lyrics, menus, messages word by word", Icons.Outlined.TextSnippet, app.tongue.language.app.nav.Routes.ANALYZER),
    )
    val reference = listOf(
        Tool("Grammar", "Rules with examples", Icons.Outlined.MenuBook, ContentTab.GRAMMAR.slug),
        Tool("Vocabulary", "Words by category", Icons.Outlined.ListAlt, ContentTab.VOCAB.slug),
        Tool("Structures", "Common sentence patterns", Icons.Outlined.Layers, ContentTab.STRUCTURES.slug),
        Tool("Cheat sheet", "Quick-reference phrases", Icons.Outlined.Bolt, ContentTab.CHEATSHEET.slug),
        Tool("Dialogues", "Real conversations to study", Icons.Outlined.Forum, ContentTab.DIALOGUES.slug),
    )

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp)) {
            Text("Learn", style = MaterialTheme.typography.headlineMedium, color = colors.text)
            Text(
                "Reference and practice tools",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
            )
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { SectionHeader("Practice") }
            items(practice) { tool -> ToolRow(tool) { onOpen(tool.route) } }
            item { Spacer(Modifier.height(4.dp)) }
            item { SectionHeader("Reference") }
            items(reference) { tool ->
                ToolRow(tool) { onOpen(app.tongue.language.app.nav.Routes.reference(tool.route)) }
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.tongue.text,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun ToolRow(tool: Tool, onClick: () -> Unit) {
    val colors = MaterialTheme.tongue
    TongueCard(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.foundation.layout.Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(colors.surface2),
                contentAlignment = Alignment.Center,
            ) {
                Icon(tool.icon, contentDescription = null, tint = colors.accent, modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                Text(tool.label, style = MaterialTheme.typography.bodyLarge, color = colors.text, fontWeight = FontWeight.SemiBold)
                Text(tool.description, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = colors.muted)
        }
    }
}
