package erp.app

import erp.app.config.Business
import erp.app.config.BusinessFailure
import erp.app.config.BusinessRules
import erp.app.config.BusinessStore
import erp.app.config.DescriptorAnswer
import erp.app.config.Prefs
import erp.app.data.OutboxDisk
import erp.app.device.LaunchLog
import erp.app.screens.businesses.LaunchPicker
import erp.core.Json
import java.io.File
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// One app, many businesses (docs/features/android-app.md "One app, many businesses"): what a descriptor may say, how the list merges, what each
// business keeps under its own name. Plain Kotlin, no device.

private val TAHERI_PALETTE = """{"light":{"accent":"#8A6B42","ground":"#F2F3F6","card":"#FFFFFF","onAccent":"#FFFFFF"},"dark":{"accent":"#BE9F76","ground":"#0A1111","card":"#141A1A","onAccent":"#0B1414"}}"""

private fun descriptor(
    id: String = "acme", name: String = "ACME", url: String = "https://erp.acme.example", android: String? =
        """{"googleWebClientId":"1-web.apps.googleusercontent.com","firebase":{"apiKey":"k","appId":"1:2:android:3","projectId":"acme-pos","senderId":"2","storageBucket":"acme-pos.firebasestorage.app"}}""",
    palette: String = TAHERI_PALETTE,
): String = """{"version":1,"id":"$id","name":"$name","shortName":"$name ERP","serverURL":"$url","metal":"silver","margin":{"kind":"percent","percent":40},"palette":$palette,
    "logo":{"light":"$url/logo.png","dark":"$url/logo-dark.png","aspect":4.5},"icon":"$url/icon.png",${if (android == null) """"android":null,""" else """"android":$android,"""}"flags":{"partnership":true}}"""

private fun answer(body: String, host: String = "erp.acme.example", status: Int = 200) = DescriptorAnswer(status, host, body)

private fun business(id: String, android: Boolean = true, host: String = "erp.$id.example"): Business =
    Business.decode(descriptor(id = id, name = id.uppercase(), url = "https://$host", android = if (android) """{"googleWebClientId":"c.apps.googleusercontent.com","firebase":{"apiKey":"k","appId":"1:2:android:$id","projectId":"p","senderId":"2","storageBucket":"b"}}""" else null))!!

class BusinessDescriptorTests {
    @Test fun `an ERP's descriptor reads, leniently, as a business`() {
        val b = assertNotNull(Business.decode(descriptor()))
        assertEquals("acme", b.id)
        assertEquals("ACME ERP", b.displayName)
        assertEquals("silver", b.metal)
        assertEquals(Business.Margin.Percent(40.0), b.margin)
        assertEquals("erp.acme.example", b.host)
        assertEquals("A", b.initial)
        assertNull(b.art)
        assertTrue(b.androidReady)
        assertNull(b.problem)
        // a missing field is a default, a missing id or palette is no business at all
        assertEquals(Business.Margin.RattiLess(6.0), Business.decode(descriptor().replace(""""margin":{"kind":"percent","percent":40},""", ""))!!.margin)
        assertEquals("gold", Business.decode(descriptor().replace("\"silver\"", "\"copper\""))!!.metal)
        assertNull(Business.decode("""{"name":"x","serverURL":"https://x.example"}"""))
        assertNull(Business.decode("not json"))
    }

    @Test fun `a business whose Android app is not registered is a business, with no sign-in`() {
        val none = assertNotNull(Business.decode(descriptor(android = null)))
        assertNull(none.android)
        assertFalse(none.androidReady)
        assertNull(none.problem)
        // an older ERP that does not send the block at all is the same
        val older = assertNotNull(Business.decode(descriptor().replace(Regex(""""android":\{.*?\}\},"""), "")))
        assertNull(older.android)
    }

    @Test fun `a descriptor that cannot be used says why`() {
        assertEquals("That ERP's id isn't one this app can use.", Business.decode(descriptor(id = "Bad Id"))!!.problem)
        assertEquals("That ERP has no name.", Business.decode(descriptor(name = "  "))!!.problem)
        assertEquals("That ERP's address isn't a secure one.", Business.decode(descriptor(url = "http://erp.acme.example"))!!.problem)
        assertEquals("That ERP's colours aren't readable.", Business.decode(descriptor(palette = TAHERI_PALETTE.replace("#8A6B42", "red")))!!.problem)
        val broken = descriptor(android = """{"googleWebClientId":"not-a-client","firebase":{"apiKey":"k","appId":"1:2:ios:3","projectId":"p","senderId":"2","storageBucket":"b"}}""")
        assertTrue(Business.decode(broken)!!.problem!!.contains("Android sign-in incorrectly"))
    }

    @Test fun `a business round-trips through the file it is kept in`() {
        val b = assertNotNull(Business.decode(descriptor()))
        assertEquals(b, Business.decode(b.toJson()))
        assertEquals(b.copy(android = null), Business.decode(b.copy(android = null).toJson()))
    }

    @Test fun `the minimum build keeps an old app out of money screens`() {
        val b = assertNotNull(Business.decode(descriptor().replace("\"flags\"", "\"minBuild\":5,\"flags\"")))
        assertTrue(b.needsUpdate(4))
        assertFalse(b.needsUpdate(5))
        assertFalse(assertNotNull(Business.decode(descriptor())).needsUpdate(1))
    }
}

class BusinessAddressTests {
    @Test fun `what a person types becomes the ERP's https origin and nothing else`() {
        assertEquals("https://erp.example.shop", BusinessRules.origin("erp.example.shop"))
        assertEquals("https://erp.example.shop", BusinessRules.origin("  https://ERP.Example.shop/orders?x=1 "))
        assertEquals("https://erp.example.shop", BusinessRules.origin("http://erp.example.shop:443/a"))
        for (bad in listOf("", "   ", "localhost", "erp example.shop", "https://user@erp.example.shop", "erp.example.shop:8080", "erp_example.shop")) {
            assertFailsWith<BusinessFailure>(bad) { BusinessRules.origin(bad) }
        }
    }

    @Test fun `a descriptor speaks for the host it came from and no other`() {
        val origin = "https://erp.acme.example"
        val ok = BusinessRules.judge(origin, answer(descriptor()), emptyList())
        assertEquals("acme", ok.id)
        // another host named inside it: the sign-in token must not be pointed at a stranger
        assertEquals(
            "That ERP names a different address for itself.",
            assertFailsWith<BusinessFailure> { BusinessRules.judge(origin, answer(descriptor(url = "https://evil.example")), emptyList()) }.message,
        )
        // an answer that came from elsewhere (a redirect), a failure status, or not a descriptor
        for (a in listOf(answer(descriptor(), host = "evil.example"), answer(descriptor(), status = 404), answer("<html>"), answer("{}"))) {
            assertEquals("That address isn't an ERP this app can open.", assertFailsWith<BusinessFailure> { BusinessRules.judge(origin, a, emptyList()) }.message)
        }
    }

    @Test fun `an ERP at erp dot or pos dot is the same ERP, and the typed address is the one kept`() {
        val pos = "https://pos.acme.example"
        val b = BusinessRules.judge(pos, answer(descriptor(url = "https://erp.acme.example"), host = "pos.acme.example"), emptyList())
        assertEquals("https://pos.acme.example", b.serverURL)
        val erp = BusinessRules.judge("https://erp.acme.example", answer(descriptor(url = "https://pos.acme.example")), emptyList())
        assertEquals("https://erp.acme.example", erp.serverURL)
        assertEquals("pos.acme.example", BusinessRules.twin("erp.acme.example"))
        assertEquals("erp.acme.example", BusinessRules.twin("pos.acme.example"))
        assertEquals("www.acme.example", BusinessRules.twin("www.acme.example"))
    }

