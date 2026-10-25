package erp.app.screens.ads

import erp.app.nav.ScreenRoute

/**
 * Ads (src/app/ads): Overview, Campaigns, an object's own page, New ad, the ad set designer, Audiences, Rules, A/B tests and Setup,
 * on the addresses MarketingRoutes.swift registers for them. Ads → Studio (`/ads/studio`) is Studio's, not listed here.
 * New ad, the designer, Campaigns and an object's page read their query (?piece=, ?from=, ?campaign=, ?ads=, ?studio=,
 * ?ad=, ?level=&id=), so they match the bare path and take the whole one.
 */
val AdsRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/ads") { AdsOverviewScreen() },
    ScreenRoute({ ScreenRoute.bare(it) == "/ads/campaigns" }, { AdsCampaignsScreen(it) }),
    ScreenRoute({ ScreenRoute.bare(it) == "/ads/object" }, { AdsObjectScreen(it) }),
    ScreenRoute({ ScreenRoute.bare(it) == "/ads/new" }, { AdsNewAdScreen(it) }),
    ScreenRoute({ ScreenRoute.bare(it) == "/ads/adset" }, { AdsAdSetsScreen(it) }),
    ScreenRoute.exact("/ads/audiences") { AdsAudiencesScreen() },
    ScreenRoute.exact("/ads/rules") { AdsRulesScreen() },
    ScreenRoute.exact("/ads/tests") { AdsTestsScreen() },
    ScreenRoute.exact("/ads/setup") { AdsSetupScreen() },
)
