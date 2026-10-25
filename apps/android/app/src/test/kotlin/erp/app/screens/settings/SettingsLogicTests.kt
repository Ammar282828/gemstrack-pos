package erp.app.screens.settings

import erp.app.screens.NativeScreens
import erp.core.ERPDecode
import erp.core.Json
import erp.core.models.Customer
import erp.core.models.Karigar
import erp.core.models.PaymentMethod
import erp.core.models.Settings
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Settings group's pure rules (SettingsKit, ShopSettings, AlertSettings, BankAccountSettings … .swift). */
class SettingsLogicTests {
    private fun settings(json: String): Settings = Settings.fromMap(@Suppress("UNCHECKED_CAST") (Json.parse(json) as Map<String, Any?>))

    // MARK: updateSettings

    @Test fun anUpdateSettingsWriteIsThePatchAndASeq() {
        val p = SettingsWriter.payload(mapOf("notifEnabled" to true), "abc")
        assertEquals(mapOf("patch" to mapOf("notifEnabled" to true), "seq" to "abc"), p)
    }

    @Test fun aBlankSettingsDocumentReadsAsEveryFieldUnset() {
        assertEquals("", BlankSettings.shopName)
        assertFalse(BlankSettings.notifEnabled)
        assertTrue(BlankSettings.autoDraftForms)
        assertTrue(BlankSettings.paymentMethods.isEmpty())
    }

    // MARK: Shop

    @Test fun theNextNumbersAreSixDigits() {
        assertEquals("INV-000124", ShopLogic.next("INV", 123))
        assertEquals("REP-000001", ShopLogic.next("REP", 0))
        assertEquals("ORD-1000000", ShopLogic.next("ORD", 999_999))
    }

    @Test fun onlyWhatWasTypedIsSentAndTrimmed() {
        val base = ShopDraft("Demo Shop", "1 Road", "0300 0000000")
        val c = ShopLogic.commit(ShopDraft("  New Name ", "1 Road", "0300 0000000"), base)
        assertEquals(mapOf("shopName" to "New Name"), c.patch)
        assertNull(c.error)
        assertEquals(base.copy(name = "New Name"), c.next)
        assertTrue(ShopLogic.commit(base, base).patch.isEmpty())
    }

    @Test fun anAddressCanBeCleared() {
        val base = ShopDraft("Demo Shop", "1 Road", "x")
        assertEquals(mapOf("shopAddress" to ""), ShopLogic.commit(base.copy(address = "  "), base).patch)
    }

    @Test fun theShopNeedsAName() {
        val base = ShopDraft("Demo Shop", "", "")
        val c = ShopLogic.commit(base.copy(name = "   "), base)
        assertEquals("The shop needs a name.", c.error)
        assertTrue(c.patch.isEmpty())
    }

    @Test fun theBookReplacesATextOnlyWhereNothingWasTypedOverIt() {
        val base = ShopDraft("A", "B", "C")
        val typed = ShopDraft("A2", "B", "C")
        val fresh = ShopDraft("A", "B9", "C9")
        assertEquals(ShopDraft("A2", "B9", "C9"), ShopLogic.sync(typed, base, fresh))
    }

    @Test fun theModeAndStyleReadAsTheyDo() {
        assertEquals("default", ShopLogic.mode("default"))
        assertEquals("taheri", ShopLogic.mode("slate"))
        assertEquals("taheri", ShopLogic.mode(""))
        assertEquals("glass", ShopLogic.style("glass"))
        assertEquals("standard", ShopLogic.style(null))
    }

    // MARK: Alerts

    @Test fun aPakistanNumberStartsFromZeroOrThreeHundred() {
        assertEquals("923001234567", AlertsLogic.international("0300 1234567"))
        assertEquals("923001234567", AlertsLogic.international("3001234567"))
        assertEquals("923001234567", AlertsLogic.international("00923001234567"))
        assertEquals("923001234567", AlertsLogic.international("+92 300 1234567"))
    }

    @Test fun anotherCountryKeepsItsCode() {
        assertEquals("447911123456", AlertsLogic.international("+44 7911 123456"))
        assertEquals("447911123456", AlertsLogic.international("447911123456"))
    }

