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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import erp.app.R
import erp.app.ui.theme.ErpTheme
import java.time.Instant

/**
 * The widget's faces drawn in plain Compose (Settings → Widgets' preview, WidgetPreviewScreen.swift): the same [WidgetPlan] as the Glance
 * widget ([WidgetPlanGlance]) is laid out here, charts included (the same bitmaps), so what is previewed is what the home screen draws.
 */
@Composable
fun WidgetFacePreview(
    shown: List<Pair<WidgetLinkData, WidgetSummary?>>,
    size: WidgetSize,
    appName: String,
    modifier: Modifier = Modifier,
    /** The widget as it draws in the device's dark mode, whatever the device is in now (a launcher follows its own). */
    dark: Boolean = isSystemInDarkTheme(),
    now: Instant = Instant.now(),
) {
    val plan = WidgetLayout.plan(shown, size, now)
    ErpTheme(themeOverride = if (dark) "taheri" else "default") {
        // A real widget's text stops growing about here; past it the fixed-size preview would clip.
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, minOf(density.fontScale, 1.3f))) {
            val shape = RoundedCornerShape(22.dp)
            Box(
                modifier.clip(shape).border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f), shape)
                    .semantics { contentDescription = "Sample widget" },
            ) {
                val items = plan.items
                when {
                    items.isEmpty() -> PreviewPaper(null, dark, Modifier.fillMaxSize()) { PreviewUnlinked(appName) }
                    plan.arrangement == WidgetArrangement.Single -> PreviewPaper(items[0].look, dark, Modifier.fillMaxSize()) { PreviewBusiness(items[0], dark) }
                    plan.arrangement == WidgetArrangement.Columns -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        PreviewPaper(items[0].look, dark, Modifier.weight(1f).fillMaxHeight()) { PreviewBusiness(items[0], dark) }
                        PreviewPaper(items[1].look, dark, Modifier.weight(1f).fillMaxHeight()) { PreviewBusiness(items[1], dark) }
                    }
                    else -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        val tight = plan.size == WidgetSize.Small
                        PreviewPaper(items[0].look, dark, Modifier.weight(1f).fillMaxWidth(), tight) { PreviewBusiness(items[0], dark) }
                        PreviewPaper(items[1].look, dark, Modifier.weight(1f).fillMaxWidth(), tight) { PreviewBusiness(items[1], dark) }
                    }
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

private val upInk = Color(0xFF1E8E3E)
private val lateInk = Color(0xFFD32F2F)
private val owedInk = Color(0xFFB45309)

@Composable
private fun PreviewPaper(look: WidgetLook?, dark: Boolean, modifier: Modifier, tight: Boolean = false, content: @Composable () -> Unit) {
    val ground = look?.ground(dark) ?: if (dark) Color(0xFF030606) else Color(0xFFECE8E1)
    Box(modifier.clip(RoundedCornerShape(if (look == null) 0.dp else 18.dp)).background(ground).padding(horizontal = 14.dp, vertical = if (tight) 6.dp else 10.dp)) { content() }
}

