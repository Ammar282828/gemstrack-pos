package erp.app.screens.businesses

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import erp.app.R
import erp.app.config.Business
import erp.app.config.parseHexColor
import erp.app.ui.theme.ErpColors

// The business switcher's small parts (BusinessChip.swift): the badge, and a business's whole logo. The chip is BusinessChip.kt;
// the list and the sheet are BusinessesPanel.kt.

/** A business's colours in the palette's own light or dark side, not the open business's: a business that is not open looks like itself in the list. */
fun Business.side(dark: Boolean): Business.Side = if (dark) palette.dark else palette.light

fun hexColor(hex: String, fallback: Color = Color.Gray): Color = parseHexColor(hex)?.let { Color(it) } ?: fallback

/** The ground each bundled badge is drawn on (its corner colour), so the circle and the art are one. */
private fun markGround(art: String): Color = if (art == "mina") Color(0xFFFAF7F2) else Color(0xFF0A1111)

private fun badgeRes(art: String): Int = if (art == "mina") R.drawable.badge_mark_mina else R.drawable.badge_mark_taheri

private fun logoRes(art: String): Int = if (art == "mina") R.drawable.brand_logo_mina else R.drawable.brand_logo_taheri

/**
 * A business's mark: the bundled badge for a built-in (the "t", the MINA wordmark, centred on its own ground), else its icon from
 * its ERP when it arrives, else its first letter on its accent. Drawn from the business's own palette, not the open one's.
 */
@Composable
fun BusinessBadge(business: Business, modifier: Modifier = Modifier, size: Dp = 28.dp) {
    val dark = ErpColors.dark
    val side = business.side(dark)
    val accent = hexColor(side.accent)
    val art = business.art
    Box(
        modifier.size(size).clip(CircleShape).border(BorderStroke(0.5.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (art != null) {
            Box(Modifier.fillMaxSize().background(markGround(art)))
            Image(painterResource(badgeRes(art)), null, Modifier.fillMaxSize().clip(CircleShape), contentScale = ContentScale.Fit)
        } else {
            Box(Modifier.fillMaxSize().background(accent))
            Text(business.initial, fontSize = (size.value * 0.46f).sp, fontWeight = FontWeight.SemiBold, color = hexColor(side.onAccent, Color.White))
            val icon = business.icon?.takeIf { it.startsWith("https://") }
            if (icon != null) {
                // The ERP's icon, fitted with ~14% padding on the business's card colour.
                AsyncImage(
                    model = icon, contentDescription = null,
                    modifier = Modifier.fillMaxSize().background(hexColor(side.card, accent)).padding(size * 0.14f),
                    contentScale = ContentScale.Fit,
                )
            }
        }
    }
}

/** A business's whole logo: the bundled one for a built-in, else the one its ERP serves, else its name. */
@Composable
fun BusinessLogo(business: Business, modifier: Modifier = Modifier, height: Dp = 48.dp) {
    val art = business.art
    val url = (if (ErpColors.dark) business.logo.dark ?: business.logo.light else business.logo.light ?: business.logo.dark)?.takeIf { it.startsWith("https://") }
    when {
        art != null -> Image(painterResource(logoRes(art)), business.displayName, modifier.size(height * business.logo.aspect.toFloat().coerceIn(1f, 6f), height), contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
        url != null -> AsyncImage(url, business.displayName, modifier.size(height * business.logo.aspect.toFloat().coerceIn(1f, 6f), height), contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
        else -> Text(business.name, modifier, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