    @Test fun aNumberThatCannotBeOneIsRefused() {
        assertNull(AlertsLogic.international("123"))
        assertNull(AlertsLogic.international(""))
        assertNull(AlertsLogic.international("1234567890123456"))
    }

    @Test fun theClockReadsAndWrites() {
        assertEquals(9 to 5, AlertsLogic.parse("09:05"))
        assertEquals(9 to 0, AlertsLogic.parse("soon"))
        assertEquals("19:00", AlertsLogic.hhmm(19, 0))
        assertEquals("7:00 pm", AlertsLogic.say("19:00"))
        assertEquals("12:30 am", AlertsLogic.say("00:30"))
        assertEquals("12:00 pm", AlertsLogic.say("12:00"))
    }

    @Test fun onlyTheTimesThatChangedAreSent() {
        val s = settings("""{"notifEndOfDayTime":"18:00"}""")
        assertEquals(emptyMap(), AlertsLogic.timePatch("09:00", "18:00", "21:00", s))
        assertEquals(mapOf("notifDailyReportTime" to "22:15"), AlertsLogic.timePatch("09:00", "18:00", "22:15", s))
        assertEquals(mapOf("notifEndOfDayTime" to "19:00"), AlertsLogic.timePatch("09:00", "19:00", "21:00", s))
    }

    @Test fun everySwitchIsAFieldOfTheSettingsDocument() {
        val all = AlertsLogic.live + AlertsLogic.reports + AlertsLogic.checks
        assertEquals(14, all.size)
        assertEquals(all.size, all.map { it.key }.toSet().size)
        val on = settings("{" + all.joinToString(",") { "\"${it.key}\":true" } + "}")
        assertTrue(all.all { it.value(on) })
        assertTrue(all.none { it.value(BlankSettings) })
    }

    // MARK: Bank accounts

    @Test fun aBankAccountNeedsABankANameAndANumber() {
        val d = BankAccountDraft("pm-1", "Meezan", "Demo Shop", "0001", "")
        assertTrue(d.valid)
        assertFalse(d.copy(bankName = " ").valid)
        assertFalse(d.copy(accountName = "").valid)
        assertFalse(d.copy(accountNumber = "").valid)
    }

    @Test fun aBankAccountIsStoredTrimmedAndWithoutAnEmptyIban() {
        val d = BankAccountDraft("pm-1", " Meezan ", "Demo Shop", " 0001 ", "  ")
        assertEquals(mapOf("id" to "pm-1", "bankName" to "Meezan", "accountName" to "Demo Shop", "accountNumber" to "0001"), d.stored)
        assertEquals("PK00MEZN", d.copy(iban = " PK00MEZN ").stored["iban"])
    }

    @Test fun aNewAccountIsNamedByTheTime() {
        assertEquals("pm-1760000000000", BankAccountDraft.new(1_760_000_000_000).id)
    }

    @Test fun anAccountComesBackIntoTheForm() {
        val m = PaymentMethod("pm-2", "HBL", "Demo", "123", null)
        val d = BankAccountDraft.of(m)
        assertEquals(BankAccountDraft("pm-2", "HBL", "Demo", "123", ""), d)
        assertEquals("Remove HBL?", BankAccountDraft.removingTitle(listOf("HBL")))
        assertEquals("Remove these accounts?", BankAccountDraft.removingTitle(listOf("", "")))
        assertEquals(27, BankAccountDraft.banks.size)
    }

    // MARK: Labels

    @Test fun theStandardTagIsRead() {
        val std = LabelLogic.standard(Json.parse("""{"standard":{"id":"s","name":"Std","widthDots":664,"heightDots":296,"fields":[]}}"""))
        assertEquals("Std", std?.name)
        assertNull(LabelLogic.standard(Json.parse("{}")))
        // A standard tag with no size cannot be drawn or printed.
        assertNull(LabelLogic.standard(Json.parse("""{"standard":{"id":"s","name":"Std","widthDots":0,"heightDots":296,"fields":[]}}""")))
    }

