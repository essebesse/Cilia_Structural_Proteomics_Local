#!/usr/bin/env node
/**
 * Setup Complex Tables in Database
 * =================================
 *
 * Creates the necessary tables for storing protein complex data.
 * Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Usage:
 *   node db/setup_complex_tables.mjs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupTables() {
  console.log('ProtoView Complex Tables Setup');
  console.log('==============================\n');

  try {
    console.log('Step 1: Creating protein_complexes table...');
    await sql`
      CREATE TABLE IF NOT EXISTS protein_complexes (
        id SERIAL PRIMARY KEY,
        complex_name VARCHAR(255) UNIQUE NOT NULL,
        display_name VARCHAR(255),
        description TEXT,
        num_proteins INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('  ✓ protein_complexes table ready\n');

    console.log('Step 2: Creating complex_proteins junction table...');
    await sql`
      CREATE TABLE IF NOT EXISTS complex_proteins (
        id SERIAL PRIMARY KEY,
        complex_id INTEGER REFERENCES protein_complexes(id) ON DELETE CASCADE,
        protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
        chain_id VARCHAR(10) NOT NULL,
        position INTEGER DEFAULT 0,
        role VARCHAR(20) DEFAULT 'bait' CHECK (role IN ('bait', 'structural')),
        UNIQUE(complex_id, protein_id, chain_id)
      )
    `;
    console.log('  ✓ complex_proteins table ready\n');

    console.log('Step 3: Creating complex_interactions table...');
    await sql`
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
        per_chain_plddt JSONB,
        ranking_score FLOAT,
        ptm FLOAT,
        mean_plddt FLOAT,
        interface_residue_count INTEGER,
        UNIQUE(bait_complex_id, prey_protein_id, source_path, alphafold_version)
      )
    `;
    console.log('  ✓ complex_interactions table ready\n');

    console.log('Step 4: Creating indexes...');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_complex_proteins_on_complex
      ON complex_proteins(complex_id)
    `;
    console.log('  ✓ Index on complex_proteins.complex_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_complex_proteins_on_protein
      ON complex_proteins(protein_id)
    `;
    console.log('  ✓ Index on complex_proteins.protein_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_complex_interactions_on_bait_complex
      ON complex_interactions(bait_complex_id)
    `;
    console.log('  ✓ Index on complex_interactions.bait_complex_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_complex_interactions_on_prey
      ON complex_interactions(prey_protein_id)
    `;
    console.log('  ✓ Index on complex_interactions.prey_protein_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_complex_interactions_on_confidence
      ON complex_interactions(confidence)
    `;
    console.log('  ✓ Index on complex_interactions.confidence');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_protein_complexes_on_name
      ON protein_complexes(complex_name)
    `;
    console.log('  ✓ Index on protein_complexes.complex_name\n');

    // Check table status
    console.log('Step 5: Verifying tables...');
    const complexesCount = await sql`SELECT COUNT(*) FROM protein_complexes`;
    const linksCount = await sql`SELECT COUNT(*) FROM complex_proteins`;
    const interactionsCount = await sql`SELECT COUNT(*) FROM complex_interactions`;

    console.log(`  ✓ protein_complexes: ${complexesCount.rows[0].count} entries`);
    console.log(`  ✓ complex_proteins: ${linksCount.rows[0].count} links`);
    console.log(`  ✓ complex_interactions: ${interactionsCount.rows[0].count} interactions\n`);

    console.log('✓ Setup complete!');
    console.log('\nYou can now import complex data using:');
    console.log('  node db/import_complex_af3_json.mjs /path/to/AF3_bait_prey_analysis_v3.json');

  } catch (error) {
    console.error('\n✗ Setup failed:', error);
    throw error;
  }
}

// Main execution
setupTables()
  .then(() => {
    console.log('\n✓ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nError:', error.message);
    process.exit(1);
  });
