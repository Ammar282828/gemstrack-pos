package erp.app.widget

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.ColorFilter
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import erp.app.MainActivity
import erp.app.R
import erp.app.config.Businesses
import erp.app.config.Prefs
import erp.app.ui.Tone
import java.time.Instant

/**
 * The home-screen widget (Widget/ERPWidget.swift, Shared/ERPWidgetViews.swift): today's takings with the week's line and its change
 * on last week, what is owed, due and on the bench, and (large) what needs you and the latest sales. One widget, many businesses:
 * every size shows both businesses by default when two are linked (small stacks two rows, medium sets two columns, large stacks two
 * medium faces, each in its own colours), and Settings → Widgets' "Show both businesses" turns the second off. It draws what
 * [WidgetSync] last kept and never asks the ERP itself, so it opens at once; a tap opens the app on that business (and, on a line, that
 * screen) by an intent of the app's own, never the browser. What a face shows is [WidgetLayout.plan]; the preview draws the same plan.
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
        val links = WidgetStore.all(context)
        val shown = WidgetLayout.pick(
            links, order = Businesses.list.value.map { it.id }, openId = Prefs.string(Prefs.BUSINESS_CURRENT),
            both = Prefs.bool(Prefs.WIDGET_BOTH) ?: true,
        ).map { it to WidgetStore.cached(context, it) }
        provideContent {
            GlanceTheme {
                val size = LocalSize.current
                WidgetGlance(shown, WidgetLayout.sizeFor(size.width.value, size.height.value), size.width.value, appName = context.getString(R.string.app_name))
            }
        }
    }
}

/** One receiver: its label is the flavor's app_name ("ERP"), what the widget picker lists. */
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

// Inks are the business's own scheme (WidgetColors): onSurface for the figures, onSurfaceVariant for what is quiet, the primary for
// the business's name and its chart, the tones for late/owed/up. Tonal surfaces take the place of every rule.
private val ink @Composable get() = GlanceTheme.colors.onSurface
private val inkQuiet @Composable get() = GlanceTheme.colors.onSurfaceVariant
private val accent @Composable get() = GlanceTheme.colors.primary

@Composable
private fun toneOf(tone: String) = LocalWidgetColors.current.tone(if (tone == "late") Tone.late else Tone.owed)

private fun Context.isNight() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

/** A widget-sized tonal tile: the corner the system gives the widget (Android 12+; before that Glance leaves it square). */
@Composable
private fun GlanceModifier.outerCorner(): GlanceModifier = cornerRadius(WidgetShape.outer(LocalContext.current))

@Composable
private fun GlanceModifier.innerCorner(): GlanceModifier = cornerRadius(WidgetShape.inner(LocalContext.current))

/** A tap that opens the app on a business and a screen (`shoperp://open?b=&p=`, AppRouter), by intent: never the browser. */
@Composable
private fun open(look: WidgetLook?, path: String = "/"): GlanceModifier {
    val context = LocalContext.current
    val url = look?.url(path) ?: "shoperp://open"
    return GlanceModifier.clickable(actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClass(context, MainActivity::class.java)))
}

@Composable
fun WidgetGlance(shown: List<Pair<WidgetLinkData, WidgetSummary?>>, size: WidgetSize, widthDp: Float, appName: String, now: Instant = Instant.now(), wallpaper: Boolean = WidgetColors.wantsWallpaper()) {
    val plan = WidgetLayout.plan(shown, size, now, widthDp)
    WidgetPlanGlance(plan, appName, wallpaper)
}

