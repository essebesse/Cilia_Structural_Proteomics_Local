#!/usr/bin/env node
import { db } from '@vercel/postgres';
import { readFileSync } from 'fs';

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

const jsonFile = process.argv[2];
if (!jsonFile) {
  console.error('❌ Usage: node import_af3_json.mjs <path_to_json_file>');
  process.exit(1);
}

/**
 * Calculate confidence level using interface quality-centric scheme
 * Same logic as frontend and migration script
 */
function calculateConfidence(iptm, contacts, iplddt) {
  // Convert to numbers, handle NULL/undefined
  const iptmVal = parseFloat(iptm) || 0;
  const contactsVal = parseInt(contacts) || 0;
  const ipLDDTVal = parseFloat(iplddt) || 0;

  // HIGH CONFIDENCE
  // Criteria: iPTM ≥ 0.7 OR (contacts ≥ 40 AND ipLDDT ≥ 80) OR (contacts ≥ 30 AND iPTM ≥ 0.5 AND ipLDDT ≥ 80)
  // BUT exclude if iPTM < 0.75 AND contacts < 5
  const meetsHighCriteria =
    iptmVal >= 0.7 ||
    (contactsVal >= 40 && ipLDDTVal >= 80) ||
    (contactsVal >= 30 && iptmVal >= 0.5 && ipLDDTVal >= 80);

  const isExcludedFromHigh = iptmVal < 0.75 && contactsVal < 5;

  if (meetsHighCriteria && !isExcludedFromHigh) {
    return 'High';
  }

  // MEDIUM CONFIDENCE
  // Criteria: iPTM ≥ 0.6 OR (contacts ≥ 20 AND ipLDDT ≥ 75) OR (contacts ≥ 15 AND iPTM ≥ 0.45)
  if (
    iptmVal >= 0.6 ||
    (contactsVal >= 20 && ipLDDTVal >= 75) ||
    (contactsVal >= 15 && iptmVal >= 0.45)
  ) {
    return 'Medium';
  }

  // LOW CONFIDENCE
  return 'Low';
}

