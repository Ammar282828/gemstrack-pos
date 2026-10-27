package erp.app.screens.design

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenRoute
import erp.app.nav.ScreenTitle
import erp.app.screens.marketing.MarketingKit
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.rememberDesignEngine
import erp.app.ui.ChipRow
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.NotAvailableState
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/**
 * Design (docs/features/design.md; DesignRoutes.swift): one place to make anything and keep it. `/design` and its `?v=` sections are
 * native here. The earlier Post a piece screen keeps its route (`/website/post`) in Marketing, as on the iPhone; nothing in the app
 * goes to `/design/classic/{post,ad}`: the photograph's AI tools and "Make the ad with AI" are the workspace's own (DesignAI).
 * Registered after the Marketing group, as the iPhone's NativeScreens has it.
 */
val DesignRoutes: List<ScreenRoute> = listOf(
    ScreenRoute({ ScreenRoute.bare(it) == "/design" }, { path -> DesignScreen(path) }),
)

/**
 * The screen: the section chip row exactly as the web's (Make · Photos · Board · Saved), and the section under it. Board and the
 * photo library are for owner and marketing (designGate 'ads'); staff get Make, Saved and the website's photographs.
 */
@Composable
fun DesignScreen(path: String, preset: DesignWorkspaceModel? = null) {
    ScreenTitle("Design")
    val session = LocalSession.current
    val role = session.role
    val access = DesignAccess(role)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val navigator = LocalNavigator.current
    val note = LocalNoteState.current
    val engine = rememberDesignEngine()
    val workspace = remember { preset ?: DesignWorkspaceModel(scope, engine, DesignDraftDisk.current(context), DesignDraftDisk.older(context)) }
    val start = remember { DesignStartModel() }
    val shelf = remember { DesignShelf() }
    var sectionRaw by rememberSaveable { mutableStateOf(MarketingKit.query("v", path) ?: "make") }
    var partRaw by rememberSaveable { mutableStateOf(MarketingKit.query("s", path) ?: "site") }
    var booted by rememberSaveable { mutableStateOf(false) }
    val current = DesignSection.of(sectionRaw, access)
    val part = DesignPhotoPart.of(partRaw, access)

    fun go(s: DesignSection) { sectionRaw = s.id }

    fun openSaved(r: DesignRecord) { scope.launch { if (workspace.open(r)) go(DesignSection.Make) } }

    fun openDraft(row: DesignDraftRow) {
        scope.launch {
            val ok = if (row.old != null) workspace.openOld(row.old) else workspace.openDraft(row.id)
            if (ok) go(DesignSection.Make)
        }
    }

    /** Continue on the start screen. */
    fun begin() {
        if (!(access.ads || start.kind != "ad")) return
        scope.launch {
            if (workspace.start(start.request)) { start.photo = null; start.fields = emptyMap(); start.price = ""; go(DesignSection.Make) }
        }
    }

    /** A photograph chosen in Photos: into the open design, else it waits on the start screen. */
    fun pick(photo: DesignStartPhoto) {
        if (workspace.isOpen) {
            scope.launch {
                try {
                    val data = photo.load()
                    workspace.replacePhoto(data, label = photo.label, fields = photo.fields, source = photo.source, isMarked = photo.marked)
                    go(DesignSection.Make)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    workspace.error = e.message
                }
            }
        } else {
            start.photo = photo
            go(DesignSection.Make)
        }
    }

    suspend fun startFromSite(id: String) {
        try {
            val pieces = MarketingRequest.get("/api/website/site-pieces?lean=1")["pieces"].array
            val piece = pieces.firstOrNull { it.s("id") == id } ?: throw erp.app.data.ErpApi.Failure(0, "That piece is no longer on the website.")
            val sizes = DesignKinds.card("piece").sizes.map { DesignSizeChoice(it) }
            if (workspace.start(DesignStartRequest("piece", sizes, DesignPhotoSources.site(piece)))) go(DesignSection.Make)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            workspace.error = "Couldn’t bring the piece in. " + (e.message ?: "")
        }
    }

    // The first time the screen opens: the engine's layouts, the shelf, then what the address asks for (?kind=, ?draft=, ?site=,
    // ?new=1, as the web answers them), else the design left open on this phone comes back.
    LaunchedEffect(access.post) {
        if (booted || !access.post) return@LaunchedEffect
        booted = true
        launch { workspace.loadCatalogue() }
        shelf.loadDrafts(context)
        MarketingKit.query("kind", path)?.let { kind -> if (kind in DesignKinds.valid && (access.ads || kind != "ad")) start.choose(kind) }
        // Ads → Plan's "Make this" (?play=): the Ad starts at the play's shape(s), layout and goal (the engine's own plays, as the web's PLAYS).
        MarketingKit.query("play", path)?.let { id ->
            if (access.ads) {
                workspace.loadCatalogue()
                workspace.catalogue["plays"].array.firstOrNull { it.s("id") == id }?.let { start.usePlay(it) }
            }
        }
        val draft = MarketingKit.query("draft", path)
        val site = MarketingKit.query("site", path)
        when {
            draft != null -> {
                val row = shelf.draftRows.firstOrNull { it.id == draft }
                if (row != null) openDraft(row) else workspace.error = "That draft could not be opened. It may have been cleared from this phone."
            }
            site != null -> startFromSite(site)
            MarketingKit.query("new", path) == "1" -> workspace.close()
            // A kind or a play asked for the start screen; only a plain visit brings the design left open back.
            MarketingKit.query("kind", path) == null && MarketingKit.query("play", path) == null -> {
                if (House.isDemo && MarketingKit.query("open", path) == "demo") {
                    // The demo opens a made-up design (and a sheet, if the address asks for one) so every part of Design can be seen.
                    DesignDemo.open(workspace, engine)
                    when (MarketingKit.query("sheet", path)) {
                        "publish" -> DesignHooks.publish(workspace)
                        "resize" -> DesignHooks.resize(workspace)
                    }
                } else workspace.resume()
            }
        }
    }
    LaunchedEffect(workspace, note) {
        workspace.speak = { n -> note.show(n) }
        start.speak = workspace.speak
        // A design started from elsewhere (a flat picture rebuilt as layers) lands in the workspace like any other.
        start.launch = { req -> scope.launch { if (workspace.start(req)) { start.photo = null; start.fields = emptyMap(); start.price = ""; go(DesignSection.Make) } } }
    }
    LaunchedEffect(workspace.route) { workspace.route?.let { navigator.open(it); workspace.route = null } }
    DisposableEffect(workspace) { onDispose { ErpApp.scope.launch { workspace.flush() } } }

    // The page's sections are all here (Make, Photos, Board, Saved, and the workspace's Resize, Publish and AI tools), so there is
    // no ERP page to fall back on except the Board; the menu is the open design's.
    if (workspace.isOpen && current == DesignSection.Make) {
        ScreenActions {
            var menu by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Symbols.MoreVert, "More") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Resize…") }, leadingIcon = { Icon(Symbols.OpenInFull, null) }, onClick = { menu = false; go(DesignSection.Make); DesignHooks.resize(workspace) })
                    DropdownMenuItem(text = { Text("Close this design") }, leadingIcon = { Icon(Symbols.Close, null) }, onClick = { menu = false; scope.launch { workspace.close(); shelf.loadDrafts(context); go(DesignSection.Make) } })
                }
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        if (!access.post) {
            NotAvailableState("Design is for the shop’s team", why = "Sign in with an owner, staff or marketing account to make posts and ads.", icon = Symbols.Lock)
        } else {
            Column(Modifier.fillMaxSize()) {
                ChipRow(Modifier.padding(vertical = 4.dp)) {
                    for (s in DesignSection.offered(access)) FilterChip(s.title, chosen = current == s, onClick = { go(s) })
                }
                if (workspace.isOpen && current != DesignSection.Make) {
                    Row(
                        Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp).ledgerCard(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("“${workspace.work?.displayName ?: ""}” is open.", Modifier.weight(1f), maxLines = 1, style = MaterialTheme.typography.bodyMedium)
                        OutlinedButton(onClick = { go(DesignSection.Make) }) { Text("Back to it") }
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (current) {
                        DesignSection.Make ->
                            if (workspace.isOpen) {
                                DesignWorkspaceView(workspace, access, onClose = { scope.launch { workspace.close(); shelf.loadDrafts(context) } }, onChangePhoto = { go(DesignSection.Photos) })
                            } else {
                                DesignStartView(
                                    start, access, role, shelf, workspace.starting, onBrowse = { go(DesignSection.Photos) }, onBegin = ::begin,
                                    onOpenDraft = ::openDraft, onOpenSaved = ::openSaved, onSeeAll = { go(DesignSection.Saved) },
                                )
                            }
                        DesignSection.Photos -> DesignPhotosView(access, part, { partRaw = it.id }, ::pick)
                        DesignSection.Board -> DesignBoardSection()
                        DesignSection.Saved -> DesignSavedView(shelf, ::openSaved, ::openDraft, adsOk = access.ads)
                    }
                }
            }
        }
        if (workspace.starting) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                Box(Modifier.clip(Radius.cardShape).background(ErpColors.card).padding(20.dp)) { SkeletonLoading(label = "Opening…") }
            }
        }
    }

    workspace.sheet?.let { sheet -> DesignSheetHost(sheet, workspace.speak) { workspace.sheet = null } }
    FailureAlert(workspace.error, onDismiss = { workspace.error = null }, title = "Could not finish")
}

/**
 * Board (owner and marketing): the Ad studio's board is the canvas of the web (and the MCP agent's); the phone has no native board
 * yet, so it opens the ERP's own page for it. Everything else in Design is native.
 */
@Composable
fun DesignBoardSection() {
    val navigator = LocalNavigator.current
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("The Board", style = MaterialTheme.typography.titleMedium)
            Text(
                "The endless canvas where the ad designs sit side by side, with Let it cook and the shop’s agent. It is the ERP’s own page on this phone for now.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = { navigator.open("/design?v=board&web=1") }, Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)) {
                Icon(Symbols.Public, null, Modifier.size(18.dp))
                Text("Open the Board", Modifier.padding(start = 8.dp))
            }
        }
    }
}

