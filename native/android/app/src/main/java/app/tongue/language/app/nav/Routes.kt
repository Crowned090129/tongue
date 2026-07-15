package app.tongue.language.app.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Type-safe-ish route constants. Kept as plain strings for Navigation-Compose;
 * the bottom-bar destinations are enumerated in [TopLevelDestination].
 */
object Routes {
    const val LOGIN = "login"
    const val PAYWALL = "paywall"

    // Top-level (bottom bar)
    const val HOME = "home"
    const val LEARN = "learn"       // stubbed "Coming soon"
    const val COACH = "coach"
    const val SETTINGS = "settings"

    // Graph roots
    const val AUTH_GRAPH = "auth_graph"
    const val MAIN_GRAPH = "main_graph"
}

enum class TopLevelDestination(
    val route: String,
    val label: String,
    val icon: ImageVector,
) {
    HOME(Routes.HOME, "Explore", Icons.Outlined.Explore),
    LEARN(Routes.LEARN, "Learn", Icons.Outlined.MenuBook),
    COACH(Routes.COACH, "Coach", Icons.Outlined.Chat),
    SETTINGS(Routes.SETTINGS, "Settings", Icons.Outlined.Settings);

    companion object {
        val ALL = entries
        fun fromRoute(route: String?): TopLevelDestination? =
            entries.firstOrNull { it.route == route }
    }
}
