package app.tongue.language.designsystem

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/**
 * Corner radii from the brand guide: cards 16, buttons 11, pills 999.
 * Material3 [Shapes] maps roughly onto our usage; brand-specific radii are
 * also exposed as constants for direct use.
 */
object TongueShapeTokens {
    val Card = RoundedCornerShape(16.dp)
    val Button = RoundedCornerShape(11.dp)
    val Pill = RoundedCornerShape(999.dp)
    val Sheet = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
}

val TongueShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(11.dp),   // buttons
    medium = RoundedCornerShape(16.dp),  // cards
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)
