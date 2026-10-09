import SwiftUI

/// The Marketing group: the Posts hub, the Ads overview and campaigns, and the Website menu, read natively.
/// The Website pages are native too: Add photos, Edit a piece (its words; re-making the photo opens the ERP's
/// square editor), Photo weights and Investments. So are Ads' New ad, Ad sets, Audiences, Rules and Setup (Ads*.swift,
/// on the web's own /api/ads routes). What designs a post stays the ERP's own page, opened in the app by its path
/// with no route here: Post a piece (/website/post) and Ads' Studio (and New ad handed a Studio ad, `?studio=`, whose
/// pictures wait in the browser's own storage).
/// "/posts?web=1" and "/ads/campaigns?web=1" open the web page where it does more (the tray that sends,
/// the campaign menu that changes budgets).
///
/// The Website menu lives at /marketing/website, not at /website/photos, which is the real Add photos page.
/// A piece's own screen carries its site key in the query (/marketing/piece?id=…), which `exact` would drop.
enum MarketingRoutes {
    static var all: [ScreenRoute] {
        let piece = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == MarketingKit.piecePrefix },
            make: { (path: String) in AnyView(PostPieceScreen(id: MarketingKit.pieceId(in: path) ?? "")) }
        )
        // Edit a piece: the grid, or one piece when the path names it (/website/edit?id=…, as the web's own links do).
        let editPiece = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == "/website/edit" },
            make: { (path: String) in
                if let id = MarketingKit.pieceId(in: path), !id.isEmpty { return AnyView(WebsiteEditPieceScreen(id: id)) }
                return AnyView(WebsiteEditScreen())
            }
        )
        // New ad and the ad set designer read their query (?piece=, ?from=, ?campaign=, ?ads=).
        let newAd = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == "/ads/new" && AdsQuery.value("studio", in: path) == nil },
            make: { (path: String) in AnyView(AdsNewAdScreen(path: path)) }
        )
        let adSets = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == "/ads/adset" },
            make: { (path: String) in AnyView(AdsAdSetsScreen(path: path)) }
        )
        return [
            .exact("/posts") { PostsHub() },
            .exact(MarketingKit.piecesPath) { PostPiecesScreen() },
            piece,
            .exact("/ads") { AdsOverviewScreen() },
            .exact("/ads/campaigns") { AdsCampaignsScreen() },
            newAd,
            adSets,
            .exact("/ads/audiences") { AdsAudiencesScreen() },
            .exact("/ads/rules") { AdsRulesScreen() },
            .exact("/ads/setup") { AdsSetupScreen() },
            .exact(MarketingKit.websitePath) { WebsiteMenu() },
            // The Website pages, native (Website*.swift), on the web's own routes; /website/post stays the ERP's.
            .exact("/website/photos") { WebsitePhotosScreen() },
            editPiece,
            .exact("/website/weights") { WebsiteWeightsScreen() },
            .exact("/website/investments") { WebsiteInvestmentsScreen() },
            // From the website is the Posts hub now; the web redirects the old address there.
            .exact("/website/from-site") { PostsHub() },
        ]
    }
}
