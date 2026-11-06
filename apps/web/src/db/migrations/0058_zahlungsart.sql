-- Zahlungsart im Bestand: eindeutige deutsche Altwerte auf
-- bank_transfer | paypal | cash | card. Alles andere bleibt.
-- Vergleich auf lower(trim(payment_method)); ein zweiter Lauf
-- trifft payment_method <> '<ziel>' nicht mehr.

UPDATE "payments"
SET payment_method = 'bank_transfer'
WHERE lower(trim(payment_method)) IN ('ueberweisung', 'überweisung')
  AND payment_method <> 'bank_transfer';
--> statement-breakpoint
UPDATE "payments"
SET payment_method = 'cash'
WHERE lower(trim(payment_method)) = 'bar'
  AND payment_method <> 'cash';
--> statement-breakpoint
UPDATE "payments"
SET payment_method = 'card'
WHERE lower(trim(payment_method)) IN ('karte', 'ec', 'ec-karte')
  AND payment_method <> 'card';
--> statement-breakpoint
UPDATE "payments"
SET payment_method = 'paypal'
WHERE lower(trim(payment_method)) = 'paypal'
  AND payment_method <> 'paypal';
