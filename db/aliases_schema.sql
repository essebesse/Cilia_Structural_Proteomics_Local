-- Add protein aliases table for comprehensive search
CREATE TABLE IF NOT EXISTS protein_aliases (
    id SERIAL PRIMARY KEY,
    protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    alias_name VARCHAR(255) NOT NULL,
    alias_type VARCHAR(50), -- e.g., 'gene_name', 'synonym', 'full_name', 'short_name'
    source VARCHAR(50) DEFAULT 'uniprot', -- 'uniprot', 'manual', etc.

    -- Ensure unique aliases per protein
    UNIQUE(protein_id, alias_name)
);

-- Create indexes for fast searching
CREATE INDEX IF NOT EXISTS idx_protein_aliases_on_alias_name ON protein_aliases(alias_name);
CREATE INDEX IF NOT EXISTS idx_protein_aliases_on_protein_id ON protein_aliases(protein_id);
CREATE INDEX IF NOT EXISTS idx_protein_aliases_on_alias_type ON protein_aliases(alias_type);

-- Create a case-insensitive index for better search performance
CREATE INDEX IF NOT EXISTS idx_protein_aliases_alias_name_lower ON protein_aliases(LOWER(alias_name));