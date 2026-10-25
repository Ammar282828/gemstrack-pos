package erp.app.screens.settings

import erp.core.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Selling on the website: the document as the page reads it and the write as the iPhone sends it (WebsiteSellingSettings.swift). */
class WebsiteSellingLogicTests {
    private fun config(json: String): WebsiteSellingConfig =
        WebsiteSellingConfig.fromMap(@Suppress("UNCHECKED_CAST") (Json.parse(json) as Map<String, Any?>))

    @Test fun aShopWithNoDocumentReadsAsThePagesDefaults() {
        val c = config("{}")
        assertFalse(c.enabled)
        assertEquals(WebsitePricing("21k", 0.0, 0.0, 0.0), c.defaultPricing)
        assertEquals("enquire", c.diamondPolicy)
        assertEquals("18k", c.palladiumKarat)
        assertEquals("", c.posCategoryId)
        // Selling cannot start without a category and a making charge: the page says which.
        assertEquals(listOf("an ERP category for website products", "a default making charge per gram"), c.missing)
    }

    @Test fun theStoredDocumentIsReadLeniently() {
        val c = config(
            """{"enabled":true,"defaultPricing":{"karat":"22k","wastagePercentage":"5","makingChargesPerGram":1200},
               "categoryPricing":{"Rings":{"karat":"18k","stoneChargesDefault":500},"Broken":"x"},
               "diamondPolicy":"gold_only","diamondChargesDefault":25000,"palladiumKarat":"12k","deliveryCharge":350,
               "freeDeliveryOver":0,"maxRateAgeHours":12,"posCategoryId":"rings","updatedAt":"2026-10-20T08:00:00.000Z"}""",
        )
        assertTrue(c.enabled)
        assertEquals(WebsitePricing("22k", 5.0, 1200.0, 0.0), c.defaultPricing)
        // A row that is not an object is dropped; a row sets only what differs.
        assertEquals(mapOf("Rings" to WebsitePricing("18k", null, null, 500.0)), c.categoryPricing)
        assertEquals("gold_only", c.diamondPolicy)
        assertEquals("12k", c.palladiumKarat)
        // A threshold of 0 is no threshold.
        assertNull(c.freeDeliveryOver)
        assertEquals(12.0, c.maxRateAgeHours)
        assertTrue(c.missing.isEmpty())
    }

    @Test fun saveSendsTheWholeDocumentAsThePageSavesIt() {
        val c = WebsiteSellingConfig(
            enabled = true,
            defaultPricing = WebsitePricing("21k", 3.0, 900.0, 0.0),
            categoryPricing = mapOf("Bangles" to WebsitePricing(null, null, 1100.0, null)),
            diamondPolicy = "gold_only", diamondChargesDefault = 20000.0, palladiumKarat = "18k", deliveryCharge = 300.0,
            freeDeliveryOver = 150000.0, maxRateAgeHours = null, posCategoryId = "rings",
        )
        val sent = WebsiteSelling.save(c, "seq-1")
        assertEquals(setOf("config", "seq"), sent.keys)
        assertEquals("seq-1", sent["seq"])
        assertEquals(
            mapOf(
                "enabled" to true,
                "defaultPricing" to mapOf("karat" to "21k", "wastagePercentage" to 3.0, "makingChargesPerGram" to 900.0, "stoneChargesDefault" to 0.0),
                "categoryPricing" to mapOf("Bangles" to mapOf("makingChargesPerGram" to 1100.0)),
                "diamondPolicy" to "gold_only", "diamondChargesDefault" to 20000.0, "palladiumKarat" to "18k", "deliveryCharge" to 300.0,
                "posCategoryId" to "rings", "freeDeliveryOver" to 150000.0,
            ),
            sent["config"],
        )
        // An empty threshold and an empty freshness are left out, not sent as 0.
        val bare = WebsiteSelling.save(c.copy(freeDeliveryOver = null), "s")["config"] as Map<*, *>
        assertFalse(bare.containsKey("freeDeliveryOver"))
        assertFalse(bare.containsKey("maxRateAgeHours"))
    }

    @Test fun theRowsKeepTheSitesOrderAndAnyOtherAfterThem() {
        val c = WebsiteSellingConfig(categoryPricing = mapOf("Zed" to WebsitePricing(), "Chains" to WebsitePricing(), "Rings" to WebsitePricing(), "Alpha" to WebsitePricing()))
        assertEquals(listOf("Rings", "Chains", "Alpha", "Zed"), c.overridden)
    }

    @Test fun aBoxReadsWhatWasTyped() {
        assertEquals(1250.0, WebsiteSelling.read("1,250", whole = false))
        assertEquals(13.0, WebsiteSelling.read("12.6", whole = true))
        assertEquals(2.5, WebsiteSelling.read("2.5", whole = false))
        // Empty or unreadable is none (the page leaves the box out), never a silent 0.
        assertNull(WebsiteSelling.read("", whole = false))
        assertNull(WebsiteSelling.read("abc", whole = false))
        assertEquals("1500", WebsiteSelling.plain(1500.0))
        assertEquals("2.5", WebsiteSelling.plain(2.5))
        assertEquals("", WebsiteSelling.plain(null))
    }

    @Test fun theSettingsListOpensTheNativeScreens() {
        assertTrue(SettingsRoutes.any { it.matches("/app/settings/website") })
        assertTrue(SettingsRoutes.any { it.matches("/settings/import-taheri") })
        assertFalse(erp.app.nav.ScreenRegistry.wantsWeb("/app/settings/website"))
        assertFalse(erp.app.nav.ScreenRegistry.wantsWeb("/settings/import-taheri"))
    }
}
