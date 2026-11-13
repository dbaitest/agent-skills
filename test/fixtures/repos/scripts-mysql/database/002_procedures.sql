DELIMITER //
CREATE PROCEDURE receive_stock(IN p_sku VARCHAR(64), IN p_quantity INT)
BEGIN
    INSERT INTO products (sku, stock) VALUES (p_sku, p_quantity)
    ON DUPLICATE KEY UPDATE stock = stock + p_quantity;
END //
DELIMITER ;