    @Test fun theCsvIsNamedByTheUtcTime() {
        assertEquals("gemstrack_double_tag_export_2026-10-12-08-00-00.csv", LabelLogic.csvName(Instant.parse("2026-10-12T08:00:00Z")))
    }

    @Test fun thePiecesAPreviewOffersAreThoseWhoseNameOrSkuHoldTheSearch() {
        val ring = ERPDecode.model<erp.core.models.Product>(mapOf("sku" to "RIN-000001", "name" to "Rose ring"))!!
        val band = ERPDecode.model<erp.core.models.Product>(mapOf("sku" to "BND-000002", "name" to "Plain band"))!!
        assertEquals(listOf("RIN-000001"), LabelLogic.hits(listOf(ring, band), " rose ").map { it.sku })
        assertEquals(listOf("BND-000002"), LabelLogic.hits(listOf(ring, band), "bnd").map { it.sku })
        assertEquals(emptyList(), LabelLogic.hits(listOf(ring, band), "  "))
    }

    // MARK: Backups

    @Test fun theBackupListKeepsOnlyTheERPsOwnNames() {
        val l = BackupList.from(
            Json.parse("""{"fileName":"b.json","collections":[{"id":"customers","label":"Customers","description":"d","count":"1200"},{"id":"Bad-Name","label":"x"},{"id":"hisaab","label":"Hisaab","count":null},{"id":"given_items","label":"Given"}]}"""),
        )
        assertEquals("b.json", l.fileName)
        assertEquals(listOf("customers", "hisaab", "given_items"), l.collections.map { it.id })
        assertEquals(1200, l.collections[0].count)
        assertEquals(-1, l.collections[1].count)
        assertEquals("backup.json", BackupList.from(Json.parse("{}")).fileName)
    }

    @Test fun recordsAreGroupedAndAnErrorCountsNone() {
        assertEquals("1,234", BackupLogic.grouped(1234))
        assertEquals("err", BackupLogic.countText(-1))
        val cols = listOf(BackupCollection("a", "A", "", 10), BackupCollection("b", "B", "", -1), BackupCollection("c", "C", "", 5))
        assertEquals(10, BackupLogic.totalDocs(cols, setOf("a", "b")))
    }

    @Test fun theBackupFileIsThePagesFile() {
        val head = BackupLogic.fileHead("2026-10-12T08:00:00.000Z", listOf("customers", "hisaab"))
        val file = head + BackupLogic.entryHead("customers", true) + "{\"a\":{}}" + BackupLogic.entryHead("hisaab", false) + "{}" + BackupLogic.FILE_TAIL
        @Suppress("UNCHECKED_CAST") val parsed = Json.parse(file) as Map<String, Any?>
        assertEquals("2026-10-12T08:00:00.000Z", parsed["exportedAt"])
        assertEquals(listOf("customers", "hisaab"), parsed["collections"])
        assertEquals(listOf("customers", "hisaab"), (parsed["data"] as Map<*, *>).keys.toList())
    }

    @Test fun theDangerZoneAndRecoveryWords() {
        assertEquals("Delete 1 Product", BackupLogic.deleteLabel(0))
        assertEquals("Delete 3 Products", BackupLogic.deleteLabel(3))
        assertEquals(3, BackupLogic.deleteCount("3 pieces"))
        assertEquals(0, BackupLogic.deleteCount(""))
        assertEquals(mapOf("count" to 3, "deleteCode" to "1234"), BackupLogic.deletePayload(3, "1234"))
        assertEquals(mapOf("sku" to "S-1"), BackupLogic.reAddPayload("S-1"))
        assertEquals("Ring has been re-added to inventory with a new SKU (S-9).", BackupLogic.reAddDetail("Ring", "S-9"))
        assertEquals("Ring has been re-added to inventory with a new SKU.", BackupLogic.reAddDetail("Ring", null))
        assertEquals("https://console.cloud.google.com/firestore/databases/-default-/pitr?project=p1", BackupLogic.consoleUrl("p1"))
        assertEquals("https://console.cloud.google.com/", BackupLogic.consoleUrl(""))
    }

    // MARK: Contact import

