package erp.app.screens.invoices

import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.InvoiceItem

/** Made-up invoices for the tests: no real names, numbers or amounts. */
internal object Fixtures {
    fun item(
        sku: String = "RNG-001",
        name: String = "Ruby ring",
        total: Double = 100_000.0,
        extra: Map<String, Any?> = emptyMap(),
    ): InvoiceItem = InvoiceItem.fromMap(
        mapOf("sku" to sku, "name" to name, "itemTotal" to total, "metalType" to "gold", "karat" to "21k", "metalWeightG" to 5.0) + extra,
    )

    fun invoice(
        id: String = "INV-000001",
        customerName: String = "Sana Demo",
        grandTotal: Double = 100_000.0,
        amountPaid: Double = 0.0,
        createdAt: String = "2026-10-12T06:00:00.000Z",
        extra: Map<String, Any?> = emptyMap(),
        items: List<Map<String, Any?>> = listOf(mapOf("sku" to "RNG-001", "name" to "Ruby ring", "itemTotal" to grandTotal)),
    ): Invoice = Invoice.fromMap(
        mapOf(
            "id" to id, "customerName" to customerName, "grandTotal" to grandTotal, "subtotal" to grandTotal,
            "amountPaid" to amountPaid, "balanceDue" to grandTotal - amountPaid, "createdAt" to createdAt,
            "items" to items,
        ) + extra,
    )

    fun customer(id: String = "c1", name: String = "Sana Demo", phone: String? = "0300 1234567"): Customer =
        Customer.fromMap(mapOf("id" to id, "name" to name, "phone" to phone))
}
