-- Starter schema. Replace it with your own tables, one file per step, applied in file-name
-- order (001_, 002_, ...). SQL Server batches are separated by GO.
CREATE TABLE dbo.customers (
    id           INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_customers PRIMARY KEY,
    email        NVARCHAR(320) NOT NULL CONSTRAINT uq_customers_email UNIQUE,
    display_name NVARCHAR(200) NOT NULL,
    created_at   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