    private val planJson = """
        {"plan":{"summary":{"cardsInFile":9,"ignoredUntagged":4,"mergedDuplicates":1,"settled":2,"conflicts":2},
          "fresh":[{"id":"f1","kind":"customer","name":"Amina","tags":["tj"],"phone":"0300 1111111","extraPhones":["0300 2222222"]},
                   {"id":"f2","kind":"karigar","name":"Bilal","tags":["karigar"],"extraPhones":[]}],
          "settled":[{"name":"Sana"},{"name":"Tariq"}],
          "conflicts":[{"id":"c1","kind":"customer","name":"Hira Khan","tags":["hom"],"phone":"0300 3333333","reason":"same_name","matches":[{"id":"x","kind":"customer","name":"Hira","phone":"0300 4444444"}]},
                       {"id":"c2","kind":"customer","name":"Zoya","reason":"same_phone","matches":[]},
                       {"id":"c3","kind":"customer","name":"Zoya Ali","phone":"0300 5555555","reason":"same_phone","matches":[{"id":"y","kind":"customer","name":"Zoya"}]}]},
         "defaults":{"c1":"add_phone","c3":"adopt_name"},"fingerprint":"fp1"}
    """.trimIndent()

    @Test fun theERPsContactPlanIsRead() {
        val a = ContactPlanAnswer.from(Json.parse(planJson))
        assertNotNull(a)
        assertEquals("fp1", a.fingerprint)
        assertEquals(mapOf("c1" to "add_phone", "c3" to "adopt_name"), a.defaults)
        assertEquals(listOf("f1", "f2"), a.plan.fresh.map { it.id })
        // A half-match with nobody to be a half-match of is not one.
        assertEquals(listOf("c1", "c3"), a.plan.conflicts.map { it.id })
        assertEquals(2, a.plan.summary.settled)
        assertNull(ContactPlanAnswer.from(Json.parse("""{"plan":{}}""")))
        assertNull(ContactPlanAnswer.from(null))
    }

    @Test fun eachKindOfHalfMatchOffersItsOwnAnswers() {
        val a = ContactPlanAnswer.from(Json.parse(planJson))!!
        val same = ContactImportLogic.options(a.plan.conflicts[0])
        assertEquals(listOf("add_phone", "add_separately", "skip"), same.map { it.value })
        val phone = ContactImportLogic.options(a.plan.conflicts[1])
        assertEquals(listOf("adopt_name", "add_separately", "skip"), phone.map { it.value })
        assertEquals("Renames to “Zoya Ali”", phone[0].hint)
    }

    @Test fun whatWouldHappenIsCounted() {
        val plan = ContactPlanAnswer.from(Json.parse(planJson))!!.plan
        assertEquals(2, ContactImportLogic.willAdd(plan, emptySet()))
        assertEquals(1, ContactImportLogic.willAdd(plan, setOf("f1")))
        assertEquals(0, ContactImportLogic.willResolve(plan, emptyMap()))
        assertEquals(1, ContactImportLogic.willResolve(plan, mapOf("c1" to "add_phone", "c3" to "skip")))
        assertEquals("9 contacts in the file · 4 personal contacts ignored · 1 duplicate(s) merged", ContactImportLogic.summaryLine(plan.summary))
        assertEquals("0300 1111111 (+1 more)", ContactImportLogic.freshPhones(plan.fresh[0]))
        assertEquals("no number", ContactImportLogic.freshPhones(plan.fresh[1]))
        assertEquals("0300 4444444", ContactImportLogic.bookPhones(plan.conflicts[0].matches[0]))
        assertEquals("no number", ContactImportLogic.bookPhones(plan.conflicts[1].matches[0]))
        assertEquals("Sana, Tariq", ContactImportLogic.settledLine(plan.settled))
    }

    @Test fun theAlreadySavedLineStopsAtThirty() {
        val many = (1..32).map { ContactSettled("N$it") }
        assertTrue(ContactImportLogic.settledLine(many).endsWith("N30 and 2 more"))
    }

