#!/usr/bin/env node

/**
 * Script to populate organism-specific data and cross-organism mappings
 * This script adds common names and creates ortholog relationships
 */

import { db } from '@vercel/postgres';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL environment variable is required');
  process.exit(1);
}

// Known organism-specific protein mappings
const PROTEIN_MAPPINGS = [
  // ODA16/DAW1 ortholog pair
  {
    chlamydomonas: { uniprot: 'Q3Y8L7', common_name: 'ODA16', aliases: ['CrODA16', 'Outer Dynein Arm 16'] },
    human: { uniprot: 'Q96GQ7', common_name: 'DAW1', aliases: ['DNAAF6', 'Dynein Assembly Factor'] }
  },
  // Add more known ortholog pairs here
  {
    chlamydomonas: { uniprot: 'A8IQW5', common_name: 'IFT144', aliases: ['WDR19', 'CrIFT144'] },
    human: { uniprot: 'Q8NEZ3', common_name: 'WDR19', aliases: ['IFT144', 'SRTD5'] }
  }
];

// Additional Chlamydomonas-specific names that should be added as aliases
const CHLAMYDOMONAS_ALIASES = [
  { uniprot: 'Q3Y8L7', aliases: ['ODA16', 'CrODA16', 'Outer Dynein Arm 16'] },
  { uniprot: 'A8IQW5', aliases: ['CrIFT144', 'CrWDR19'] },
  // Add more as needed
];

async function populateOrganismData() {
  const client = await db.connect();

  try {
    console.log('🔧 Populating organism-specific data and cross-organism mappings...');

    // Update common names for known proteins
    console.log('📝 Adding Chlamydomonas common names...');

    // Add ODA16 as common name for Q3Y8L7
    await client.query(`
      UPDATE proteins
      SET common_name = 'ODA16',
          description = 'Outer dynein arm assembly factor 16'
      WHERE uniprot_id = 'Q3Y8L7';
    `);

    // Add additional Chlamydomonas aliases
    console.log('📝 Adding Chlamydomonas-specific aliases...');
    for (const mapping of CHLAMYDOMONAS_ALIASES) {
      // Get protein ID
      const proteinResult = await client.query(
        'SELECT id FROM proteins WHERE uniprot_id = $1',
        [mapping.uniprot]
      );

      if (proteinResult.rows.length > 0) {
        const proteinId = proteinResult.rows[0].id;

        for (const alias of mapping.aliases) {
          try {
            await client.query(`
              INSERT INTO protein_aliases (protein_id, alias_name, alias_type, source, organism, organism_code, is_primary)
              VALUES ($1, $2, 'common_name', 'manual', 'Chlamydomonas reinhardtii'::organism_type, 'Cr', true)
              ON CONFLICT DO NOTHING;
            `, [proteinId, alias]);

            console.log(`   ✅ Added alias '${alias}' for ${mapping.uniprot}`);
          } catch (error) {
            console.log(`   ⚠️  Could not add alias '${alias}' for ${mapping.uniprot}:`, error.message);
          }
        }
      } else {
        console.log(`   ⚠️  Protein ${mapping.uniprot} not found in database`);
      }
    }

    // Create ortholog relationships
    console.log('📝 Creating cross-organism ortholog mappings...');
    for (const mapping of PROTEIN_MAPPINGS) {
      try {
        // Get protein IDs
        const chlamyResult = await client.query(
          'SELECT id FROM proteins WHERE uniprot_id = $1',
          [mapping.chlamydomonas.uniprot]
        );

        const humanResult = await client.query(
          'SELECT id FROM proteins WHERE uniprot_id = $1',
          [mapping.human.uniprot]
        );

        if (chlamyResult.rows.length > 0 && humanResult.rows.length > 0) {
          const chlamyId = chlamyResult.rows[0].id;
          const humanId = humanResult.rows[0].id;

          // Create ortholog relationship
          await client.query(`
            INSERT INTO protein_orthologs (protein_id_1, protein_id_2, ortholog_type, confidence_score, source)
            VALUES ($1, $2, 'ortholog', 0.9, 'manual')
            ON CONFLICT DO NOTHING;
          `, [chlamyId, humanId]);

          console.log(`   ✅ Created ortholog mapping: ${mapping.chlamydomonas.common_name} ↔ ${mapping.human.common_name}`);
        } else {
          console.log(`   ⚠️  Could not find proteins for ortholog mapping: ${mapping.chlamydomonas.uniprot} ↔ ${mapping.human.uniprot}`);
        }
      } catch (error) {
        console.log(`   ❌ Error creating ortholog mapping:`, error.message);
      }
    }

    // Test the new search functionality
    console.log('\n🔍 Testing enhanced search functionality...');

    // Test searching for ODA16
    const oda16Results = await client.query(`
      SELECT * FROM search_proteins_comprehensive('ODA16') LIMIT 5;
    `);

    console.log('   Search results for "ODA16":');
    for (const row of oda16Results.rows) {
      console.log(`     ${row.uniprot_id} (${row.organism_code}) - ${row.common_name || row.gene_name} [${row.match_type}: ${row.match_value}]`);
    }

    // Test searching for DAW1
    const daw1Results = await client.query(`
      SELECT * FROM search_proteins_comprehensive('DAW1') LIMIT 5;
    `);

    console.log('   Search results for "DAW1":');
    for (const row of daw1Results.rows) {
      console.log(`     ${row.uniprot_id} (${row.organism_code}) - ${row.common_name || row.gene_name} [${row.match_type}: ${row.match_value}]`);
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

    const orthologStats = await client.query(`
      SELECT COUNT(*) as ortholog_pairs FROM protein_orthologs;
    `);

    const aliasStats = await client.query(`
      SELECT
        COUNT(*) as total_aliases,
        COUNT(CASE WHEN is_primary = true THEN 1 END) as primary_aliases,
        COUNT(CASE WHEN organism = 'Chlamydomonas reinhardtii' THEN 1 END) as chlamydomonas_aliases
      FROM protein_aliases;
    `);

    console.log('\n✅ Organism data population completed!');
    console.log('\n📊 Updated Statistics:');
    console.log(`   Total proteins: ${stats.rows[0].total_proteins}`);
    console.log(`   Chlamydomonas: ${stats.rows[0].chlamydomonas_proteins}`);
    console.log(`   Human: ${stats.rows[0].human_proteins}`);
    console.log(`   Proteins with common names: ${stats.rows[0].proteins_with_common_names}`);
    console.log(`   Ortholog pairs: ${orthologStats.rows[0].ortholog_pairs}`);
    console.log(`   Total aliases: ${aliasStats.rows[0].total_aliases}`);
    console.log(`   Primary aliases: ${aliasStats.rows[0].primary_aliases}`);
    console.log(`   Chlamydomonas aliases: ${aliasStats.rows[0].chlamydomonas_aliases}`);

  } catch (error) {
    console.error('❌ Population failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

// Run the population script
populateOrganismData()
  .then(() => {
    console.log('\n🎉 Organism data population completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Population failed:', error);
    process.exit(1);
  });