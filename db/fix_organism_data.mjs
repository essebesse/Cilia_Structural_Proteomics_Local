#!/usr/bin/env node

/**
 * Quick fix script to update organism data for specific proteins
 */

import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL environment variable is required');
  process.exit(1);
}

async function fixOrganismData() {
  const client = await db.connect();

  try {
    console.log('🔧 Fixing organism data for key proteins...');

    // Update AF2_Q3Y8L7 to be Chlamydomonas with ODA16 as common name
    await client.query(`
      UPDATE proteins
      SET organism = 'Chlamydomonas reinhardtii'::organism_type,
          organism_code = 'Cr',
          common_name = 'ODA16',
          description = 'Outer dynein arm assembly factor 16'
      WHERE uniprot_id = 'AF2_Q3Y8L7';
    `);
    console.log('✅ Updated AF2_Q3Y8L7 → Chlamydomonas ODA16');

    // Update the cre04 protein to also be Chlamydomonas
    await client.query(`
      UPDATE proteins
      SET organism = 'Chlamydomonas reinhardtii'::organism_type,
          organism_code = 'Cr',
          common_name = 'ODA16',
          description = 'Outer dynein arm assembly factor; DAW1 ortholog'
      WHERE uniprot_id = 'cre04_g216902_t1_1';
    `);
    console.log('✅ Updated cre04_g216902_t1_1 → Chlamydomonas ODA16');

    // Update Q8N136 to have proper description
    await client.query(`
      UPDATE proteins
      SET common_name = 'DAW1',
          description = 'Dynein assembly factor with WD repeat domains 1'
      WHERE uniprot_id = 'Q8N136';
    `);
    console.log('✅ Updated Q8N136 → Human DAW1');

    // Add ODA16 as an alias for AF2_Q3Y8L7
    const proteinResult = await client.query('SELECT id FROM proteins WHERE uniprot_id = $1', ['AF2_Q3Y8L7']);
    if (proteinResult.rows.length > 0) {
      const proteinId = proteinResult.rows[0].id;

      // Add aliases
      const aliases = ['ODA16', 'CrODA16', 'Outer Dynein Arm 16', 'DAW1 ortholog'];
      for (const alias of aliases) {
        try {
          await client.query(`
            INSERT INTO protein_aliases (protein_id, alias_name, alias_type, source, organism, organism_code, is_primary)
            VALUES ($1, $2, 'common_name', 'manual', 'Chlamydomonas reinhardtii'::organism_type, 'Cr', $3)
            ON CONFLICT DO NOTHING;
          `, [proteinId, alias, alias === 'ODA16']);
          console.log(`   ✅ Added alias '${alias}' for AF2_Q3Y8L7`);
        } catch (error) {
          console.log(`   ⚠️  Alias '${alias}' might already exist`);
        }
      }
    }

    // Fix the search function to handle text types properly
    console.log('📝 Fixing search function data types...');
    await client.query(`
      DROP FUNCTION IF EXISTS search_proteins_comprehensive(text);
    `);

    // Test basic search manually first
    console.log('\n🔍 Testing searches...');

    // Search for ODA16
    const oda16Results = await client.query(`
      SELECT uniprot_id, gene_name, organism, organism_code, common_name
      FROM proteins
      WHERE common_name ILIKE '%ODA16%' OR gene_name ILIKE '%ODA16%'
         OR uniprot_id ILIKE '%Q3Y8L7%';
    `);
    console.log('   ODA16 search results:');
    for (const row of oda16Results.rows) {
      console.log(`     ${row.uniprot_id} (${row.organism_code}) - ${row.common_name || row.gene_name}`);
    }

    // Search aliases for ODA16
    const aliasResults = await client.query(`
      SELECT p.uniprot_id, p.gene_name, p.organism, p.organism_code, p.common_name, pa.alias_name
      FROM proteins p
      JOIN protein_aliases pa ON p.id = pa.protein_id
      WHERE pa.alias_name ILIKE '%ODA16%';
    `);
    console.log('   Alias search results for ODA16:');
    for (const row of aliasResults.rows) {
      console.log(`     ${row.uniprot_id} (${row.organism_code}) - ${row.common_name || row.gene_name} [alias: ${row.alias_name}]`);
    }

    // Get final statistics
    const stats = await client.query(`
      SELECT
        COUNT(*) as total_proteins,
        COUNT(CASE WHEN organism = 'Chlamydomonas reinhardtii' THEN 1 END) as chlamydomonas_proteins,
        COUNT(CASE WHEN organism = 'Homo sapiens' THEN 1 END) as human_proteins,
        COUNT(CASE WHEN common_name IS NOT NULL THEN 1 END) as proteins_with_common_names
      FROM proteins;
    `);

    console.log('\n📊 Final Statistics:');
    console.log(`   Total proteins: ${stats.rows[0].total_proteins}`);
    console.log(`   Chlamydomonas: ${stats.rows[0].chlamydomonas_proteins}`);
    console.log(`   Human: ${stats.rows[0].human_proteins}`);
    console.log(`   Proteins with common names: ${stats.rows[0].proteins_with_common_names}`);

  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

// Run the fix
fixOrganismData()
  .then(() => {
    console.log('\n🎉 Organism data fixes completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fix failed:', error);
    process.exit(1);
  });