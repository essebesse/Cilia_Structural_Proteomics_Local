# Mode Switching Bugs Analysis

## Overview

This document analyzes bugs in the frontend mode switching logic when users toggle between:
- **Search Mode**: Single Protein vs Protein Complex
- **Analysis Mode**: v3 (Interface Quality) vs v4 (ipSAE)

## State Variables

```typescript
searchMode: 'protein' | 'complex'      // What type of entity is selected
filterMode: 'v3' | 'ipsae'             // Which analysis mode
selectedBait: string                    // Selected single protein ID
selectedComplex: string                 // Selected complex name
baitProteins: []                        // List of single proteins (from /api/baits)
complexes: []                           // List of complexes (from /api/complexes)
confidenceFilters: {High, Medium, Low, AF2}  // v3 mode filters
ipsaeFilters: {High, Medium, Low}       // v4 mode filters
```

## Critical Bugs Identified

### 🔴 BUG #1: Dropdown Lists Don't Update When Switching Modes

**Location**: `page.tsx:349-353`, `/api/baits/route.ts`, `/api/complexes/route.ts`

**Problem**:
1. Dropdown lists fetch only once on mount (no dependency on `filterMode`)
2. `/api/baits` counts ALL interactions (doesn't consider v3 vs v4)
3. `/api/complexes` counts ALL complex interactions (doesn't differentiate v3 vs v4)

**User Experience**:
```
User Action                         | What User Sees        | What's Actually Available
------------------------------------|-----------------------|-------------------------
1. Page loads in v3 mode            | "IFT74_81 (14)"       | 14 interactions in v3
2. User switches to v4 mode         | "IFT74_81 (14)"       | **WRONG - only 3 in v4!
3. User selects IFT74_81           | Shows 3 interactions  | User confused 😕
```

**Root Cause**:
- `useEffect(() => { fetchBaitProteins(); fetchComplexes(); }, [])` has no dependencies
- API endpoints don't accept `mode` parameter
- Counts are static regardless of current mode

**Fix Required**:
```typescript
// 1. Add mode dependency to useEffect
useEffect(() => {
  fetchBaitProteins();
  fetchComplexes();
}, [filterMode]); // ** Re-fetch when mode changes

// 2. Update API endpoints to accept mode parameter
GET /api/baits?mode=v3         // Count only v3 interactions
GET /api/baits?mode=ipsae      // Count only v4 (ipSAE) interactions
GET /api/complexes?mode=v3     // Count only v3 complex interactions
GET /api/complexes?mode=ipsae  // Count only v4 complex interactions

// 3. Update fetchBaitProteins/fetchComplexes to pass mode
const fetchBaitProteins = async () => {
  const res = await fetch(`/api/baits?mode=${filterMode}`);
  // ...
};
```

---

### 🟡 BUG #2: Double Filtering in v3 Mode for Complexes

**Location**: `page.tsx:136-143`, `/api/complex-interactions/[id]/route.ts:148-158`

**Problem**:
Complex interactions in v3 mode are filtered TWICE:
1. **Server-side**: API filters by `ci.confidence = ANY($confidenceLevels)`
2. **Client-side**: Frontend recalculates confidence and filters again

**Code Flow**:
```javascript
// SERVER (API)
if (mode === 'v3') {
  // Filter by database confidence field
  query += ` AND ci.confidence = ANY($${queryParams.length + 1})`;
  queryParams.push(confidenceLevels); // ['High', 'Medium', 'Low']
}

// CLIENT (Frontend)
if (filterMode === 'v3') {
  data = data.filter((inter: any) => {
    const level = getConfidenceLevel(inter); // RECALCULATES from metrics
    return activeFilters[level];
  });
}
```

**Why This Causes Issues**:
- Database confidence might be out of sync with calculated confidence
- If a complex interaction has `confidence='Low'` in DB but calculates as 'High' based on metrics:
  - Server filters it out (if Low is unchecked)
  - Client would have kept it (if High is checked)
  - User never sees it even though it matches their criteria

**Fix Required**:
```javascript
// OPTION 1: Remove server-side filtering in v3 mode for complexes
// Let client do all the filtering based on recalculated confidence

// In /api/complex-interactions/[id]/route.ts
if (confidenceLevels.length > 0) {
  if (mode === 'ipsae') {
    // v4: Server-side filter by ipsae_confidence (accurate)
    interactionsQuery += ` AND ci.ipsae_confidence = ANY($${queryParams.length + 1})`;
    queryParams.push(confidenceLevels);
  }
  // **Remove v3 server-side filtering - let client handle it
}

// Client-side filtering remains the same
// OR

// OPTION 2: Remove client-side filtering in v3 mode
// Trust the database confidence values (after migration)
```

---

### 🟡 BUG #3: Confidence Filter State Not Reset When Switching Modes

**Location**: `page.tsx:38-49`

**Problem**:
When switching from v3 to v4 mode:
- v3 uses `confidenceFilters` (High, Medium, Low, AF2)
- v4 uses `ipsaeFilters` (High, Medium, Low)

But there's no synchronization between them.

**User Experience**:
```
1. User in v3 mode unchecks "Low" confidence
2. User switches to v4 mode
3. "Low" is still checked in v4 (different state)
4. User sees different results than expected
```

**Fix Required**:
```typescript
// Option 1: Sync filter states when switching modes
useEffect(() => {
  if (filterMode === 'ipsae') {
    // Sync ipsaeFilters from confidenceFilters
    setIpsaeFilters({
      High: confidenceFilters.High,
      Medium: confidenceFilters.Medium,
      Low: confidenceFilters.Low,
    });
  } else {
    // Sync confidenceFilters from ipsaeFilters
    setConfidenceFilters(prev => ({
      ...prev,
      High: ipsaeFilters.High,
      Medium: ipsaeFilters.Medium,
      Low: ipsaeFilters.Low,
    }));
  }
}, [filterMode]);

// Option 2: Use single confidence filter state
// More complex but cleaner
const [confidenceFilters, setConfidenceFilters] = useState({
  High: true,
  Medium: true,
  Low: true,
});
// AF2 checkbox only shown in v3 mode
```

---

### 🟡 BUG #4: Complex Selection Not Preserved When Switching v3 ↔ v4

**Location**: `page.tsx:322-332`

**Current Behavior**:
```typescript
useEffect(() => {
  if (searchMode === 'complex' && selectedComplex) {
    handleComplexSelection(selectedComplex); // **Re-fetches complex data
  } else if (searchMode === 'protein' && searchTerm) {
    handleSearch(); // **Re-fetches protein data
  }
}, [confidenceFilters, ipsaeFilters, filterMode]);
```

**Problem**:
The `useEffect` dependencies include `confidenceFilters` and `ipsaeFilters`, but it only uses one based on `filterMode`. This causes unnecessary re-fetches.

**Better Implementation**:
```typescript
// Split into two useEffects for clarity
useEffect(() => {
  // Re-fetch when v3 filters change (only in v3 mode)
  if (filterMode === 'v3') {
    if (searchMode === 'complex' && selectedComplex) {
      handleComplexSelection(selectedComplex);
    } else if (searchMode === 'protein' && searchTerm) {
      handleSearch();
    }
  }
}, [confidenceFilters]);

useEffect(() => {
  // Re-fetch when v4 filters change (only in v4 mode)
  if (filterMode === 'ipsae') {
    if (searchMode === 'complex' && selectedComplex) {
      handleComplexSelection(selectedComplex);
    } else if (searchMode === 'protein' && searchTerm) {
      handleSearch();
    }
  }
}, [ipsaeFilters]);

useEffect(() => {
  // Re-fetch when mode changes
  if (searchMode === 'complex' && selectedComplex) {
    handleComplexSelection(selectedComplex);
  } else if (searchMode === 'protein' && searchTerm) {
    handleSearch();
  }
}, [filterMode]);
```

---

### 🟢 BUG #5: Protein Dropdown Selection Not Showing in v4 Mode

**Location**: `/api/interactions/[id]/route.ts:86-94`

**Current Behavior**:
```javascript
if (filterMode === 'ipsae') {
  // ipSAE mode: STRICT - only show v4 data with ipSAE scores
  query += ` AND i.ipsae IS NOT NULL`;
}
```

**Problem**:
Single protein interactions (from `interactions` table) might not have ipSAE scores. When user switches to v4 mode and selects a protein, they get 0 results even though the dropdown shows interactions.

**Fix Required**:
Same as Bug #1 - dropdown needs to show accurate counts based on mode.

---

## Testing Scenarios

### Scenario 1: v3 → v4 Mode Switch with Complex Selected

**Steps**:
1. Select "IFT74 & IFT81" complex in v3 mode
2. Verify 14 interactions shown
3. Switch to v4 (ipSAE) mode
4. **Expected**: Dropdown updates to show actual v4 count (e.g., "3 interactions")
5. **Expected**: Table shows 3 interactions with ipSAE scores
6. **Actual**: **Dropdown still shows "14 interactions", table shows 3

### Scenario 2: v4 → v3 Mode Switch with Complex Selected

**Steps**:
1. Select "IFT52 & IFT46" complex in v4 mode
2. Verify 3 interactions with ipSAE scores
3. Switch to v3 mode
4. **Expected**: All interactions shown (including those without ipSAE)
5. **Expected**: Dropdown updates to show v3 count
6. **Actual**: **Dropdown count doesn't update

### Scenario 3: Protein → Complex → Protein Mode Switch

**Steps**:
1. Select protein "Q8NEZ3" from dropdown
2. Switch to complex, select "IFT74_81"
3. Switch back to protein mode
4. **Expected**: Previous protein still selected, interactions shown
5. **Actual**: **Works (selectedBait cleared, but searchTerm preserved)

### Scenario 4: Confidence Filter Changes in v3 Mode

**Steps**:
1. Complex selected, showing 14 interactions
2. Uncheck "Low" confidence
3. **Expected**: Some interactions filtered out
4. **Actual**: **Works (useEffect triggers re-fetch)

### Scenario 5: Switch Mode Then Change Filters

**Steps**:
1. v3 mode, all filters checked
2. Switch to v4 mode
3. Uncheck "Low" in v4
4. Switch back to v3
5. **Expected**: v3 "Low" filter state independent
6. **Actual**: **Works (separate filter states)

---

## Recommended Fix Priority

1. **🔴 HIGH**: Bug #1 - Fix dropdown counts (major UX confusion)
2. **🟡 MEDIUM**: Bug #2 - Remove double filtering
3. **🟡 MEDIUM**: Bug #4 - Optimize useEffect dependencies
4. **🟢 LOW**: Bug #3 - Filter state sync (minor UX issue)

---

## Implementation Plan

### Phase 1: Fix Dropdown Counts (Bug #1)

**Backend Changes**:
```typescript
// /api/baits/route.ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'v3';

  let query = `
    SELECT DISTINCT
      bait.uniprot_id,
      bait.gene_name,
      COUNT(i.id) as interaction_count
    FROM interactions i
    JOIN proteins bait ON i.bait_protein_id = bait.id
  `;

  if (mode === 'ipsae') {
    query += ` WHERE i.ipsae IS NOT NULL`;
  }

  query += `
    GROUP BY bait.uniprot_id, bait.gene_name
    ORDER BY bait.gene_name ASC, bait.uniprot_id ASC
  `;
  // ...
}

// /api/complexes/route.ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'v3';

  let interactionCountQuery = `
    SELECT
      pc.id,
      pc.complex_name,
      pc.display_name,
      pc.num_proteins,
      pc.created_at,
      COUNT(ci.id) as interaction_count
    FROM protein_complexes pc
    LEFT JOIN complex_interactions ci ON pc.id = ci.bait_complex_id
  `;

  if (mode === 'ipsae') {
    interactionCountQuery += ` AND ci.ipsae IS NOT NULL AND ci.analysis_version = 'v4'`;
  }

  interactionCountQuery += `
    GROUP BY pc.id, pc.complex_name, pc.display_name, pc.num_proteins, pc.created_at
    ORDER BY pc.display_name ASC
  `;
  // ...
}
```

**Frontend Changes**:
```typescript
// page.tsx
const fetchBaitProteins = async () => {
  try {
    const res = await fetch(`/api/baits?mode=${filterMode}`);
    // ...
  }
};

const fetchComplexes = async () => {
  try {
    const res = await fetch(`/api/complexes?mode=${filterMode}`);
    // ...
  }
};

useEffect(() => {
  fetchBaitProteins();
  fetchComplexes();
}, [filterMode]); // Re-fetch when mode changes
```

### Phase 2: Remove Double Filtering (Bug #2)

**Option A**: Remove server-side filtering in v3 mode
```typescript
// /api/complex-interactions/[id]/route.ts
if (confidenceLevels.length > 0 && mode === 'ipsae') {
  // Only filter server-side in v4 mode
  interactionsQuery += ` AND ci.ipsae_confidence = ANY($${queryParams.length + 1})`;
  queryParams.push(confidenceLevels);
}
// v3 mode: no server-side filtering, let client handle it
```

**Option B**: Remove client-side filtering, trust DB values
```typescript
// page.tsx - Remove this block:
if (filterMode === 'v3') {
  data = data.filter((inter: any) => {
    const level = getConfidenceLevel(inter);
    return activeFilters[level];
  });
}
// Trust that server filtering is correct
```

### Phase 3: Optimize useEffect (Bug #4)

See recommended implementation above.

---

## Verification Tests

After fixes, verify:
- [ ] Dropdown counts match displayed results in both v3 and v4 modes
- [ ] Switching modes updates dropdown counts immediately
- [ ] No interactions lost due to double filtering
- [ ] Confidence filters work correctly in both modes
- [ ] Complex selection preserved when switching v3 ↔ v4
- [ ] Protein selection preserved when switching v3 ↔ v4
