package erp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.color.ColorProvider
import androidx.glance.unit.ColorProvider
import erp.app.MainActivity
import erp.app.R
import java.time.Instant

/**
 * The home-screen widget (Widget/ERPWidget.swift, Shared/ERPWidgetViews.swift): today's revenue and this month's, the
 * shop's pinned note, and (large) the supporting figures, in the house's palette. Three faces by the room the launcher
 * gives it; it draws what [WidgetSync] last kept and never asks the ERP itself, so it opens at once and a tap opens the app.
 */
class ErpWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        // Finer than the three faces, so the figures are fitted to the room the widget really has.
        setOf(
            DpSize(110.dp, 110.dp), DpSize(160.dp, 160.dp), DpSize(220.dp, 110.dp), DpSize(280.dp, 110.dp),
            DpSize(320.dp, 160.dp), DpSize(220.dp, 220.dp), DpSize(280.dp, 280.dp), DpSize(320.dp, 360.dp),
        ),
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val link = WidgetStore.load(context)
        val summary = link?.let { WidgetStore.cached(context, it) }
        provideContent {
            GlanceTheme {
                val size = LocalSize.current
                WidgetFaceGlance(summary, WidgetLayout.sizeFor(size.width.value, size.height.value), size.width.value, appName = context.getString(R.string.app_name))
            }
        }
    }
}

/** One receiver per flavor: its label is the flavor's app_name ("Taheri ERP" / "Mina ERP"), what the widget picker lists. */
class ErpWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ErpWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetSync.schedule(context)
        WidgetSync.refreshSoon(context)
    }

    override fun onUpdate(context: Context, appWidgetManager: android.appwidget.AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        WidgetSync.refreshSoon(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WidgetSync.cancel(context)
    }
}

// The house's palette: resource colours (values and values-night, generated from the iPhone's colour sets) follow the
// device's night mode on their own.
private val ground = ColorProvider(R.color.house_ground)
private val accent = ColorProvider(R.color.house_accent)
private val primary = ColorProvider(day = Color(0xFF1B1B1F), night = Color(0xFFEDEAE4))
private val secondary = ColorProvider(day = Color(0xFF6B6B70), night = Color(0xFFA6A39C))
private val hair = ColorProvider(day = Color(0x24000000), night = Color(0x33FFFFFF))

private fun tap() = GlanceModifier.clickable(actionStartActivity<MainActivity>())

@Composable
fun WidgetFaceGlance(summary: WidgetSummary?, size: WidgetSize, widthDp: Float, appName: String, now: Instant = Instant.now()) {
    val plan = summary?.let { WidgetLayout.plan(it, size, now, widthDp) }
    Row(GlanceModifier.fillMaxSize().appWidgetBackground().background(ground).cornerRadius(22.dp).then(tap())) {
        // Quiet house paper: the accent bar, the wordmark, the typography and the shop's note carry the personality.
        Box(GlanceModifier.width(4.dp).fillMaxHeight().background(accent)) {}
        Column(GlanceModifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp)) {
            if (summary == null || plan == null) Unlinked(appName) else Face(summary, plan)
        }
    }
}

@Composable
private fun Unlinked(appName: String) {
    Wordmark(92, 24, "")
    Spacer(GlanceModifier.height(8.dp))
    Text("Your shop, at a glance", style = TextStyle(color = primary, fontSize = 16.sp, fontWeight = FontWeight.Medium), maxLines = 2)
    Spacer(GlanceModifier.height(4.dp))
    Text("Open $appName and link your widget in Settings.", style = TextStyle(color = secondary, fontSize = 12.sp), maxLines = 3)
}