@Composable
private fun PreviewUnlinked(appName: String) {
    Column {
        Text("Your shop, at a glance", style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(4.dp))
        Text("Open $appName and sign in.", color = inkSecondary(), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun PreviewBusiness(item: WidgetItem, dark: Boolean) {
    val f = item.face
    if (f == null) {
        Text("${item.look.name} · no figures yet", color = inkSecondary(), fontSize = 12.sp, maxLines = 2)
        return
    }
    val look = item.look
    when (f.kind) {
        FaceKind.Small -> Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Eyebrow("Today")
                Spacer(Modifier.weight(1f))
                Wordmark(look, 52.dp, 14.dp, dark)
            }
            Spacer(Modifier.height(4.dp))
            Hero(f)
            Delta(f)
            Spacer(Modifier.weight(1f))
            Chart(look, f, 38, dark)
            Stamp(f)
        }
        FaceKind.SmallHalf, FaceKind.MediumHalf -> Column(Modifier.fillMaxSize()) {
            if (f.kind == FaceKind.MediumHalf) {
                Text(f.name.uppercase(), color = look.accent(dark), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(2.dp))
                Hero(f)
                Delta(f)
            } else {
                // A row of a small widget is short: the name with the week's change at its end, then the figure.
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(f.name.uppercase(), Modifier.weight(1f), color = look.accent(dark), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Delta(f, long = false)
                }
                Spacer(Modifier.height(2.dp))
                Hero(f)
            }
            if (f.kind == FaceKind.MediumHalf) {
                Spacer(Modifier.weight(1f))
                Chart(look, f, 38, dark)
                Stamp(f)
            }
        }
        FaceKind.Medium -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight()) {
                Eyebrow("Today")
                Spacer(Modifier.height(3.dp))
                Hero(f)
                Delta(f)
                Spacer(Modifier.weight(1f))
                Chart(look, f, 38, dark)
            }
            Column(Modifier.weight(1f).fillMaxHeight()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Wordmark(look, 56.dp, 14.dp, dark) }
                Spacer(Modifier.weight(1f))
                for (s in f.stats) { Stat(s); Spacer(Modifier.height(7.dp)) }
                Stamp(f)
            }
        }
        FaceKind.Large -> Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.weight(1f)) {
                    Eyebrow("Today")
                    Spacer(Modifier.height(2.dp))
                    Hero(f)
                    Delta(f)
                }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                    Wordmark(look, 64.dp, 16.dp, dark)
                    Spacer(Modifier.height(6.dp))
                    Chart(look, f, 34, dark)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth()) { for (s in f.stats) Column(Modifier.weight(1f)) { Stat(s) } }
            if (f.needs.isNotEmpty()) Section("Needs you") { f.needs.forEach { n -> Line(n.title, n.detail, color = if (n.tone == "late") lateInk else owedInk) } }
            if (f.recent.isNotEmpty()) Section("Recent sales") { f.recent.forEach { r -> Line(r.title, r.amount, mid = r.whenText, bold = true) } }
            if (f.needs.isEmpty() && f.recent.isEmpty() && f.supporting.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                f.supporting.chunked(f.columns).forEach { row ->
                    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        row.forEach { fig -> Column(Modifier.weight(1f)) { PreviewCell(fig) } }
                        repeat(f.columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            f.note?.let { Text("◆ $it", color = inkSecondary(), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
private fun Eyebrow(text: String) {
    Text(text.uppercase(), color = inkSecondary(), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, maxLines = 1)
}

@Composable
private fun Hero(f: FacePlan) {
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        f.heroPrefix?.let { Text(it, color = inkSecondary(), fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1) }
        Text(f.heroNumber, color = inkPrimary(), fontSize = f.heroSp.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Delta(f: FacePlan, long: Boolean = true) {
    val d = f.delta ?: return
    Row(Modifier.semantics { contentDescription = d.speech }) {
        Text(d.text, color = if (d.up) upInk else lateInk, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        if (long) Text("  vs last week", color = inkSecondary(), fontSize = 11.sp, maxLines = 1)
    }
}

@Composable
private fun Stat(s: WidgetStat) {
    Column {
        // An explicit line height: the theme's 24 sp one would give each figure twice the room the widget's own text takes, and clip the third.
        Text(s.value, color = if (s.late) lateInk else inkPrimary(), fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(s.label, color = inkSecondary(), fontSize = 10.sp, lineHeight = 13.sp, maxLines = 1)
    }
}

@Composable
private fun Section(title: String, rows: @Composable () -> Unit) {
    Spacer(Modifier.height(8.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(inkPrimary().copy(alpha = 0.14f)))
    Spacer(Modifier.height(5.dp))
    Eyebrow(title)
    Spacer(Modifier.height(3.dp))
    rows()
}

@Composable
private fun Line(title: String, end: String, mid: String? = null, color: Color? = null, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), color = inkPrimary(), fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        mid?.let { Text("$it  ", color = inkSecondary(), fontSize = 10.sp, maxLines = 1) }
        Text(end, color = color ?: inkPrimary(), fontSize = 12.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
    }
}

@Composable
private fun PreviewCell(f: WidgetFigure) {
    Text(f.label, color = inkSecondary(), fontSize = 10.sp, maxLines = 1)
    Text(f.value, color = inkPrimary(), fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun Stamp(f: FacePlan) {
    f.stamp?.let { Text(it, color = inkSecondary(), fontSize = 10.sp, maxLines = 1) }
}

/** The very bitmaps the widget draws. */
@Composable
private fun Chart(look: WidgetLook, f: FacePlan, heightDp: Int, dark: Boolean) {
    if (f.chart == ChartKind.None) return
    val density = LocalDensity.current.density
    val color = look.accent(dark).toArgb()
    val bitmap = remember(f.days, f.chart, color, heightDp, density) {
        val h = (heightDp * density).toInt()
        val w = (130 * density).toInt()
        (if (f.chart == ChartKind.Sparkline) WidgetCharts.sparklineBitmap(f.days, w, h, color) else WidgetCharts.barsBitmap(f.days, w, h, color)).asImageBitmap()
    }
    Image(bitmap, "Takings, last 7 days", Modifier.fillMaxWidth().height(heightDp.dp), contentScale = ContentScale.Fit, alignment = Alignment.CenterStart)
}

@Composable
private fun Wordmark(look: WidgetLook, w: Dp, h: Dp, dark: Boolean) {
    val res = when (look.brand) {
        "taheri" -> R.drawable.brand_logo_taheri
        "mina" -> R.drawable.brand_logo_mina
        else -> null
    }
    if (res != null) Image(logo(res, dark), look.name, Modifier.size(w, h), contentScale = ContentScale.Fit, alignment = Alignment.CenterEnd)
    else Text(look.name, color = look.accent(dark), fontSize = (h.value * 0.7f).sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.width(w))
}

/** A wordmark in the light or the dark variant, whichever the preview is drawn in (not the device's). */
@Composable
private fun logo(res: Int, dark: Boolean): BitmapPainter {
    val context = LocalContext.current
    return remember(context, res, dark) {
        val configuration = Configuration(context.resources.configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or (if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
        }
        BitmapPainter(BitmapFactory.decodeResource(context.createConfigurationContext(configuration).resources, res).asImageBitmap())
    }
}
