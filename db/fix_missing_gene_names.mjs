#!/usr/bin/env node
/**
 * Fix Missing Gene Names
 * ======================
 *
 * Fetches gene names from UniProt for proteins that are missing them.
 * Focuses on proteins that have organism codes but no gene names.
 *
 * Usage:
 *   node db/fix_missing_gene_names.mjs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function fetchGeneNameFromUniProt(uniprotId) {
  try {
    const cmd = `curl -s "https://rest.uniprot.org/uniprotkb/${uniprotId}.json" | python3 -c "import json, sys; data = json.load(sys.stdin); print(data.get('genes', [{}])[0].get('geneName', {}).get('value', ''))"`;
    const { stdout } = await execAsync(cmd);
    const geneName = stdout.trim();
    return geneName || null;
  } catch (error) {
    console.error(`  ✗ Error fetching ${uniprotId}:`, error.message);
    return null;
  }
}

async function fixMissingGeneNames() {
  console.log('Fixing Missing Gene Names');
  console.log('========================\n');

  try {
    // Find proteins with NULL gene names (excluding Unknown organisms)
    const missing = await sql`
      SELECT id, uniprot_id, organism_code
      FROM proteins
      WHERE gene_name IS NULL
        AND organism_code IS NOT NULL
      ORDER BY uniprot_id
    `;

    console.log(`Found ${missing.rows.length} proteins missing gene names\n`);

    if (missing.rows.length === 0) {
      console.log('✓ All proteins have gene names!');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const protein of missing.rows) {
      console.log(`Fetching ${protein.uniprot_id}...`);

      const geneName = await fetchGeneNameFromUniProt(protein.uniprot_id);

      if (geneName) {
        // Update protein
        await sql`UPDATE proteins SET gene_name = ${geneName} WHERE id = ${protein.id}`;

        // Add alias
        await sql`
          INSERT INTO protein_aliases (protein_id, alias_name, alias_type, source)
          VALUES (${protein.id}, ${geneName}, 'gene_name', 'uniprot')
          ON CONFLICT DO NOTHING
        `;

        console.log(`  ✓ ${protein.uniprot_id} → ${geneName}`);
        updated++;
      } else {
        console.log(`  ✗ ${protein.uniprot_id}: No gene name found in UniProt`);
        failed++;
      }

      // Rate limit: 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✓ Update complete!`);
    console.log(`  Updated: ${updated} proteins`);
    console.log(`  Failed: ${failed} proteins`);

    if (updated > 0) {
      console.log('\nNote: Changes are immediately visible in the web app!');
      console.log('Refresh the page to see updated gene names.');
    }

  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Main execution
fixMissingGeneNames()
  .then(() => {
    console.log('\n✓ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Failed:', error.message);
    process.exit(1);
  });
