#!/usr/bin/env node
/**
 * Batch Import AlphaFold 3 v4 Analysis Data with ipSAE Scoring
 * =============================================================
 *
 * Recursively searches for AF3_PD_analysis_v4.json files and imports them
 * into the database. This script:
 *
 * - Searches multiple base directories recursively
 * - Extracts ipSAE scores and confidence levels
 * - Uses UPSERT logic (updates existing, inserts new)
 * - Only imports ipSAE >= 0.3 (Very Low excluded by v4 analysis script)
 * - Marks all imported data as analysis_version='v4'
 *
 * Usage:
 *   node db/batch_import_af3_v4.mjs
 *   node db/batch_import_af3_v4.mjs --paths "/path1,/path2"
 *   node db/batch_import_af3_v4.mjs --dry-run
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

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pathsArg = args.find(arg => arg.startsWith('--paths='));

// Default search paths
const DEFAULT_PATHS = [
  '/emcc/au14762/AF',
  '/emcc/au14762/elo_lab/AlphaPulldown'
];

const SEARCH_PATHS = pathsArg
  ? pathsArg.split('=')[1].split(',')
  : DEFAULT_PATHS;

/**
 * Recursively find all v4 JSON files
 */
function findV4JsonFiles(basePath, foundFiles = []) {
  if (!fs.existsSync(basePath)) {
    console.warn(`⚠️  Path does not exist: ${basePath}`);
    return foundFiles;
  }

  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        // Check if this is an AF3 directory with v4 JSON
        if (entry.name === 'AF3') {
          const jsonPath = path.join(fullPath, 'AF3_PD_analysis_v4.json');
          if (fs.existsSync(jsonPath)) {
            foundFiles.push(jsonPath);
          }
        }
        // Recurse into subdirectories
        findV4JsonFiles(fullPath, foundFiles);
      }
    }
  } catch (error) {
    console.warn(`⚠️  Error reading directory ${basePath}: ${error.message}`);
  }

  return foundFiles;
}

/**
 * Extract protein IDs from directory name
 * Handles patterns: q9nvl8_and_p68363, Q96LB3_Q8WYA0_IFT74_81
 */
function extractProteinIds(directoryName) {
  // Split by _and_ if present
  const parts = directoryName.toLowerCase().split('_and_');

  if (parts.length === 2) {
    // Simple bait_and_prey pattern
    return {
      bait: parts[0].trim().toUpperCase(),
      prey: parts[1].trim().toUpperCase(),
      type: 'simple'
    };
  }

  // Complex patterns - look for UniProt IDs
  const uniprotPattern = /([QPOAB][0-9][A-Z0-9]{4})/gi;
  const matches = directoryName.match(uniprotPattern) || [];

  if (matches.length >= 2) {
    return {
      bait: matches[0].toUpperCase(),
      prey: matches[1].toUpperCase(),
      type: 'complex'
    };
  }

  return null;
}

/**
 * Normalize ipSAE confidence class from Python format
 */
function normalizeIpsaeConfidence(pythonClass) {
  const mapping = {
    'High Confidence': 'High',
    'Medium Confidence': 'Medium',
    'Low/Ambiguous': 'Low',
    'Very Low': 'Very Low'
  };
  return mapping[pythonClass] || pythonClass;
}

/**
 * Get or create protein entry
 */
async function getOrCreateProtein(uniprotId) {
  try {
    // Check if protein exists
    const existing = await sql`
      SELECT id FROM proteins WHERE uniprot_id = ${uniprotId}
    `;

    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }

    // Create new protein with Unknown organism (will be filled by organism_lookup later)
    const result = await sql`
      INSERT INTO proteins (uniprot_id, organism, organism_code)
      VALUES (${uniprotId}, 'Unknown'::organism_type, NULL)
      RETURNING id
    `;

    return result.rows[0].id;
  } catch (error) {
    console.error(`❌ Error with protein ${uniprotId}:`, error.message);
    throw error;
  }
}

/**
 * Import a single prediction
 */
