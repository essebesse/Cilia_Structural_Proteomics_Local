#!/usr/bin/env node
import { db } from '@vercel/postgres';
import fetch from 'node-fetch';

const DELAY_MS = 1000; // 1 second between requests (UniProt rate limit)
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

async function lookupProteinOrganism(uniprotId) {
  try {
    const url = `https://rest.uniprot.org/uniprotkb/${uniprotId}.json`;
    console.log(`🔍 Looking up ${uniprotId}...`);

    const response = await fetch(url);

    if (!response.ok) {
      console.log(`⚠️  ${uniprotId}: API error ${response.status}`);
      return null;
    }

    const data = await response.json();
    const organism = data.organism?.scientificName;

    if (!organism) {
      console.log(`⚠️  ${uniprotId}: No organism data found`);
      return null;
    }

    // Map to our organism types
    if (organism === 'Homo sapiens') {
      console.log(`✅ ${uniprotId}: Human`);
      return { organism: 'Homo sapiens', code: 'Hs' };
    }

    if (organism === 'Chlamydomonas reinhardtii') {
      console.log(`✅ ${uniprotId}: Chlamydomonas`);
      return { organism: 'Chlamydomonas reinhardtii', code: 'Cr' };
    }

    console.log(`ℹ️  ${uniprotId}: Other organism (${organism})`);
    return { organism: 'Unknown', code: null };

  } catch (error) {
    console.error(`❌ Error looking up ${uniprotId}:`, error.message);
    return null;
  }
}

async function batchOrganismLookup() {
  const client = await db.connect();

  try {
    console.log('🚀 Starting comprehensive organism lookup...');

    // First, reset all to Unknown to clean slate
    console.log('Step 1: Resetting all organisms to Unknown (clean slate)');
    const resetResult = await client.query(`
      UPDATE proteins
      SET organism = 'Unknown'::organism_type, organism_code = NULL
    `);
    console.log(`✅ Reset ${resetResult.rowCount} proteins to Unknown`);

    // Apply high-confidence rules first
    console.log('\nStep 2: Applying high-confidence organism assignments');

    // Chlamydomonas from specific AF2_Cre data and Cre gene names
    const crResult = await client.query(`
      UPDATE proteins
      SET organism = 'Chlamydomonas reinhardtii'::organism_type,
          organism_code = 'Cr'
      WHERE uniprot_id LIKE 'AF2_Cre%'
         OR uniprot_id LIKE 'Cre%'
         OR uniprot_id LIKE 'cre%'
         OR gene_name LIKE 'Cre.%'
    `);
    console.log(`✅ Assigned ${crResult.rowCount} proteins as Chlamydomonas (high confidence)`);

    // Human from Lotte's dataset
    const hsResult = await client.query(`
      UPDATE proteins
      SET organism = 'Homo sapiens'::organism_type,
          organism_code = 'Hs'
      WHERE uniprot_id IN (
        SELECT DISTINCT unnest(ARRAY[bait.uniprot_id, prey.uniprot_id])
        FROM interactions i
        JOIN proteins bait ON i.bait_protein_id = bait.id
        JOIN proteins prey ON i.prey_protein_id = prey.id
        WHERE i.source_path LIKE '%Lotte_Pedersen%'
      )
    `);
    console.log(`✅ Assigned ${hsResult.rowCount} proteins as Human (Lotte's dataset)`);

    // Get proteins that still need lookup (only valid UniProt IDs)
    const unknownProteins = await client.query(`
      SELECT uniprot_id FROM proteins
      WHERE organism = 'Unknown'
        AND uniprot_id ~ '^[A-Z][0-9][A-Z0-9]{3}[0-9]$'  -- Standard UniProt format (6 chars)
        OR uniprot_id ~ '^[A-Z][0-9][A-Z0-9]{4}[0-9]$'   -- Alternative UniProt format (7 chars)
      ORDER BY uniprot_id
    `);

    console.log(`\n🔍 Looking up ${unknownProteins.rows.length} proteins via UniProt API...`);
    console.log('This will take approximately', Math.ceil(unknownProteins.rows.length * DELAY_MS / 1000 / 60), 'minutes');

    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (const protein of unknownProteins.rows) {
      const orgData = await lookupProteinOrganism(protein.uniprot_id);

      if (orgData) {
        await client.query(`
          UPDATE proteins
          SET organism = $1::organism_type, organism_code = $2
          WHERE uniprot_id = $3
        `, [orgData.organism, orgData.code, protein.uniprot_id]);
        successful++;
      } else {
        failed++;
      }

      processed++;
      if (processed % 10 === 0) {
        console.log(`📊 Progress: ${processed}/${unknownProteins.rows.length} (${successful} successful, ${failed} failed)`);
      }

      // Rate limiting - respect UniProt's limits
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }

    // Final statistics
    console.log('\n📈 Final organism distribution:');
    const finalStats = await client.query(`
      SELECT organism, organism_code, COUNT(*) as count
      FROM proteins
      GROUP BY organism, organism_code
      ORDER BY count DESC
    `);

    finalStats.rows.forEach(row => {
      console.log(`  ${row.organism} (${row.organism_code}): ${row.count} proteins`);
    });

    console.log(`\n✅ Lookup completed: ${successful} successful, ${failed} failed out of ${processed} total`);

  } finally {
    await client.release();
  }
}

console.log('🧬 UniProt Organism Lookup Tool');
console.log('This tool will fix organism assignments using UniProt API');
console.log('WARNING: This will reset ALL current assignments first!\n');

batchOrganismLookup()
  .then(() => console.log('✅ Organism lookup completed successfully'))
  .catch(err => console.error('❌ Lookup failed:', err));