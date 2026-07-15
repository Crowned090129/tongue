package app.tongue.language.app.nav

import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.tongue.language.data.model.AuthState
import app.tongue.language.designsystem.LoadingState
import app.tongue.language.designsystem.tongue
import app.tongue.language.feature.coach.CoachScreen
import app.tongue.language.feature.home.HomeScreen
import app.tongue.language.feature.login.LoginScreen
import app.tongue.language.feature.placeholder.ComingSoonScreen
import app.tongue.language.feature.placeholder.PaywallScreen
import app.tongue.language.feature.settings.SettingsScreen
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Alignment

/**
 * Root navigation. Auth state drives which graph is shown:
 *  - Unknown          → nothing (system splash still visible via MainActivity)
 *  - AutoSigningIn    → brief "Signing you in…" splash
 *  - LoggedOut        → auth graph (Login)
 *  - Authenticated    → main graph (bottom-bar shell)
 *
 * The `LaunchedEffect`-free approach: we simply pick the start graph from the
 * current [authState]. On sign-in / sign-out the state flips and the correct
 * graph is composed. The bottom-bar shell handles inner navigation.
 */
@Composable
fun TongueNavHost(authState: AuthState) {
    when (authState) {
        is AuthState.Unknown -> Unit // splash owns the screen

        is AuthState.AutoSigningIn -> SigningInSplash()

        is AuthState.LoggedOut -> {
            val navController = rememberNavController()
            AuthGraphHost(navController)
        }

        is AuthState.Authenticated -> {
            val navController = rememberNavController()
            MainShell(navController)
        }
    }
}

@Composable
private fun SigningInSplash() {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LoadingState(label = "Signing you in…")
    }
}

@Composable
private fun AuthGraphHost(navController: NavHostController) {
    NavHost(
        navController = navController,
        startDestination = Routes.LOGIN,
    ) {
        composable(Routes.LOGIN) {
            // On success the AuthRepository flips authState → Authenticated,
            // which recomposes TongueNavHost into the main graph. No explicit
            // navigation needed here.
            LoginScreen()
        }
    }
}

@Composable
private fun MainShell(navController: NavHostController) {
    val colors = MaterialTheme.tongue
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val current = TopLevelDestination.fromRoute(currentRoute)

    Scaffold(
        containerColor = colors.bg,
        bottomBar = {
            // Hide the bar on full-screen destinations like the paywall.
            if (currentRoute == null || TopLevelDestination.fromRoute(currentRoute) != null) {
                NavigationBar(containerColor = colors.surface) {
                    TopLevelDestination.ALL.forEach { dest ->
                        val selected = current == dest
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(dest.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                androidx.compose.material3.Icon(dest.icon, contentDescription = dest.label)
                            },
                            label = { Text(dest.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = colors.accent,
                                selectedTextColor = colors.accent,
                                indicatorColor = colors.surface2,
                                unselectedIconColor = colors.muted,
                                unselectedTextColor = colors.muted,
                            ),
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.HOME,
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            enterTransition = { androidx.compose.animation.fadeIn(tween(150)) },
            exitTransition = { androidx.compose.animation.fadeOut(tween(150)) },
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    onOpenCoach = { navController.navigate(Routes.COACH) },
                    onLocked = { navController.navigate(Routes.PAYWALL) },
                )
            }
            composable(Routes.LEARN) {
                ComingSoonScreen(
                    title = "Learn",
                    message = "Structured lessons and drills are coming to the app soon.",
                )
            }
            composable(Routes.COACH) {
                CoachScreen(onUpgrade = { navController.navigate(Routes.PAYWALL) })
            }
            composable(Routes.SETTINGS) {
                SettingsScreen(onUpgrade = { navController.navigate(Routes.PAYWALL) })
            }
            composable(Routes.PAYWALL) {
                PaywallScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
