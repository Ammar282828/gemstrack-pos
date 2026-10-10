# Native workshop, October 2026

The workshop uses the same house surfaces and ledger hierarchy as Orders and Invoices. Each piece,
karigar and given item has a separate card. Job cards adapt to the available width with a wider minimum
than the simpler recipient cards; accessibility sizes use one column. Filters scroll with the queue,
and an empty queue keeps them reachable. Whole-workshop totals remain distinct from filtered counts.

## Functions retained

| Place | Available functions |
| --- | --- |
| Workshop queue | Search; taken-by, source, karigar and status filters; attention, unassigned and not-given queues; list, stage and karigar grouping |
| Order and invoice pieces | Assign or remove a karigar, hand over or undo handover, complete or reopen, open the source document and karigar |
| Stock work | Assign stock work, edit making details, change status, hand over or undo handover, delete with the owner's code |
| Instructions | Expand the full instructions on the job card |
| Karigars | Working/free filters, contact information, open hisaab and workload; all stock jobs remain reachable without the former 20-job cutoff |
| Karigar work | Bench, estimated metal weights, given items, stock work, profile and share list |
| Payments & khata | Existing gold and cash khata, payments, silver, starting and settling pay batches, settled batches, direct payments and protected deletions |
| Given items | Record, return, edit, delete and open recipient; date, notes and Given by retained |

Every card has a visible action menu; controls do not depend on discovering a long press or swipe.
Order/invoice making details retain their existing link to the ERP workshop editor. Stock details and
assignment forms remain native. The redesign does not change write operations, price calculations,
assignment-versus-handover semantics or owner/staff permissions.

## Validation

- Simulator visual checks on iPhone 18 Pro Max and iPad Pro, including the house's dark appearance.
- Focused UI checks cover empty-queue recovery, the job menu, native stock assignment, Given-item editing
  and reaching the existing payment, silver and settlement actions.
- Shared workshop, workshop-details, karigar-position, karigar-pay and workshop-write suites: 68 tests.
- ERPCore: 368 tests. No production record was changed during UI checks.

The UI checks use fabricated demo books. Production write behavior is covered by the existing shared
operation tests; this audit does not claim to have made live payments or completed real jobs.