    @Test fun theImportSendsTheFileAgainWithTheAnswers() {
        val body = ContactImportLogic.importBody("BEGIN:VCARD", "fp1", setOf("f2", "f1"), mapOf("c1" to "skip"))
        assertEquals(listOf("vcf", "fingerprint", "dropped", "choices"), body.keys.toList())
        assertEquals(listOf("f1", "f2"), body["dropped"])
        assertEquals(mapOf("kind" to "contacts", "vcf" to "x"), ContactImportLogic.planBody("x"))
        assertEquals("Import finished" to "3 added, 1 updated. 2 were already saved.", ContactImportLogic.finished(mapOf("added" to 3, "updated" to 1.0, "settled" to 2L), 9))
        assertEquals("Import finished" to "0 added, 0 updated. 9 were already saved.", ContactImportLogic.finished(emptyMap(), 9))
    }

    @Test fun anAddressBooksPicturesStayOnThePhone() {
        val card = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Altaf TJ\r\nPHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ\r\n SkZJRgABAQ\r\n\tmore\r\nitem1.PHOTO;X=1:abc\r\n def\r\nTEL;TYPE=CELL:0300 1234567\r\nLOGO:zz\r\nKEY:k\r\nSOUND:s\r\nNOTE:fine\r\nEND:VCARD\r\n"
        val out = VCards.withoutMedia(card)
        assertEquals("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Altaf TJ\r\nTEL;TYPE=CELL:0300 1234567\r\nNOTE:fine\r\nEND:VCARD\r\n", out)
    }

    @Test fun aFoldedLineOfAKeptPropertyIsKept() {
        val card = "FN:A very long\r\n name\r\nPHOTO:x\r\n y\r\nTEL:1\r\n"
        assertEquals("FN:A very long\r\n name\r\nTEL:1\r\n", VCards.withoutMedia(card))
    }

    @Test fun thePhonesContactsMakeTheCardsTheERPReads() {
        val text = VCards.fromContacts(
            listOf(
                VCards.DeviceContact("Altaf TJ", listOf("0300 1234567", "0300 1234567", " ")),
                VCards.DeviceContact("Two\nLines HOM", emptyList()),
                VCards.DeviceContact("  ", listOf("1")),
            ),
        )
        assertEquals(
            "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Altaf TJ\r\nTEL;TYPE=CELL:0300 1234567\r\nEND:VCARD\r\n" +
                "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Two Lines HOM\r\nEND:VCARD\r\n",
            text,
        )
        assertTrue(text.contains("BEGIN:VCARD"))
        assertEquals("", VCards.fromContacts(emptyList()))
    }

    // MARK: Hisaab import

    @Test fun aHisaabFileIsReadAsRowsAndARefusal() {
        val r = HisaabRead.from(
            Json.parse("""{"rows":[{"date":"2026-01-02","isValidDate":true,"description":"Cash","cashIn":"1,500","cashOut":0},{"date":"x","isValidDate":false,"description":"","cashIn":0,"cashOut":0}],"refusal":"Fix the dates."}"""),
        )
        assertNotNull(r)
        assertEquals(2, r.rows.size)
        assertEquals(1500.0, r.rows[0].cashIn)
        assertTrue(r.rows[0].fine)
        assertFalse(r.rows[1].fine)
        assertEquals("Fix the dates.", r.refusal)
        assertNull(HisaabRead.from("nope"))
    }

    @Test fun hisaabIsImportedOnlyForAPersonAndACleanFile() {
        val ok = HisaabRead(listOf(HisaabRow("2026-01-02", true, "x", 1.0, 0.0)), null)
        val who = HisaabPerson("c1", "Amina", "customer")
        assertTrue(HisaabImportLogic.canImport(ok, who, false, null))
        assertFalse(HisaabImportLogic.canImport(ok, null, false, null))
        assertFalse(HisaabImportLogic.canImport(ok, who, true, null))
        assertFalse(HisaabImportLogic.canImport(ok, who, false, "bad"))
        assertFalse(HisaabImportLogic.canImport(ok.copy(refusal = "no"), who, false, null))
        assertFalse(HisaabImportLogic.canImport(HisaabRead(emptyList(), null), who, false, null))
        assertEquals(mapOf("csv" to "c", "entityId" to "c1", "entityType" to "customer"), HisaabImportLogic.importBody("c", who))
        assertEquals(mapOf("kind" to "hisaab", "csv" to "c"), HisaabImportLogic.planBody("c"))
        assertEquals("4 transactions imported successfully. 0 failed.", HisaabImportLogic.complete(mapOf("imported" to 4), 9))
        assertEquals("9 transactions imported successfully. 0 failed.", HisaabImportLogic.complete(emptyMap(), 9))
    }

