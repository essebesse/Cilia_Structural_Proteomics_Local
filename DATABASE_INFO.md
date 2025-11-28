# Database Information

## Pre-populated SQLite Database

**File**: `protoview.db`
**Size**: 1.89 MB
**Format**: SQLite 3
**Exported**: 2025-11-28

## Contents

| Table | Rows | Description |
|-------|------|-------------|
| `proteins` | 1,808 | Protein information with UniProt IDs, gene names, organisms |
| `interactions` | 2,754 | Pairwise protein-protein interactions (AF2 + AF3) |
| `protein_complexes` | 3 | Complex bait definitions |
| `complex_proteins` | 6 | Junction table linking complexes to proteins |
| `complex_interactions` | 57 | Complex bait to prey interactions |
| `protein_aliases` | 7,612 | Protein aliases for comprehensive search |
| `protein_orthologs` | 0 | Cross-organism ortholog mappings (empty) |

**Total**: 12,240 rows across 7 tables

## Data Sources

This database contains data from:
- AlphaFold 3 predictions (v3 and v4 analyses)
- AlphaFold 2 predictions (legacy data)
- UniProt protein information
- ChlamyFP gene names (Chlamydomonas proteins)

## Confidence Schemes

### v3 Data (iPTM-based)
- Uses `contacts_pae_lt_3`, `contacts_pae_lt_6`, `interface_plddt`
- Stored in `confidence` column
- Levels: Very High, High, Medium, Low

### v4 Data (ipSAE-based)
- Uses `ipsae`, `ipsae_confidence`, `ipsae_pae_cutoff`
- Stored in `ipsae_confidence` column
- Levels: High (>0.7), Medium (0.5-0.7), Low (0.3-0.5)
- Better for multi-protein complexes

## Experimental Validation

Some interactions have experimental validation data stored in `experimental_validation` (JSON text):
- **17 validated interactions** from MS pulldown experiments
- Stored as JSON strings (parse with `JSON.parse()`)
- Format: `{"validated": true, "method": "PD_MS", "source": "Lab", "date": "YYYY-MM-DD", ...}`

## Schema Details

### Core Tables

**proteins**:
```sql
id, uniprot_id, gene_name, organism, organism_code, common_name, description
```

**interactions**:
```sql
id, bait_protein_id, prey_protein_id, iptm, contacts_pae_lt_3, contacts_pae_lt_6,
interface_plddt, confidence, source_path, alphafold_version, ipsae, ipsae_confidence,
ipsae_pae_cutoff, analysis_version, experimental_validation
```

**protein_complexes**:
```sql
id, complex_name, display_name, description, num_proteins, created_at
```

**complex_interactions**:
```sql
id, bait_complex_id, prey_protein_id, iptm, contacts_pae_lt_3, contacts_pae_lt_6,
interface_plddt, confidence, source_path, alphafold_version, per_chain_plddt,
ranking_score, ptm, mean_plddt, interface_residue_count, ipsae, ipsae_confidence,
ipsae_pae_cutoff, analysis_version, experimental_validation
```

**protein_aliases**:
```sql
id, protein_id, alias_name, alias_type, source, organism, organism_code, is_primary
```

## How This Database Was Created

Exported from production PostgreSQL database on Neon using:

```bash
export POSTGRES_URL="postgresql://..."
node scripts/export_to_sqlite.mjs
```

The export script (`scripts/export_to_sqlite.mjs` in parent repository):
1. Connects to PostgreSQL database
2. Reads all tables and data
3. Converts schema to SQLite format
4. Exports data in transactions for speed
5. Creates indexes for search performance

## Updating the Database

To export fresh data from production:

```bash
# From parent cloud repository
cd /path/to/Cilia_Structural_Proteomics
export POSTGRES_URL="your_postgresql_connection_string"
node scripts/export_to_sqlite.mjs

# Copy to local repo
cp protoview.db ../Cilia_Structural_Proteomics_Local/
```

## Database Size Considerations

Current size: **1.89 MB** (small enough for git)

If database grows significantly:
- Consider using Git LFS for files >5MB
- Or provide download link instead of including in repository
- Or compress with gzip for distribution

## Querying the Database

Example queries:

```sql
-- Count proteins by organism
SELECT organism_code, COUNT(*) FROM proteins GROUP BY organism_code;

-- Find high-confidence interactions
SELECT * FROM interactions WHERE confidence = 'High' OR ipsae_confidence = 'High';

-- Search by protein name
SELECT p.* FROM proteins p
LEFT JOIN protein_aliases pa ON p.id = pa.protein_id
WHERE p.gene_name LIKE '%IFT%' OR pa.alias_name LIKE '%IFT%';

-- Get all interactions for a protein
SELECT * FROM interactions
WHERE bait_protein_id = (SELECT id FROM proteins WHERE uniprot_id = 'Q8NEZ3')
   OR prey_protein_id = (SELECT id FROM proteins WHERE uniprot_id = 'Q8NEZ3');
```

## Notes for IT Person

- This database is **ready to use** - no setup required
- Indexes are already created for search performance
- Foreign key constraints are enabled
- All JSONB data from PostgreSQL is stored as TEXT (JSON strings)
- Use `JSON.parse()` to parse JSON columns
- Database file is included in git repository for easy distribution

---

**Last Export**: 2025-11-28
**Source**: Production Neon PostgreSQL database
**Export Script**: `scripts/export_to_sqlite.mjs` (in parent repository)
