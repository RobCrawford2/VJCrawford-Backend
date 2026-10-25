-- Migration 027: the product is now V J Crawford Law (a full law firm system,
-- not only conveyancing). Rename the demo firm to match; letters and bills
-- print the firm's name from here. Real firms' names are left alone.

UPDATE firms SET name = 'V J Crawford Law (Demo)' WHERE name = 'V J Crawford Conveyancing (Demo)';
