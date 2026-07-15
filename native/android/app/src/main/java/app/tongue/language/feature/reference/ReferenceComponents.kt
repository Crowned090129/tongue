package app.tongue.language.feature.reference

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.tongue.language.common.PlayButton
import app.tongue.language.data.model.Language
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.LoadingState
import app.tongue.language.designsystem.Pill
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.tongue

/** Standard header with a back button + title/subtitle used across reference screens. */
@Composable
fun ReferenceHeader(title: String, subtitle: String, onBack: () -> Unit) {
    val colors = MaterialTheme.tongue
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = colors.text)
        }
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, color = colors.text)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
        }
    }
}

/**
 * Generic screen scaffold: header, then either loading / notice / a list body.
 * The [body] is invoked only when content is available.
 */
@Composable
fun ReferenceScaffold(
    title: String,
    language: Language,
    loading: Boolean,
    notice: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    reportState: ReportState,
    onReport: () -> Unit,
    body: @Composable (contentPadding: PaddingValues) -> Unit,
) {
    val colors = MaterialTheme.tongue
    Column(modifier = Modifier.fillMaxSize()) {
        ReferenceHeader(
            title = title,
            subtitle = "${language.flag}  ${language.englishName}",
            onBack = onBack,
        )
        when {
            loading -> Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { LoadingState(label = "Loading ${title.lowercase()}…") }

            notice != null -> NoticeBody(message = notice, onRetry = onRetry)

            else -> Column(Modifier.weight(1f)) {
                Column(Modifier.weight(1f)) { body(PaddingValues(20.dp)) }
                ReportRow(reportState = reportState, onReport = onReport)
            }
        }
    }
}

@Composable
private fun NoticeBody(message: String, onRetry: () -> Unit) {
    val colors = MaterialTheme.tongue
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        GradientButton(text = "Try again", onClick = onRetry)
    }
}

/** "Report an error" row shown under the content list. */
@Composable
private fun ReportRow(reportState: ReportState, onReport: () -> Unit) {
    val colors = MaterialTheme.tongue
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (reportState) {
            is ReportState.Sent -> Text(
                "Thanks — reported.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.green,
                modifier = Modifier.padding(start = 12.dp),
            )
            is ReportState.Sending -> Text(
                "Reporting…",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
                modifier = Modifier.padding(start = 12.dp),
            )
            is ReportState.Failed -> TextButton(onClick = onReport) {
                Icon(Icons.Outlined.Flag, contentDescription = null, tint = colors.red)
                Text("  Couldn't report — retry", color = colors.red)
            }
            ReportState.Idle -> TextButton(onClick = onReport) {
                Icon(Icons.Outlined.Flag, contentDescription = null, tint = colors.muted)
                Text("  Report an error", color = colors.muted)
            }
        }
    }
}

/**
 * A [TongueCard] whose body collapses/expands. [header] is always visible; the
 * [expanded] content shows below when tapped. Optional [level] renders a pill.
 */
@Composable
fun ExpandableCard(
    title: String,
    level: String? = null,
    subtitle: String? = null,
    startExpanded: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colors = MaterialTheme.tongue
    var expanded by remember { mutableStateOf(startExpanded) }
    TongueCard(
        modifier = Modifier.fillMaxWidth(),
        onClick = { expanded = !expanded },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.text,
                    fontWeight = FontWeight.SemiBold,
                )
                if (subtitle != null) {
                    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
                }
            }
            if (level != null) {
                Pill(text = level, background = colors.surface2, contentColor = colors.muted)
            }
            Icon(
                if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = if (expanded) "Collapse" else "Expand",
                tint = colors.muted,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        AnimatedVisibility(visible = expanded) {
            Column(Modifier.padding(top = 12.dp)) { content() }
        }
    }
}

/**
 * A target-language string with an inline [PlayButton]. Optional [ref] (native)
 * line and [note] render below in muted text.
 */
@Composable
fun TargetLine(
    target: String?,
    langTag: String,
    ref: String? = null,
    note: String? = null,
    label: String? = null,
    emphasize: Boolean = false,
) {
    if (target.isNullOrBlank() && ref.isNullOrBlank()) return
    val colors = MaterialTheme.tongue
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        if (!target.isNullOrBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    if (label != null) {
                        Text(label, style = MaterialTheme.typography.labelMedium, color = colors.muted)
                    }
                    Text(
                        target,
                        style = if (emphasize) MaterialTheme.typography.titleMedium
                        else MaterialTheme.typography.bodyLarge,
                        color = colors.text,
                        fontWeight = if (emphasize) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
                PlayButton(text = target, langTag = langTag)
            }
        }
        if (!ref.isNullOrBlank()) {
            Text(ref, style = MaterialTheme.typography.bodyMedium, color = colors.muted)
        }
        if (!note.isNullOrBlank()) {
            Text(
                note,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.accent,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/** Empty-list fallback shown when a parsed payload has no renderable entries. */
@Composable
fun ReferenceEmpty() {
    val colors = MaterialTheme.tongue
    Text(
        "No content to show yet.",
        style = MaterialTheme.typography.bodyMedium,
        color = colors.muted,
        modifier = Modifier.padding(20.dp),
    )
}
