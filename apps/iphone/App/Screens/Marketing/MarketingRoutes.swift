import SwiftUI

/// The Marketing group: the Posts hub, the Ads overview and campaigns, and the Website menu, read natively.
/// What makes or sends things stays the ERP's own page, opened in the app by its path with no route here:
/// Post a piece (/website/post), Investments, Add photos, Edit a piece, Photo weights, and Ads' Studio,
/// New ad and Setup. "/posts?web=1" and "/ads/campaigns?web=1" open the web page where it does more
/// (the tray that sends, the campaign menu that changes budgets).
///
/// The Website menu lives at /marketing/website, not at /website/photos, which is the real Add photos page.
/// A piece's own screen carries its site key in the query (/marketing/piece?id=…), which `exact` would drop.
enum MarketingRoutes {
    static var all: [ScreenRoute] {
        let piece = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == MarketingKit.piecePrefix },
            make: { (path: String) in AnyView(PostPieceScreen(id: MarketingKit.pieceId(in: path) ?? "")) }
        )
        return [
            .exact("/posts") { PostsHub() },
            .exact(MarketingKit.piecesPath) { PostPiecesScreen() },
            piece,
            .exact("/ads") { AdsOverviewScreen() },
            .exact("/ads/campaigns") { AdsCampaignsScreen() },
            .exact(MarketingKit.websitePath) { WebsiteMenu() },
        ]
    }
}