    @Test fun `a demo id, a second ERP of a known brand, and an unusable descriptor are told apart`() {
        val demo = BusinessRules.judge("https://erp.acme.example", answer(descriptor(id = "demo")), emptyList())
        assertEquals("demo-erp-acme-example", demo.id)
        val known = listOf(business("acme", host = "erp.other.example"))
        val second = BusinessRules.judge("https://erp.acme.example", answer(descriptor()), known)
        assertEquals("acme-erp-acme-example", second.id)
        // the same brand at the same address is the same business: refreshed, not renamed
        val same = BusinessRules.judge("https://erp.acme.example", answer(descriptor()), listOf(business("acme", host = "erp.acme.example")))
        assertEquals("acme", same.id)
        assertEquals("That ERP's colours aren't readable.", assertFailsWith<BusinessFailure> {
            BusinessRules.judge("https://erp.acme.example", answer(descriptor(palette = TAHERI_PALETTE.replace("#8A6B42", "nope"))), emptyList())
        }.message)
        assertEquals("acme-erp", BusinessRules.slug("Acme  ERP!"))
    }

    @Test fun `a refresh never moves an address or a Firebase identity, but gives a built-in the sign-in it lacked`() {
        val old = business("taheri")
        val moved = old.copy(serverURL = "https://elsewhere.example", name = "TAHERI 2", android = business("other").android)
        val kept = BusinessRules.keepingIdentity(old, moved)
        assertEquals("https://erp.taheri.example", kept.serverURL)
        assertEquals(old.android, kept.android)
        assertEquals("TAHERI 2", kept.name)
        val unregistered = business("mina", android = false)
        assertEquals(business("mina").android, BusinessRules.keepingIdentity(unregistered, business("mina")).android)
    }
}

class BusinessListTests {
    private val bundled = listOf(business("taheri"), business("mina", android = false))

    @Test fun `a first launch has the built-ins and needs no network`() {
        assertEquals(listOf("taheri", "mina"), BusinessRules.merged(bundled, null, emptyList()).map { it.id })
    }

    @Test fun `the saved list keeps its order, and a built-in the person removed stays gone`() {
        val saved = listOf(business("acme"), business("taheri"))
        assertEquals(listOf("acme", "taheri", "mina"), BusinessRules.merged(bundled, saved, emptyList()).map { it.id })
        assertEquals(listOf("acme", "taheri"), BusinessRules.merged(bundled, saved, listOf("mina")).map { it.id })
        // nothing left at all is the built-ins again, never an empty phone
        assertEquals(listOf("taheri", "mina"), BusinessRules.merged(bundled, emptyList(), listOf("taheri", "mina")).map { it.id })
    }

    @Test fun `an app update that brings a built-in its Android sign-in reaches the saved copy`() {
        val savedMina = business("mina", android = false)
        val registered = listOf(business("taheri"), business("mina"))
        val merged = BusinessRules.merged(registered, listOf(business("taheri"), savedMina), emptyList())
        assertTrue(merged.first { it.id == "mina" }.androidReady)
    }

    @Test fun `the store keeps the list, the order and the hidden built-ins in its file`() {
        val file = File.createTempFile("businesses", ".json").apply { delete() }
        val store = BusinessStore(file, bundled)
        assertEquals(listOf("taheri", "mina"), store.list.map { it.id })
        store.put(business("acme"))
        store.move(2, 0)
        assertTrue(store.remove("mina"))
        assertEquals(listOf("acme", "taheri"), store.list.map { it.id })
        assertEquals(listOf("mina"), store.removed)
        // the last one cannot go
        assertTrue(store.remove("acme"))
        assertFalse(store.remove("taheri"))

        val again = BusinessStore(file, bundled)
        assertEquals(listOf("taheri"), again.list.map { it.id })
        // typing a hidden built-in's address brings it back
        again.put(business("mina"))
        assertEquals(listOf("taheri", "mina"), again.list.map { it.id })
        assertEquals(emptyList(), again.removed)
        file.delete()
    }