@Composable
private fun ColumnScope.Face(s: WidgetSummary, p: FacePlan) {
    Header(s, p)
    when (p.size) {
        WidgetSize.Small -> {
            Spacer(GlanceModifier.height(4.dp))
            Hero(p.today, p.heroSp)
            p.month?.let { Month(it, p.monthSp) }
            p.note?.let { Spacer(GlanceModifier.height(6.dp)); Pinned(it, p.noteLines, compact = true) }
        }
        WidgetSize.Medium -> {
            Spacer(GlanceModifier.height(8.dp))
            Row(GlanceModifier.fillMaxWidth()) {
                Column(GlanceModifier.defaultWeight()) {
                    Hero(p.today, p.heroSp)
                    p.month?.let { Month(it, p.monthSp) }
                }
                if (p.note != null) {
                    Box(GlanceModifier.width(1.dp).height(52.dp).background(hair)) {}
                    Spacer(GlanceModifier.width(12.dp))
                    Column(GlanceModifier.defaultWeight()) { Pinned(p.note, p.noteLines, compact = false) }
                }
            }
        }
        WidgetSize.Large -> {
            Spacer(GlanceModifier.height(18.dp))
            Hero(p.today, p.heroSp)
            p.month?.let { Spacer(GlanceModifier.height(6.dp)); Month(it, p.monthSp) }
            p.note?.let { Spacer(GlanceModifier.height(16.dp)); Pinned(it, p.noteLines, compact = false) }
            if (p.supporting.isNotEmpty()) {
                Spacer(GlanceModifier.defaultWeight())
                Box(GlanceModifier.fillMaxWidth().height(1.dp).background(hair)) {}
                Spacer(GlanceModifier.height(10.dp))
                p.supporting.chunked(p.columns).forEach { row ->
                    Row(GlanceModifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        row.forEach { f -> Column(GlanceModifier.defaultWeight()) { Cell(f) } }
                        repeat(p.columns - row.size) { Spacer(GlanceModifier.defaultWeight()) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Wordmark(w: Int, h: Int, label: String) {
    Image(ImageProvider(R.drawable.brand_logo), label, GlanceModifier.width(w.dp).height(h.dp), contentScale = ContentScale.Fit)
}

@Composable
private fun Header(s: WidgetSummary, p: FacePlan) {
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (p.compactHeader) Wordmark(72, 18, s.house) else Wordmark(96, 24, s.house)
        Spacer(GlanceModifier.defaultWeight())
        val f = p.freshness
        Text(
            if (p.compactHeader) f.short else f.text,
            style = TextStyle(color = if (f.stale) primary else secondary, fontSize = 11.sp, fontWeight = if (f.stale) FontWeight.Bold else FontWeight.Medium),
            maxLines = 1,
        )
    }
}

@Composable
private fun Hero(f: WidgetFigure, sizeSp: Float) {
    Text(f.label.uppercase(), style = TextStyle(color = secondary, fontSize = 10.sp, fontWeight = FontWeight.Bold), maxLines = 1)
    Text(f.value, style = TextStyle(color = accent, fontSize = sizeSp.sp, fontWeight = FontWeight.Bold), maxLines = 1)
}

@Composable
private fun Month(f: WidgetFigure, sizeSp: Float) {
    Row {
        Text(f.label + "  ", style = TextStyle(color = secondary, fontSize = sizeSp.sp), maxLines = 1)
        Text(f.value, style = TextStyle(color = primary, fontSize = sizeSp.sp, fontWeight = FontWeight.Bold), maxLines = 1)
    }
}

@Composable
private fun Pinned(text: String, lines: Int, compact: Boolean) {
    if (compact) {
        Row(verticalAlignment = Alignment.Top) {
            Text("◆ ", style = TextStyle(color = accent, fontSize = 10.sp), maxLines = 1)
            Text(text, style = TextStyle(color = primary, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = lines)
        }
    } else {
        Text("PINNED", style = TextStyle(color = accent, fontSize = 10.sp, fontWeight = FontWeight.Bold), maxLines = 1)
        Text(text, style = TextStyle(color = primary, fontSize = 13.sp, fontWeight = FontWeight.Medium), maxLines = lines)
    }
}

@Composable
private fun Cell(f: WidgetFigure) {
    Text(f.label, style = TextStyle(color = secondary, fontSize = 10.sp), maxLines = 1)
    Text(f.value, style = TextStyle(color = primary, fontSize = 15.sp, fontWeight = FontWeight.Bold), maxLines = 1)
    f.detail?.takeIf { it.isNotEmpty() }?.let { Text(it, style = TextStyle(color = secondary, fontSize = 10.sp), maxLines = 1) }
}
