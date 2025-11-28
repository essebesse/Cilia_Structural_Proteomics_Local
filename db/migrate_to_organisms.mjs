#!/usr/bin/env node

/**
 * Migration script to add organism support to ProtoView database
 * This script adds organism columns and creates cross-organism mapping tables
 */

import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL environment variable is required');
  process.exit(1);
}

async function migrateDatabase() {
  const client = await db.connect();

  try {
    console.log('🔧 Starting database migration to add organism support...');

    // Create organism enum type
    console.log('📝 Creating organism_type enum...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE organism_type AS ENUM (
          'Homo sapiens',
          'Chlamydomonas reinhardtii',
          'Unknown'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add new columns to proteins table
    console.log('📝 Adding organism columns to proteins table...');
    try {
      await client.query(`
        ALTER TABLE proteins
        ADD COLUMN IF NOT EXISTS organism organism_type DEFAULT 'Unknown',
        ADD COLUMN IF NOT EXISTS organism_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS common_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS description TEXT;
      `);
    } catch (error) {
      console.log('⚠️  Some columns may already exist:', error.message);
    }

    // Create indexes for new columns
    console.log('📝 Creating indexes for organism columns...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_proteins_on_organism ON proteins(organism);
      CREATE INDEX IF NOT EXISTS idx_proteins_on_organism_code ON proteins(organism_code);
      CREATE INDEX IF NOT EXISTS idx_proteins_on_common_name ON proteins(common_name);
    `);

    // Create protein_orthologs table
    console.log('📝 Creating protein_orthologs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS protein_orthologs (
        id SERIAL PRIMARY KEY,
        protein_id_1 INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
        protein_id_2 INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
        ortholog_type VARCHAR(50) DEFAULT 'ortholog',
        confidence_score FLOAT,
        source VARCHAR(100),
        UNIQUE(protein_id_1, protein_id_2),
        CHECK(protein_id_1 != protein_id_2)
      );
    `);

    // Create indexes for ortholog table
    console.log('📝 Creating indexes for protein_orthologs table...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orthologs_on_protein1 ON protein_orthologs(protein_id_1);
      CREATE INDEX IF NOT EXISTS idx_orthologs_on_protein2 ON protein_orthologs(protein_id_2);
      CREATE INDEX IF NOT EXISTS idx_orthologs_on_type ON protein_orthologs(ortholog_type);
    `);

    // Add new columns to protein_aliases table
    console.log('📝 Adding organism columns to protein_aliases table...');
    try {
      await client.query(`
        ALTER TABLE protein_aliases
        ADD COLUMN IF NOT EXISTS organism organism_type,
        ADD COLUMN IF NOT EXISTS organism_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;
      `);
    } catch (error) {
      console.log('⚠️  Some alias columns may already exist:', error.message);
    }

    // Create indexes for enhanced alias table
    console.log('📝 Creating indexes for enhanced protein_aliases table...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_aliases_on_organism ON protein_aliases(organism);
      CREATE INDEX IF NOT EXISTS idx_aliases_on_organism_code ON protein_aliases(organism_code);
      CREATE INDEX IF NOT EXISTS idx_aliases_on_primary ON protein_aliases(is_primary);
    `);

    // Update existing data with organism information
    console.log('📝 Updating existing proteins with organism information...');

    // Detect organism based on UniProt ID patterns and source paths
    await client.query(`
      UPDATE proteins SET
        organism = CASE
          WHEN uniprot_id LIKE 'Cre%' OR uniprot_id LIKE 'A8%' OR uniprot_id LIKE 'Q9%' THEN 'Chlamydomonas reinhardtii'::organism_type
          WHEN uniprot_id ~ '^[A-Z][0-9][A-Z0-9]{3}[0-9]$' THEN 'Homo sapiens'::organism_type
          ELSE 'Unknown'::organism_type
        END,
        organism_code = CASE
          WHEN uniprot_id LIKE 'Cre%' OR uniprot_id LIKE 'A8%' OR uniprot_id LIKE 'Q9%' THEN 'Cr'
          WHEN uniprot_id ~ '^[A-Z][0-9][A-Z0-9]{3}[0-9]$' THEN 'Hs'
          ELSE NULL
        END
      WHERE organism IS NULL OR organism = 'Unknown';
    `);

    // Update aliases with organism information based on their associated proteins
    console.log('📝 Updating protein_aliases with organism information...');
    await client.query(`
      UPDATE protein_aliases
      SET
        organism = p.organism,
        organism_code = p.organism_code
      FROM proteins p
      WHERE protein_aliases.protein_id = p.id
        AND protein_aliases.organism IS NULL;
    `);

    // Create the comprehensive search view
    console.log('📝 Creating comprehensive protein search view...');
    await client.query(`
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
    `);

    // Create the comprehensive search function
    console.log('📝 Creating comprehensive protein search function...');
    await client.query(`
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
    `);

    // Get statistics
    const stats = await client.query(`
      SELECT
        COUNT(*) as total_proteins,
        COUNT(CASE WHEN organism = 'Chlamydomonas reinhardtii' THEN 1 END) as chlamydomonas_proteins,
        COUNT(CASE WHEN organism = 'Homo sapiens' THEN 1 END) as human_proteins,
        COUNT(CASE WHEN organism = 'Unknown' THEN 1 END) as unknown_proteins
      FROM proteins;
    `);

    const aliasStats = await client.query(`
      SELECT
        COUNT(*) as total_aliases,
        COUNT(CASE WHEN organism = 'Chlamydomonas reinhardtii' THEN 1 END) as chlamydomonas_aliases,
        COUNT(CASE WHEN organism = 'Homo sapiens' THEN 1 END) as human_aliases
      FROM protein_aliases;
    `);

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Database Statistics:');
    console.log(`   Total proteins: ${stats.rows[0].total_proteins}`);
    console.log(`   Chlamydomonas: ${stats.rows[0].chlamydomonas_proteins}`);
    console.log(`   Human: ${stats.rows[0].human_proteins}`);
    console.log(`   Unknown: ${stats.rows[0].unknown_proteins}`);
    console.log(`   Total aliases: ${aliasStats.rows[0].total_aliases}`);
    console.log(`   Chlamydomonas aliases: ${aliasStats.rows[0].chlamydomonas_aliases}`);
    console.log(`   Human aliases: ${aliasStats.rows[0].human_aliases}`);

    console.log('\n🔍 New Features Available:');
    console.log('   • Organism-aware protein search');
    console.log('   • Cross-species ortholog mapping');
    console.log('   • Enhanced protein aliases with organism context');
    console.log('   • Comprehensive search function: search_proteins_comprehensive()');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

// Run the migration
migrateDatabase()
  .then(() => {
    console.log('\n🎉 Database migration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });