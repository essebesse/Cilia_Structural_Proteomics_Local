#!/usr/bin/env node

/**
 * Script to import Lotte Pedersen's AF3 results into ProtoView database
 * Processes AF3_PD_analysis_v3.json files from human AF3 runs
 */

import { db } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL environment variable is required');
  process.exit(1);
}

// Path to Lotte's AF3 results
const LOTTE_AF3_PATH = '/emcc/au14762/AF/Lotte_Pedersen/O15182_CENT3/AF3/AF3_PD_analysis_v3.json';

// Map confidence levels from Lotte's system to our database enum
const CONFIDENCE_MAPPING = {
  'Very High Confidence': 'Very High Confidence',
  'Worth Investigating': 'Worth Investigating',
  'Low iPTM - Proceed with Caution': 'Low iPTM - Proceed with Caution',
  'Very Low': 'Very Low',
  'Low': 'Low',
  'Medium': 'Medium',
  'High': 'High'
};

async function parseProteinName(directoryName) {
  // Parse protein IDs from directory names like "o15182_and_q8na72"
  const parts = directoryName.toLowerCase().split('_and_');
  if (parts.length === 2) {
    return {
      protein1: parts[0].toUpperCase(),
      protein2: parts[1].toUpperCase()
    };
  }
  return null;
}

async function ensureProteinExists(client, uniprotId, isFromLotte = true) {
  // Check if protein exists
  const existing = await client.query(
    'SELECT id FROM proteins WHERE uniprot_id = $1',
    [uniprotId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new protein with basic info
  const result = await client.query(`
    INSERT INTO proteins (uniprot_id, gene_name, organism, organism_code)
    VALUES ($1, $2, 'Homo sapiens'::organism_type, 'Hs')
    RETURNING id
  `, [uniprotId, uniprotId + ']']); // Add ] to match existing format

  console.log(`   ✅ Created new protein: ${uniprotId}`);
  return result.rows[0].id;
}

async function importLotteAF3Results() {
  const client = await db.connect();

  try {
    console.log('🔧 Importing Lotte Pedersen AF3 results...');
    console.log(`📂 Reading: ${LOTTE_AF3_PATH}`);

    // Read and parse JSON file
    const jsonData = JSON.parse(fs.readFileSync(LOTTE_AF3_PATH, 'utf8'));

    console.log(`📊 Analysis info:`);
    console.log(`   Date: ${jsonData.analysis_date}`);
    console.log(`   Total predictions: ${jsonData.total_predictions}`);
    console.log(`   High confidence: ${jsonData.high_confidence_count}`);

    const predictions = jsonData.high_confidence_predictions || [];
    console.log(`\n🔄 Processing ${predictions.length} high-confidence predictions...`);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const pred of predictions) {
      try {
        // Parse protein names from directory
        const proteins = await parseProteinName(pred.directory_name);
        if (!proteins) {
          console.log(`   ⚠️  Could not parse directory: ${pred.directory_name}`);
          skipped++;
          continue;
        }

        // Ensure both proteins exist in database
        const baitId = await ensureProteinExists(client, proteins.protein1);
        const preyId = await ensureProteinExists(client, proteins.protein2);

        // Map confidence level
        const mappedConfidence = CONFIDENCE_MAPPING[pred.confidence] || pred.confidence;

        // Prepare interaction data
        const sourceBasePath = `/emcc/au14762/AF/Lotte_Pedersen/O15182_CENT3/AF3/${pred.directory_name}`;

        // Check if interaction already exists
        const existingQuery = await client.query(`
          SELECT id FROM interactions
          WHERE bait_protein_id = $1 AND prey_protein_id = $2 AND source_path = $3
        `, [baitId, preyId, sourceBasePath]);

        if (existingQuery.rows.length > 0) {
          skipped++;
          continue;
        }

        // Insert interaction
        await client.query(`
          INSERT INTO interactions (
            bait_protein_id, prey_protein_id, iptm, confidence, alphafold_version,
            contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt, source_path
          ) VALUES ($1, $2, $3, $4::confidence_level, $5, $6, $7, $8, $9)
        `, [
          baitId,
          preyId,
          pred.iptm,
          mappedConfidence,
          'AF3',
          pred.contacts_pae_lt_3 || null,
          pred.contacts_pae_lt_6 || null,
          pred.interface_plddt || null,
          sourceBasePath
        ]);

        imported++;

        if (imported % 10 === 0) {
          console.log(`   📝 Imported ${imported} interactions...`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${pred.directory_name}:`, error.message);
        errors++;
      }
    }

    // Get final statistics
    const stats = await client.query(`
      SELECT
        COUNT(*) as total_interactions,
        COUNT(CASE WHEN alphafold_version = 'AF3' THEN 1 END) as af3_interactions,
        COUNT(CASE WHEN source_path LIKE '%Lotte_Pedersen%' THEN 1 END) as lotte_interactions
      FROM interactions
    `);

    const proteinStats = await client.query(`
      SELECT
        COUNT(*) as total_proteins,
        COUNT(CASE WHEN organism = 'Homo sapiens' THEN 1 END) as human_proteins
      FROM proteins
    `);

    console.log('\n✅ Import completed!');
    console.log('\n📊 Import Results:');
    console.log(`   Successfully imported: ${imported} interactions`);
    console.log(`   Skipped (duplicates): ${skipped}`);
    console.log(`   Errors: ${errors}`);

    console.log('\n📊 Database Statistics:');
    console.log(`   Total interactions: ${stats.rows[0].total_interactions}`);
    console.log(`   AF3 interactions: ${stats.rows[0].af3_interactions}`);
    console.log(`   Lotte's interactions: ${stats.rows[0].lotte_interactions}`);
    console.log(`   Total proteins: ${proteinStats.rows[0].total_proteins}`);
    console.log(`   Human proteins: ${proteinStats.rows[0].human_proteins}`);

    // Show some example new interactions
    const examples = await client.query(`
      SELECT
        bait.uniprot_id as bait_uniprot, bait.gene_name as bait_gene,
        prey.uniprot_id as prey_uniprot, prey.gene_name as prey_gene,
        i.iptm, i.confidence
      FROM interactions i
      JOIN proteins bait ON i.bait_protein_id = bait.id
      JOIN proteins prey ON i.prey_protein_id = prey.id
      WHERE i.source_path LIKE '%Lotte_Pedersen%'
      ORDER BY i.iptm DESC
      LIMIT 5
    `);

    console.log('\n🔍 Example new interactions (top 5 by iPTM):');
    for (const ex of examples.rows) {
      console.log(`   ${ex.bait_uniprot} ↔ ${ex.prey_uniprot} (iPTM: ${ex.iptm}, ${ex.confidence})`);
    }

  } catch (error) {
    console.error('❌ Import failed:', error);
    throw error;
  } finally {
    await client.release();
  }
}

// Run the import
importLotteAF3Results()
  .then(() => {
    console.log('\n🎉 Lotte AF3 import completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Import failed:', error);
    process.exit(1);
  });