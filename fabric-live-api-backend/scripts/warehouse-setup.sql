-- ─────────────────────────────────────────────────────────────────────────────
-- Fabric Warehouse setup for fabric-live-api-backend (durable write-back target)
-- Run this in your Fabric Warehouse SQL query editor (or any T-SQL tool).
--
-- Fabric Warehouse T-SQL caveats reflected below:
--   • No IDENTITY columns (they behave differently in Fabric) — ids come from the app.
--   • Use datetime2 (not datetime) and varchar (UTF-8); nvarchar/datetime differ.
--   • PRIMARY KEY is allowed only as NOT ENFORCED (informational; not a constraint).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE dbo.LiveEvents (
    id          varchar(256)  NOT NULL,
    source      varchar(64)   NOT NULL,   -- "app" for write-back, "external-api" for ingest
    kind        varchar(128)  NOT NULL,
    metric      varchar(256)  NULL,
    value       float         NULL,
    unit        varchar(64)   NULL,
    eventTime   datetime2(3)  NOT NULL,
    ingestedAt  datetime2(3)  NOT NULL,
    payload     varchar(8000) NULL        -- JSON string; widen to varchar(max) if supported
);
GO

-- Optional: informational primary key (NOT ENFORCED is the only allowed form).
ALTER TABLE dbo.LiveEvents ADD CONSTRAINT PK_LiveEvents PRIMARY KEY NONCLUSTERED (id) NOT ENFORCED;
GO

-- ── Upsert pattern (if you switch the writer from append to MERGE) ────────────
-- Fabric Warehouse supports MERGE (GA). Stage rows, then:
--
-- MERGE dbo.LiveEvents AS t
-- USING (SELECT @id AS id, @kind AS kind /* ... */) AS s
--   ON t.id = s.id
-- WHEN MATCHED THEN UPDATE SET t.kind = s.kind /* ... */
-- WHEN NOT MATCHED THEN INSERT (id, kind /* ... */) VALUES (s.id, s.kind /* ... */);

-- Sanity check once write-back is flowing:
-- SELECT TOP (20) * FROM dbo.LiveEvents ORDER BY ingestedAt DESC;