    @Test fun `the cold start opens the last business, else the build's own, else the first`() {
        val list = listOf(business("mina"), business("taheri"))
        assertEquals("mina", BusinessStore.start(list, "mina", "taheri").id)
        assertEquals("taheri", BusinessStore.start(list, "gone", "taheri").id)
        assertEquals("mina", BusinessStore.start(list, null, "none").id)
    }
}

class BusinessKeysTests {
    @Test fun `each business's outbox and write names are in files of their own`() {
        assertEquals("outbox-taheri.json", OutboxDisk.name("outbox", "taheri"))
        assertEquals("outbox-mina.json", OutboxDisk.name("outbox", "mina"))
        assertEquals("write-intents-acme-erp.json", OutboxDisk.name("write-intents", "acme-erp"))
        // an id cannot climb out of the folder
        assertEquals("outbox-evil.json", OutboxDisk.name("outbox", "../evil"))
        assertTrue(OutboxDisk.name("outbox", "taheri") != OutboxDisk.name("outbox", "mina"))
    }

    @Test fun `a setting belongs to its business unless it is the phone's own`() {
        assertEquals("erp.orderDraft.taheri", Prefs.keyFor("erp.orderDraft", "taheri"))
        assertEquals("erp.orderDraft.mina", Prefs.keyFor("erp.orderDraft", "mina"))
        assertEquals("erp.lastMe.acme", Prefs.keyFor("erp.lastMe", "acme"))
        // each business's Firebase project has its own sender, so each has its own push token
        assertEquals("erp.pushToken.mina", Prefs.keyFor("erp.pushToken", "mina"))
        for (own in listOf("deviceTheme", "erp.lock.enabled", Prefs.BUSINESS_CURRENT, Prefs.ASK_AT_LAUNCH, Prefs.WIDGET_BOTH)) {
            assertEquals(own, Prefs.keyFor(own, "mina"))
        }
    }

    @Test fun `a draft kept for one business is not read by another`() {
        val before = Prefs.scope
        try {
            Prefs.scope = { "taheri" }
            Prefs.putString("erp.orderDraft", "taheri's order")
            Prefs.scope = { "mina" }
            assertNull(Prefs.string("erp.orderDraft"))
            Prefs.putString("erp.orderDraft", "mina's order")
            assertEquals("mina's order", Prefs.string("erp.orderDraft"))
            assertEquals("taheri's order", Prefs.string("erp.orderDraft", "taheri"))
            Prefs.forget("mina")
            assertNull(Prefs.string("erp.orderDraft"))
            assertEquals("taheri's order", Prefs.string("erp.orderDraft", "taheri"))
            // the phone's own is the same whichever is open
            Prefs.putBool(Prefs.ASK_AT_LAUNCH, false)
            Prefs.scope = { "taheri" }
            assertEquals(false, Prefs.bool(Prefs.ASK_AT_LAUNCH))
        } finally {
            Prefs.scope = before
            Prefs.remove("erp.orderDraft", "taheri")
            Prefs.putBool(Prefs.ASK_AT_LAUNCH, null)
        }
    }
}

/** The built-ins the app ships are the iPhone's (businesses.mjs) with the Android sign-in of apps/android/houses.json: one source. */
class BundledBusinessesTests {
    private fun read(path: String): String = File(path).readText()

    @Test fun `the bundled list is Taheri's and Mina's, with the Android block from houses json`() {
        val list = Business.decodeList(read("src/main/assets/businesses.json"))
        assertEquals(listOf("taheri", "mina"), list.map { it.id })
        val houses = Json.parse(read("../houses.json")) as Map<*, *>
        val taheri = houses["taheri"] as Map<*, *>
        val a = assertNotNull(list[0].android)
        assertEquals(taheri["firebaseAndroidAppId"], a.firebase.appId)
        assertEquals(taheri["googleWebClientId"], a.googleWebClientId)
        assertEquals("gemstrack-pos", a.firebase.projectId)
        assertTrue(list[0].androidReady)
        // Mina has not registered shop.taheri.erp yet: no Android block, so its sign-in page says so rather than failing
        val mina = houses["mina"] as Map<*, *>
        assertEquals("", mina["firebaseAndroidAppId"])
        assertNull(list[1].android)
        assertEquals("https://erp.houseofmina.store", list[1].serverURL)
        for (b in list) assertNull(b.problem, b.id)
    }

