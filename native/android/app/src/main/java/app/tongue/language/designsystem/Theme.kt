package app.tongue.language.designsystem

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Brand-only color roles that don't have a natural Material3 slot (muted text,
 * hairlines, semantic green/red, the "stage" backdrop, and the accent gradient).
 * Access via [LocalTongueColors] or the [MaterialTheme.tongue] convenience.
 */
@Immutable
data class TongueColors(
    val accent: Color,
    val accentPink: Color,
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val stage: Color,
    val text: Color,
    val muted: Color,
    val line: Color,
    val green: Color,
    val red: Color,
    val onAccent: Color,
    val isDark: Boolean,
) {
    /** 135° accent gradient. Approximated as top-left → bottom-right for fills. */
    val accentGradient: Brush
        get() = Brush.linearGradient(
            colors = listOf(
                BrandTokens.GradientStart,
                if (isDark) BrandTokens.GradientEndDark else BrandTokens.GradientEndLight,
            ),
            start = Offset(0f, 0f),
            end = Offset.Infinite,
        )
}

private val LightTongueColors = TongueColors(
    accent = BrandTokens.LightAccent,
    accentPink = BrandTokens.LightAccentPink,
    bg = BrandTokens.LightBg,
    surface = BrandTokens.LightSurface,
    surface2 = BrandTokens.LightSurface2,
    stage = BrandTokens.LightStage,
    text = BrandTokens.LightText,
    muted = BrandTokens.LightMuted,
    line = BrandTokens.LightLine,
    green = BrandTokens.LightGreen,
    red = BrandTokens.LightRed,
    onAccent = BrandTokens.OnAccent,
    isDark = false,
)

private val DarkTongueColors = TongueColors(
    accent = BrandTokens.DarkAccent,
    accentPink = BrandTokens.DarkAccentPink,
    bg = BrandTokens.DarkBg,
    surface = BrandTokens.DarkSurface,
    surface2 = BrandTokens.DarkSurface2,
    stage = BrandTokens.DarkStage,
    text = BrandTokens.DarkText,
    muted = BrandTokens.DarkMuted,
    line = BrandTokens.DarkLine,
    green = BrandTokens.DarkGreen,
    red = BrandTokens.DarkRed,
    onAccent = BrandTokens.OnAccent,
    isDark = true,
)

private val LightColorScheme = lightColorScheme(
    primary = BrandTokens.LightAccent,
    onPrimary = BrandTokens.OnAccent,
    primaryContainer = BrandTokens.LightAccentPink,
    onPrimaryContainer = BrandTokens.LightText,
    secondary = BrandTokens.LightAccentPink,
    onSecondary = BrandTokens.OnAccent,
    background = BrandTokens.LightBg,
    onBackground = BrandTokens.LightText,
    surface = BrandTokens.LightSurface,
    onSurface = BrandTokens.LightText,
    surfaceVariant = BrandTokens.LightSurface2,
    onSurfaceVariant = BrandTokens.LightMuted,
    outline = BrandTokens.LightLine,
    outlineVariant = BrandTokens.LightLine,
    error = BrandTokens.LightRed,
    onError = BrandTokens.OnAccent,
)

private val DarkColorScheme = darkColorScheme(
    primary = BrandTokens.DarkAccent,
    onPrimary = BrandTokens.OnAccent,
    primaryContainer = BrandTokens.DarkSurface2,
    onPrimaryContainer = BrandTokens.DarkText,
    secondary = BrandTokens.DarkAccentPink,
    onSecondary = BrandTokens.OnAccent,
    background = BrandTokens.DarkBg,
    onBackground = BrandTokens.DarkText,
    surface = BrandTokens.DarkSurface,
    onSurface = BrandTokens.DarkText,
    surfaceVariant = BrandTokens.DarkSurface2,
    onSurfaceVariant = BrandTokens.DarkMuted,
    outline = BrandTokens.DarkLine,
    outlineVariant = BrandTokens.DarkLine,
    error = BrandTokens.DarkRed,
    onError = BrandTokens.OnAccent,
)

val LocalTongueColors = staticCompositionLocalOf { LightTongueColors }

/** Convenience accessor: `MaterialTheme.tongue.accent`, etc. */
val MaterialTheme.tongue: TongueColors
    @Composable get() = LocalTongueColors.current

@Composable
fun TongueTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val tongueColors = if (darkTheme) DarkTongueColors else LightTongueColors
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val argb = tongueColors.bg.toArgb()
            @Suppress("DEPRECATION")
            window.statusBarColor = argb
            @Suppress("DEPRECATION")
            window.navigationBarColor = argb
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !darkTheme
            controller.isAppearanceLightNavigationBars = !darkTheme
        }
    }

    androidx.compose.runtime.CompositionLocalProvider(
        LocalTongueColors provides tongueColors,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = TongueTypography,
            shapes = TongueShapes,
            content = content,
        )
    }
}
