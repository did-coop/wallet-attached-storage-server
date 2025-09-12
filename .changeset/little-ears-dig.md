---
"wallet-attached-storage-database": patch
---

fix ResourceRepository#toArray: previously it would error when run on PostgreSQL. Now it detects PostgreSQL and adjusts to a query that will not syntax error on psql.
