-- =============================================================
-- Migration: Fix malformed booking_documents JSON
-- =============================================================
-- Background:
--   A previous version of the upload code spread a URL string
--   into an object, producing records like {"0":"h","1":"t",...}.
--   This script detects those records and reconstructs them.
--
-- Safe to run multiple times (idempotent).
-- Run in the Supabase SQL Editor or via supabase db push.
-- =============================================================

-- Step 1: Preview what would be fixed (run this first)
SELECT
  id,
  invoice_no,
  jsonb_array_length(booking_documents) AS doc_count,
  booking_documents
FROM bookings
WHERE
  booking_documents IS NOT NULL
  AND jsonb_typeof(booking_documents) = 'array'
  AND jsonb_array_length(booking_documents) > 0
  AND (booking_documents -> 0) ? '0'   -- first element has numeric key '0'
LIMIT 20;

-- =============================================================
-- Step 2: Fix malformed records
-- Reconstructs each element where numeric keys are present,
-- preserving any elements that are already well-formed.
-- =============================================================

UPDATE bookings
SET booking_documents = (
  SELECT jsonb_agg(
    CASE
      -- Well-formed: already has a "url" key → keep as-is
      WHEN elem ? 'url' THEN elem

      -- Malformed: numeric keys ("0","1",...) → reconstruct URL string
      WHEN elem ? '0' THEN jsonb_build_object(
        'url',
        (
          SELECT string_agg(val, '' ORDER BY key::int)
          FROM jsonb_each_text(elem) AS t(key, val)
          WHERE key ~ '^\d+$'
        ),
        'filename', COALESCE(elem->>'filename', 'document'),
        'size',     (elem->>'size')::bigint,
        'uploaded_at', COALESCE(elem->>'uploaded_at', NOW()::text),
        'uploaded_by', elem->>'uploaded_by'
      )

      -- Unknown shape: keep unchanged
      ELSE elem
    END
  )
  FROM jsonb_array_elements(booking_documents) AS elem
)
WHERE
  booking_documents IS NOT NULL
  AND jsonb_typeof(booking_documents) = 'array'
  AND jsonb_array_length(booking_documents) > 0
  AND (booking_documents -> 0) ? '0';

-- =============================================================
-- Step 3: Verify — should return 0 rows after migration
-- =============================================================
SELECT COUNT(*) AS remaining_malformed
FROM bookings
WHERE
  booking_documents IS NOT NULL
  AND jsonb_typeof(booking_documents) = 'array'
  AND jsonb_array_length(booking_documents) > 0
  AND (booking_documents -> 0) ? '0';
