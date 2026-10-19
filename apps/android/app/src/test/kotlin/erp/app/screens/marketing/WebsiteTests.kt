package erp.app.screens.marketing

import erp.app.nav.ScreenRoute
import erp.app.ui.AppClock
import erp.core.Json
import java.time.Instant
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WebsiteTests {
    // Karachi is UTC+5: 08:00Z is 13:00 on the 12th.
    private val now = Instant.parse("2026-10-12T08:00:00Z")

    @Before fun pin() { AppClock.pinned = now }
    @After fun unpin() { AppClock.pinned = null }

    private fun parse(text: String) = Json.parse(text)

    private fun piece(json: String) = WebsiteEditPiece.from(parse(json))!!

    // MARK: Routes

    @Test fun theWebsiteRoutesAreRegisteredOnTheWebsOwnPaths() {
        fun has(path: String) = MarketingRoutes.any { it.matches(path) }
        for (p in listOf("/website/photos", "/website/edit", "/website/edit?id=Rings%2FR1%2Ewebp", "/website/weights", "/website/investments", MarketingKit.websitePath)) assertTrue(has(p), p)
        // The first match wins: Post a piece keeps /website/post, and the old address still lands on the hub.
        assertEquals(1, MarketingRoutes.count { it.matches("/website/post") })
        assertTrue(has("/website/from-site"))
    }

    @Test fun editAPieceOpensOnePieceWhenTheQueryNamesIt() {
        assertEquals("Rings/R1.webp", MarketingKit.pieceId("/website/edit?id=Rings%2FR1%2Ewebp"))
        assertNull(MarketingKit.pieceId("/website/edit"))
        assertNull(MarketingKit.pieceId("/website/edit?id="))
        assertEquals("/website/edit?id=Rings%2FR1%2Ewebp", WebsiteEditLogic.piecePath("Rings/R1.webp"))
        // Re-making the photo is the ERP's own page.
        assertEquals("/website/edit?id=Rings%2FR1%2Ewebp&web=1", WebsiteEditLogic.remakePath("Rings/R1.webp"))
        assertTrue(erp.app.nav.ScreenRegistry.wantsWeb(WebsiteEditLogic.remakePath("Rings/R1.webp")))
    }

    // MARK: Numbers

    @Test fun gramsHaveNoTrailingZeros() {
        assertEquals("12.5", WebsiteNumber.grams(12.5))
        assertEquals("3", WebsiteNumber.grams(3.0))
        assertEquals("0.125", WebsiteNumber.grams(0.125))
        assertEquals("4.2", WebsiteNumber.grams(4.2))
    }

    @Test fun aWeightIsMoreThanNothingAndUnderFiveThousand() {
        assertEquals(4.25, WebsiteNumber.parse(" 4,25 "))
        assertNull(WebsiteNumber.parse(""))
        assertNull(WebsiteNumber.parse("0"))
        assertNull(WebsiteNumber.parse("-1"))
        assertNull(WebsiteNumber.parse("5000"))
        assertNull(WebsiteNumber.parse("abc"))
        assertEquals(4999.9, WebsiteNumber.parse("4999.9"))
    }

    @Test fun aKeyIsEscapedWhole() {
        assertEquals("Rings%2FDSC0912%2Ewebp", WebsiteNumber.query("Rings/DSC0912.webp"))
    }

    @Test fun sizesAreSaidInKbAndMb() {
        assertEquals("820 KB", WebsiteNumber.size(839_680))
        assertEquals("4.2 MB", WebsiteNumber.size(4_404_019))
    }

    // MARK: Models

    @Test fun collectionsDropThoseWithoutAFolder() {
        val a = WebsiteCollectionsAnswer.from(parse("""{"collections":[{"collection":"Jhumki","category":"Earrings","count":"33","folder":"Earrings/Jhumki"},{"collection":"x"}]}"""))!!
        assertEquals(1, a.collections.size)
        assertEquals(33, a.collections[0].count)
        assertTrue(a.configured)
        assertFalse(WebsiteCollectionsAnswer.from(parse("""{"configured":false}"""))!!.configured)
    }

    @Test fun aPieceReadsWithItsChanges() {
        val p = piece(
            """{"id":"Rings/R1.webp","name":"Ring","image":"https://x/i.webp","weightGrams":3.5,"source":"attributes",
               "own":{"name":"Ring","about":"A","stone":"Ruby"},"words":{"name":"Ring 2","about":"A","stone":"Ruby"},
               "change":{"name":"Ring 2","photo":{"edited":true},"at":"2026-10-12T05:00:00Z","weightGrams":3.5}}""",
        )
        assertEquals("https://x/i.webp", p.thumb)
        assertTrue(p.hasTags)
        assertTrue(p.photoEdited)
        assertTrue(p.wordsChanged)
        assertTrue(p.changed)
        assertEquals("Ring 2", p.words.name)
        assertEquals("Ring", p.own.name)
        assertEquals("Ruby", p.words.tag("stone"))
        assertEquals("", p.words.tag("cut"))
    }

    @Test fun aPieceWithNoWordsStillOpens() {
        val p = piece("""{"id":"A/b.webp"}""")
        assertEquals("", p.words.name)
        assertEquals("attributes", p.source)
        assertFalse(p.changed)
        assertNull(p.weightGrams)
        // A weight of nothing is none.
        assertNull(piece("""{"id":"A/b.webp","weightGrams":0}""").weightGrams)
    }

    @Test fun anOwnWordsFallBackToWhatTheSiteShows() {
        val p = piece("""{"id":"A/b.webp","words":{"name":"Shown"}}""")
        assertEquals("Shown", p.own.name)
        val q = piece("""{"id":"A/b.webp","own":{"name":"Own"}}""")
        assertEquals("Own", q.words.name)
    }

    @Test fun aHiddenPieceIsChangedAndAWeightOnlyIsToo() {
        assertTrue(piece("""{"id":"a","hidden":true}""").changed)
        assertTrue(piece("""{"id":"a","change":{"weightGrams":2}}""").changed)
        assertFalse(piece("""{"id":"a","change":{"photo":{"edited":false}}}""").changed)
    }

    @Test fun theEditAnswerCarriesTheOriginalAndTheLastAI() {
        val a = WebsiteEditOne.from(parse("""{"piece":{"id":"a"},"original":"https://x/o.webp","design":{"ai":["enhance","retouch"]}}"""))!!
        assertEquals("a", a.piece?.id)
        assertEquals("https://x/o.webp", a.original)
        assertEquals(listOf("enhance", "retouch"), a.lastAI)
        assertNull(WebsiteEditOne.from(parse("{}"))!!.piece)
    }

    @Test fun theSavedAnswerCarriesTheNote() {
        val a = WebsiteEditSaved.from(parse("""{"piece":{"id":"a"},"note":"Nothing had changed."}"""))!!
        assertEquals("Nothing had changed.", a.note)
        assertEquals("a", a.piece?.id)
    }

    @Test fun theRetouchComesBackWithItsCheck() {
        val bytes = byteArrayOf(1, 2, 3, 4)
        val b64 = java.util.Base64.getEncoder().encodeToString(bytes)
        val r = WebsiteRetouched.from(parse("""{"image":{"data":"$b64"},"check":{"samePiece":true,"confidence":0.9,"differences":[]},"steps":["a","b"]}"""))!!
        assertTrue(bytes.contentEquals(r.data))
        assertTrue(r.checked)
        assertTrue(r.passes)
        assertEquals(listOf("a", "b"), r.steps)
        // The web's bar: sure, and at least 80%.
        assertFalse(WebsiteRetouched.from(parse("""{"check":{"samePiece":true,"confidence":0.79}}"""))!!.passes)
        assertFalse(WebsiteRetouched.from(parse("""{"check":{"samePiece":false,"confidence":0.99}}"""))!!.passes)
        val unchecked = WebsiteRetouched.from(parse("""{"image":{"data":"$b64"}}"""))!!
        assertFalse(unchecked.checked)
        assertFalse(unchecked.passes)
    }

    @Test fun theFeaturedAnswerIsNoneWithoutAKey() {
        assertNull(WebsiteFeaturedAnswer.from(parse("""{"featured":null}"""))!!.featured)
        assertNull(WebsiteFeaturedAnswer.from(parse("""{"featured":{"key":""}}"""))!!.featured)
        assertEquals("Rings/R1.webp", WebsiteFeaturedAnswer.from(parse("""{"featured":{"key":"Rings/R1.webp","file":"R1","note":"New"}}"""))!!.featured?.key)
    }

    @Test fun theSettingsDefaultToNothingOn() {
        val s = WebsiteSettings.from(parse("{}"))!!
        assertEquals("the website", s.siteName)
        assertFalse(s.featured)
        assertFalse(s.weights)
        assertFalse(s.edit)
        assertFalse(s.investments)
    }

    @Test fun theSameFeaturedPieceIgnoresItsEnding() {
        assertTrue(WebsiteStore.sameKey("Rings/R1.webp", "Rings/R1.jpg"))
        assertFalse(WebsiteStore.sameKey("Rings/R1.webp", "Rings/R2.webp"))
        assertFalse(WebsiteStore.sameKey("", "Rings/R2.webp"))
        assertFalse(WebsiteStore.sameKey(null, null))
        // A dot in a folder is not an ending.
        assertFalse(WebsiteStore.sameKey("Rings.v2/A", "Rings.v3/A"))
    }

    // MARK: Edit a piece

    private val tagged = piece("""{"id":"R1","source":"attributes","weightGrams":4.2,"own":{"name":"Ring","about":"A","stone":"Ruby"},"words":{"name":"Ring","about":"A","stone":"Ruby"}}""")
    private val catalogue = piece("""{"id":"R2","source":"pieces","own":{"name":"Ring","facts":["Stone: Emerald"]},"words":{"name":"Ring","facts":["Stone: Emerald"]}}""")

    @Test fun anUntouchedFormIsNotDirty() {
        assertFalse(WebsiteEditLogic.dirty(tagged, WebsiteEditLogic.formOf(tagged)))
        assertFalse(WebsiteEditLogic.dirty(catalogue, WebsiteEditLogic.formOf(catalogue)))
    }

    @Test fun eachFieldMakesTheFormDirty() {
        val f = WebsiteEditLogic.formOf(tagged)
        assertTrue(WebsiteEditLogic.dirty(tagged, f.copy(name = "Ring 2")))
        assertTrue(WebsiteEditLogic.dirty(tagged, f.copy(about = "B")))
        assertTrue(WebsiteEditLogic.dirty(tagged, f.copy(tags = f.tags.withTag("stone", "Emerald"))))
        assertTrue(WebsiteEditLogic.dirty(tagged, f.copy(hidden = true)))
        assertTrue(WebsiteEditLogic.dirty(tagged, f.copy(weight = "5")))
        assertTrue(WebsiteEditLogic.dirty(tagged, f.copy(weight = "")))
        val c = WebsiteEditLogic.formOf(catalogue)
        assertTrue(WebsiteEditLogic.dirty(catalogue, c.copy(factsText = "Stone: Ruby")))
        // Blank lines and spacing are not a change.
        assertFalse(WebsiteEditLogic.dirty(catalogue, c.copy(factsText = "\n  Stone: Emerald  \n")))
    }

    @Test fun theWordsSentAreTheWholeOfIt() {
        val f = WebsiteEditLogic.formOf(tagged).copy(name = "Ring 2", weight = "")
        val w = WebsiteEditLogic.wordsNow(tagged, f)
        assertEquals("Ring 2", w["name"])
        assertEquals(false, w["hidden"])
        assertEquals("Ruby", w["stone"])
        assertTrue(w.containsKey("weightGrams") && w["weightGrams"] == null)
        assertFalse(w.containsKey("facts"))
        val c = WebsiteEditLogic.wordsNow(catalogue, WebsiteEditLogic.formOf(catalogue).copy(factsText = "A\n\n B "))
        assertEquals(listOf("A", "B"), c["facts"])
        assertFalse(c.containsKey("stone"))
        // As the form field the route reads: keys sorted, a cleared weight null.
        assertEquals("""{"about":"A","cut":"","hidden":false,"karat":"","metal":"","name":"Ring 2","stone":"Ruby","style":"","weightGrams":null}""", WebsiteApi.text(w))
    }

    @Test fun theSaveListsExactlyWhatChanges() {
        val f = WebsiteEditLogic.formOf(tagged).copy(name = " Ring 2 ", hidden = true, weight = "5.5", tags = WebsiteEditLogic.formOf(tagged).tags.withTag("stone", ""))
        val words = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Save, tagged, f, "taheri.shop")
        assertTrue(words.startsWith("On taheri.shop:\n"))
        assertTrue(words.contains("• Name: “Ring 2”"))
        assertTrue(words.contains("• Stone: (none)"))
        assertTrue(words.contains("• Weight: 5.5g"))
        assertTrue(words.contains("• Hidden from the website"))
        assertTrue(words.endsWith("Pages opened from about a minute later show it, for everyone."))
        val shown = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Save, tagged.copy(hidden = true), WebsiteEditLogic.formOf(tagged).copy(hidden = false), "taheri.shop")
        assertTrue(shown.contains("• Shown on the website again"))
        val facts = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Save, catalogue, WebsiteEditLogic.formOf(catalogue).copy(factsText = "x"), "mina.shop")
        assertTrue(facts.contains("• New details"))
    }

    @Test fun thePutBacksSayWhatComesBack() {
        val photo = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.Photo, tagged, WebsiteEditLogic.formOf(tagged), "taheri.shop")
        assertTrue(photo.contains("The design made here is forgotten; the words stay as they are."))
        val all = WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.All, tagged, WebsiteEditLogic.formOf(tagged), "taheri.shop")
        assertTrue(all.contains("A weight typed here stays"))
        assertFalse(WebsiteEditLogic.confirmWords(WebsiteEditLogic.Confirm.All, catalogue, WebsiteEditLogic.formOf(catalogue), "x").contains("A weight typed here stays"))
        assertEquals("Change it on taheri.shop?", WebsiteEditLogic.confirmTitle(WebsiteEditLogic.Confirm.Save, "taheri.shop"))
    }

    @Test fun theGridFiltersByChangeHiddenCollectionAndWords() {
        val a = piece("""{"id":"Rings/A.webp","collection":"Rings","hidden":true,"words":{"name":"Ruby ring"}}""")
        val b = piece("""{"id":"Earrings/B.webp","collection":"Earrings","words":{"name":"Jhumka"},"facts":["gold"],"change":{"name":"x"}}""")
        val all = listOf(a, b)
        assertEquals(listOf(a, b), WebsiteEditLogic.filtered(all, "", WebsiteEditLogic.Filter.All, ""))
        assertEquals(listOf(a), WebsiteEditLogic.filtered(all, "", WebsiteEditLogic.Filter.Hidden, ""))
        assertEquals(listOf(a, b), WebsiteEditLogic.filtered(all, "", WebsiteEditLogic.Filter.Changed, ""))
        assertEquals(listOf(b), WebsiteEditLogic.filtered(all, "", WebsiteEditLogic.Filter.All, "Earrings"))
        assertEquals(listOf(a), WebsiteEditLogic.filtered(all, "RUBY ring", WebsiteEditLogic.Filter.All, ""))
        assertEquals(listOf(b), WebsiteEditLogic.filtered(all, "gold", WebsiteEditLogic.Filter.All, ""))
        // The id is searchable: "Ring 12" style.
        assertEquals(listOf(b), WebsiteEditLogic.filtered(all, "b.webp", WebsiteEditLogic.Filter.All, ""))
        assertEquals(listOf("Earrings", "Rings"), WebsiteEditLogic.collections(all))
    }

    @Test fun theTileSaysCollectionAndWeight() {
        assertEquals("Rings · 4.2g", WebsiteEditLogic.detail(tagged.copy(collection = "Rings")))
        assertEquals("", WebsiteEditLogic.detail(piece("""{"id":"a"}""")))
    }

    @Test fun thePhotoNoteWarnsAsTheEditorDoes() {
        assertEquals("Last time: enhance, retouch. Editing starts from the original photo.", WebsiteEditLogic.photoNote(tagged, listOf("enhance", "retouch"), "taheri"))
        val burned = tagged.copy(weightOnPhoto = true)
        assertTrue(WebsiteEditLogic.photoNote(burned, emptyList(), "taheri").contains("a stamp would show them twice"))
        assertEquals("", WebsiteEditLogic.photoNote(burned.copy(change = WebsiteEditChange(setOf("photo"), true, null, null, true)), emptyList(), "taheri"))
        val mina = tagged.copy(photoSource = "src", sourceMarked = true)
        assertTrue(WebsiteEditLogic.photoNote(mina, emptyList(), "mina").contains("carries the house's mark already"))
        assertTrue(WebsiteEditLogic.photoNote(mina.copy(sourceMarked = false), emptyList(), "mina").contains("the mark goes back top right"))
        // Taheri's note about burned-in weights is Taheri's.
        assertEquals("", WebsiteEditLogic.photoNote(mina, emptyList(), "taheri"))
    }

    @Test fun theChangeLogLineJoinsWhatByWhom() {
        val r = WebsiteEditRecent("Rings/A.webp", "Ruby ring", listOf("new photo", "hidden"), "owner@example.test", "2026-10-12T07:00:00Z")
        assertEquals("new photo, hidden · owner@example.test · Today 12:00 pm", WebsiteEditLogic.recentWords(r, now))
        assertEquals("hidden · Today 12:00 pm", WebsiteEditLogic.recentWords(r.copy(what = listOf("hidden"), by = ""), now))
    }

    // MARK: Photo weights

    private fun w(key: String, collection: String, grams: Double? = null, source: String? = null, label: Double? = null) =
        WebsiteWeightPiece(key, collection, key.substringAfterLast('/'), "", grams, source, label, null, null)

    @Test fun theWeightsQueueNarrowsAsTheCounterAsks() {
        val a = w("Rings/A.webp", "Rings")
        val b = w("Rings/B.webp", "Rings", 3.0, "pos")
        val c = w("Earrings/C.webp", "Earrings")
        val all = listOf(a, b, c)
        assertEquals(listOf(a, c), WebsiteWeightsLogic.queue(all, "", true, ""))
        assertEquals(all, WebsiteWeightsLogic.queue(all, "", false, ""))
        assertEquals(listOf(a), WebsiteWeightsLogic.queue(all, "Rings", true, ""))
        assertEquals(listOf(c), WebsiteWeightsLogic.queue(all, "", true, " earrings/c "))
        assertEquals(3 to 1, WebsiteWeightsLogic.counts(all, ""))
        assertEquals(2 to 1, WebsiteWeightsLogic.counts(all, "Rings"))
        assertEquals(listOf("Earrings", "Rings"), WebsiteWeightsLogic.collections(all))
    }

    @Test fun theStripShowsTheNextTwelve() {
        val q = (0 until 20).map { w("A/$it.webp", "A") }
        val up = WebsiteWeightsLogic.upcoming(q, 2)
        assertEquals(12, up.size)
        assertEquals(3, up.first().first)
        assertEquals(14, up.last().first)
        assertTrue(WebsiteWeightsLogic.upcoming(q, 19).isEmpty())
        assertEquals(1, WebsiteWeightsLogic.upcoming(q, 18).size)
    }

    @Test fun thePreviewIsWhatIsTypedElseWhatIsRecorded() {
        val p = w("A/x.webp", "A", 3.5, "pos")
        assertEquals("4.2", WebsiteWeightsLogic.preview(p, "4,2"))
        assertEquals("4.2", WebsiteWeightsLogic.preview(p, "4.2g"))
        assertEquals("3.5", WebsiteWeightsLogic.preview(p, ""))
        assertNull(WebsiteWeightsLogic.preview(w("A/y.webp", "A"), ""))
    }

    @Test fun theFieldStartsWithOnlyAWeightTypedHere() {
        assertEquals("3.5", WebsiteWeightsLogic.prefill(w("A/x.webp", "A", 3.5, "pos")))
        // The photo's own label is never put in the field.
        assertEquals("", WebsiteWeightsLogic.prefill(w("A/x.webp", "A", 3.5, "label", 3.5)))
        assertEquals("", WebsiteWeightsLogic.prefill(null))
    }

    @Test fun theWeightSaveSaysWhatChangesOnTheSite() {
        val on = WebsiteWeightsLogic.words(WebsiteWeightsLogic.Pending("A/x.webp", "x.webp", 3.5, null, true), "taheri.shop")
        assertTrue(on.startsWith("3.5 g for x.webp. taheri.shop draws it on the photograph's corner"))
        val off = WebsiteWeightsLogic.words(WebsiteWeightsLogic.Pending("A/x.webp", "x.webp", null, 2.0, true), "taheri.shop")
        assertTrue(off.contains("comes off taheri.shop"))
        assertTrue(off.endsWith("The photo's own 2g stays."))
    }

    @Test fun aSavedWeightIsKeptInTheListAndRemovingItGoesBackToTheLabel() {
        val a = w("A/x.webp", "A", null, null, 2.0)
        val saved = WebsiteWeightsLogic.saved(listOf(a), "A/x.webp", 3.0, now).single()
        assertEquals(3.0, saved.weightGrams)
        assertEquals("pos", saved.source)
        assertEquals("you", saved.enteredBy)
        assertNotNull(saved.enteredAt)
        val back = WebsiteWeightsLogic.saved(listOf(saved), "A/x.webp", null, now).single()
        assertEquals(2.0, back.weightGrams)
        assertEquals("label", back.source)
        assertNull(back.enteredBy)
        val none = WebsiteWeightsLogic.saved(listOf(w("A/y.webp", "A", 1.0, "pos")), "A/y.webp", null, now).single()
        assertNull(none.weightGrams)
        assertNull(none.source)
    }

    // MARK: Add photos

    private fun item(id: String, status: WebsitePhotoItem.Status = WebsitePhotoItem.Status.Queued, house: String = "", model: String = "") =
        WebsitePhotoItem(id, ByteArray(10), MarketingPhotos.Kind("jpg", "image/jpeg"), null, "IMG-$id", house, model, status)

    private val maison = WebsiteMaisonAnswer(true, listOf("Cartier"))
    private val plain = WebsiteMaisonAnswer(false, emptyList())

    @Test fun theShelvesGroupByCategoryInTheSitesOrder() {
        val cs = listOf(WebsiteCollection("Rings", "Rings", 1, "Rings/Rings", null), WebsiteCollection("Jhumki", "Earrings", 2, "Earrings/Jhumki", null), WebsiteCollection("Solitaire", "Rings", 3, "Rings/Solitaire", null))
        val s = WebsitePhotosLogic.shelves(cs, "")
        assertEquals(listOf("Rings", "Earrings"), s.map { it.id })
        assertEquals(2, s[0].list.size)
        assertEquals(listOf("Earrings"), WebsitePhotosLogic.shelves(cs, "ear jhu").map { it.id })
        assertTrue(WebsitePhotosLogic.shelves(cs, "zzz").isEmpty())
    }

    @Test fun nothingIsSentUntilItIsKnownHowTheCollectionNamesThem() {
        val items = listOf(item("1"))
        fun can(maison: WebsiteMaisonAnswer?, unknown: Boolean = false, folder: String = "Rings/Rings", sending: Boolean = false, configured: Boolean = true, list: List<WebsitePhotoItem> = items) =
            WebsitePhotosLogic.canSend(folder, configured, list, maison, unknown, sending, false)
        assertTrue(can(plain))
        assertFalse(can(null))
        assertFalse(can(plain, unknown = true))
        assertFalse(can(plain, folder = ""))
        assertFalse(can(plain, sending = true))
        assertFalse(can(plain, configured = false))
        assertFalse(can(plain, list = emptyList()))
        assertFalse(can(plain, list = listOf(item("1").copy(retouching = true))))
        assertFalse(WebsitePhotosLogic.canSend("Rings/Rings", true, items, plain, false, false, true))
        // A sent photograph is not waiting.
        assertFalse(can(plain, list = listOf(item("1", WebsitePhotoItem.Status.Done))))
        // A failed one is sent again.
        assertTrue(can(plain, list = listOf(item("1", WebsitePhotoItem.Status.Failed))))
    }

    @Test fun aMaisonsTrayNeedsAHouseAndAnOfficialName() {
        val items = listOf(item("1"), item("2", house = "Cartier"), item("3", house = "Cartier", model = "  "), item("4", house = "Cartier", model = "LOVE Bracelet"))
        assertEquals(3, WebsitePhotosLogic.unnamed(items, true))
        assertEquals(0, WebsitePhotosLogic.unnamed(items, false))
        assertFalse(WebsitePhotosLogic.canSend("a/b", true, items, maison, false, false, false))
        assertTrue(WebsitePhotosLogic.canSend("a/b", true, listOf(items[3]), maison, false, false, false))
        assertEquals("Cartier — LOVE Bracelet", WebsitePhotosLogic.displayName(items[3], true))
        assertEquals("IMG-4.jpg", WebsitePhotosLogic.displayName(items[3], false))
        assertEquals("IMG-1.jpg", WebsitePhotosLogic.displayName(items[0], true))
    }

    @Test fun theSendWordsSayWhereAndThatItIsPublic() {
        val one = WebsitePhotosLogic.sendWords(listOf(item("1")), "Rings → Solitaire", "taheri.shop")
        assertEquals("1 photograph goes to taheri.shop, into Rings → Solitaire, and is public at once: anyone who opens the site sees it.", one)
        val two = WebsitePhotosLogic.sendWords(listOf(item("1"), item("2").copy(original = WebsitePhotoItem.Original(ByteArray(1), MarketingPhotos.Kind("jpg", "image/jpeg"), null))), "Rings → Solitaire", "taheri.shop")
        assertTrue(two.startsWith("2 photographs go to taheri.shop"))
        assertTrue(two.contains("are public at once: anyone who opens the site sees them."))
        assertTrue(two.endsWith("1 of them retouched by the AI: check it against the originals."))
    }

    @Test fun theCollectionPageIsTheSitesOrTheWebsGuess() {
        val c = WebsiteCollection("Solitaire Rings", "Rings", 1, "Rings/Solitaire Rings", null)
        assertEquals("https://x.test/solitaire-rings", WebsitePhotosLogic.collectionUrl(c, "https://x.test"))
        assertEquals("https://x.test/r/s", WebsitePhotosLogic.collectionUrl(c.copy(path = "/r/s"), "https://x.test"))
        assertNull(WebsitePhotosLogic.collectionUrl(c, ""))
        assertNull(WebsitePhotosLogic.collectionUrl(null, "https://x.test"))
    }

    @Test fun theStemIsDatedInKarachiAndNumbered() {
        assertEquals("IMG-20261012-130000-3abcd", WebsitePhotosLogic.nextStem(2, now, "abcd"))
    }

    @Test fun whatWasLeftOutOfAPickIsSaid() {
        assertNull(WebsitePhotosLogic.skippedWords(0, 0))
        assertEquals("Skipped 1. 1 couldn't be read: only JPEG, PNG, WebP and HEIC photographs can go on the website.", WebsitePhotosLogic.skippedWords(1, 0))
        assertEquals("Skipped 3. 1 couldn't be read: only JPEG, PNG, WebP and HEIC photographs can go on the website; 2 are over 25 MB.", WebsitePhotosLogic.skippedWords(1, 2))
        assertEquals("Skipped 1. 1 is over 25 MB.", WebsitePhotosLogic.skippedWords(0, 1))
    }

    @Test fun theRetouchSaysHowItWent() {
        fun r(checked: Boolean, same: Boolean, c: Double, diffs: List<String> = emptyList(), steps: List<String> = emptyList()) = WebsiteRetouched(null, if (checked) same else null, if (checked) c else null, diffs, steps, checked)
        assertEquals("Retouched, not checked: compare it with the original before sending.", WebsitePhotosLogic.retouchSaid(r(false, false, 0.0)))
        assertEquals("Retouched: the same piece.", WebsitePhotosLogic.retouchSaid(r(true, true, 0.95)))
        assertEquals("Retouched: enhance → clean", WebsitePhotosLogic.retouchSaid(r(true, true, 0.95, steps = listOf("enhance", "clean"))))
        assertEquals("Retouched. Check it closely: the stone is different", WebsitePhotosLogic.retouchSaid(r(true, true, 0.5, listOf("the stone is different"))))
        assertEquals("Retouched. Check it closely: it may not be the same piece.", WebsitePhotosLogic.retouchSaid(r(true, false, 0.9)))
    }

    @Test fun aPhotoIsKnownByItsFirstBytes() {
        fun kind(vararg b: Int) = MarketingPhotos.kind(ByteArray(16) { b.getOrElse(it) { 0 }.toByte() })?.ext
        assertEquals("jpg", kind(0xFF, 0xD8, 0xFF))
        assertEquals("png", kind(0x89, 0x50, 0x4E, 0x47))
        assertEquals("webp", kind(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))
        assertEquals("heic", kind(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))
        assertNull(kind(1, 2, 3))
    }

    // MARK: Investments

    private fun gold(json: String) = WebsiteGoldPost.from(parse(json))!!

    @Test fun aGoldPostReadsItsSendsAndDropsEmptyOnes() {
        val p = gold("""{"date":"2026-10-12","post":"*Gold holds*\nrest","teaser":"t","cards":["square"],"receivedAt":"2026-10-12T06:00:00Z","source":"routine","sent":{"group":{"at":"2026-10-12T07:00:00Z","by":"schedule"},"channel":{"at":""},"teaser":"x"},"hold":true,"approved":{"at":"2026-10-12T06:30:00Z"}}""")
        assertEquals("2026-10-12", p.id)
        assertEquals("Gold holds", p.headline)
        assertEquals(setOf("group"), p.sent.keys)
        assertEquals("schedule", p.sent["group"]?.by)
        assertTrue(p.hold)
        assertEquals("2026-10-12T06:30:00Z", p.approvedAt)
        assertNull(gold("""{"date":"2026-10-12","approved":{"at":""}}""").approvedAt)
        assertEquals("", gold("""{"date":"d","post":"\n \n"}""").headline)
    }

    @Test fun theScheduleFillsWhatTheAnswerLeavesOut() {
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":true,"days":[1,2,9,"x"],"mode":"weird","targets":{"group":{"on":false,"at":"arrival"}},"lateUntil":"21:15"}"""))!!
        assertTrue(s.enabled)
        assertEquals(listOf(1, 2), s.days)
        assertEquals("auto", s.mode)
        assertEquals(WebsiteGoldSchedule.Plan(false, "arrival"), s.plan("group"))
        assertEquals(WebsiteGoldSchedule.Plan(true, "12:00"), s.plan("teaser"))
        assertEquals(WebsiteGoldSchedule.Plan(false, "13:00"), s.plan("instagram"))
        assertEquals("21:15", s.lateUntil)
        assertEquals("20:00", WebsiteGoldSchedule.from(parse("{}"))!!.lateUntil)
        assertEquals("approve", WebsiteGoldSchedule.from(parse("""{"mode":"approve"}"""))!!.mode)
    }

    @Test fun theScheduleIsSentBackWhole() {
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":true,"days":[3,1],"mode":"approve","lateUntil":"19:00"}"""))!!
        val b = s.body
        assertEquals(true, b["enabled"])
        assertEquals(listOf(1, 3), b["days"])
        assertEquals("approve", b["mode"])
        assertEquals("19:00", b["lateUntil"])
        @Suppress("UNCHECKED_CAST")
        val t = b["targets"] as Map<String, Map<String, Any?>>
        assertEquals(setOf("group", "channel", "teaser", "instagram"), t.keys)
        assertEquals(mapOf("on" to true, "at" to "11:30"), t["group"])
    }

    @Test fun aChangedDraftIsToldFromTheSavedOneByItsChoicesOnly() {
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":false,"days":[1,2],"updatedBy":"a","lastTick":"2026-10-12T07:00:00Z"}"""))!!
        assertTrue(s.sameChoices(s.copy(updatedBy = "b", lastTick = null, days = listOf(2, 1))))
        assertFalse(s.sameChoices(s.copy(days = listOf(1))))
        assertFalse(s.sameChoices(s.copy(mode = "approve")))
        assertFalse(s.sameChoices(s.withPlan("channel", WebsiteGoldSchedule.Plan(true, "11:30"))))
        assertFalse(s.sameChoices(s.copy(lateUntil = "21:00")))
    }

    @Test fun theStatusKeepsTheTargetsInTheirOrderAndTheDaysParts() {
        val st = WebsiteGoldStatus.from(parse(
            """{"today":"2026-10-12","enabled":true,"targets":[{"id":"group","label":"Post","to":"the group"},{"id":"","label":"x"}],
               "day":{"id":"2026-10-12","parts":{"group":{"kind":"sent","line":{"text":"Sent 1 h ago","tone":"ok"}},"teaser":{"kind":"waiting"},"bad":1}}}""",
        ))!!
        assertEquals(listOf("group"), st.targets.map { it.id })
        assertEquals("2026-10-12", st.dayId)
        assertEquals("Sent 1 h ago", st.parts["group"]?.line)
        assertEquals("ok", st.parts["group"]?.tone)
        assertNull(st.parts["teaser"]?.line)
        assertEquals("muted", st.parts["teaser"]?.tone)
        assertFalse(st.parts.containsKey("bad"))
    }

    private val targets = listOf(
        WebsiteGoldStatus.Target("group", "Post + square card", "the Investments group"),
        WebsiteGoldStatus.Target("teaser", "Teaser", "the community's announcements"),
    )

    @Test fun daysAreSaidAsThePageSaysThem() {
        assertEquals("Every day", WebsiteGoldWords.days(listOf(0, 1, 2, 3, 4, 5, 6)))
        assertEquals("Mon–Sat", WebsiteGoldWords.days(listOf(6, 5, 4, 3, 2, 1)))
        assertEquals("Mon–Fri", WebsiteGoldWords.days(listOf(1, 2, 3, 4, 5)))
        assertEquals("Mon, Wed, Fri", WebsiteGoldWords.days(listOf(5, 3, 1)))
        assertEquals("No days", WebsiteGoldWords.days(emptyList()))
        assertEquals("Sun", WebsiteGoldWords.days(listOf(0, 0, 9)))
    }

    @Test fun clocksAreInTwelveHours() {
        assertEquals("1:05 pm", WebsiteGoldTime.clock("13:05"))
        assertEquals("12:00 am", WebsiteGoldTime.clock("00:00"))
        assertEquals("12:30 pm", WebsiteGoldTime.clock("12:30"))
        assertEquals("11:30 am", WebsiteGoldTime.clock("11:30"))
        assertEquals("junk", WebsiteGoldTime.clock("junk"))
        assertEquals("25:00", WebsiteGoldTime.clock("25:00"))
        assertEquals(13 * 60 + 5, WebsiteGoldTime.minutes("13:05", "11:30"))
        assertEquals(11 * 60 + 30, WebsiteGoldTime.minutes("nonsense", "11:30"))
        assertEquals("09:05", WebsiteGoldTime.hhmm(9 * 60 + 5))
        assertEquals("Wednesday 7 October", WebsiteGoldTime.longDate("2026-10-07"))
        assertEquals("not a day", WebsiteGoldTime.longDate("not a day"))
    }

    @Test fun agoIsInMinutesThenHours() {
        assertEquals("just now", WebsiteGoldTime.ago("2026-10-12T07:59:50Z", now))
        assertEquals("12 min ago", WebsiteGoldTime.ago("2026-10-12T07:48:00Z", now))
        assertEquals("3 h ago", WebsiteGoldTime.ago("2026-10-12T05:00:00Z", now))
        assertEquals("", WebsiteGoldTime.ago(null, now))
    }

    @Test fun theScheduleSummaryAndTheSwitchOnWords() {
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":true,"days":[1,2,3,4,5,6],"mode":"approve","targets":{"teaser":{"on":true,"at":"arrival"}}}"""))!!
        assertEquals("Mon–Sat · group 11:30 am · teaser on arrival · after your OK", WebsiteGoldWords.summary(s, targets))
        assertEquals("Mon–Sat · nothing chosen", WebsiteGoldWords.summary(s.copy(mode = "auto", targets = mapOf("group" to WebsiteGoldSchedule.Plan(false, "11:30"), "teaser" to WebsiteGoldSchedule.Plan(false, "12:00"))), targets))
        val words = WebsiteGoldWords.switchOn(s, targets)
        assertEquals(
            "From now on, on Mon–Sat, once the routine has filed the day's post and you've approved it:\n" +
                "• 11:30 am: post + square card to the Investments group\n• As soon as it arrives: teaser to the community's announcements\n\n" +
                "Only that day's post, each part once. A late post still goes until 8:00 pm. Hold any day from its card.",
            words,
        )
        assertTrue(WebsiteGoldWords.switchOn(s.copy(days = listOf(0, 1, 2, 3, 4, 5, 6), mode = "auto"), targets).startsWith("From now on, every day, once the routine has filed the day's post:\n"))
    }

    @Test fun theSchedulerIsSilentAfterFifteenMinutes() {
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":true,"lastTick":"2026-10-12T07:50:00Z"}"""))!!
        assertFalse(WebsiteGoldWords.silent(s, now))
        assertTrue(WebsiteGoldWords.silent(s.copy(lastTick = "2026-10-12T07:40:00Z"), now))
        assertTrue(WebsiteGoldWords.silent(s.copy(lastTick = null), now))
        assertFalse(WebsiteGoldWords.silent(s.copy(enabled = false, lastTick = null), now))
        assertEquals("Checked 10 min ago · set by the counter", WebsiteGoldWords.checked(s.copy(updatedBy = "counter"), now))
        assertEquals("Not checked yet · set by a@x.test", WebsiteGoldWords.checked(s.copy(lastTick = null, updatedBy = "a@x.test"), now))
        assertEquals("Checked 10 min ago", WebsiteGoldWords.checked(s, now))
    }

    @Test fun aPartWithNothingToSendCannotBeSent() {
        val d = gold("""{"date":"d","cards":["square"]}""")
        assertTrue(WebsiteGoldWords.missing("teaser", d, "post", "  "))
        assertFalse(WebsiteGoldWords.missing("teaser", d, "post", "t"))
        assertTrue(WebsiteGoldWords.missing("instagram", d, "post", "t"))
        assertFalse(WebsiteGoldWords.missing("instagram", d.copy(cards = listOf("story")), "post", ""))
        assertTrue(WebsiteGoldWords.missing("group", d, " ", "t"))
        assertFalse(WebsiteGoldWords.missing("channel", d, "post", ""))
    }

    @Test fun whatIsAskedBeforeASendIsSaidInFull() {
        val d = gold("""{"date":"2026-10-07","sent":{"teaser":{"at":"2026-10-07T07:00:00Z"}}}""")
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":true,"mode":"approve"}"""))!!
        val one = WebsiteGoldAsk.Send(listOf("group"), false)
        assertEquals("Send it now?", WebsiteGoldAsk.title(one))
        assertEquals("Send", WebsiteGoldAsk.button(one))
        assertEquals("Post + square card for Wednesday 7 October goes to the Investments group. It can't be unsent from here.", WebsiteGoldAsk.words(one, d, s, targets))
        val again = WebsiteGoldAsk.Send(listOf("teaser"), true)
        assertEquals("Send it again?", WebsiteGoldAsk.title(again))
        assertEquals("Send again", WebsiteGoldAsk.button(again))
        assertEquals("Teaser for Wednesday 7 October goes to the community's announcements a second time: everyone will see it twice. It can't be unsent from here.", WebsiteGoldAsk.words(again, d, s, targets))
        val all = WebsiteGoldAsk.Send(listOf("group", "teaser"), false)
        assertEquals("Send all 2 now?", WebsiteGoldAsk.title(all))
        assertEquals(
            "Wednesday 7 October, one after another:\n• Post + square card → the Investments group\n• Teaser → the community's announcements\n\nNone of it can be unsent from here.",
            WebsiteGoldAsk.words(all, d, s, targets),
        )
    }

    @Test fun approvingAndLettingGoListWhatGoesByItself() {
        val d = gold("""{"date":"2026-10-07","sent":{"teaser":{"at":"2026-10-07T07:00:00Z"}}}""")
        val s = WebsiteGoldSchedule.from(parse("""{"enabled":true,"mode":"approve","targets":{"teaser":{"on":true,"at":"12:00"}}}"""))!!
        assertEquals(
            "It goes by itself at its times, saved words only:\n• 11:30 am: Post + square card → the Investments group",
            WebsiteGoldAsk.words(WebsiteGoldAsk.Approve, d, s, targets),
        )
        // A held day let go still waits for the OK when none was given.
        assertTrue(WebsiteGoldAsk.words(WebsiteGoldAsk.LetGo, d, s, targets).endsWith("\n\nIt still waits for your OK."))
        assertFalse(WebsiteGoldAsk.words(WebsiteGoldAsk.LetGo, d.copy(approvedAt = "x"), s, targets).contains("waits for your OK"))
        val nothing = s.copy(targets = mapOf("group" to WebsiteGoldSchedule.Plan(false, "11:30"), "teaser" to WebsiteGoldSchedule.Plan(false, "12:00")))
        assertTrue(WebsiteGoldAsk.words(WebsiteGoldAsk.Approve, d, nothing, targets).startsWith("Nothing of it is set to go by itself."))
        assertEquals("The next check (within 5 minutes) tries Teaser → the community's announcements again.", WebsiteGoldAsk.words(WebsiteGoldAsk.Retry("teaser"), d, s, targets))
        assertEquals("Try again", WebsiteGoldAsk.button(WebsiteGoldAsk.Retry("teaser")))
        assertEquals("Let today's post send?", WebsiteGoldAsk.title(WebsiteGoldAsk.LetGo))
        assertEquals("Approve today's post?", WebsiteGoldAsk.title(WebsiteGoldAsk.Approve))
    }

    @Test fun countsAreWords() {
        assertEquals("two", WebsiteGoldWords.count(2))
        assertEquals("four", WebsiteGoldWords.count(4))
        assertEquals("5", WebsiteGoldWords.count(5))
        assertEquals("Post + square card → the Investments group", WebsiteGoldWords.place("group", targets))
        assertEquals("unknown", WebsiteGoldWords.place("unknown", targets))
    }

    @Test fun theDemoReadsLikeTheServer() {
        val (a, s, st) = WebsiteDemo.gold(now)
        assertTrue(a.posts.isNotEmpty())
        assertEquals(st.targets.map { it.id }, listOf("group", "channel", "teaser", "instagram"))
        assertTrue(s.enabled)
        assertNotNull(a.posts.firstOrNull { it.date == a.today })
        val e = WebsiteDemo.edits("taheri", now)
        assertTrue(e.pieces.any { it.hidden } && e.pieces.any { it.photoEdited } && e.pieces.any { it.wordsChanged })
        assertFalse(WebsiteDemo.edits("mina", now).pieces.any { it.hasTags })
        assertNull(WebsiteDemo.featured("mina"))
    }
}
