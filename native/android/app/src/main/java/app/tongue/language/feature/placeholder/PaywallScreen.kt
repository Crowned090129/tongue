package app.tongue.language.feature.placeholder

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.tongue.language.BuildConfig
import app.tongue.language.common.openCustomTab
import app.tongue.language.designsystem.GradientButton
import app.tongue.language.designsystem.tongue

/**
 * Subscribe screen — payments run through Tongue's own Stripe checkout on the
 * web, so you keep ~100% (no Play Store 15–30% cut).
 *
 * Compliance note: we deliberately do NOT integrate Google Play Billing. Instead
 * the button opens the web /subscribe page (Stripe) in a Chrome Custom Tab. The
 * user pays on the web, receives an access code by email, and signs in here.
 * Distributing off-Play (direct APK) or via Play's external-billing options are
 * both viable; nothing charges through an in-app billing flow.
 */
@Composable
fun PaywallScreen(onBack: () -> Unit) {
    val colors = MaterialTheme.tongue
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(28.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Text(
            "Unlock everything",
            style = MaterialTheme.typography.headlineMedium,
            color = colors.text,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Unlimited AI coaching and every language, on all your devices.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.muted,
        )

        Spacer(Modifier.height(24.dp))

        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Benefit("Unlimited AI Coach conversations")
            Benefit("Every language and all reference content")
            Benefit("Voice tutor, analyzer, and flashcards")
            Benefit("Streak reminders and progress tracking")
        }

        Spacer(Modifier.height(24.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PlanCard(Modifier.weight(1f), "MONTHLY", "$9", "per month", highlight = false)
            PlanCard(Modifier.weight(1f), "YEARLY", "$79", "per year · save $29", highlight = true)
        }

        Spacer(Modifier.height(24.dp))

        // Opens the Stripe checkout in a Custom Tab. You keep ~100% via Stripe.
        GradientButton(
            text = "Subscribe",
            onClick = { openCustomTab(context, BuildConfig.SUBSCRIBE_URL) },
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(12.dp))
        Text(
            "You'll subscribe securely via Stripe on the Tongue website, then get an " +
                "access code by email — sign in here with that code and everything unlocks. " +
                "Already subscribed? Close this and log in with your code.",
            style = MaterialTheme.typography.bodySmall,
            color = colors.muted,
        )

        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onBack) {
            Text("Not now", color = colors.muted)
        }
    }
}

@Composable
private fun PlanCard(
    modifier: Modifier,
    label: String,
    price: String,
    period: String,
    highlight: Boolean,
) {
    val colors = MaterialTheme.tongue
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (highlight) colors.accent.copy(alpha = 0.10f) else colors.surface2)
            .border(
                width = if (highlight) 1.5.dp else 1.dp,
                color = if (highlight) colors.accent else colors.line,
                shape = RoundedCornerShape(14.dp),
            )
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = if (highlight) colors.accent else colors.muted,
        )
        Text(price, fontSize = 26.sp, fontWeight = FontWeight.Black, color = colors.text)
        Text(period, style = MaterialTheme.typography.labelSmall, color = colors.muted)
    }
}

@Composable
private fun Benefit(text: String) {
    val colors = MaterialTheme.tongue
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            Icons.Filled.Check,
            contentDescription = null,
            tint = colors.green,
            modifier = Modifier.height(20.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = colors.text)
    }
}