    @Test fun thePeopleAreCustomersAndKarigarsStillInTheBookByName() {
        val customers = listOf(
            customer("c1", "bilal", null), customer("c2", "Zara", null), customer("c3", "Removed", "2026-10-01T00:00:00.000Z"),
        )
        val karigars = listOf(karigar("k1", "Asif", null), karigar("k2", "Gone", "2026-10-01T00:00:00.000Z"))
        val people = HisaabImportLogic.people(customers, karigars)
        assertEquals(listOf("Asif", "bilal", "Zara"), people.map { it.name })
        assertEquals(listOf("karigar", "customer", "customer"), people.map { it.type })
        assertEquals(listOf("bilal"), HisaabImportLogic.shown(people, " BIL ").map { it.name })
        assertEquals(3, HisaabImportLogic.shown(people, "").size)
    }

    private fun customer(id: String, name: String, deleted: String?): Customer =
        Customer.fromMap(mapOf("id" to id, "name" to name, "deletedAt" to deleted))

    private fun karigar(id: String, name: String, deleted: String?): Karigar =
        Karigar.fromMap(mapOf("id" to id, "name" to name, "deletedAt" to deleted))

    // MARK: Shopify

    @Test fun writeAccessIncludesReadAccess() {
        val held = setOf("write_orders", "read_customers", "read_all_products")
        assertTrue(ShopifyLogic.holds(held, "read_orders"))
        assertTrue(ShopifyLogic.holds(held, "write_orders"))
        assertTrue(ShopifyLogic.holds(held, "read_customers"))
        assertFalse(ShopifyLogic.holds(held, "write_customers"))
        assertTrue(ShopifyLogic.holds(held, "read_products"))
        assertFalse(ShopifyLogic.holds(held, "write_products"))
        assertFalse(ShopifyLogic.holds(held, "read_draft_orders"))
    }

    @Test fun theMissingPermissionsAreListedInTheERPsOrder() {
        val held = setOf("write_orders", "write_customers", "write_products", "read_draft_orders")
        assertEquals(listOf("write_draft_orders"), ShopifyLogic.missing(held))
        assertEquals(8, ShopifyLogic.missing(emptySet()).size)
        assertEquals(listOf("read_all_orders", "read_inventory"), ShopifyLogic.extra(held + setOf("read_inventory", "read_all_orders")))
    }

    @Test fun theStatusIsReadLeniently() {
        val s = ShopifyStatus.from(Json.parse("""{"configured":true,"connected":true,"shop":"x.myshopify.com","scopes":["read_orders"],"webhooksHere":2,"webhooksTotal":"3"}"""))
        assertTrue(s.configured)
        assertEquals(listOf("read_orders"), s.scopes)
        assertEquals(3, s.webhooksTotal)
        assertEquals("Connected", ShopifyLogic.statusText(s))
        val bare = ShopifyStatus.from(Json.parse("""{"configured":false}"""))
        assertNull(bare.scopes)
        assertEquals("Not configured", ShopifyLogic.statusText(bare))
        assertEquals("Needs attention", ShopifyLogic.statusText(s.copy(connected = false)))
    }

    @Test fun onlyAMyshopifyDomainIsOfferedToReauthorize() {
        val s = ShopifyStatus.from(Json.parse("""{"configured":true,"shop":"demo-shop.myshopify.com"}"""))
        assertEquals("https://erp.example.shop/api/shopify/auth?shop=demo-shop.myshopify.com", ShopifyLogic.reauthorizeUrl(s, "https://erp.example.shop/"))
        assertNull(ShopifyLogic.reauthorizeUrl(s.copy(shop = "evil.example.com"), "https://erp.example.shop"))
        assertNull(ShopifyLogic.reauthorizeUrl(s.copy(shop = null), "https://erp.example.shop"))
    }

