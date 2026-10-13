package erp.app.screens.marketing

import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenRoute

/**
 * The Marketing group's routes (MarketingRoutes.swift): Posts, Post a piece, the queue and the website's pieces. The
 * rest of the group (Ads, Studio, the other Website pages) is added to this list by the agents that port them, one line
 * each and before the closing "/website/from-site"; until then those paths fall through to the ERP's own page.
 */
val MarketingRoutes: List<ScreenRoute> = buildList {
    add(ScreenRoute.exact("/posts") { PostsHub() })
    // Post a piece: the designer, the story, the caption, the destinations (`?new=1`, `?studio=<key>`).
    add(ScreenRoute({ ScreenRoute.bare(it) == "/website/post" }, { path -> PostComposerScreen(path) }))
    // One queued piece, opened as a page (the hub opens the same as a sheet).
    add(
        ScreenRoute({ ScreenRoute.bare(it) == "/marketing/queue" }, { path ->
            val navigator = LocalNavigator.current
            PostQueueSheet(id = MarketingKit.query("id", path) ?: "", onClose = navigator::back, embedded = true)
        }),
    )
    add(ScreenRoute.exact(MarketingKit.piecesPath) { PostPiecesScreen() })
    add(ScreenRoute({ ScreenRoute.bare(it) == MarketingKit.piecePrefix }, { path -> PostPieceScreen(MarketingKit.pieceId(path) ?: "") }))
    // --- Ads, Studio and the Website pages go here. ---
    // From the website is the Posts hub now; the web redirects the old address there.
    add(ScreenRoute.exact("/website/from-site") { PostsHub() })
}
