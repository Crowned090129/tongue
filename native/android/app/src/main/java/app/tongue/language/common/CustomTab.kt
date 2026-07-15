package app.tongue.language.common

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri

/**
 * Opens a URL in a Chrome Custom Tab. Used for the reader-app subscription flow:
 * we send users to the web `/subscribe` page (Google requires Play Billing for
 * in-app digital goods, which we deliberately do NOT implement — see the paywall
 * screen). After subscribing on the web, the user receives an access code by
 * email and signs in with it here.
 */
fun openCustomTab(context: Context, url: String) {
    val intent = CustomTabsIntent.Builder()
        .setShowTitle(true)
        .setUrlBarHidingEnabled(true)
        .build()
    intent.launchUrl(context, url.toUri())
}

fun openCustomTab(context: Context, uri: Uri) {
    CustomTabsIntent.Builder()
        .setShowTitle(true)
        .build()
        .launchUrl(context, uri)
}
