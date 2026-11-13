CREATE VIEW dbo.CustomerOrderTotals
AS
SELECT c.Id AS CustomerId, c.Email, COUNT(o.Id) AS OrderCount, COALESCE(SUM(o.Amount), 0) AS TotalAmount
FROM dbo.Customers AS c
LEFT JOIN dbo.Orders AS o ON o.CustomerId = c.Id
GROUP BY c.Id, c.Email;
