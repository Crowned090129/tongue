package app.tongue.language.feature.coach

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.designsystem.tongue

/**
 * AI Coach — the flagship live-API screen. Sends prompts to `/api/claude` and
 * renders replies as a chat. Handles the free-tier remaining counter and the
 * 429 upgrade paywall (routing to the reader-app subscribe flow via [onUpgrade]).
 */
@Composable
fun CoachScreen(
    onUpgrade: () -> Unit,
    viewModel: CoachViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MaterialTheme.tongue
    val listState = rememberLazyListState()

    // Auto-scroll to the newest message.
    LaunchedEffect(state.messages.size, state.sending) {
        val target = state.messages.size + if (state.sending) 1 else 0
        if (target > 0) listState.animateScrollToItem((target - 1).coerceAtLeast(0))
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("AI Coach", style = MaterialTheme.typography.headlineMedium, color = colors.text)
                Text(
                    "Practicing ${state.language.englishName}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
            if (state.remaining != null) {
                Surface(shape = RoundedCornerShape(999.dp), color = colors.surface2) {
                    Text(
                        "${state.remaining} left",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.muted,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
        }

        // Messages
        Box(modifier = Modifier.weight(1f)) {
            if (state.messages.isEmpty() && !state.sending) {
                EmptyCoach(modifier = Modifier.align(Alignment.Center))
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.messages, key = { it.id }) { msg ->
                    MessageBubble(text = msg.text, fromUser = msg.fromUser)
                }
                if (state.sending) {
                    item { TypingBubble() }
                }
            }
        }

        // Error / paywall
        if (state.error != null) {
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text(state.error!!, style = MaterialTheme.typography.bodyMedium, color = colors.red)
                if (state.paywallHit) {
                    TextButton(onClick = onUpgrade) {
                        Text("See subscription options", color = colors.accent)
                    }
                }
            }
        }

        // Composer
        Composer(
            input = state.input,
            enabled = !state.sending,
            onChange = viewModel::onInputChange,
            onSend = viewModel::send,
        )
    }
}

@Composable
private fun MessageBubble(text: String, fromUser: Boolean) {
    val colors = MaterialTheme.tongue
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (fromUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (fromUser) 16.dp else 4.dp,
                        bottomEnd = if (fromUser) 4.dp else 16.dp,
                    )
                )
                .then(
                    if (fromUser) Modifier.background(colors.accentGradient)
                    else Modifier.background(colors.surface)
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyLarge,
                color = if (fromUser) colors.onAccent else colors.text,
            )
        }
    }
}

@Composable
private fun TypingBubble() {
    val colors = MaterialTheme.tongue
    Row(horizontalArrangement = Arrangement.Start) {
        Surface(shape = RoundedCornerShape(16.dp), color = colors.surface) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.height(16.dp).widthIn(min = 16.dp),
                    strokeWidth = 2.dp,
                    color = colors.accent,
                )
                Spacer(Modifier.height(0.dp))
                Text(
                    "  Thinking…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.muted,
                )
            }
        }
    }
}

@Composable
private fun EmptyCoach(modifier: Modifier = Modifier) {
    val colors = MaterialTheme.tongue
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Say something to start",
            style = MaterialTheme.typography.titleLarge,
            color = colors.text,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Ask for a quick exercise, a correction, or just chat in your target language. " +
                "The coach adapts to your level.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun Composer(
    input: String,
    enabled: Boolean,
    onChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    val colors = MaterialTheme.tongue
    Surface(color = colors.surface, shadowElevation = 0.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = onChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Message the coach") },
                maxLines = 4,
                shape = RoundedCornerShape(20.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.accent,
                    unfocusedBorderColor = colors.line,
                    cursorColor = colors.accent,
                    focusedTextColor = colors.text,
                    unfocusedTextColor = colors.text,
                ),
            )
            val canSend = enabled && input.isNotBlank()
            IconButton(
                onClick = onSend,
                enabled = canSend,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .then(
                        if (canSend) Modifier.background(colors.accentGradient)
                        else Modifier.background(colors.surface2)
                    ),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = if (canSend) colors.onAccent else colors.muted,
                )
            }
        }
    }
}
