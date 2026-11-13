CREATE PROCEDURE dbo.CountReports
    @managerId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) FROM dbo.Employees WHERE ManagerId = @managerId;
END;
GO
