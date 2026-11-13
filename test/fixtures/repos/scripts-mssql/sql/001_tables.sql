CREATE TABLE dbo.Employees (
    Id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Employees PRIMARY KEY,
    Name      NVARCHAR(200) NOT NULL,
    ManagerId INT NULL CONSTRAINT FK_Employees_Manager REFERENCES dbo.Employees (Id)
);
GO
