CREATE OR REPLACE FUNCTION invoice_total(p_invoice_id INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN COALESCE((SELECT SUM(amount) FROM invoice_lines WHERE invoice_id = p_invoice_id), 0);
END;
$$;
