package erp.app.screens.settings

import erp.core.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** Import the Taheri Software book: the ERP's preview as read and the two writes as the iPhone sends them (TaheriBookImportSettings.swift). */
class TaheriBookImportLogicTests {
    private val answer = """{"source":"Demo book","inFile":{"customers":120,"karigars":9},
        "counts":{"customersNew":80,"customersSettled":30,"customersConflict":2,"karigarsNew":5,"karigarsSettled":3,"karigarsConflict":1},
        "halfMatches":[{"id":"h1","kind":"customer","name":"Amina Example","verdict":"same_name","matches":["Amina E."],"carried":3},
                       {"id":"h2","kind":"karigar","name":"Bilal Example","verdict":"same_phone","matches":["Bilal","Bilal Ustad"],"carried":1},
                       {"kind":"customer","name":"No id"}],
        "willAdd":{"only":85,"withHalfMatches":88},"fingerprint":"fp-1"}"""

    private val preview = BookPreview(Json.parse(answer) as Map<*, *>)

    @Test fun thePreviewIsReadAsTheErpCountedIt() {
        assertEquals("Demo book", preview.source)
        assertEquals(120, preview.customersInFile)
        assertEquals(9, preview.karigarsInFile)
        assertEquals(80, preview.count("customersNew"))
        assertEquals(1, preview.count("karigarsConflict"))
        assertEquals(0, preview.count("nothing"))
        // Half-matches are opt-in: what Import adds is the ERP's own number for each choice.
        assertEquals(85, preview.adds(takingHalfMatches = false))
        assertEquals(88, preview.adds(takingHalfMatches = true))
        assertEquals("fp-1", preview.fingerprint)
    }

    @Test fun aHalfMatchSaysWhoItMatchesAndWhatTheirLedgerCarries() {
        assertEquals("Same name as Amina E. — which carries 3 ledger entries", preview.halfMatches[0].line)
        assertEquals("Same number as Bilal, Bilal Ustad — which carries 1 ledger entry", preview.halfMatches[1].line)
        // A row with no id still has one, and no ledger says nothing about it.
        assertEquals("half-2", preview.halfMatches[2].id)
        assertEquals("Same name as ", preview.halfMatches[2].line)
    }

    @Test fun theWritesAreTheIphonesPayloads() {
        assertEquals(mapOf("preview" to true, "seq" to "s-1"), TaheriBookImportLogic.previewBody("s-1"))
        assertEquals(mapOf("fingerprint" to "fp-1", "takeConflicts" to false), TaheriBookImportLogic.importBody("fp-1", false))
        assertEquals(mapOf("fingerprint" to "fp-1", "takeConflicts" to true), TaheriBookImportLogic.importBody("fp-1", true))
        assertEquals(4 to 2, TaheriBookImportLogic.added(mapOf("customers" to 4, "karigars" to 2.0)))
        assertEquals(0 to 0, TaheriBookImportLogic.added(emptyMap()))
        assertEquals("1 record", TaheriBookImportLogic.records(1))
        assertEquals("0 records", TaheriBookImportLogic.records(0))
        assertFalse(TaheriBookImportLogic.previewBody("a") == TaheriBookImportLogic.previewBody("b"))
    }
}
