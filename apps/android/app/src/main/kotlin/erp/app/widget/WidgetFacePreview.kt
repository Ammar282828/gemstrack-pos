package erp.app.widget

import android.content.res.Configuration
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.R
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpTheme
import java.time.Instant

/**
 * The widget's faces drawn in plain Compose (Settings → Widgets' preview, WidgetPreviewScreen.swift): the same
 * [FacePlan] as the Glance widget ([WidgetFaceGlance]) is laid out here, so what is previewed is what the home screen draws.
 */
@Composable
fun WidgetFacePreview(
    summary: WidgetSummary?,
    size: WidgetSize,
    appName: String,
    modifier: Modifier = Modifier,
    /** The widget as it draws in the device's dark mode, whatever the device is in now (a launcher follows its own). */
    dark: Boolean = isSystemInDarkTheme(),
    now: Instant = Instant.now(),
) {
    val plan = summary?.let { WidgetLayout.plan(it, size, now) }
    ErpTheme(themeOverride = if (dark) "taheri" else "default") {
        // A real widget's text stops growing about here; past it the fixed-size preview would clip.
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, minOf(density.fontScale, 1.3f))) {
            val shape = RoundedCornerShape(22.dp)
            Row(
                modifier.clip(shape).background(ErpColors.ground)
                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f), shape)
                    .semantics { contentDescription = "Sample widget" },
            ) {
                Box(Modifier.width(4.dp).fillMaxHeight().background(ErpColors.accent))
                Column(Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp)) {
                    if (summary == null || plan == null) PreviewUnlinked(appName, dark) else PreviewFace(summary, plan, dark)
                }
            }
        }
    }
}

/** The size a face is drawn at in the preview (a launcher's 2x2, 4x2 and 4x4 cells). */
fun previewWidth(size: WidgetSize): Dp = WidgetLayout.nominalWidth(size).dp
fun previewHeight(size: WidgetSize): Dp = when (size) { WidgetSize.Large -> 354.dp; else -> 160.dp }

@Composable
private fun inkSecondary() = MaterialTheme.colorScheme.onSurfaceVariant

@Composable
private fun inkPrimary() = MaterialTheme.colorScheme.onSurface

@Composable
private fun PreviewUnlinked(appName: String, dark: Boolean) {
    Wordmark(92.dp, 24.dp, "", dark)
    Spacer(Modifier.height(8.dp))
    Text("Your shop, at a glance", style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Spacer(Modifier.height(4.dp))
    Text("Open $appName and link your widget in Settings.", color = inkSecondary(), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun ColumnScope.PreviewFace(s: WidgetSummary, p: FacePlan, dark: Boolean) {
    PreviewHeader(s, p, dark)
    when (p.size) {
        WidgetSize.Small -> {
            Spacer(Modifier.height(4.dp))
            PreviewHero(p.today, p.heroSp)
            p.month?.let { PreviewMonth(it, p.monthSp) }
            p.note?.let { Spacer(Modifier.height(6.dp)); PreviewPinned(it, p.noteLines, compact = true) }
        }
        WidgetSize.Medium -> {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    PreviewHero(p.today, p.heroSp)
                    p.month?.let { PreviewMonth(it, p.monthSp) }
                }
                if (p.note != null) {
                    Box(Modifier.width(1.dp).fillMaxHeight().background(inkPrimary().copy(alpha = 0.14f)))
                    Column(Modifier.weight(1f)) { PreviewPinned(p.note, p.noteLines, compact = false) }
                }
            }
        }
        WidgetSize.Large -> {
            Spacer(Modifier.height(18.dp))
            PreviewHero(p.today, p.heroSp)
            p.month?.let { Spacer(Modifier.height(6.dp)); PreviewMonth(it, p.monthSp) }
            p.note?.let { Spacer(Modifier.height(16.dp)); PreviewPinned(it, p.noteLines, compact = false) }
            if (p.supporting.isNotEmpty()) {
                Spacer(Modifier.weight(1f))
                Box(Modifier.fillMaxWidth().height(1.dp).background(inkPrimary().copy(alpha = 0.14f)))
                Spacer(Modifier.height(10.dp))
                p.supporting.chunked(p.columns).forEach { row ->
                    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        row.forEach { f -> Column(Modifier.weight(1f)) { PreviewCell(f) } }
                        repeat(p.columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Wordmark(w: Dp, h: Dp, label: String, dark: Boolean) {
    Image(houseLogo(dark), label.ifEmpty { null }, Modifier.size(w, h), contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
}

/** The house's wordmark in the light or the dark variant, whichever the preview is drawn in (not the device's). */
@Composable
private fun houseLogo(dark: Boolean): BitmapPainter {
    val context = LocalContext.current
    return remember(context, dark) {
        val configuration = Configuration(context.resources.configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or (if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
        }
        val resources = context.createConfigurationContext(configuration).resources
        BitmapPainter(BitmapFactory.decodeResource(resources, R.drawable.brand_logo).asImageBitmap())
    }
}

@Composable
private fun PreviewHeader(s: WidgetSummary, p: FacePlan, dark: Boolean) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (p.compactHeader) Wordmark(72.dp, 18.dp, s.house, dark) else Wordmark(96.dp, 24.dp, s.house, dark)
        Spacer(Modifier.weight(1f))
        val f = p.freshness
        Text(
            if (p.compactHeader) f.short else f.text,
            color = if (f.stale) inkPrimary() else inkSecondary(), fontSize = 11.sp,
            fontWeight = if (f.stale) FontWeight.Bold else FontWeight.Medium, maxLines = 1,
            modifier = Modifier.semantics { contentDescription = if (f.stale) "Figures from ${f.text}" else "Updated ${f.text}" },
        )
    }
}

@Composable
private fun PreviewHero(f: WidgetFigure, sizeSp: Float) {
    Text(f.label.uppercase(), color = inkSecondary(), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, maxLines = 1)
    Text(f.value, color = ErpColors.accent, fontSize = sizeSp.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun PreviewMonth(f: WidgetFigure, sizeSp: Float) {
    val sp = sizeSp.sp
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.Bottom) {
        Text(f.label, color = inkSecondary(), fontSize = sp, maxLines = 1)
        Text(f.value, color = inkPrimary(), fontSize = sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun PreviewPinned(text: String, lines: Int, compact: Boolean) {
    if (compact) {
        Row(verticalAlignment = Alignment.Top) {
            Text("◆ ", color = ErpColors.accent, fontSize = 10.sp)
            Text(text, color = inkPrimary(), fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium, maxLines = lines, overflow = TextOverflow.Ellipsis)
        }
    } else {
        Text("PINNED", color = ErpColors.accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        Text(text, color = inkPrimary(), fontSize = 13.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium, maxLines = lines, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun PreviewCell(f: WidgetFigure) {
    Text(f.label, color = inkSecondary(), fontSize = 10.sp, maxLines = 1)
    Text(f.value, color = inkPrimary(), fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    f.detail?.takeIf { it.isNotEmpty() }?.let { Text(it, color = inkSecondary(), fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}
