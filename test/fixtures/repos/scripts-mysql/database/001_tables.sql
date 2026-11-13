CREATE TABLE products (
    id     INT NOT NULL AUTO_INCREMENT,
    sku    VARCHAR(64) NOT NULL,
    stock  INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_products_sku (sku)
) ENGINE = InnoDB;