@Composable
fun WidgetPlanGlance(plan: WidgetPlan, appName: String, wallpaper: Boolean = false) {
    val context = LocalContext.current
    val items = plan.items
    // The widget's own outline carries the system's rounded corner; each business's tonal tile sits inside it. Two tiles leave a
    // 3 dp seam of the first business's page colour; one tile is the whole widget.
    val seam = WidgetColors.of(items.firstOrNull()?.look, wallpaper, context).color { it.surface }
    val alone = if (items.size == 1 || items.isEmpty()) WidgetColors.of(items.firstOrNull()?.look, wallpaper, context).color { it.surfaceContainerHigh } else seam
    Box(GlanceModifier.fillMaxSize().appWidgetBackground().outerCorner().background(alone)) {
        when {
            items.isEmpty() -> Tile(null, wallpaper, GlanceModifier.fillMaxSize()) { Unlinked(appName) }
            plan.arrangement == WidgetArrangement.Single -> Tile(items[0].look, wallpaper, GlanceModifier.fillMaxSize()) { Business(items[0], plan) }
            plan.arrangement == WidgetArrangement.Columns -> Row(GlanceModifier.fillMaxSize()) {
                Tile(items[0].look, wallpaper, GlanceModifier.defaultWeight().fillMaxHeight()) { Business(items[0], plan) }
                Spacer(GlanceModifier.width(3.dp))
                Tile(items[1].look, wallpaper, GlanceModifier.defaultWeight().fillMaxHeight()) { Business(items[1], plan) }
            }
            else -> Column(GlanceModifier.fillMaxSize()) {
                val tight = plan.size == WidgetSize.Small
                Tile(items[0].look, wallpaper, GlanceModifier.defaultWeight().fillMaxWidth(), tight) { Business(items[0], plan) }
                Spacer(GlanceModifier.height(3.dp))
                Tile(items[1].look, wallpaper, GlanceModifier.defaultWeight().fillMaxWidth(), tight) { Business(items[1], plan) }
            }
        }
    }
}

/** A business's own tile: its scheme's tonal surface (GlanceTheme carries the rest of its colours), the whole of it a tap that opens that business. */
@Composable
private fun Tile(look: WidgetLook?, wallpaper: Boolean, modifier: GlanceModifier, tight: Boolean = false, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val colors = remember(look?.id, look?.palette, wallpaper) { WidgetColors.of(look, wallpaper, context) }
    GlanceTheme(colors = colors.glance) {
        CompositionLocalProvider(LocalWidgetColors provides colors) {
            Box(
                modifier.background(colors.color { it.surfaceContainerHigh }).outerCorner().then(open(look))
                    .padding(horizontal = 14.dp, vertical = if (tight) 6.dp else 10.dp),
            ) { content() }
        }
    }
}

@Composable
private fun Unlinked(appName: String) {
    Column(GlanceModifier.fillMaxSize()) {
        Text("Your shop, at a glance", style = TextStyle(color = ink, fontSize = 16.sp, fontWeight = FontWeight.Medium), maxLines = 2)
        Spacer(GlanceModifier.height(4.dp))
        Text("Open $appName and sign in.", style = TextStyle(color = inkQuiet, fontSize = 12.sp), maxLines = 3)
    }
}

@Composable
private fun Business(item: WidgetItem, plan: WidgetPlan) {
    val face = item.face
    if (face == null) {
        // A business whose figures have not come yet keeps its place and says so.
        Text("${item.look.name} · no figures yet", style = TextStyle(color = inkQuiet, fontSize = 12.sp), maxLines = 2)
        return
    }
    when (face.kind) {
        FaceKind.Small -> SmallFace(item.look, face)
        FaceKind.SmallHalf -> HalfFace(item.look, face, withChart = false)
        FaceKind.MediumHalf -> HalfFace(item.look, face, withChart = true)
        FaceKind.Medium -> MediumFace(item.look, face)
        FaceKind.Large -> LargeFace(item.look, face)
    }
}

// ---- The faces ----

@Composable
private fun SmallFace(look: WidgetLook, f: FacePlan) {
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("Today")
            Spacer(GlanceModifier.defaultWeight())
            Wordmark(look, 52, 14)
        }
        Spacer(GlanceModifier.height(4.dp))
        Hero(f)
        Delta(f)
        Spacer(GlanceModifier.defaultWeight())
        Chart(look, f, 38)
        Stamp(f)
    }
}

@Composable
private fun HalfFace(look: WidgetLook, f: FacePlan, withChart: Boolean) {
    Column(GlanceModifier.fillMaxSize()) {
        if (withChart) {
            NameTag(f)
            Spacer(GlanceModifier.height(2.dp))
            Hero(f)
            Delta(f)
        } else {
            // A row of a small widget is short: the name with the week's change at its end, then the figure.
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                NameTag(f, GlanceModifier.defaultWeight())
                Delta(f, long = false)
            }
            Spacer(GlanceModifier.height(2.dp))
            Hero(f)
        }
        if (withChart) {
            Spacer(GlanceModifier.defaultWeight())
            Chart(look, f, 38)
            Stamp(f)
        }
    }
}

