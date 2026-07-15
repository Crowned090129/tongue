package app.tongue.language.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.BuildConfig
import app.tongue.language.common.openCustomTab
import app.tongue.language.data.model.Language
import app.tongue.language.data.model.Languages
import app.tongue.language.designsystem.Pill
import app.tongue.language.designsystem.SettingRow
import app.tongue.language.designsystem.TongueCard
import app.tongue.language.designsystem.tongue

/**
 * Settings. Shows account + plan, lets the user switch their learning language
 * (persisted server-side), links to manage the subscription on the web (reader-
 * app model), and signs out (which deletes the push token + clears secrets).
 */
@Composable
fun SettingsScreen(
    onUpgrade: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MaterialTheme.tongue
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium, color = colors.text)
        Spacer(Modifier.height(16.dp))

        // Account card
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        state.email ?: "Signed in",
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.text,
                    )
                    Text(
                        if (state.plan.isPaid) "Premium" else "Free plan",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.muted,
                    )
                }
                Pill(
                    text = if (state.plan.isPaid) "Premium" else "Free",
                    background = if (state.plan.isPaid) colors.accent else colors.surface2,
                    contentColor = if (state.plan.isPaid) colors.onAccent else colors.muted,
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Preferences
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            SettingRow(
                title = "Learning language",
                subtitle = "${state.language.flag}  ${state.language.englishName}",
                onClick = viewModel::openLanguagePicker,
            )
        }

        Spacer(Modifier.height(16.dp))

        // Subscription (reader-app model)
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            if (state.plan.isPaid) {
                SettingRow(
                    title = "Manage subscription",
                    subtitle = "Opens the web billing portal",
                    onClick = { openCustomTab(context, BuildConfig.SUBSCRIBE_URL) },
                    trailing = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null) },
                )
            } else {
                SettingRow(
                    title = "Go Premium",
                    subtitle = "Unlimited AI Coach and all reference content",
                    onClick = onUpgrade,
                    trailing = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null) },
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Sign out
        TongueCard(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !state.signingOut) { viewModel.signOut() }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (state.signingOut) "Signing out…" else "Sign out",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.red,
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        Text(
            "Tongue v${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.labelMedium,
            color = colors.muted,
            modifier = Modifier.fillMaxWidth(),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }

    if (state.languagePickerOpen) {
        LanguageSheet(
            selected = state.language,
            onSelect = viewModel::selectLanguage,
            onDismiss = viewModel::dismissLanguagePicker,
        )
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun LanguageSheet(
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
            "Learning language",
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
                    Text(
                        lang.englishName,
                        style = MaterialTheme.typography.bodyLarge,
                        color = colors.text,
                        modifier = Modifier.weight(1f),
                    )
                    if (lang.code == selected.code) {
                        Pill("Selected", background = colors.accent, contentColor = colors.onAccent)
                    }
                }
            }
        }
    }
}
