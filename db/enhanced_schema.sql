-- Enhanced ProtoView Database Schema with Multi-Organism Support
-- This script adds organism information and cross-species protein mapping.

-- Create organism enum for supported organisms
CREATE TYPE organism_type AS ENUM (
    'Homo sapiens',
    'Chlamydomonas reinhardtii',
    'Unknown'
);

-- Enhanced proteins table with organism information
ALTER TABLE proteins
ADD COLUMN organism organism_type DEFAULT 'Unknown',
ADD COLUMN organism_code VARCHAR(10), -- 'Hs', 'Cr', etc.
ADD COLUMN common_name VARCHAR(255), -- organism-specific common name (e.g., 'ODA16', 'DAW1')
ADD COLUMN description TEXT; -- protein description/function

-- Create indexes for organism-based searches
CREATE INDEX idx_proteins_on_organism ON proteins(organism);
CREATE INDEX idx_proteins_on_organism_code ON proteins(organism_code);
CREATE INDEX idx_proteins_on_common_name ON proteins(common_name);

-- Table for cross-organism ortholog mapping
CREATE TABLE protein_orthologs (
    id SERIAL PRIMARY KEY,
    protein_id_1 INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    protein_id_2 INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    ortholog_type VARCHAR(50) DEFAULT 'ortholog', -- 'ortholog', 'paralog', 'homolog'
    confidence_score FLOAT, -- ortholog confidence (0-1)
    source VARCHAR(100), -- 'manual', 'ensembl', 'orthodb', etc.

    -- Ensure bidirectional uniqueness (don't duplicate A->B and B->A)
    UNIQUE(protein_id_1, protein_id_2),
    CHECK(protein_id_1 != protein_id_2)
);

-- Create indexes for ortholog searches
CREATE INDEX idx_orthologs_on_protein1 ON protein_orthologs(protein_id_1);
CREATE INDEX idx_orthologs_on_protein2 ON protein_orthologs(protein_id_2);
CREATE INDEX idx_orthologs_on_type ON protein_orthologs(ortholog_type);

-- Enhanced protein_aliases table with organism context
ALTER TABLE protein_aliases
ADD COLUMN organism organism_type,
ADD COLUMN organism_code VARCHAR(10),
ADD COLUMN is_primary BOOLEAN DEFAULT FALSE; -- mark primary names for each organism

-- Create indexes for organism-specific alias searches
CREATE INDEX idx_aliases_on_organism ON protein_aliases(organism);
CREATE INDEX idx_aliases_on_organism_code ON protein_aliases(organism_code);
CREATE INDEX idx_aliases_on_primary ON protein_aliases(is_primary);

-- View for comprehensive protein search across organisms and aliases
CREATE OR REPLACE VIEW protein_search_view AS
SELECT
    p.id,
    p.uniprot_id,
    p.gene_name,
    p.organism,
    p.organism_code,
    p.common_name,
    p.description,
    STRING_AGG(DISTINCT pa.alias_name, '; ') as all_aliases,
    STRING_AGG(DISTINCT po_related.uniprot_id, '; ') as ortholog_ids,
    STRING_AGG(DISTINCT po_related.common_name, '; ') as ortholog_names
FROM proteins p
LEFT JOIN protein_aliases pa ON p.id = pa.protein_id
LEFT JOIN protein_orthologs po1 ON p.id = po1.protein_id_1
LEFT JOIN protein_orthologs po2 ON p.id = po2.protein_id_2
LEFT JOIN proteins po_related ON (po_related.id = po1.protein_id_2 OR po_related.id = po2.protein_id_1)
GROUP BY p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name, p.description;

-- Function to search proteins across all names and organisms
CREATE OR REPLACE FUNCTION search_proteins_comprehensive(search_term TEXT)
RETURNS TABLE(
    protein_id INTEGER,
    uniprot_id VARCHAR(255),
    gene_name VARCHAR(255),
    organism organism_type,
    organism_code VARCHAR(10),
    common_name VARCHAR(255),
    match_type TEXT,
    match_value TEXT
) AS $$
BEGIN
    RETURN QUERY
    -- Direct uniprot_id match
    SELECT p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name,
           'uniprot_id'::TEXT, p.uniprot_id
    FROM proteins p
    WHERE p.uniprot_id ILIKE search_term

    UNION

    -- Gene name match
    SELECT p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name,
           'gene_name'::TEXT, p.gene_name
    FROM proteins p
    WHERE p.gene_name ILIKE '%' || search_term || '%'

    UNION

    -- Common name match
    SELECT p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name,
           'common_name'::TEXT, p.common_name
    FROM proteins p
    WHERE p.common_name ILIKE '%' || search_term || '%'

    UNION

    -- Alias match
    SELECT p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name,
           'alias'::TEXT, pa.alias_name
    FROM proteins p
    JOIN protein_aliases pa ON p.id = pa.protein_id
    WHERE pa.alias_name ILIKE '%' || search_term || '%'

    UNION

    -- Ortholog match (find by ortholog names)
    SELECT p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name,
           'ortholog'::TEXT, po_related.common_name
    FROM proteins p
    JOIN protein_orthologs po1 ON p.id = po1.protein_id_1
    JOIN proteins po_related ON po_related.id = po1.protein_id_2
    WHERE po_related.common_name ILIKE '%' || search_term || '%'

    UNION

    SELECT p.id, p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name,
           'ortholog'::TEXT, po_related.common_name
    FROM proteins p
    JOIN protein_orthologs po2 ON p.id = po2.protein_id_2
    JOIN proteins po_related ON po_related.id = po2.protein_id_1
    WHERE po_related.common_name ILIKE '%' || search_term || '%';
END;
$$ LANGUAGE plpgsql;