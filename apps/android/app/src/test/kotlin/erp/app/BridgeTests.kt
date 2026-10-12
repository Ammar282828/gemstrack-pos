package erp.app

import erp.app.web.BridgeProtocol
import erp.app.web.Files
import erp.core.Json
import java.io.File
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BridgeTests {
    private val host = "erp.example.test"

    @Test fun onlyTheErpsOwnMainFrameMayAsk() {
        assertTrue(BridgeProtocol.originAllowed("https", host, -1, true, host))
        assertTrue(BridgeProtocol.originAllowed("https", host, 443, true, host))
        assertTrue(BridgeProtocol.originAllowed("https", "ERP.Example.Test", -1, true, host))
    }

    @Test fun aFrameInsideTheErpPageNeverGetsTheSignInOrTheDeleteCode() {
        assertFalse(BridgeProtocol.originAllowed("https", host, -1, false, host), "a preview or video frame")
        assertFalse(BridgeProtocol.originAllowed("https", "www.instagram.com", -1, true, host))
        assertFalse(BridgeProtocol.originAllowed("http", host, -1, true, host))
        assertFalse(BridgeProtocol.originAllowed("https", host, 8443, true, host))
        assertFalse(BridgeProtocol.originAllowed("https", "$host.evil.test", -1, true, host))
        assertFalse(BridgeProtocol.originAllowed("https", null, -1, true, host))
        assertFalse(BridgeProtocol.originAllowed(null, host, -1, true, host))
        assertFalse(BridgeProtocol.originAllowed("file", host, -1, true, host))
    }

    @Test fun aCallNamesAPluginAndAMethod() {
        val c = BridgeProtocol.parse("""{"id":7,"plugin":"ERPNative","method":"secretRead","options":{"key":"deleteCode","reason":"Unlock"}}""")!!
        assertEquals("ERPNative", c.plugin)
        assertEquals("secretRead", c.method)
        assertEquals("deleteCode", c.options["key"])
        assertEquals(7L, c.id)
        assertEquals(emptyMap(), BridgeProtocol.parse("""{"plugin":"Share","method":"share"}""")!!.options)
        assertNull(BridgeProtocol.parse("""{"plugin":"Share"}"""))
        assertNull(BridgeProtocol.parse("not json"))
        assertNull(BridgeProtocol.parse(null))
        assertNull(BridgeProtocol.parse("[1]"))
    }

    @Test fun anAnswerFindsItsCallByIdAndARejectionCarriesCodeAndMessage() {
        assertEquals(mapOf("id" to 7L, "result" to emptyMap<String, Any?>()), Json.parse(BridgeProtocol.reply(7)))
        assertEquals(mapOf("id" to 7L, "result" to mapOf("has" to true)), Json.parse(BridgeProtocol.reply(7, mapOf("has" to true))))
        assertEquals(mapOf("id" to 8L, "error" to "cancelled|Cancelled"), Json.parse(BridgeProtocol.failure(8, "cancelled", "Cancelled")))
        assertEquals(mapOf("id" to null, "error" to "forbidden|Not this page's to ask"), Json.parse(BridgeProtocol.failure(null, "forbidden", "Not this page's to ask")))
    }

    @Test fun theShimIsTheCapacitorOneTheErpPageAlreadyKnows() {
        val s = BridgeProtocol.script
        for (needle in listOf("__erpNative", "isNativePlatform", "nativePromise", "addListener", "__erpEmit", "getPlatform: () => 'android'", "window.erp")) {
            assertTrue(s.contains(needle), needle)
        }
        // the page's reading of a rejection: "code|message"
        assertTrue(s.contains("err.code"))
        assertEquals(BridgeProtocol.OBJECT_NAME, "erp")
    }

    @Test fun aDownloadHookCarriesItsAddressAndNameAsText() {
        val js = BridgeProtocol.downloadHook("blob:https://erp.example.test/abc\"; alert(1);//", "Invoice \"7\".pdf")
        assertTrue(js.contains("fetch(\"blob:https://erp.example.test/abc\\\"; alert(1);//\""))
        assertTrue(js.contains("\"Invoice \\\"7\\\".pdf\""))
        assertTrue(js.contains("Filesystem") && js.contains("Share"))
    }

    @Test fun filesStayUnderTheirFolder() {
        val root = File.createTempFile("erp", "dir").also { it.delete(); it.mkdirs() }
        assertEquals(File(root, "shared/1-0/Invoice.pdf").canonicalPath, Files.resolve(root, "shared/1-0/Invoice.pdf").canonicalPath)
        assertTrue(Files.resolve(root, "../../etc/passwd").canonicalPath.startsWith(root.canonicalPath))
        assertTrue(Files.resolve(root, "/etc/passwd").canonicalPath.startsWith(root.canonicalPath))
        assertEquals(File(root, "file").canonicalPath, Files.resolve(root, "").canonicalPath)
        root.deleteRecursively()
    }
}
