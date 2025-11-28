# MolStar 3D Structure Viewer Implementation Guide

**Created**: 2025-11-28
**For**: Adding 3D structure visualization to local deployment
**Based on**: IFT_Interactors_paper implementation

## Overview

This guide shows how to add MolStar (Mol*) 3D structure viewer to the local Protoview deployment, based on the working implementation in the IFT_Interactors_paper project.

**MolStar** is a modern molecular visualization library that can display protein structures in 3D, with features like:
- Interactive 3D rendering
- Chain coloring
- Custom highlighting (e.g., PAE-based interface coloring)
- Fullscreen viewing
- Export and screenshots

## Current Status

### IFT_Interactors Project (Working Implementation)
- ✅ MolStar v5.2.0 integrated
- ✅ 500 CIF structure files stored on Vercel Blob
- ✅ PAE contact data for interface highlighting
- ✅ Fullscreen viewer with memory optimization
- ✅ API routes for serving structures
- ✅ Dynamic component loading

### Local Deployment Project (To Be Implemented)
- ❌ No MolStar dependency
- ❌ No structure viewer component
- ❌ No structure storage/API routes
- ❌ No CIF files or PAE data

## Architecture Overview

### Data Flow
```
User clicks "View 3D" in results table
    ↓
Open /structure/[id] page (fullscreen)
    ↓
Load StructureViewer component (dynamic, client-side only)
    ↓
Fetch CIF file from /api/structure/[id]
    ↓
Load structure into Mol* plugin
    ↓
Optional: Fetch PAE data and apply interface highlighting
```

### File Structure (from IFT_Interactors)
```
components/
  StructureViewer.tsx          # Main MolStar component
app/
  structure/
    [id]/
      page.tsx                 # Fullscreen viewer page
  api/
    structure/
      [id]/
        route.ts               # CIF file server
        pae/
          route.ts             # PAE contact data server
public/
  cif_manifest.json            # Maps interaction IDs to filenames
  contacts_data/               # PAE JSON files (172 files)
    interaction_*.json
```

## Implementation Steps

### Phase 1: Install Dependencies

**1.1 Add MolStar and Sass**
```bash
cd Cilia_Structural_Proteomics_Local
npm install molstar@5.2.0 sass
npm install @vercel/blob  # For structure file storage
```

**Why Sass?** MolStar requires Sass to compile its stylesheets (`molstar/lib/mol-plugin-ui/skin/light.scss`)

**1.2 Verify package.json**
```json
{
  "dependencies": {
    "molstar": "^5.2.0",
    "sass": "^1.77.8",
    "@vercel/blob": "^2.0.0"
  }
}
```

### Phase 2: Copy Structure Viewer Component

