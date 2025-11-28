-- ProtoView Complex Schema Extension
-- This script extends the database to support multi-protein complexes (AB:C, ABC:D, etc.)

-- Table for protein complexes (e.g., IFT74+IFT81, A+B+C complexes)
CREATE TABLE IF NOT EXISTS protein_complexes (
    id SERIAL PRIMARY KEY,
    complex_name VARCHAR(255) UNIQUE NOT NULL,  -- e.g., "IFT74_IFT81", "Q96LB3_Q8WYA0_IFT74_81"
    display_name VARCHAR(255),                   -- e.g., "IFT74 & IFT81", human-readable format
    description TEXT,                            -- Optional description
    num_proteins INTEGER DEFAULT 0,              -- Number of proteins in complex (2, 3, 4, etc.)
    created_at TIMESTAMP DEFAULT NOW()
);

-- Junction table linking proteins to complexes
-- This allows complexes with ANY number of proteins (AB, ABC, ABCD, etc.)
CREATE TABLE IF NOT EXISTS complex_proteins (
    id SERIAL PRIMARY KEY,
    complex_id INTEGER REFERENCES protein_complexes(id) ON DELETE CASCADE,
    protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    chain_id VARCHAR(10) NOT NULL,               -- e.g., "A", "B", "C" from AF3 structure
    position INTEGER DEFAULT 0,                   -- Order within complex (0, 1, 2, etc.)
    role VARCHAR(20) DEFAULT 'bait' CHECK (role IN ('bait', 'structural')),
    UNIQUE(complex_id, protein_id, chain_id)
);

-- Interactions between complexes and prey proteins
CREATE TABLE IF NOT EXISTS complex_interactions (
    id SERIAL PRIMARY KEY,
    bait_complex_id INTEGER REFERENCES protein_complexes(id) ON DELETE CASCADE,
    prey_protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    iptm FLOAT,
    contacts_pae_lt_3 INTEGER DEFAULT 0,
    contacts_pae_lt_6 INTEGER DEFAULT 0,
    interface_plddt FLOAT,
    confidence confidence_level,
    source_path TEXT,
    alphafold_version VARCHAR(10) DEFAULT 'AF3',
    per_chain_plddt JSONB,                       -- Store detailed per-chain interface pLDDT data

    -- Metadata
    ranking_score FLOAT,
    ptm FLOAT,
    mean_plddt FLOAT,
    interface_residue_count INTEGER,

    UNIQUE(bait_complex_id, prey_protein_id, source_path, alphafold_version)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_complex_proteins_on_complex ON complex_proteins(complex_id);
CREATE INDEX IF NOT EXISTS idx_complex_proteins_on_protein ON complex_proteins(protein_id);
CREATE INDEX IF NOT EXISTS idx_complex_interactions_on_bait_complex ON complex_interactions(bait_complex_id);
CREATE INDEX IF NOT EXISTS idx_complex_interactions_on_prey ON complex_interactions(prey_protein_id);
CREATE INDEX IF NOT EXISTS idx_complex_interactions_on_confidence ON complex_interactions(confidence);
CREATE INDEX IF NOT EXISTS idx_protein_complexes_on_name ON protein_complexes(complex_name);

-- Add comments for documentation
COMMENT ON TABLE protein_complexes IS 'Stores multi-protein complexes (AB, ABC, ABCD, etc.) that act as baits';
COMMENT ON TABLE complex_proteins IS 'Junction table linking proteins to complexes with chain information';
COMMENT ON TABLE complex_interactions IS 'Interactions between protein complexes and prey proteins';
COMMENT ON COLUMN complex_proteins.chain_id IS 'AlphaFold 3 chain identifier (A, B, C, etc.)';
COMMENT ON COLUMN complex_proteins.position IS 'Order of protein within complex for consistent display';
COMMENT ON COLUMN complex_interactions.per_chain_plddt IS 'JSON object with per-chain interface pLDDT statistics';
