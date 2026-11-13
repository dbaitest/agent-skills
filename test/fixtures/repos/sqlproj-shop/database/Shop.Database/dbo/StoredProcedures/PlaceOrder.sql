CREATE PROCEDURE dbo.PlaceOrder
    @email   NVARCHAR(320),
    @amount  DECIMAL(10, 2),
    @orderId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @customerId INT = (SELECT Id FROM dbo.Customers WHERE Email = @email);
    IF @customerId IS NULL
    BEGIN
        INSERT INTO dbo.Customers (Email, DisplayName) VALUES (@email, @email);
        SET @customerId = SCOPE_IDENTITY();
    END;
    INSERT INTO dbo.Orders (CustomerId, Amount) VALUES (@customerId, @amount);
    SET @orderId = SCOPE_IDENTITY();
END;
