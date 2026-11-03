package erp.app.ui

import erp.app.data.ErpApi
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QuickPrintTests {
    @Test fun aPdfStartsWithItsMagic() {
        assertTrue(looksLikePdf("%PDF-1.7 rest".toByteArray()))
        assertFalse(looksLikePdf("<html>sign in</html>".toByteArray()))
        assertFalse(looksLikePdf(ByteArray(0)))
    }

    @Test fun aRefusalIsSaidInWordsThePersonCanActOn() {
        assertEquals("This one is for the owners. Sign in as an owner to share it.", quickPdfProblem(ErpApi.Failure(403, "x")))
        assertEquals("The ERP is busy.", quickPdfProblem(ErpApi.Failure(503, "The ERP is busy.")))
    }
}
