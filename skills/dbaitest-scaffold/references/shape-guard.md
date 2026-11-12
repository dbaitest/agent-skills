# The shape guard

Tests share one container and one schema per engine. A test that drops, adds or re-types a
column on a shared table would make the next test fail for the wrong reason. The guard
snapshots every table, view and routine after the schema is applied; `DbAiTestBase` re-reads
them after every test and fails the test that changed one:

```
[ShapeGuard] MsSqlCustomerTests.Adds_A_Column left dbo.customers columns changed (id,email) -> (id,email,probe)
```

The name is the concrete test class (one per engine) and the test method.

- The culprit is blamed once. An object that is put back is forgotten, so the next test to
  break it is blamed again.
- Objects a test creates itself are not watched, only the schema as applied.
- It detects; it does not repair. Fix the test: restore what it changed in a `finally` block,
  or create its own table instead of altering a shared one.
- To only log leaks instead of failing: `protected override bool FailOnShapeLeak => false;`.

Rows are not shape: `Harness.CleanAsync()` (the generated `[TestInitialize]` calls it) starts
each test from empty tables with identity counters reset.
