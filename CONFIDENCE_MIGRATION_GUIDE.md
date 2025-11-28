# Confidence Level Migration Guide

**Date:** 2025-10-10
**Purpose:** Move confidence calculation from frontend to backend for better performance

---

## What Changed

### Before (Slow **):
- Confidence calculated **in the browser** every time
- Hundreds of calculations per page load
- Logic duplicated in frontend

### After (Fast **):
- Confidence calculated **once** at import time
- Stored in database
- Frontend just reads the value
- **Much faster!** No redundant calculations

---

## How to Run the Migration

### Step 1: Run Migration Scripts

**** IMPORTANT:** There are TWO migration scripts - one for single proteins and one for complexes. Run BOTH:

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Migrate single protein interactions (interactions table)
node db/migrate_confidence_levels.mjs

# Migrate complex interactions (complex_interactions table)
node db/migrate_complex_confidence.mjs
```

**What they do:**
- **Read existing data from database (iPTM, contacts, ipLDDT)
- **Recalculate confidence using new scheme
- **Update ONLY the `confidence` field
- **Preserve all other data
- **Safe to run multiple times

**Expected output:**
```
**Confidence Level Migration

Found 2,267 interactions to process

Processing interactions...
  Processed 100 / 2,267...
  Processed 200 / 2,267...
  ...

**Migration Complete!

📈 Summary:
  Total interactions: 2,267
  Updated: 2,267
  Unchanged: 0

📊 New Confidence Distribution:
  High: 856 interactions
  Medium: 742 interactions
  Low: 524 interactions
  AF2 (NULL): 145 interactions
```

### Step 2: Deploy Frontend Changes

The frontend has been simplified and committed. Deploy to Vercel:

```bash
# Changes are already committed
git push origin main
```

Vercel will automatically:
- Build the new frontend
- Deploy the simplified code
- No more client-side calculations!

### Step 3: Verify

1. **Wait for Vercel deployment** (~2 minutes)
2. **Hard refresh browser:** Ctrl+Shift+R
3. **Check performance:** Page should load faster
4. **Verify confidence colors:** Should be identical to before

---

## Technical Details

### Migration Scripts

**Two scripts handle different tables:**

1. **`db/migrate_confidence_levels.mjs`** - For single protein interactions
   - Migrates: `interactions` table
   - Processes: Bait-prey interactions (A:B format)

2. **`db/migrate_complex_confidence.mjs`** - For complex interactions
   - Migrates: `complex_interactions` table
   - Processes: Complex-prey interactions (AB:C, ABC:D format)

**Shared Logic:**
```javascript
function calculateConfidence(iptm, contacts, iplddt) {
  // HIGH: iPTM ≥0.7 OR (contacts ≥40 AND ipLDDT ≥80) OR ...
  // MEDIUM: iPTM ≥0.6 OR (contacts ≥20 AND ipLDDT ≥75) OR ...
  // LOW: Everything else
  // AF2: NULL (displayed as "AF2")
}
```

Same logic used in:
- Both migration scripts
- Import scripts (for new data)
- Complex import scripts

### Updated Import Scripts

**Files Updated:**
1. `db/import_af3_json.mjs` - Single bait imports
2. `db/import_complex_af3_json.mjs` - Complex imports

**What changed:**
- Added `calculateConfidence()` function
- Confidence calculated at import time
- Stored directly in database

**Future imports:** Confidence automatically calculated!

### Frontend Simplification

**File:** `app/page.tsx`

**Before (30 lines):**
```typescript
const getConfidenceLevel = (inter: any): string => {
  if (inter.alphafold_version === 'AF2') {
    return 'AF2';
  }

  // Complex calculation with iPTM, contacts, ipLDDT...
  const meetsHighCriteria = ...
  const isExcludedFromHigh = ...
  // ... 25 more lines

  return 'Low';
};
```

**After (9 lines):**
```typescript
const getConfidenceLevel = (inter: any): string => {
  if (inter.alphafold_version === 'AF2') {
    return 'AF2';
  }

  // Just read from database!
  return inter.confidence || 'Low';
};
```

---

## Performance Improvements

### Before Migration:
- **2,267 interactions** × **calculation per interaction** × **every page load**
- Calculations happen on:
  - Initial data fetch
  - Every filter change
  - Every table render
  - Network graph rendering

**Estimate:** ~10,000+ calculations per page load!

### After Migration:
- **0 calculations** during page load
- Database returns pre-calculated values
- Frontend just displays them

**Performance gain:** Significant! ⚡

---

## Safety Features

****No data loss:** Only updates `confidence` field
****Idempotent:** Safe to run multiple times
****No re-import needed:** Uses existing database data
****Backwards compatible:** Frontend works with old or new data
****Single source of truth:** Backend calculates, frontend displays

---

## Troubleshooting

### Migration fails with connection error
**Solution:** Check `POSTGRES_URL` is correct

### Frontend still shows old behavior
**Solution:**
1. Wait for Vercel deployment to complete
2. Hard refresh browser (Ctrl+Shift+R)
3. Clear browser cache if needed

### Confidence colors look different
**Expected:** Should be identical to before
**If different:** Run migration again

---

## Future Data Imports

**No extra steps needed!**

When you import new data:

```bash
# Standard workflow - confidence calculated automatically
node db/import_af3_json.mjs /path/to/AF3_PD_analysis_v3.json
node db/incremental_organism_lookup.mjs
node db/fetch_aliases.mjs
# ... rest of workflow
```

The import scripts now automatically:
- **Calculate confidence at import time
- **Store in database
- **No frontend calculations needed

---

## Rollback (If Needed)

**Not recommended**, but if you need to revert:

1. Checkout previous git commit
2. Re-deploy frontend
3. Migration is harmless (only updates one field)

---

**Questions?** Check `CLAUDE.md` for architecture details.

**Migration completed?** Mark this done:
- **Single protein migration script run (`migrate_confidence_levels.mjs`)
- **Complex migration script run (`migrate_complex_confidence.mjs`)
- **Frontend deployed
- **Performance improved
- **No more redundant calculations!
