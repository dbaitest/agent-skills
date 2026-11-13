# Calling a database object, per engine

The harness is the same on every engine; the call syntax is not. This page holds the calls, and
the examples the CI compiles against a real schema (an example an agent copies is one that
builds and passes).

## The calls

```csharp
await Harness.ExecuteAsync(sql, [new DbParameterValue("@name", value)], TestContext.CancellationToken);
var count = await Harness.QueryScalarAsync<int>(sql, [new DbParameterValue("@id", id)], TestContext.CancellationToken);
await using var connection = await Harness.OpenConnectionAsync(TestContext.CancellationToken);
```

- Parameters are written `@name` on every engine; the driver takes the value as it is.
- `QueryScalarAsync<T>` reads the first column of the first row; `NULL` or no row gives `default`.
- **Every harness call opens its own connection.** Anything that depends on the session
  (`SCOPE_IDENTITY()`, `LAST_INSERT_ID()`, a temp table, a transaction) must run on one
  connection: open one and use the driver's own command.
- Errors from the database surface as the driver's exception, a `System.Data.Common.DbException`.

## SQL Server

A stored procedure with an output parameter, read on one connection:

```csharp
using System.Data;
using Microsoft.Data.SqlClient;

await using var connection = (SqlConnection)await Harness.OpenConnectionAsync(TestContext.CancellationToken);
await using var command = new SqlCommand("dbo.PlaceOrder", connection) { CommandType = CommandType.StoredProcedure };
command.Parameters.AddWithValue("@email", "ada@example.test");
command.Parameters.AddWithValue("@amount", 25.00m);
var orderId = command.Parameters.Add("@orderId", SqlDbType.Int);
orderId.Direction = ParameterDirection.Output;
await command.ExecuteNonQueryAsync(TestContext.CancellationToken);
```

A result set: `command.ExecuteReaderAsync` on the same kind of connection. A scalar function:
`SELECT dbo.TaxFor(@amount)`.

A view, and the row of a customer that has no order yet:

<!-- snippet: sqlproj-shop -->
```csharp
[TestMethod]
public async Task CustomerOrderTotals_Counts_No_Order_For_A_New_Customer()
{
    await Harness.ExecuteAsync(
        "INSERT INTO dbo.Customers (Email, DisplayName) VALUES (@email, @name)",
        [new DbParameterValue("@email", "ada@example.test"), new DbParameterValue("@name", "Ada")],
        TestContext.CancellationToken);

    var orderCount = await Harness.QueryScalarAsync<int>(
        "SELECT OrderCount FROM dbo.CustomerOrderTotals WHERE Email = @email",
        [new DbParameterValue("@email", "ada@example.test")], TestContext.CancellationToken);
    var total = await Harness.QueryScalarAsync<decimal>(
        "SELECT TotalAmount FROM dbo.CustomerOrderTotals WHERE Email = @email",
        [new DbParameterValue("@email", "ada@example.test")], TestContext.CancellationToken);

    Assert.AreEqual(0, orderCount);
    Assert.AreEqual(0m, total);
}
```

A foreign key that rejects an order for a customer that does not exist:

<!-- snippet: sqlproj-shop -->
```csharp
using System.Data.Common;

[TestMethod]
public async Task Orders_Reject_A_Customer_That_Does_Not_Exist()
{
    await Assert.ThrowsAsync<DbException>(() => Harness.ExecuteAsync(
        "INSERT INTO dbo.Orders (CustomerId, Amount) VALUES (@customer, @amount)",
        [new DbParameterValue("@customer", 4242), new DbParameterValue("@amount", 10.00m)],
        TestContext.CancellationToken));

    Assert.AreEqual(0, await Harness.QueryScalarAsync<int>(
        "SELECT COUNT(*) FROM dbo.Orders", TestContext.CancellationToken));
}
```

## PostgreSQL

A function, seeded through its table (`RETURNING` gives the id in one statement):

