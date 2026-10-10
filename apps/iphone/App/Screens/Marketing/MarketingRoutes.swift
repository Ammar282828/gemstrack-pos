import SwiftUI

/// Native Marketing screens use the ERP's existing authenticated routes.
/// Studio's shared board remains available while its canvas is being ported.
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
            matches: { (path: String) in ScreenRoute.bare(path) == "/ads/new" },
            make: { (path: String) in AnyView(AdsNewAdScreen(path: path)) }
        )
        let adSets = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == "/ads/adset" },
            make: { (path: String) in AnyView(AdsAdSetsScreen(path: path)) }
        )
        return [
            .exact("/posts") { PostsHub() },
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/website/post" }, make: { AnyView(PostComposerScreen(path: $0)) }),
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/marketing/queue" }, make: { AnyView(PostQueueSheet(id: AdsQuery.value("id", in: $0) ?? "", embedded: true)) }),
            .exact(MarketingKit.piecesPath) { PostPiecesScreen() },
            piece,
            .exact("/ads") { AdsOverviewScreen() },
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/ads/campaigns" }, make: { AnyView(AdsCampaignsScreen(path: $0)) }),
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/ads/object" }, make: { AnyView(AdsObjectScreen(path: $0)) }),
            ScreenRoute(matches: { ScreenRoute.bare($0) == "/ads/studio" }, make: { AnyView(StudioScreen(path: $0)) }),
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