    @Test fun theOrdersAreReadAndTheListFiltered() {
        val orders = ShopifyLogic.orders(
            Json.parse("""[{"id":"1001","title":"#1001","subtitle":"Amina","date":"2026-10-01","amount":12000},{"id":1002,"title":"#1002","subtitle":"Bilal"},{"id":"0","title":"zero"},{"title":"no id"}]"""),
        )
        assertEquals(listOf("1001", "1002"), orders.map { it.id })
        assertEquals(12000.0, orders[0].amount)
        assertEquals(listOf("#1002"), ShopifyLogic.visible(orders, " bil ").map { it.title })
        assertEquals(2, ShopifyLogic.visible(orders, "").size)
        assertEquals("Import 2 orders · PKR 12,000?", ShopifyLogic.importTitle(2, 12000.0))
        assertEquals("Import 1 order · PKR 0?", ShopifyLogic.importTitle(1, 0.0))
    }

    @Test fun anOrderIdFromABigNumberIsNotRoundedThroughAnInt() {
        assertEquals("5123456789012", ShopifyLogic.orderId(5_123_456_789_012.0))
        assertEquals("", ShopifyLogic.orderId(null))
    }

    @Test fun theWebhooksAnswerIsSaidInWords() {
        assertEquals("Shopify answered; nothing to register.", ShopifyLogic.webhookMessage(emptyList(), emptyList()))
        assertEquals("Registered orders/create, orders/updated.", ShopifyLogic.webhookMessage(listOf("orders/create", "orders/updated"), emptyList()))
        assertEquals("Registered orders/create; already there: orders/updated.", ShopifyLogic.webhookMessage(listOf("orders/create"), listOf("orders/updated")))
        assertEquals("1 older order at or below #1000 is not offered; it predates the ERP.", ShopifyLogic.olderSkipped(1, 1000))
        assertEquals("3 older orders at or below #1000 are not offered; they predate the ERP.", ShopifyLogic.olderSkipped(3, 1000))
    }

    // MARK: Voice

    @Test fun theVoiceStatusSaysWhyItIsNotReady() {
        assertEquals(SettingsVoiceStatus(true, null), SettingsVoiceStatus.from(Json.parse("""{"ready":true}""")))
        assertEquals("no_credit", SettingsVoiceStatus.from(Json.parse("""{"ready":false,"reason":"no_credit"}""")).reason)
        assertEquals("refused", SettingsVoiceStatus.from(Json.parse("""{"error":"Sign in again."}""")).reason)
        assertEquals("unreachable", SettingsVoiceStatus.from(Json.parse("{}")).reason)
        assertEquals("The Google Cloud account is out of credit", VoiceWords.problemTitle("no_credit"))
        assertEquals("Could not reach Gemini", VoiceWords.problemTitle(null))
        assertTrue(VoiceWords.problemDetail("refused").startsWith("The voice routes asked"))
    }

    @Test fun aLearnedNameSaysWhoItIsAndHowOften() {
        val a = SettingsVoiceAlias.fromMap(mapOf("id" to "a1", "heard" to "amna", "refName" to "Amina", "kind" to "karigar", "uses" to 3, "createdAt" to "2026-10-01T07:00:00.000Z"))
        assertEquals("Karigar · corrected 3 times · 1 Oct 2026", VoiceWords.rowSub(a))
        val b = SettingsVoiceAlias.fromMap(mapOf("id" to "a2", "heard" to "x", "refName" to "Y"))
        assertEquals("Customer", VoiceWords.rowSub(b))
        assertEquals(1, b.uses)
    }

    // MARK: This phone

    @Test fun theNotificationKindsAreTheIPhonesFour() {
        assertEquals(listOf("sales", "payments", "orders", "karigar"), PhoneLogic.kinds.map { it.id })
        assertEquals(listOf("Sales", "Payments", "Orders", "Karigars"), PhoneLogic.kinds.map { it.title })
    }