async function importAF3Json(jsonFile) {
  const client = await db.connect();

  try {
    console.log(`🧬 Importing AF3 JSON data from: ${jsonFile}`);

    // Read and parse JSON
    const jsonData = JSON.parse(readFileSync(jsonFile, 'utf8'));

    // Detect JSON format version and get predictions
    // v3 uses high_confidence_predictions, v4 uses filtered_predictions
    const isV4Format = jsonData.version && jsonData.version.startsWith('v4');
    const allPredictions = jsonData.high_confidence_predictions || jsonData.filtered_predictions || [];
    console.log(`📊 Found ${allPredictions.length} total predictions in JSON (${isV4Format ? 'v4 format' : 'v3 format'})\n`);

    // IMPORTANT: Only import actionable confidence levels
    // We SKIP "Very Low" predictions as they are unreliable
    // v3 confidence classes
    const ACTIONABLE_CONFIDENCE_LEVELS_V3 = [
      'Very High Confidence',
      'Worth Investigating',
      'Low iPTM - Proceed with Caution'
    ];
    // v4 confidence classes (ipSAE-based)
    const ACTIONABLE_CONFIDENCE_LEVELS_V4 = [
      'High Confidence',
      'Medium Confidence',
      'Low/Ambiguous'
    ];

    // Filter to only actionable predictions
    const predictions = allPredictions.filter(p => {
      const confClass = p.confidence_class || p.ipsae_confidence_class;
      return ACTIONABLE_CONFIDENCE_LEVELS_V3.includes(confClass) ||
             ACTIONABLE_CONFIDENCE_LEVELS_V4.includes(confClass);
    });

    // Display confidence distribution based on format
    console.log(`📋 Confidence distribution:`);
    if (isV4Format) {
      console.log(`   ✅ High Confidence: ${allPredictions.filter(p => p.ipsae_confidence_class === 'High Confidence').length}`);
      console.log(`   ✅ Medium Confidence: ${allPredictions.filter(p => p.ipsae_confidence_class === 'Medium Confidence').length}`);
      console.log(`   ✅ Low/Ambiguous: ${allPredictions.filter(p => p.ipsae_confidence_class === 'Low/Ambiguous').length}`);
      console.log(`   ❌ Very Low (SKIPPED): ${jsonData.ipsae_distribution?.['Very Low'] || 0}`);
    } else {
      console.log(`   ✅ Very High Confidence: ${allPredictions.filter(p => p.confidence_class === 'Very High Confidence').length}`);
      console.log(`   ✅ Worth Investigating: ${allPredictions.filter(p => p.confidence_class === 'Worth Investigating').length}`);
      console.log(`   ✅ Low iPTM - Proceed with Caution: ${allPredictions.filter(p => p.confidence_class === 'Low iPTM - Proceed with Caution').length}`);
      console.log(`   ❌ Very Low (SKIPPED): ${allPredictions.filter(p => p.confidence_class === 'Very Low').length}`);
    }
    console.log(`\n✅ Importing ${predictions.length} actionable interactions\n`);

    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (const prediction of predictions) {
      try {
        const directory = prediction.directory || prediction.directory_name;
        const iptm = prediction.iptm;

        // Extract structural quality metrics from JSON (needed for confidence calculation)
        const contactsPaeLt3 = prediction.contacts_pae3 || null;
        const contactsPaeLt6 = prediction.contacts_pae6 || null;
        const interfacePlddt = prediction.mean_interface_plddt || null;

        // Extract ipSAE data (v4 format only)
        const ipsae = prediction.ipsae || null;
        const ipsaePaeCutoff = prediction.ipsae_pae_cutoff || 10;

        // Map v4 JSON confidence class to database enum values
        // JSON: "High Confidence", "Medium Confidence", "Low/Ambiguous", "Very Low"
        // DB enum: "High", "Medium", "Low", "Very Low"
        let ipsaeConfidence = null;
        if (prediction.ipsae_confidence_class) {
          const classMap = {
            'High Confidence': 'High',
            'Medium Confidence': 'Medium',
            'Low/Ambiguous': 'Low',
            'Very Low': 'Very Low'
          };
          ipsaeConfidence = classMap[prediction.ipsae_confidence_class] || null;
        }

        // Calculate confidence using interface quality-centric scheme
        const confidence = calculateConfidence(iptm, contactsPaeLt3, interfacePlddt);

        // Extract protein IDs from directory name (e.g., "q9nvl8_and_p68363")
        const parts = directory.toLowerCase().split('_and_');
        if (parts.length !== 2) {
          console.warn(`⚠️  Skipping invalid directory format: ${directory}`);
          failed++;
          continue;
        }

        const baitId = parts[0].toUpperCase();
        const preyId = parts[1].toUpperCase();

        // Insert proteins (with CONFLICT handling)
        await client.query(`
          INSERT INTO proteins (uniprot_id, organism, organism_code)
          VALUES ($1, 'Unknown'::organism_type, NULL)
          ON CONFLICT (uniprot_id) DO NOTHING
        `, [baitId]);

        await client.query(`
          INSERT INTO proteins (uniprot_id, organism, organism_code)
          VALUES ($1, 'Unknown'::organism_type, NULL)
          ON CONFLICT (uniprot_id) DO NOTHING
        `, [preyId]);

        // Get protein IDs
        const baitResult = await client.query('SELECT id FROM proteins WHERE uniprot_id = $1', [baitId]);
        const preyResult = await client.query('SELECT id FROM proteins WHERE uniprot_id = $1', [preyId]);

        if (baitResult.rows.length === 0 || preyResult.rows.length === 0) {
          console.warn(`⚠️  Could not find protein IDs for ${baitId}/${preyId}`);
          failed++;
          continue;
        }

        const baitProteinId = baitResult.rows[0].id;
        const preyProteinId = preyResult.rows[0].id;

        // Check if this interaction already exists (prevent v3/v4 duplicates)
        const existingCheck = await client.query(`
          SELECT id FROM interactions
          WHERE bait_protein_id = $1
            AND prey_protein_id = $2
            AND iptm = $3
            AND COALESCE(contacts_pae_lt_3, 0) = COALESCE($4, 0)
        `, [baitProteinId, preyProteinId, iptm, contactsPaeLt3]);

        if (existingCheck.rows.length > 0) {
          // Update existing interaction (e.g., v4 updating v3 with ipSAE data)
          await client.query(`
            UPDATE interactions SET
              confidence = $1::confidence_level,
              source_path = $2,
              contacts_pae_lt_3 = $3,
              contacts_pae_lt_6 = $4,
              interface_plddt = $5,
              ipsae = $6,
              ipsae_confidence = $7::ipsae_confidence_level,
              ipsae_pae_cutoff = $8,
              analysis_version = $9
            WHERE id = $10
          `, [
            confidence,
            jsonFile,
            contactsPaeLt3,
            contactsPaeLt6,
            interfacePlddt,
            ipsae,
            ipsaeConfidence,
            ipsaePaeCutoff,
            isV4Format ? 'v4' : 'v3',
            existingCheck.rows[0].id
          ]);
          const ipsaeInfo = ipsae ? `, ipSAE: ${ipsae.toFixed(3)}` : '';
          console.log(`🔄 ${baitId} ↔ ${preyId} (iPTM: ${iptm}, ${confidence}${ipsaeInfo}) - UPDATED`);
        } else {
          // Insert new interaction
          await client.query(`
            INSERT INTO interactions (
              bait_protein_id, prey_protein_id, iptm, confidence,
              alphafold_version, source_path,
              contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt,
              ipsae, ipsae_confidence, ipsae_pae_cutoff, analysis_version
            )
            VALUES ($1, $2, $3, $4::confidence_level, $5, $6, $7, $8, $9, $10, $11::ipsae_confidence_level, $12, $13)
          `, [
            baitProteinId,
            preyProteinId,
            iptm,
            confidence,
            'AF3',
            jsonFile,
            contactsPaeLt3,
            contactsPaeLt6,
            interfacePlddt,
            ipsae,
            ipsaeConfidence,
            ipsaePaeCutoff,
            isV4Format ? 'v4' : 'v3'
          ]);
          const ipsaeInfo = ipsae ? `, ipSAE: ${ipsae.toFixed(3)}` : '';
          console.log(`✅ ${baitId} ↔ ${preyId} (iPTM: ${iptm}, ${confidence}${ipsaeInfo}) - NEW`);
        }

        successful++;

      } catch (error) {
        console.error(`❌ Error processing ${prediction.directory}:`, error.message);
        failed++;
      }

      processed++;
    }

    console.log(`\n📈 Import completed:`);
    console.log(`  ✅ ${successful} interactions imported successfully`);
    console.log(`  ❌ ${failed} interactions failed`);
    console.log(`  📊 ${processed}/${predictions.length} predictions processed`);

    // Show final database stats
    const stats = await client.query(`
      SELECT
        COUNT(DISTINCT bait_protein_id) + COUNT(DISTINCT prey_protein_id) as unique_proteins,
        COUNT(*) as total_interactions
      FROM interactions
    `);

    console.log(`\n🗄️  Database totals: ${stats.rows[0].total_interactions} interactions, ~${stats.rows[0].unique_proteins} proteins`);

  } finally {
    await client.release();
  }
}

importAF3Json(jsonFile)
  .then(() => console.log('✅ AF3 JSON import completed'))
  .catch(err => console.error('❌ Import failed:', err));