    @Test fun `it is the iPhone's list in everything but the Android block`() {
        val ios = Json.parse(read("../../iphone/App/Resources/businesses.json")) as List<*>
        val mine = Json.parse(read("src/main/assets/businesses.json")) as List<*>
        assertEquals(ios.size, mine.size)
        for ((i, m) in ios.zip(mine)) {
            val withoutAndroid = (m as Map<*, *>).filterKeys { it != "android" }
            assertEquals(i, withoutAndroid)
        }
    }

    @Test fun `the server's descriptor has the same block under the same names`() {
        // src/lib/store-config.ts storeAppAndroid: { googleWebClientId, firebase: { appId, apiKey, projectId, senderId, storageBucket } }
        val b = assertNotNull(Business.decodeList(read("src/main/assets/businesses.json")).first().android)
        val map = Json.parse(Business.decodeList(read("src/main/assets/businesses.json")).first().toJson()) as Map<*, *>
        val block = map["android"] as Map<*, *>
        assertEquals(setOf("googleWebClientId", "firebase"), block.keys)
        assertEquals(setOf("apiKey", "appId", "projectId", "senderId", "storageBucket"), (block["firebase"] as Map<*, *>).keys)
        assertEquals(b.firebase.appId, (block["firebase"] as Map<*, *>)["appId"])
    }
}

class LaunchPickerTests {
    @Test fun `a cold start asks only with two or more businesses, unless it was switched off or is the demo`() {
        assertFalse(LaunchPicker.skips(demo = false, ask = true, count = 2))
        assertTrue(LaunchPicker.skips(demo = false, ask = true, count = 1))
        assertTrue(LaunchPicker.skips(demo = false, ask = false, count = 3))
        assertTrue(LaunchPicker.skips(demo = true, ask = true, count = 3))
    }

    @Test fun `the app is built under the picker only after the picker has painted, and a switch ends the question`() {
        try {
            LaunchPicker.startOver()
            LaunchPicker.begin("taheri", skip = false)
            assertTrue(LaunchPicker.showing("taheri", 2))
            // the picker's first frame is the picker alone
            assertFalse(LaunchPicker.mountsApp("taheri", 2))
            LaunchPicker.ready = true
            assertTrue(LaunchPicker.mountsApp("taheri", 2))
            // another business open than at launch (a card, the chip, the add sheet): nothing left to ask
            assertFalse(LaunchPicker.showing("mina", 2))
            assertFalse(LaunchPicker.showing("taheri", 1))
            LaunchPicker.dismiss()
            assertFalse(LaunchPicker.showing("taheri", 2))
            // it is decided once per process: a second Activity does not ask again
            LaunchPicker.begin("taheri", skip = false)
            assertFalse(LaunchPicker.showing("taheri", 2))

            LaunchPicker.startOver()
            LaunchPicker.begin("taheri", skip = true)
            assertFalse(LaunchPicker.showing("taheri", 2))
            assertTrue(LaunchPicker.mountsApp("taheri", 2))
        } finally {
            LaunchPicker.startOver()
        }
    }

    @Test fun `the launch report carries the picker's marks and may end on it`() {
        var t = 0L
        val log = LaunchLog { t }
        t = 120; log.mark("frame:first")
        t = 180; log.mark("picker:shown")
        t = 2400; log.mark("picked", "mina")
        val body = assertNotNull(log.finish("picker", "mina", "0.1.0 (2)", "Pixel"))
        val steps = (body["marks"] as List<*>).map { (it as Map<*, *>)["step"] }
        assertEquals(listOf("frame:first", "picker:shown", "picked", "ready:picker"), steps)
        assertEquals("android", body["platform"])
        assertNull(log.finish("home", "mina", "x", "y"))
    }
}
