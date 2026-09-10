package tn.maawen.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection

private val Teal = Color(0xFF2DD4BF)
private val TealDeep = Color(0xFF0F766E)

private val DarkColors = darkColorScheme(
    primary = Teal,
    onPrimary = Color(0xFF04231F),
    primaryContainer = TealDeep,
    onPrimaryContainer = Color(0xFFE8F5F1),
    background = Color(0xFF08201D),
    onBackground = Color(0xFFE8F5F1),
    surface = Color(0xFF113531),
    onSurface = Color(0xFFE8F5F1),
    surfaceVariant = Color(0xFF16423C),
    onSurfaceVariant = Color(0xFF8FB3AC),
    outline = Color(0xFF1F5750),
    error = Color(0xFFF97362),
)

/**
 * Thème de l'app: un seul habillage, sombre — l'écran principal est une
 * conversation qu'on regarde souvent le soir, et ça évite deux palettes à
 * maintenir. Tout est en RTL: l'app parle arabe.
 */
@Composable
fun MaawenTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DarkColors) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            content()
        }
    }
}
