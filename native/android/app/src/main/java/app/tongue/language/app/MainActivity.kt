package app.tongue.language.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tongue.language.data.model.AuthState
import app.tongue.language.designsystem.TongueTheme
import app.tongue.language.designsystem.tongue
import app.tongue.language.app.nav.TongueNavHost
import androidx.compose.material3.MaterialTheme
import dagger.hilt.android.AndroidEntryPoint

/**
 * Single-activity host. Keeps the system splash on screen until the app has
 * resolved the initial auth state (token validate / silent auto-login), so the
 * user sees "Signing you in…" continuity rather than a flash of the Login screen.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val viewModel: RootViewModel by androidx.activity.viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Hold the splash while auth is Unknown (bootstrap running).
        splash.setKeepOnScreenCondition {
            viewModel.authState.value is AuthState.Unknown
        }

        setContent {
            TongueTheme {
                val authState by viewModel.authState.collectAsStateWithLifecycle()
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.tongue.bg,
                ) {
                    TongueNavHost(authState = authState)
                }
            }
        }
    }
}
