# Import Duplicate Prevention Guide

## Problem Fixed (2025-10-23)

**Issue:** Importing both v3 and v4 JSON files created duplicate interactions
- 855 duplicate entries across entire database
- Same interaction stored twice (different `source_path`)

**Root Cause:**
- Unique constraint: `(bait_protein_id, prey_protein_id, source_path)`
- Different filenames (v3.json vs v4.json) = different source_path = duplicates allowed
- Old ON CONFLICT clause only updated on exact source_path match

## Solution Implemented

### Updated Script: `db/import_af3_json.mjs`

**Changed from:**
```javascript
ON CONFLICT (bait_protein_id, prey_protein_id, source_path)
DO UPDATE SET ...
```

**Changed to:**
```javascript
// Check if interaction exists (independent of source_path)
SELECT id FROM interactions
WHERE bait_protein_id = $1
  AND prey_protein_id = $2
  AND iptm = $3
  AND COALESCE(contacts_pae_lt_3, 0) = COALESCE($4, 0)

// If exists: UPDATE
// If not: INSERT
```

### Key Features

1. **Checks before inserting** - Looks for existing interaction by core metrics
2. **Updates existing** - If found, updates with new data (e.g., v4 updating v3)
3. **Source path preserved** - Latest import's path is saved
4. **Prevents duplicates** - No more v3/v4 duplicate rows

### Import Behavior

**First import (v3):**
```
**Q9UG01 ↔ Q9NWB7 (iPTM: 0.45, High) - NEW
```

**Second import (v4 of same data):**
```
**Q9UG01 ↔ Q9NWB7 (iPTM: 0.45, High) - UPDATED
```

**Different interaction:**
```
**Q9UG01 ↔ P12345 (iPTM: 0.82, High) - NEW
```

## Best Practices Going Forward

### Import Strategy

1. **Prefer v4 over v3** - Import v4 files when available (has ipSAE for complexes)
2. **Import order doesn't matter** - Script now handles v3→v4 or v4→v3 correctly
3. **Re-imports are safe** - Running same import twice just updates existing data

### Complex Interactions

**Status:** Already have proper UPSERT logic
- `import_complex_af3_json.mjs` - Checks source_path, skips if exists
- `import_complex_af3_v4.mjs` - Has UPSERT by `(bait, prey, source_path)`

**Note:** Complex imports work correctly because they explicitly check for duplicates

## Testing

### Verify Fix Works

```bash
# Import v3
export POSTGRES_URL="..."
node db/import_af3_json.mjs /path/to/data_v3.json

# Import v4 of same data (should UPDATE, not duplicate)
node db/import_af3_json.mjs /path/to/data_v4.json

# Check for duplicates (should be 0)
node db/check_croda8_duplicates.mjs  # or any other protein
```

### Check for Remaining Duplicates

```bash
node db/deduplicate_all_proteins.mjs  # Dry-run check
```

Should output: "Found 0 duplicate groups"

## Deduplication Scripts (If Needed)

### Single Protein
```bash
node db/deduplicate_single_protein.mjs <uniprot_id> --execute
```

### Global Cleanup
```bash
node db/deduplicate_all_proteins.mjs --execute
```

**Status:** Already executed (2025-10-23) - Database is clean

## Technical Details

### Matching Logic

**Interactions are considered the same if:**
- Same bait protein (protein_id)
- Same prey protein (protein_id)
- Same iPTM value
- Same contacts (NULL treated as 0)

**NOT matched by:**
- **source_path (prevents duplicates from different files)
- **interface_plddt (floating-point precision differences)

### Why This Works

1. **Core metrics identify interaction** - Protein pair + iPTM + contacts is unique
2. **NULL normalization** - v3 (NULL) and v4 (0) both treated as 0
3. **Float precision ignored** - ipLDDT can vary slightly between v3/v4
4. **Source updated** - Latest import path preserved for traceability

## Migration Path

If you have existing duplicates:

1. **Run global deduplication** (one-time cleanup):
   ```bash
   node db/deduplicate_all_proteins.mjs --execute
   ```

2. **Update import script** (prevents future duplicates):
   - Already done in `db/import_af3_json.mjs`

3. **Import freely** - No more duplicates will be created

## Complex vs Single-Protein Imports

### Complex Interactions
- **Scripts:** `import_complex.sh`, `import_complex_v4.sh`
- **Behavior:** Proper UPSERT, no duplicates
- **No changes needed**

### Single-Protein Interactions
- **Script:** `import_af3_json.mjs`
- **Previous:** Created duplicates on v3+v4 import
- **Now:** Updates existing, no duplicates **

## Summary

****Fixed:** Import script now prevents duplicates
****Cleaned:** Database deduplicated (855 entries removed)
****Safe:** Can import v3 and v4 without creating duplicates
****Preserved:** All v4 data (with ipSAE) kept during cleanup

**Result:** Import the same data as many times as you want - no more duplicates!
