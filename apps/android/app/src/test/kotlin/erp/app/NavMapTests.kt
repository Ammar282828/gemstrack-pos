package erp.app

import erp.app.nav.NavIcon
import erp.app.nav.NavMap
import erp.core.Json
import java.io.File
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NavMapTests {
    // The two houses' real maps, the very files the app bundles (made of the ERP's own menu: no data in them).
    private fun file(house: String) = File("../../iphone/App/Resources/nav-$house.json")
    private fun real(house: String) = NavMap.parse(file(house).readText())!!

    private val small = NavMap.parse(
        """
        {"groups":[{"key":"home","label":""},{"key":"sales","label":"Sales"},{"key":"marketing","label":"Marketing"},{"key":"money","label":"Money"}],
         "newSale":{"id":"new-sale","group":"sales","href":"/new","label":"New sale","icon":"CirclePlus","staff":true,"keywords":["sale"]},
         "entries":[
           {"id":"home","group":"home","href":"/","label":"Home","staff":true,"tabs":[
              {"href":"/","label":"Overview","staff":true},{"href":"/today","label":"Today's cash"}]},
           {"id":"orders","group":"sales","href":"/orders","label":"Orders","staff":true,"keywords":["order"],"count":"online"},
           {"id":"invoices","group":"sales","href":"/invoices","label":"Invoices","staff":true,"match":["/cart"]},
           {"id":"stock","group":"sales","href":"/products","label":"Stock","staff":true,"tabs":[
              {"href":"/products","label":"Pieces","staff":true},{"href":"/settings/printer","label":"Labels","staff":true}]},
           {"id":"money","group":"money","href":"/money","label":"Money","tabs":[{"href":"/money","label":"Hisaab"}]},
           {"id":"posts","group":"marketing","href":"/posts","label":"Posts","keywords":["instagram"]},
           {"id":"ads","group":"marketing","href":"/ads","label":"Ads","pages":[{"href":"/ads/new","label":"New ad"}]}],
         "settings":{"id":"settings","group":"home","href":"/settings","label":"Settings"},
         "actions":[{"href":"/new","label":"New sale","staff":true},{"href":"/orders/add","label":"New order","staff":true},{"href":"/karigars/add","label":"New karigar"}]}
        """.trimIndent(),
    )!!

    @Test fun anOwnerSeesEverything() {
        val m = small.visible("owner")
        assertEquals(small, m)
        assertNotNull(m.newSale)
        assertNotNull(m.settings)
        assertEquals(7, m.entries.size)
    }

    @Test fun staffSeeOnlyWhatIsMarkedForThemAndNoSettingsOrNewSale() {
        val m = small.visible("staff")
        assertEquals(listOf("home", "orders", "invoices", "stock"), m.entries.map { it.id })
        assertNull(m.newSale)
        assertNull(m.settings)
        // Today's cash is the owners': Home keeps one tab
        assertEquals(listOf("/"), m.entries.first().tabs!!.map { it.href })
        // New sale is out of Create too
        assertEquals(listOf("/orders/add"), m.actions.map { it.href })
    }

    @Test fun anEntryWhoseTabsAreAllTheOwnersIsNotTheirs() {
        val tabsOwnersOnly = NavMap.parse(
            """{"groups":[],"entries":[{"id":"x","group":"g","href":"/x","label":"X","staff":true,"tabs":[{"href":"/x","label":"X"}]}],"actions":[]}""",
        )!!
        assertTrue(tabsOwnersOnly.visible("staff").entries.isEmpty())
    }

    @Test fun anEntryOpensTheFirstTabAStaffMemberMaySee() {
        val m = NavMap.parse(
            """{"groups":[],"entries":[{"id":"x","group":"g","href":"/x","label":"X","staff":true,"tabs":[
               {"href":"/x","label":"Owners"},{"href":"/y","label":"All","staff":true}]}],"actions":[]}""",
        )!!
        assertEquals("/y", m.visible("staff").entries.single().href)
    }

    @Test fun marketingGetsItsGroupWholeAndNothingToCreate() {
        val m = small.visible("marketing")
        assertEquals(listOf("posts", "ads"), m.entries.map { it.id })
        assertEquals(listOf("/ads/new"), m.entries.last().pages!!.map { it.href })
        assertNull(m.newSale)
        assertNull(m.settings)
        assertTrue(m.actions.isEmpty())
    }

    @Test fun anUnknownRoleIsStaffNotOwner() {
        assertEquals(small.visible("staff"), small.visible("none"))
    }

    @Test fun aPathBelongsToTheEntryThatClaimsItLongest() {
        val m = small.visible("owner")
        assertEquals("home", m.entry("/")?.id)
        assertEquals("orders", m.entry("/orders/ORD-1")?.id)
        assertEquals("invoices", m.entry("/cart")?.id, "an old link: nav.ts `match`")
        assertEquals("stock", m.entry("/settings/printer")?.id, "Labels is Stock's, not Settings'")
        assertEquals("settings", m.entry("/settings/rates")?.id)
        assertEquals("ads", m.entry("/ads/new?x=1")?.id)
        assertEquals("home", m.entry("/today")?.id)
        assertNull(m.entry("/elsewhere"))
    }

    @Test fun searchFindsByNameKeywordAndRow() {
        val m = small.visible("owner")
        assertEquals(setOf("/orders"), m.search("order").filter { it.place.label == "Orders" }.map { it.place.href }.toSet())
        assertTrue(m.search("INSTAGRAM").any { it.place.href == "/posts" })
        // a tab is found under the row it sits in
        assertTrue(m.search("labels").any { it.place.href == "/settings/printer" && it.entry?.id == "stock" })
        assertTrue(m.search("stock").any { it.place.href == "/settings/printer" })
        assertTrue(m.search("zzz").isEmpty())
        assertTrue(m.search("  ").isEmpty())
        // each place once
        assertEquals(m.allPlaces.map { it.id }.distinct().size, m.allPlaces.size)
    }

    @Test fun theRealMapsReadAndStaffNeverSeeSettingsOrTheOwnersMoney() {
        for (house in listOf("taheri", "mina")) {
            val m = real(house)
            assertTrue(m.entries.isNotEmpty(), house)
            assertNotNull(m.newSale)
            assertNotNull(m.settings)
            val staff = m.visible("staff")
            assertNull(staff.settings)
            assertTrue(staff.entries.all { it.staff == true })
            assertTrue(staff.entries.flatMap { it.tabs ?: emptyList() }.all { it.staff == true })
            val marketing = m.visible("marketing")
            assertTrue(marketing.entries.isNotEmpty() && marketing.entries.all { it.group == "marketing" })
            // every place under a row of the real maps resolves to a row (the actions and New sale sit under none)
            for (hit in m.allPlaces.filter { it.entry != null && it.entry.id != "new-sale" }) assertNotNull(m.entry(hit.place.href), "${hit.place.href} in $house")
        }
    }

    @Test fun everyIconBothMapsUseIsDrawn() {
        val names = mutableSetOf<String>()
        fun walk(v: Any?) {
            when (v) {
                is Map<*, *> -> { (v["icon"] as? String)?.let(names::add); v.values.forEach(::walk) }
                is List<*> -> v.forEach(::walk)
            }
        }
        for (house in listOf("taheri", "mina")) walk(Json.parse(file(house).readText()))
        assertTrue(names.size > 30, "the maps use many icons")
        assertEquals(emptySet(), names - NavIcon.known, "lucide names with no Material icon")
    }
}