async function importPrediction(prediction, jsonFilePath) {
  const directoryName = prediction.directory_name;
  const proteinIds = extractProteinIds(directoryName);

  if (!proteinIds) {
    return {
      success: false,
      reason: `Could not parse protein IDs from: ${directoryName}`
    };
  }

  const { bait, prey } = proteinIds;

  try {
    // Get or create proteins
    const baitProteinId = await getOrCreateProtein(bait);
    const preyProteinId = await getOrCreateProtein(prey);

    // Extract metrics
    const iptm = prediction.iptm || 0.0;
    const ipsae = prediction.ipsae || null;
    const ipsaeConfidence = prediction.ipsae_confidence_class
      ? normalizeIpsaeConfidence(prediction.ipsae_confidence_class)
      : null;
    const ipsaePaeCutoff = prediction.ipsae_pae_cutoff || 10.0;
    const contactsPae3 = prediction.contacts_pae3 || 0;
    const contactsPae6 = prediction.contacts_pae6 || 0;
    const interfacePlddt = prediction.mean_interface_plddt || 0.0;

    // Calculate v3-style confidence for backward compatibility
    const v3Confidence = calculateV3Confidence(iptm, contactsPae3, interfacePlddt);

    // UPSERT interaction
    const result = await sql`
      INSERT INTO interactions (
        bait_protein_id,
        prey_protein_id,
        iptm,
        contacts_pae_lt_3,
        contacts_pae_lt_6,
        interface_plddt,
        confidence,
        ipsae,
        ipsae_confidence,
        ipsae_pae_cutoff,
        analysis_version,
        alphafold_version,
        source_path
      )
      VALUES (
        ${baitProteinId},
        ${preyProteinId},
        ${iptm},
        ${contactsPae3},
        ${contactsPae6},
        ${interfacePlddt},
        ${v3Confidence}::confidence_level,
        ${ipsae},
        ${ipsaeConfidence}::ipsae_confidence_level,
        ${ipsaePaeCutoff},
        'v4',
        'AF3',
        ${jsonFilePath}
      )
      ON CONFLICT (bait_protein_id, prey_protein_id, source_path)
      DO UPDATE SET
        iptm = EXCLUDED.iptm,
        contacts_pae_lt_3 = EXCLUDED.contacts_pae_lt_3,
        contacts_pae_lt_6 = EXCLUDED.contacts_pae_lt_6,
        interface_plddt = EXCLUDED.interface_plddt,
        confidence = EXCLUDED.confidence,
        ipsae = EXCLUDED.ipsae,
        ipsae_confidence = EXCLUDED.ipsae_confidence,
        ipsae_pae_cutoff = EXCLUDED.ipsae_pae_cutoff,
        analysis_version = 'v4'
    `;

    return {
      success: true,
      bait,
      prey,
      ipsae,
      ipsaeConfidence,
      isUpdate: result.rowCount === 0 // If rowCount is 0, it was an update
    };
  } catch (error) {
    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Calculate v3-style confidence (for backward compatibility)
 */
function calculateV3Confidence(iptm, contacts, iplddt) {
  const iptmVal = parseFloat(iptm) || 0;
  const contactsVal = parseInt(contacts) || 0;
  const ipLDDTVal = parseFloat(iplddt) || 0;

  // High confidence
  const meetsHighCriteria =
    iptmVal >= 0.7 ||
    (contactsVal >= 40 && ipLDDTVal >= 80) ||
    (contactsVal >= 30 && iptmVal >= 0.5 && ipLDDTVal >= 80);

  const isExcludedFromHigh = iptmVal < 0.75 && contactsVal < 5;

  if (meetsHighCriteria && !isExcludedFromHigh) {
    return 'High';
  }

  // Medium confidence
  if (
    iptmVal >= 0.6 ||
    (contactsVal >= 20 && ipLDDTVal >= 75) ||
    (contactsVal >= 15 && iptmVal >= 0.45)
  ) {
    return 'Medium';
  }

  // Low confidence
  return 'Low';
}

/**
 * Import a single JSON file
 */
async function importJsonFile(jsonPath) {
  console.log(`\n📄 Processing: ${jsonPath}`);

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    if (!data.filtered_predictions || data.filtered_predictions.length === 0) {
      console.log('  ⚠️  No filtered predictions found in file');
      return { imported: 0, updated: 0, failed: 0 };
    }

    const predictions = data.filtered_predictions;
    console.log(`  Found ${predictions.length} predictions (ipSAE >= 0.3)`);

    // Show ipSAE distribution
    if (data.ipsae_distribution) {
      console.log('  ipSAE distribution:');
      Object.entries(data.ipsae_distribution).forEach(([level, count]) => {
        console.log(`    ${level}: ${count}`);
      });
    }

    if (dryRun) {
      console.log('  🔍 DRY RUN - Would import these predictions');
      return { imported: predictions.length, updated: 0, failed: 0 };
    }

    // Import predictions
    let imported = 0;
    let updated = 0;
    let failed = 0;

    for (const prediction of predictions) {
      const result = await importPrediction(prediction, jsonPath);

      if (result.success) {
        if (result.isUpdate) {
          updated++;
        } else {
          imported++;
        }

        if ((imported + updated) % 10 === 0) {
          process.stdout.write(`\r  Progress: ${imported + updated}/${predictions.length}`);
        }
      } else {
        failed++;
        console.log(`\n  ⚠️  Failed: ${result.reason}`);
      }
    }

    console.log(`\r  ✅ Complete: ${imported} new, ${updated} updated, ${failed} failed`);

    return { imported, updated, failed };
  } catch (error) {
    console.error(`  ❌ Error processing file: ${error.message}`);
    return { imported: 0, updated: 0, failed: 0 };
  }
}

/**
 * Main batch import function
 */
async function batchImportV4() {
  console.log('🚀 AlphaFold 3 v4 Batch Import (ipSAE Scoring)');
  console.log('═'.repeat(70));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No database changes will be made\n');
  }

  console.log('📂 Searching for v4 JSON files in:');
  SEARCH_PATHS.forEach(p => console.log(`  - ${p}`));
  console.log('');

  // Find all v4 JSON files
  let allJsonFiles = [];
  for (const basePath of SEARCH_PATHS) {
    console.log(`🔍 Scanning: ${basePath}...`);
    const found = findV4JsonFiles(basePath);
    console.log(`  Found ${found.length} v4 JSON files`);
    allJsonFiles = allJsonFiles.concat(found);
  }

  if (allJsonFiles.length === 0) {
    console.log('\n❌ No AF3_PD_analysis_v4.json files found!');
    console.log('Expected location: */AF3/AF3_PD_analysis_v4.json');
    process.exit(1);
  }

  console.log(`\n📊 Total v4 JSON files found: ${allJsonFiles.length}`);
  console.log('═'.repeat(70));

  // Import each file
  let totalImported = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (let i = 0; i < allJsonFiles.length; i++) {
    console.log(`\n[${i + 1}/${allJsonFiles.length}]`);
    const stats = await importJsonFile(allJsonFiles[i]);
    totalImported += stats.imported;
    totalUpdated += stats.updated;
    totalFailed += stats.failed;
  }

  console.log('\n' + '═'.repeat(70));
  console.log('📈 Batch Import Summary');
  console.log('═'.repeat(70));
  console.log(`Files processed: ${allJsonFiles.length}`);
  console.log(`New interactions: ${totalImported}`);
  console.log(`Updated interactions: ${totalUpdated}`);
  console.log(`Failed: ${totalFailed}`);

  if (!dryRun) {
    // Show database statistics
    const stats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(ipsae) as with_ipsae,
        COUNT(CASE WHEN ipsae_confidence = 'High' THEN 1 END) as ipsae_high,
        COUNT(CASE WHEN ipsae_confidence = 'Medium' THEN 1 END) as ipsae_medium,
        COUNT(CASE WHEN ipsae_confidence = 'Low' THEN 1 END) as ipsae_low
      FROM interactions
    `;

    console.log('\n📊 Database Statistics:');
    console.log(`Total interactions: ${stats.rows[0].total}`);
    console.log(`With ipSAE scores: ${stats.rows[0].with_ipsae}`);
    console.log(`  High (>0.7): ${stats.rows[0].ipsae_high}`);
    console.log(`  Medium (0.5-0.7): ${stats.rows[0].ipsae_medium}`);
    console.log(`  Low (0.3-0.5): ${stats.rows[0].ipsae_low}`);
  }

  console.log('\n✅ Batch import completed successfully!');
  console.log('\nNext steps:');
  console.log('  1. Assign organisms: node db/incremental_organism_lookup.mjs');
  console.log('  2. Fetch aliases: node db/fetch_aliases.mjs');
  console.log('  3. Chlamydomonas genes: node db/chlamyfp_gene_lookup.mjs');
  console.log('  4. Check database: node db/check_db.mjs');
}

// Run batch import
batchImportV4()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Fatal error:', err);
    console.error(err.stack);
    process.exit(1);
  });
