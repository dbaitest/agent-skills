-- Starter schema. Replace it with your own tables, one file per step, applied in file-name
-- order (001_, 002_, ...). Routines need a DELIMITER directive around their bodies.
CREATE TABLE customers (
    id           INT NOT NULL AUTO_INCREMENT,
    email        VARCHAR(320) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_email (email)
);