    @Test fun theDevicesAnswerIsRead() {
        assertTrue(PhoneLogic.isRegistered(Json.parse("""{"registered":true,"off":["orders"]}""")))
        assertFalse(PhoneLogic.isRegistered(Json.parse("""{"registered":false}""")))
        assertFalse(PhoneLogic.isRegistered(null))
        assertEquals(listOf("orders"), PhoneLogic.off(Json.parse("""{"registered":true,"off":["orders",3]}""")))
        assertEquals(emptyList(), PhoneLogic.off(Json.parse("{}")))
    }

    @Test fun aSwitchTurnsAKindOffOrOn() {
        assertEquals(setOf("orders"), PhoneLogic.toggled(emptySet(), "orders", on = false))
        assertEquals(emptySet(), PhoneLogic.toggled(setOf("orders"), "orders", on = true))
        assertEquals(setOf("orders", "sales"), PhoneLogic.toggled(setOf("orders"), "sales", on = false))
    }

    @Test fun theKindsOffAreSavedWithThePhonesTokenAndBundle() {
        val body = PhoneLogic.offBody("tok", "shop.taheri.erp", listOf("orders"))
        assertEquals("tok", body["token"])
        assertEquals("shop.taheri.erp", body["bundleId"])
        assertEquals(listOf("orders"), body["off"])
        assertEquals("android", body["platform"])
    }

    @Test fun notificationsAreAskedForOnlyFromAndroidThirteen() {
        val d = NotificationPermission::decide
        assertEquals(NotificationAccess.NotAsked, d(34, false, true, false))
        assertEquals(NotificationAccess.Denied, d(34, false, true, true))
        assertEquals(NotificationAccess.Allowed, d(34, true, true, true))
        assertEquals(NotificationAccess.Denied, d(34, true, false, true))
        assertEquals(NotificationAccess.Allowed, d(30, false, true, false))
        assertEquals(NotificationAccess.Denied, d(30, false, false, false))
    }

    // MARK: Root

    @Test fun theVersionLineNamesTheHouseAndTheBuild() {
        assertEquals("TAHERI ERP · 0.1.0 (2)", versionLine("TAHERI ERP", "0.1.0", 2))
        assertEquals("A", initial("ammar"))
        assertEquals("", initial(""))
    }

    // MARK: Routes

    @Test fun everySettingsPathHasANativeScreenAndSettingsComesFirst() {
        val paths = listOf(
            "/settings", "/app/settings/shop", "/settings/alerts", "/settings/payment-methods", "/settings/integrations", "/app/settings/shopify",
            "/settings/data", "/settings/voice", "/settings/printer", "/settings/weprint-api", "/settings/backups", "/settings/contact-import",
            "/settings/hisaab-import", "/app/phone", "/app/widgets", "/app/label-live", "/app/tag-printer",
        )
        assertEquals(17, SettingsRoutes.size)
        for (p in paths) assertTrue(SettingsRoutes.any { it.matches(p) }, p)
        assertTrue(NativeScreens.all.first().matches("/settings"))
        // The ERP's own pages stay the ERP's, and Recently removed stays the Owner group's.
        assertFalse(SettingsRoutes.any { it.matches("/settings/import-taheri") })
        assertFalse(SettingsRoutes.any { it.matches("/settings/recently-removed") })
    }

    @Test fun theLabelsPageFillsTheWindowAndTheRestReadInAColumn() {
        assertNull(erp.app.nav.ScreenRegistry.readableWidth("/settings/printer"))
        assertNull(erp.app.nav.ScreenRegistry.readableWidth("/app/widgets"))
        assertEquals(720, erp.app.nav.ScreenRegistry.readableWidth("/settings")?.value?.toInt())
        assertEquals(720, erp.app.nav.ScreenRegistry.readableWidth("/app/phone")?.value?.toInt())
    }

    @Test fun aFilesNameHasNoSlashes() {
        assertEquals("a-b", SettingsFiles.safeName("a/b"))
        assertEquals("a-b", SettingsFiles.safeName("a..b"))
        assertEquals("file", SettingsFiles.safeName(""))
    }

}