@Composable
private fun MediumFace(look: WidgetLook, f: FacePlan) {
    Row(GlanceModifier.fillMaxSize()) {
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Eyebrow("Today")
            Spacer(GlanceModifier.height(3.dp))
            Hero(f)
            Delta(f)
            Spacer(GlanceModifier.defaultWeight())
            Chart(look, f, 38)
        }
        Spacer(GlanceModifier.width(14.dp))
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Row(GlanceModifier.fillMaxWidth()) {
                Spacer(GlanceModifier.defaultWeight())
                Wordmark(look, 56, 14)
            }
            Spacer(GlanceModifier.defaultWeight())
            for (s in f.stats) {
                Stat(s)
                Spacer(GlanceModifier.height(7.dp))
            }
            Stamp(f)
        }
    }
}

@Composable
private fun LargeFace(look: WidgetLook, f: FacePlan) {
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(GlanceModifier.defaultWeight()) {
                Eyebrow("Today")
                Spacer(GlanceModifier.height(2.dp))
                Hero(f)
                Delta(f)
            }
            Spacer(GlanceModifier.width(14.dp))
            Column(GlanceModifier.defaultWeight(), horizontalAlignment = Alignment.End) {
                Wordmark(look, 64, 16)
                Spacer(GlanceModifier.height(6.dp))
                Chart(look, f, 34)
            }
        }
        Spacer(GlanceModifier.height(10.dp))
        Row(GlanceModifier.fillMaxWidth()) {
            for (s in f.stats) { Column(GlanceModifier.defaultWeight()) { Stat(s) } }
        }
        if (f.needs.isNotEmpty()) Section("Needs you", R.drawable.ic_symbol_pending_actions) { f.needs.forEach { NeedRow(look, it) } }
        if (f.recent.isNotEmpty()) Section("Recent sales", R.drawable.ic_symbol_receipt_long) { f.recent.forEach { SaleRow(look, it) } }
        if (f.needs.isEmpty() && f.recent.isEmpty() && f.supporting.isNotEmpty()) {
            Spacer(GlanceModifier.height(8.dp))
            f.supporting.chunked(f.columns).forEach { row ->
                Row(GlanceModifier.fillMaxWidth().padding(bottom = 6.dp)) {
                    row.forEach { fig -> Column(GlanceModifier.defaultWeight()) { Cell(fig) } }
                    repeat(f.columns - row.size) { Spacer(GlanceModifier.defaultWeight()) }
                }
            }
        }
        Spacer(GlanceModifier.defaultWeight())
        f.note?.let { Note(it) }
    }
}

// ---- Pieces ----

/** A label: Material's labelMedium, sentence case, the quiet ink. */
@Composable
private fun Eyebrow(text: String) {
    Text(text, style = TextStyle(color = inkQuiet, fontSize = 11.sp, fontWeight = FontWeight.Medium), maxLines = 1)
}

