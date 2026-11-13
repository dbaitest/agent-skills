# Writing tests for an existing database

Tests go in the abstract `DatabaseTests` class (one copy of each test runs per engine class). The
generated `[TestInitialize]` calls `Harness.CleanAsync`, so every test starts from empty tables
with identity counters reset. Pass `TestContext.CancellationToken` to every call.

## Ground rules

- **Seed with SQL, assert through a second channel.** A procedure test checks the rows it wrote
  (or the view that reads them), not only what the procedure returned.
- **One behaviour per test**, named `Object_Does_What_When`: `PlaceOrder_Creates_The_Customer_When_The_Email_Is_New`.
- **The rule and its edge:** the happy path, then one rejection or boundary (a `CHECK` that fails,
  a duplicate, an empty input).
- **Every harness call opens its own connection.** Anything that depends on the session
  (`SCOPE_IDENTITY()`, `LAST_INSERT_ID()`, temp tables, a transaction) must run on one connection:
  `await using var connection = await Harness.OpenConnectionAsync(ct);`.
- **Find rows by natural key** (`WHERE email = @email`) rather than assuming ids, or return the id
  from the insert itself (`OUTPUT INSERTED.Id`, `RETURNING id`).
- **Never alter shared tables** in a test; the shape guard fails it (`shape-guard.md`).
- Errors from the database surface as the driver's exception, a `System.Data.Common.DbException`.

## Harness calls

The generated `.csproj` imports `DbAiTest.Core.Engine` (`DbParameterValue`, `DbEngine`) and
`DbAiTest.MSTest` for every file, so new test files need no `using` for them; add driver
namespaces (`Microsoft.Data.SqlClient`, `System.Data`, `System.Data.Common`) where used.

```csharp
await Harness.ExecuteAsync(sql, [new DbParameterValue("@email", "ada@example.test")], TestContext.CancellationToken);
var count = await Harness.QueryScalarAsync<int>(sql, [new DbParameterValue("@id", id)], TestContext.CancellationToken);
await using var connection = await Harness.OpenConnectionAsync(TestContext.CancellationToken); // for anything richer
```

Parameters are written `@name` on every engine. `QueryScalarAsync<T>` reads the first column of
the first row; `NULL` or no row gives `default`.

## SQL Server

A stored procedure with an output parameter, asserted through the table and a view:

```csharp
using System.Data;
using Microsoft.Data.SqlClient;

[TestMethod]
public async Task PlaceOrder_Creates_The_Customer_When_The_Email_Is_New()
{
    var orderId = await PlaceOrderAsync("ada@example.test", 25.00m);

    Assert.IsGreaterThan(0, orderId);
    Assert.AreEqual(1, await Harness.QueryScalarAsync<int>(
        "SELECT COUNT(*) FROM dbo.Customers WHERE Email = @email",
        [new DbParameterValue("@email", "ada@example.test")], TestContext.CancellationToken));
    Assert.AreEqual(25.00m, await Harness.QueryScalarAsync<decimal>(
        "SELECT TotalAmount FROM dbo.CustomerOrderTotals WHERE Email = @email",
        [new DbParameterValue("@email", "ada@example.test")], TestContext.CancellationToken));
}

private async Task<int> PlaceOrderAsync(string email, decimal amount)
{
    await using var connection = (SqlConnection)await Harness.OpenConnectionAsync(TestContext.CancellationToken);
    await using var command = new SqlCommand("dbo.PlaceOrder", connection) { CommandType = CommandType.StoredProcedure };
    command.Parameters.AddWithValue("@email", email);
    command.Parameters.AddWithValue("@amount", amount);
    var orderId = command.Parameters.Add("@orderId", SqlDbType.Int);
    orderId.Direction = ParameterDirection.Output;
    await command.ExecuteNonQueryAsync(TestContext.CancellationToken);
    return (int)orderId.Value;
}
```

A result set: read it with `command.ExecuteReaderAsync` on the same kind of connection. A scalar
function: `SELECT dbo.TaxFor(@amount)` with `QueryScalarAsync`.

## PostgreSQL

A function, seeded through its tables (`RETURNING` gives the id in one statement):

```csharp
[TestMethod]
public async Task Invoice_Total_Sums_Its_Lines()
{
    var invoiceId = await Harness.QueryScalarAsync<int>(
        "INSERT INTO invoices (customer) VALUES (@customer) RETURNING id",
        [new DbParameterValue("@customer", "ada")], TestContext.CancellationToken);
    foreach (var amount in new[] { 10.00m, 5.50m })
    {
        await Harness.ExecuteAsync(
            "INSERT INTO invoice_lines (invoice_id, amount) VALUES (@invoice, @amount)",
            [new DbParameterValue("@invoice", invoiceId), new DbParameterValue("@amount", amount)],
            TestContext.CancellationToken);
    }

    var total = await Harness.QueryScalarAsync<decimal>(
        "SELECT invoice_total(@invoice)", [new DbParameterValue("@invoice", invoiceId)], TestContext.CancellationToken);

    Assert.AreEqual(15.50m, total);
}
```

A procedure (PostgreSQL 11+): `CALL do_something(@a, @b)` with `ExecuteAsync`. A set-returning
function: `SELECT COUNT(*) FROM list_things(@x)`, or read it through `OpenConnectionAsync`.

## MySQL

A procedure through `CALL`, asserted on the table it changes:

```csharp
[TestMethod]
public async Task Receive_Stock_Adds_To_An_Existing_Product()
{
    await Harness.ExecuteAsync("CALL receive_stock(@sku, @quantity)",
        [new DbParameterValue("@sku", "A-1"), new DbParameterValue("@quantity", 3)], TestContext.CancellationToken);
    await Harness.ExecuteAsync("CALL receive_stock(@sku, @quantity)",
        [new DbParameterValue("@sku", "A-1"), new DbParameterValue("@quantity", 4)], TestContext.CancellationToken);

    Assert.AreEqual(7, await Harness.QueryScalarAsync<int>(
        "SELECT stock FROM products WHERE sku = @sku", [new DbParameterValue("@sku", "A-1")], TestContext.CancellationToken));
}
```

Output parameters: open a connection and use a `MySqlConnector.MySqlCommand` with
`CommandType.StoredProcedure`, as in the SQL Server example.

## Constraints and rejections (every engine)

```csharp
using System.Data.Common;

[TestMethod]
public async Task Order_Amount_Must_Be_Positive()
{
    await Assert.ThrowsAsync<DbException>(() => Harness.ExecuteAsync(
        "INSERT INTO orders (customer_id, amount) VALUES (@customer, 0)",
        [new DbParameterValue("@customer", await SeedCustomerAsync())], TestContext.CancellationToken));
}
```

Test the rule, not the message text (it differs per engine and server version). A unique
constraint: insert the same key twice and expect the second to throw. A foreign key: insert a
child whose parent does not exist.

## Reference data

`CleanAsync` empties every table, including reference data the schema seeds (lookup tables, a
dacpac post-deployment script). Re-insert what the tests need in a `[TestInitialize]` of the
abstract class, after the base class has cleaned; for a dacpac see `dacpac.md`.

## Application code

To test the app's own repositories or services, construct them with `Harness.ConnectionString`
(add a project reference from the test project to the app project), and assert through the
harness, not through the code under test.