<!-- snippet: scripts-postgres -->
```csharp
[TestMethod]
public async Task Invoice_Total_Is_Zero_For_An_Invoice_Without_Lines()
{
    var invoiceId = await Harness.QueryScalarAsync<int>(
        "INSERT INTO invoices (customer) VALUES (@customer) RETURNING id",
        [new DbParameterValue("@customer", "ada")], TestContext.CancellationToken);

    var total = await Harness.QueryScalarAsync<decimal>(
        "SELECT invoice_total(@invoice)",
        [new DbParameterValue("@invoice", invoiceId)],
        TestContext.CancellationToken);

    Assert.AreEqual(0m, total);
}
```

A check constraint that rejects a line with a negative amount:

<!-- snippet: scripts-postgres -->
```csharp
using System.Data.Common;

[TestMethod]
public async Task Invoice_Lines_Reject_A_Negative_Amount()
{
    var invoiceId = await Harness.QueryScalarAsync<int>(
        "INSERT INTO invoices (customer) VALUES (@customer) RETURNING id",
        [new DbParameterValue("@customer", "ada")], TestContext.CancellationToken);

    await Assert.ThrowsAsync<DbException>(() => Harness.ExecuteAsync(
        "INSERT INTO invoice_lines (invoice_id, amount) VALUES (@invoice, @amount)",
        [new DbParameterValue("@invoice", invoiceId), new DbParameterValue("@amount", -1.00m)],
        TestContext.CancellationToken));

    Assert.AreEqual(0, await Harness.QueryScalarAsync<int>(
        "SELECT COUNT(*) FROM invoice_lines", TestContext.CancellationToken));
}
```

A procedure (PostgreSQL 11+): `CALL do_something(@a, @b)` with `ExecuteAsync`. A set-returning
function: `SELECT COUNT(*) FROM list_things(@x)`, or read it through `OpenConnectionAsync`.

## MySQL

A procedure through `CALL`, asserted on the table it changes. It creates the row when it is not
there yet:

<!-- snippet: scripts-mysql -->
```csharp
[TestMethod]
public async Task Receive_Stock_Creates_A_Product_That_Does_Not_Exist_Yet()
{
    await Harness.ExecuteAsync("CALL receive_stock(@sku, @quantity)",
        [new DbParameterValue("@sku", "B-2"), new DbParameterValue("@quantity", 5)],
        TestContext.CancellationToken);

    Assert.AreEqual(5, await Harness.QueryScalarAsync<int>(
        "SELECT stock FROM products WHERE sku = @sku",
        [new DbParameterValue("@sku", "B-2")], TestContext.CancellationToken));
}
```

A unique key that rejects a second product with the same sku:

<!-- snippet: scripts-mysql -->
```csharp
using System.Data.Common;

[TestMethod]
public async Task Products_Reject_A_Duplicate_Sku()
{
    await Harness.ExecuteAsync(
        "INSERT INTO products (sku, stock) VALUES (@sku, @stock)",
        [new DbParameterValue("@sku", "C-3"), new DbParameterValue("@stock", 1)],
        TestContext.CancellationToken);

    await Assert.ThrowsAsync<DbException>(() => Harness.ExecuteAsync(
        "INSERT INTO products (sku, stock) VALUES (@sku, @stock)",
        [new DbParameterValue("@sku", "C-3"), new DbParameterValue("@stock", 2)],
        TestContext.CancellationToken));

    Assert.AreEqual(1, await Harness.QueryScalarAsync<int>(
        "SELECT COUNT(*) FROM products WHERE sku = @sku",
        [new DbParameterValue("@sku", "C-3")], TestContext.CancellationToken));
}
```

Output parameters: open a connection and use a `MySqlConnector.MySqlCommand` with
`CommandType.StoredProcedure`, as in the SQL Server example.

## Seeding and rejection, on every engine

Seed **before** the assertion, so the only statement that may throw is the one under test, and
check that nothing was written. Test the rule, not the message: it differs per engine and per
server version.

```csharp
await Assert.ThrowsAsync<DbException>(() => Harness.ExecuteAsync(sql, parameters, TestContext.CancellationToken));
Assert.AreEqual(0, await Harness.QueryScalarAsync<int>("SELECT COUNT(*) FROM the_table", TestContext.CancellationToken));
```

A unique constraint: insert the same key twice and expect the second to throw. A foreign key:
insert a child whose parent does not exist. A check constraint: insert a value the rule forbids.