/** The business's name in its primary, labelMedium: what tells two businesses apart on one widget. */
@Composable
private fun NameTag(f: FacePlan, modifier: GlanceModifier = GlanceModifier) {
    Text(f.name, modifier, style = TextStyle(color = accent, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 1)
}

/** "Rs" small and quiet, the number large. */
@Composable
private fun Hero(f: FacePlan) {
    Row(verticalAlignment = Alignment.Bottom) {
        f.heroPrefix?.let {
            Text(it, style = TextStyle(color = inkQuiet, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 1)
            Spacer(GlanceModifier.width(3.dp))
        }
        Text(f.heroNumber, style = TextStyle(color = ink, fontSize = f.heroSp.sp, fontWeight = FontWeight.Bold), maxLines = 1)
    }
}

/** "▲ 12% vs last week": the settled tone up, the late tone down, nothing when there is nothing to compare. */
@Composable
private fun Delta(f: FacePlan, long: Boolean = true) {
    val d = f.delta ?: return
    Row {
        Text(d.text, style = TextStyle(color = LocalWidgetColors.current.tone(if (d.up) Tone.settled else Tone.late), fontSize = 11.sp, fontWeight = FontWeight.Bold), maxLines = 1)
        if (long) Text("  vs last week", style = TextStyle(color = inkQuiet, fontSize = 11.sp), maxLines = 1)
    }
}

@Composable
private fun Stat(s: WidgetStat) {
    Column {
        Text(s.value, style = TextStyle(color = if (s.late) LocalWidgetColors.current.tone(Tone.late) else ink, fontSize = 14.sp, fontWeight = FontWeight.Bold), maxLines = 1)
        Text(s.label, style = TextStyle(color = inkQuiet, fontSize = 11.sp), maxLines = 1)
    }
}

/** A group of lines in a tonal inset (the rule that used to part them is gone): a symbol and a title in the primary, then the rows. */
@Composable
private fun Section(title: String, icon: Int, rows: @Composable () -> Unit) {
    Spacer(GlanceModifier.height(7.dp))
    val colors = LocalWidgetColors.current
    Column(GlanceModifier.fillMaxWidth().background(colors.color { it.surfaceContainerHighest }).innerCorner().padding(horizontal = 10.dp, vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(ImageProvider(icon), null, GlanceModifier.size(14.dp), colorFilter = ColorFilter.tint(accent))
            Spacer(GlanceModifier.width(5.dp))
            Text(title, style = TextStyle(color = accent, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 1)
        }
        Spacer(GlanceModifier.height(2.dp))
        rows()
    }
}

@Composable
private fun NeedRow(look: WidgetLook, n: WidgetNeed) {
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 1.dp).then(open(look, n.path))) {
        Text(n.title, GlanceModifier.defaultWeight(), style = TextStyle(color = ink, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 1)
        Text(n.detail, style = TextStyle(color = toneOf(n.tone), fontSize = 12.sp), maxLines = 1)
    }
}

@Composable
private fun SaleRow(look: WidgetLook, r: WidgetSale) {
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 1.dp).then(open(look, r.path)), verticalAlignment = Alignment.CenterVertically) {
        Text(r.title, GlanceModifier.defaultWeight(), style = TextStyle(color = ink, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 1)
        Text(r.whenText + "  ", style = TextStyle(color = inkQuiet, fontSize = 11.sp), maxLines = 1)
        Text(r.amount, style = TextStyle(color = ink, fontSize = 12.sp, fontWeight = FontWeight.Bold), maxLines = 1)
    }
}

@Composable
private fun Cell(f: WidgetFigure) {
    Text(f.label, style = TextStyle(color = inkQuiet, fontSize = 11.sp), maxLines = 1)
    Text(f.value, style = TextStyle(color = ink, fontSize = 14.sp, fontWeight = FontWeight.Bold), maxLines = 1)
}

/** The team note, pinned. */
@Composable
private fun Note(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(ImageProvider(R.drawable.ic_symbol_push_pin), null, GlanceModifier.size(14.dp), colorFilter = ColorFilter.tint(inkQuiet))
        Spacer(GlanceModifier.width(5.dp))
        Text(text, style = TextStyle(color = inkQuiet, fontSize = 11.sp), maxLines = 1)
    }
}

/** Quiet: only when the figures are not from today, or the ERP could not be reached. */
@Composable
private fun Stamp(f: FacePlan) {
    f.stamp?.let { Text(it, style = TextStyle(color = inkQuiet, fontSize = 11.sp), maxLines = 1) }
}

/** The week's line (small, half) or bars (medium, large), drawn as a bitmap in the business's accent. */
@Composable
private fun Chart(look: WidgetLook, f: FacePlan, heightDp: Int) {
    if (f.chart == ChartKind.None) return
    val context = LocalContext.current
    val density = context.resources.displayMetrics.density
    val color = LocalWidgetColors.current.scheme(context.isNight()).primary.toArgb()
    val bitmap = remember(f.days, f.chart, color, heightDp) {
        val h = (heightDp * density).toInt()
        val w = (130 * density).toInt()
        if (f.chart == ChartKind.Sparkline) WidgetCharts.sparklineBitmap(f.days, w, h, color) else WidgetCharts.barsBitmap(f.days, w, h, color)
    }
    Image(ImageProvider(bitmap), "Takings, last 7 days", GlanceModifier.fillMaxWidth().height(heightDp.dp), contentScale = ContentScale.Fit)
}

/** The business's wordmark: the bundled one for a built-in, its name in its accent for any other. */
@Composable
private fun Wordmark(look: WidgetLook, w: Int, h: Int) {
    val res = when (look.brand) {
        "taheri" -> R.drawable.brand_logo_taheri
        "mina" -> R.drawable.brand_logo_mina
        else -> null
    }
    if (res != null) Image(ImageProvider(res), look.name, GlanceModifier.width(w.dp).height(h.dp), contentScale = ContentScale.Fit)
    else Text(look.name, style = TextStyle(color = accent, fontSize = (h * 0.7f).sp, fontWeight = FontWeight.Bold), maxLines = 1)
}
