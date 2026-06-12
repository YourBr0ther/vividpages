-- Before the partial unique index below can build, existing data must not
-- contain two 'running' runs for the same book. Mark stale 'running' rows as
-- failed ('superseded'): everything except the latest running run per book,
-- and the latest one too when it hasn't written progress in 10 minutes
-- (crashed worker / evaporated job).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY book_id ORDER BY started_at DESC) AS rn,
    updated_at
  FROM pipeline_runs
  WHERE status = 'running'
)
UPDATE pipeline_runs AS p
SET status = 'failed', error = 'superseded', updated_at = now()
FROM ranked AS r
WHERE p.id = r.id
  AND (r.rn > 1 OR r.updated_at < now() - interval '10 minutes');
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_runs_book_running_unique" ON "pipeline_runs" USING btree ("book_id") WHERE "pipeline_runs"."status" = 'running';