**2.1 Create components directory** (if it doesn't exist)
```bash
mkdir -p components
```

**2.2 Copy StructureViewer.tsx**
Copy from IFT_Interactors_paper:
```bash
cp ../IFT_Interactors_paper/components/StructureViewer.tsx components/
```

**Key features in this component**:
- Dynamic client-side loading (`'use client'`)
- MolStar plugin initialization
- CIF file loading via API
- PAE-based interface highlighting
- Chain coloring
- Loading states and error handling

**2.3 Review StructureViewer.tsx**

The component has these key sections:
- **MolStar imports**: Plugin UI, script language, coloring
- **Props interface**: interaction ID, bait/prey genes, close callback
- **Plugin initialization**: Disables external network calls (RCSB, validation)
- **Structure loading**: Fetches CIF from `/api/structure/[id]`
- **PAE highlighting**: Fetches contact data and applies custom coloring
- **UI controls**: Toggle PAE mode, close button, loading spinners

### Phase 3: Create Structure Viewer Page

**3.1 Create fullscreen viewer page**
```bash
mkdir -p app/structure/[id]
```

**3.2 Copy page.tsx**
Copy from IFT_Interactors_paper:
```bash
cp ../IFT_Interactors_paper/app/structure/[id]/page.tsx app/structure/[id]/
```

**Key features**:
- Dynamic import of StructureViewer (SSR disabled)
- Canvas size calculation (prevents memory issues on high-res displays)
- Loads interaction info from manifest
- Fullscreen layout (100vw x 100vh)
- Safe pixel limit (20M pixels to prevent memory exhaustion)

**Important**: The page calculates safe canvas dimensions based on:
- Screen size (innerWidth, innerHeight)
- Device pixel ratio (retina displays)
- Memory limit (caps at ~20M pixels = 1-2GB RAM)

### Phase 4: Create API Routes

**4.1 Create structure API directory**
```bash
mkdir -p app/api/structure/[id]/pae
```

**4.2 Copy route.ts files**
```bash
# Main structure route (serves CIF files)
cp ../IFT_Interactors_paper/app/api/structure/[id]/route.ts app/api/structure/[id]/

# PAE data route (serves contact JSON)
cp ../IFT_Interactors_paper/app/api/structure/[id]/pae/route.ts app/api/structure/[id]/pae/
```

**4.3 Understand the API routes**

**`/api/structure/[id]/route.ts`**:
- Reads `cif_manifest.json` to map interaction ID → filename
- Constructs Blob URL: `structures/{bait_uniprot}_and_{prey_uniprot}.cif`
- Fetches CIF from Vercel Blob storage
- Returns CIF content with proper headers

**`/api/structure/[id]/pae/route.ts`**:
- Reads PAE contact data from `public/contacts_data/interaction_{id}.json`
- Returns JSON with contact list (chain, residue, PAE score, confidence)
- Used for highlighting interface residues

### Phase 5: Prepare Structure Data

**5.1 Option A: Use Vercel Blob Storage (Recommended for cloud deployment)**

If deploying to Vercel (like IFT_Interactors):

```bash
# Create manifest
cp ../IFT_Interactors_paper/cif_manifest.json public/

# Upload CIF files to Vercel Blob
# You'll need:
# - CIF files from AlphaFold predictions
# - Vercel Blob upload script
# - Blob storage token

node scripts/upload_to_vercel_blob.mjs
```

**Blob naming convention**:
```
structures/{bait_uniprot_lowercase}_and_{prey_uniprot_lowercase}.cif
Example: structures/a0avf1_and_q9nqc8.cif
```

**5.2 Option B: Local File Storage (For offline/local deployment)**

For truly local deployment (no Vercel Blob):

**Modify `/api/structure/[id]/route.ts`** to serve from local files:

```typescript
// OLD: Fetch from Vercel Blob
const blobUrl = `${BLOB_BASE_URL}/structures/${entry.interaction_directory}.cif`;
const response = await fetch(blobUrl);

// NEW: Read from local filesystem
import { readFile } from 'fs/promises';
import path from 'path';

const cifPath = path.join(
  process.cwd(),
  'public',
  'structures',
  `${entry.interaction_directory}.cif`
);
const cifContent = await readFile(cifPath, 'utf8');

return new NextResponse(cifContent, {
  headers: {
    'Content-Type': 'chemical/x-cif',
    'Content-Disposition': isDownload ?
      `attachment; filename="${entry.bait_gene}_${entry.prey_gene}.cif"` :
      'inline'
  }
});
```

**Store CIF files locally**:
```bash
mkdir -p public/structures
# Copy CIF files from AlphaFold predictions
# Naming: {bait_uniprot}_and_{prey_uniprot}.cif
```

**5.3 Create CIF Manifest**

The manifest maps interaction IDs to structure files:

```json
{
  "entries": {
    "123": {
      "id": 123,
      "interaction_directory": "a0avf1_and_q9nqc8",
      "bait_uniprot": "A0AVF1",
      "prey_uniprot": "Q9NQC8",
      "bait_gene": "IFT56",
      "prey_gene": "IFT46"
    }
  }
}
```

**Generate from database**:
```bash
node scripts/generate_cif_manifest.mjs
```

Or create manually for key interactions you want to visualize.

**5.4 Add PAE Contact Data (Optional)**

PAE highlighting requires contact JSON files:

```bash
mkdir -p public/contacts_data
# Copy from IFT_Interactors or generate from AlphaFold PAE matrices
```

**PAE JSON format**:
```json
{
  "interaction_id": 123,
  "generated_at": "2025-11-28T12:00:00Z",
  "data": {
    "chains": ["A", "B"],
    "chain_lengths": {"A": 500, "B": 450},
    "contacts": [
      {
        "chain1": "A",
        "resi1": 123,
        "aa1": "LEU",
        "chain2": "B",
        "resi2": 456,
        "aa2": "ARG",
        "pae": 2.5,
        "distance": 3.8,
        "confidence": "very_high",
        "color": "yellow"
      }
    ],
    "summary": {
      "total_contacts": 150,
      "very_high_count": 100,
      "high_count": 40,
      "medium_count": 8,
      "low_count": 2
    }
  }
}
```

### Phase 6: Add UI Integration

**6.1 Update results table to include "View 3D" button**

In `app/page.tsx`, add a column to the interactions table:

```tsx
<th>3D Structure</th>
```

And in the data rows:

```tsx
<td>
  <button
    className="btn btn-sm btn-primary"
    onClick={() => window.open(`/structure/${interaction.id}`, '_blank')}
  >
    View 3D
  </button>
</td>
```

**6.2 Alternative: Add to network graph**

Add "View 3D" option when clicking nodes in NetworkVisualization.tsx

### Phase 7: Test and Verify

**7.1 Local testing**
```bash
npm run dev
# Visit http://localhost:3000
# Search for a protein
# Click "View 3D" on an interaction
# Verify structure loads in fullscreen
# Test PAE highlighting toggle
```

**7.2 Check for errors**
- Console should show "INITIALIZING MOLSTAR PLUGIN"
- CIF file should load in 2-3 seconds
- No memory errors on high-res displays
- PAE highlighting applies in <1 second

**7.3 Verify features**
- ✓ Structure loads and renders
- ✓ Camera controls work (rotate, zoom, pan)
- ✓ Chain colors distinct
- ✓ PAE toggle works (yellow/magenta highlighting)
- ✓ Close button returns to network
- ✓ Fullscreen window opens/closes properly

## Database Schema Changes (Optional)

To track which interactions have 3D structures:

```sql
-- Add column to interactions table
ALTER TABLE interactions ADD COLUMN has_structure BOOLEAN DEFAULT false;

-- Update for interactions with CIF files
UPDATE interactions SET has_structure = true
WHERE id IN (SELECT id FROM cif_manifest_entries);
```

Then in your results table, only show "View 3D" button when `has_structure = true`.

## File Size Considerations

**CIF files**: ~50-200 KB each (compressed PDB format)
**PAE JSON files**: ~10-50 KB each

**For local deployment with SQLite**:
- Store CIF files in `public/structures/` directory
- Include in git if <100 files (~10-20 MB total)
- For larger datasets: Use Git LFS or external download

**For cloud deployment (Vercel)**:
- Use Vercel Blob storage (500 files = ~50-100 MB)
- Fast CDN delivery
- No git repository size impact

## Performance Optimization

### From IFT_Interactors Experience

**1. Memory Management**
- Limit canvas pixels to 20M (~1-2 GB RAM)
- Dynamic sizing based on screen resolution
- Prevents browser crashes on 4K/5K displays

**2. Loading Speed**
- Use CIF format (faster than PDB)
- Lazy load StructureViewer component
- Show loading spinner during structure fetch

**3. Disable External Calls**
- Filter out RCSB assembly symmetry behavior
- Disable validation checks
- Prevents slow external API calls

**4. Client-Side Only**
- `'use client'` directive
- Dynamic import with `ssr: false`
- Prevents server-side rendering issues

## SQLite Compatibility

**Good news**: The MolStar implementation is database-agnostic!

The viewer only needs:
1. CIF files (via API or filesystem)
2. PAE JSON files (optional, for highlighting)
3. Manifest JSON (maps IDs to files)

**No database queries** in the structure viewer component.

**Integration with SQLite backend**:
```javascript
// In your API route (using SQLite)
import Database from 'better-sqlite3';

const db = new Database('protoview.db');
const interaction = db.prepare(
  'SELECT * FROM interactions WHERE id = ?'
).get(interactionId);

// Return structure metadata
return NextResponse.json({
  baitGene: interaction.bait_gene_name,
  preyGene: interaction.prey_gene_name,
  hasCifFile: fs.existsSync(`public/structures/${interaction.id}.cif`)
});
```

## Common Issues and Solutions

### Issue: "Cannot find module 'molstar'"
**Solution**: Run `npm install molstar sass`

### Issue: "Sass loader error"
**Solution**:
```bash
npm install sass --save-dev
# Restart dev server
```

### Issue: Structure loads but interface is blank
**Cause**: MolStar CSS not loaded
**Solution**: Verify import in StructureViewer.tsx:
```typescript
import 'molstar/lib/mol-plugin-ui/skin/light.scss';
```

### Issue: Memory crash on high-res display
**Cause**: Canvas too large
**Solution**: Already fixed in IFT implementation - uses `calculateSafeCanvasDimensions()`

### Issue: CIF file 404 error
**Solution**:
1. Check `cif_manifest.json` has correct mapping
2. Verify CIF file exists (Blob or `public/structures/`)
3. Check API route is serving correct URL

### Issue: PAE highlighting doesn't work
**Solution**:
1. Verify `/api/structure/[id]/pae` returns valid JSON
2. Check `public/contacts_data/interaction_*.json` exists
3. Confirm contact data has correct format

## Estimated Implementation Time

| Phase | Task | Time |
|-------|------|------|
| 1 | Install dependencies | 10 min |
| 2 | Copy StructureViewer component | 15 min |
| 3 | Create viewer page | 10 min |
| 4 | Create API routes | 20 min |
| 5 | Prepare structure data | 1-3 hours |
| 6 | UI integration | 30 min |
| 7 | Testing | 30 min |
| **Total** | | **3-5 hours** |

**Phase 5 varies based on**:
- How many structures you want to include
- Whether using Blob storage or local files
- If generating PAE data or skipping highlighting

## Minimal Implementation (Quick Start)

For fastest implementation (1-2 hours):

1. **Install MolStar**: `npm install molstar sass`
2. **Copy 3 files**:
   - `components/StructureViewer.tsx`
   - `app/structure/[id]/page.tsx`
   - `app/api/structure/[id]/route.ts`
3. **Skip PAE highlighting** (remove toggle, simplify component)
4. **Use 10-20 sample structures** in `public/structures/`
5. **Create minimal manifest** with just those IDs
6. **Add "View 3D" button** to results table

This gives you working 3D visualization without all the bells and whistles.

## Future Enhancements

Once basic viewer is working, consider:
- **Sequence view**: Show protein sequences aligned to structure
- **Contact map**: 2D representation of interface contacts
- **Multiple structures**: Compare different predictions
- **Export**: Download structure files, screenshots, videos
- **Measurements**: Distance/angle tools
- **Annotations**: Mark specific residues or regions
- **Custom coloring**: By B-factor, conservation, etc.

## References

### Working Implementation
- **IFT_Interactors_paper project** (this server)
  - Path: `/emcc/au14762/elo_lab/SCRIPTS/Global_Analysis/IFT_Interactors_paper`
  - Live site: https://ift-interactors.vercel.app
  - 500 structures with PAE highlighting

### Documentation
- **MolStar**: https://github.com/molstar/molstar
- **MolStar examples**: https://molstar.org/viewer/
- **CIF format**: https://www.iucr.org/resources/cif

### Scripts (from IFT_Interactors)
- `scripts/upload_to_vercel_blob.mjs` - Upload structures to Blob
- `scripts/generate_cif_manifest.mjs` - Create manifest from database
- `scripts/collect_cif_paths.py` - Find CIF files in AlphaFold output

---

**Summary**: Adding MolStar to the local deployment is straightforward - copy 3-4 key files, install dependencies, prepare structure data. The implementation is database-agnostic and works with SQLite. Estimated 3-5 hours for full implementation, 1-2 hours for minimal version.

**Next Steps**:
1. Decide: Full implementation or minimal version?
2. Choose: Vercel Blob storage or local filesystem?
3. Select: Which interactions to include structures for?
4. Implement: Follow phases 1-7 above
5. Test: Verify on local deployment before pushing to GitHub
