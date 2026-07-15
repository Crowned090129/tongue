package app.tongue.language.designsystem

import androidx.compose.ui.graphics.Color

/**
 * Raw brand color tokens. These are the single source of truth for the palette
 * described by the Tongue brand guide. Semantic mapping into a Material3
 * [androidx.compose.material3.ColorScheme] plus the extra brand-only roles lives
 * in [Theme.kt] / [TongueColors].
 *
 * Rule: a single accent, no emoji in UI (country flags are fine in the language
 * picker only).
 */
object BrandTokens {
    // ── Light ────────────────────────────────────────────────────────────────
    val LightAccent = Color(0xFFC0153E)
    val LightAccentPink = Color(0xFFFF5F7E)
    val LightBg = Color(0xFFF5F2EC)
    val LightSurface = Color(0xFFFFFFFF)
    val LightSurface2 = Color(0xFFEDE9E1)
    val LightStage = Color(0xFFE5E0D6)
    val LightText = Color(0xFF14121A)
    val LightMuted = Color(0xFF14121A).copy(alpha = 0.50f)
    val LightLine = Color(0xFF000000).copy(alpha = 0.10f)
    val LightGreen = Color(0xFF1E9962)
    val LightRed = Color(0xFFE5484D)

    // ── Dark ─────────────────────────────────────────────────────────────────
    val DarkAccent = Color(0xFFFF7090)
    val DarkAccentPink = Color(0xFFFF5F7E) // shared pink for the gradient
    val DarkBg = Color(0xFF0E0C14)
    val DarkSurface = Color(0xFF161420)
    val DarkSurface2 = Color(0xFF1E1B2A)
    val DarkStage = Color(0xFF08070D)
    val DarkText = Color(0xFFEDE9F5)
    val DarkMuted = Color(0xFFEDE9F5).copy(alpha = 0.52f)
    val DarkLine = Color(0xFFFFFFFF).copy(alpha = 0.07f)
    val DarkGreen = Color(0xFF1E9962)
    val DarkRed = Color(0xFFE5484D)

    // Gradient stops: 135° from pink → accent. Same pink both themes.
    val GradientStart = Color(0xFFFF5F7E)
    val GradientEndLight = Color(0xFFC0153E)
    val GradientEndDark = Color(0xFFFF7090)

    // On-accent content (text/icons drawn on the accent fill).
    val OnAccent = Color(0xFFFFFFFF)
}
