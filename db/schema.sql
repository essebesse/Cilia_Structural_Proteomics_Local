-- ProtoView Database Schema
-- This script defines the tables for storing protein interaction data.

-- First, create an ENUM type for the confidence levels to ensure data consistency.
CREATE TYPE confidence_level AS ENUM (
    'Very High Confidence',
    'Worth Investigating',
    'Low iPTM - Proceed with Caution',
    'Very High',
    'High',
    'Medium',
    'Low',
    'Very Low',
    'Unknown'
);

-- Table to store unique proteins
CREATE TABLE proteins (
    id SERIAL PRIMARY KEY,
    uniprot_id VARCHAR(255) UNIQUE NOT NULL,
    gene_name VARCHAR(255)
);

-- Create an index on uniprot_id for faster searches.
CREATE INDEX idx_proteins_on_uniprot_id ON proteins(uniprot_id);
-- Create an index on gene_name for faster searches.
CREATE INDEX idx_proteins_on_gene_name ON proteins(gene_name);

-- Table to store the interactions between two proteins
CREATE TABLE interactions (
    id SERIAL PRIMARY KEY,
    bait_protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    prey_protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
    iptm FLOAT,
    contacts_pae_lt_3 INTEGER,
    contacts_pae_lt_6 INTEGER,
    interface_plddt FLOAT,
    confidence confidence_level,
    source_path TEXT, -- The path to the original results directory
    alphafold_version VARCHAR(10), -- AF2 or AF3

    -- Ensure that each interaction between two proteins from a specific source is unique.
    UNIQUE(bait_protein_id, prey_protein_id, source_path, alphafold_version)
);

-- Create indexes for faster querying of interactions.
CREATE INDEX idx_interactions_on_bait_id ON interactions(bait_protein_id);
CREATE INDEX idx_interactions_on_prey_id ON interactions(prey_protein_id);
CREATE INDEX idx_interactions_on_confidence ON interactions(confidence);

