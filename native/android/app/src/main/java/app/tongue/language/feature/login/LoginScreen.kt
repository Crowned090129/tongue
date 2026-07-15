package app.tongue.language.feature.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.BuildConfig
import app.tongue.language.common.openCustomTab
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.tongue

/**
 * Access-code login. On success the shared [app.tongue.language.data.repo.AuthRepository]
 * flips global auth state and the nav host swaps to the main graph — this screen
 * doesn't navigate itself.
 *
 * Reader-app model: users subscribe on the web, then sign in here with the code
 * they receive by email. The "Subscribe on the web" affordance opens a Custom Tab.
 */
@Composable
fun LoginScreen(viewModel: LoginViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MaterialTheme.tongue
    val context = LocalContext.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Brand mark
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(colors.accentGradient),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "T",
                    style = MaterialTheme.typography.displayMedium,
                    color = colors.onAccent,
                )
            }

            Spacer(Modifier.height(24.dp))
            Text(
                "Welcome to Tongue",
                style = MaterialTheme.typography.headlineMedium,
                color = colors.text,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Enter the access code from your welcome email to sign in.",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.muted,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(28.dp))

            OutlinedTextField(
                value = state.code,
                onValueChange = viewModel::onCodeChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                isError = state.error != null,
                label = { Text("Access code") },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { viewModel.submit() }),
                shape = RoundedCornerShape(11.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = colors.accent,
                    unfocusedBorderColor = colors.line,
                    focusedLabelColor = colors.accent,
                    cursorColor = colors.accent,
                    focusedTextColor = colors.text,
                    unfocusedTextColor = colors.text,
                ),
            )

            if (state.error != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    state.error!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.red,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(20.dp))

            GradientButton(
                text = "Sign in",
                onClick = viewModel::submit,
                modifier = Modifier.fillMaxWidth(),
                loading = state.loading,
                enabled = !state.loading,
            )

            Spacer(Modifier.height(16.dp))

            TextButton(onClick = { openCustomTab(context, BuildConfig.SUBSCRIBE_URL) }) {
                Text(
                    if (state.showSubscribeHint)
                        "This account isn't subscribed yet — subscribe on the web"
                    else "Don't have a code? Subscribe on the web",
                    color = colors.accent,
                    style = MaterialTheme.typography.labelLarge,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
