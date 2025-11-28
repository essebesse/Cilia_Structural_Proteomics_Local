# Structure Files Directory

**Generated**: 2025-11-28
**Total Files**: 1,069 CIF files
**Total Size**: 799.66 MB (0.78 GB)
**Coverage**: 45.4% of AF3 interactions in database

## Contents

This directory contains CIF (Crystallographic Information File) structure files for AlphaFold 3 predictions. These files are used by the MolStar 3D structure viewer to display protein-protein interactions.

## File Naming Convention

Files are named using UniProt IDs in lowercase:
```
{bait_uniprot}_and_{prey_uniprot}.cif
```

**Examples**:
- `q8nez3_and_q9bxc9.cif` - WDR19 ↔ BBS2
- `a0avf1_and_q9nqc8.cif` - IFT56 ↔ IFT46
- `q96rk4_and_q8tex9.cif` - BBS4 ↔ IPO4

## Manifest File

The `cif_manifest.json` file (in parent directory) maps database interaction IDs to structure files:

```json
{
  "generated_at": "2025-11-28T...",
  "total": 2357,
  "found": 1069,
  "not_found": 1288,
  "entries": {
    "123": {
      "id": 123,
      "bait_uniprot": "Q8NEZ3",
      "bait_gene": "WDR19",
      "prey_uniprot": "Q9BXC9",
      "prey_gene": "BBS2",
      "ipsae": 0.65,
      "status": "found",
      "cif_path": "structures/q8nez3_and_q9bxc9.cif",
      "interaction_directory": "q8nez3_and_q9bxc9"
    }
  }
}
```

## Source Data

CIF files were extracted from AlphaFold Pulldown predictions:
- **Base directory**: `/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/`
- **Original paths**: Stored in `original_cif_path` in manifest
- **Collection script**: `scripts/collect_cif_files.mjs`

## Coverage Statistics

- **Total AF3 interactions in database**: 2,357
- **Found CIF files**: 1,069 (45.4%)
- **Missing CIF files**: 1,288 (54.6%)
- **Errors**: 0

### Why Some Files Are Missing

CIF files may be missing for several reasons:
1. Prediction directory not found in AlphaPulldown structure
2. Different directory naming convention used
3. Prediction was run but CIF file not generated
4. Source data path in database incorrect

## Git Status

**NOT included in git repository** (too large - 800 MB)

The structures directory is listed in `.gitignore`. Instead:
- ✅ Manifest file (`cif_manifest.json`) IS included in git
- ✅ Collection script IS included in git
- ❌ CIF files themselves are NOT in git

## Distribution

To provide these files to the implementer:

### Option 1: Copy Directly
```bash
# Copy entire structures directory
cp -r structures/ /path/to/implementer/location/
```

### Option 2: Create Archive
```bash
# Create compressed archive
tar -czf structures.tar.gz structures/
# Size: ~200-300 MB compressed

# Extract on implementer's machine
tar -xzf structures.tar.gz
```

### Option 3: Rsync (if network accessible)
```bash
rsync -avz structures/ user@remote:/path/to/Cilia_Structural_Proteomics_Local/structures/
```

## Usage with MolStar

Once MolStar is implemented (see MOLSTAR_IMPLEMENTATION_GUIDE.md), these files will be served by the local API:

1. User clicks "View 3D" in results table
2. Browser requests `/api/structure/[id]`
3. API looks up ID in manifest
4. API reads CIF file from `structures/` directory
5. MolStar loads and displays the structure

## Regenerating Files

If you need to re-collect CIF files (e.g., after adding new interactions):

```bash
node scripts/collect_cif_files.mjs
```

This will:
- Read all AF3 interactions from `protoview.db`
- Search for CIF files in AlphaPulldown directories
- Copy found files to `structures/`
- Generate updated `cif_manifest.json`

## File Format

CIF files are text-based crystallographic format containing:
- Atomic coordinates (x, y, z positions)
- Chain information
- Residue sequences
- Secondary structure
- B-factors and occupancy
- Metadata (method, resolution, etc.)

**Size per file**: ~400-800 KB typical

## Verification

To verify files after copying:

```bash
# Count files
ls structures/*.cif | wc -l
# Should be: 1069

# Check total size
du -sh structures/
# Should be: ~800M

# Verify manifest matches
node -e "
const manifest = require('./cif_manifest.json');
console.log('Manifest says:', manifest.found, 'files');
console.log('Directory has:', require('fs').readdirSync('structures').filter(f => f.endsWith('.cif')).length, 'files');
"
```

## Troubleshooting

### CIF file exists in manifest but not in directory
**Solution**: Run `node scripts/collect_cif_files.mjs` to re-collect

### Wrong number of files
**Solution**:
1. Check if collection script completed without errors
2. Verify AlphaPulldown directory is accessible
3. Check manifest `found` count matches directory count

### File not found error when viewing structure
**Solution**:
1. Check file exists: `ls structures/{bait}_{prey}.cif`
2. Check manifest entry has correct path
3. Verify file permissions are readable

## Notes

- CIF files are **read-only** - never modified by the application
- Files are served directly from filesystem (no database storage)
- Manifest file must stay in sync with directory contents
- For production deployment, consider using Vercel Blob or similar CDN

---

**Last Updated**: 2025-11-28
**Script**: `scripts/collect_cif_files.mjs`
**Source**: AlphaPulldown AF3 predictions
