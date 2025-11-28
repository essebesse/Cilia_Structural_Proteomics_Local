#!/usr/bin/env node
/**
 * Import AlphaFold 3 Complex-Prey Interaction Data (v4 with ipSAE)
 * ================================================================
 *
 * Imports bait-prey complex data where multiple proteins form a complex bait.
 * v4 version with ipSAE scoring support.
 *
 * Examples: AB:C, ABC:D, ABCD:E, etc.
 *
 * Usage:
 *   node db/import_complex_af3_v4.mjs /path/to/AF3_bait_prey_analysis_v4.json [VARIANT_NAME]
 *
 * Arguments:
 *   JSON_FILE     - Path to AF3_bait_prey_analysis_v4.json (required)
 *   VARIANT_NAME  - Custom variant name (optional, default: auto-detect from path)
 *                   Examples: "Cterm_141-107aa", "Nterm_1-150aa", "Middle_domain"
 *
 * Features:
 * - Automatically extracts complex proteins from bait_chains array
 * - Creates complex entries and links component proteins
 * - Imports high-confidence interactions (filters out "Very Low")
 * - Preserves per-chain interface pLDDT data
 * - Supports complexes with any number of proteins (2, 3, 4+)
 * - **NEW v4:** Extracts and stores ipSAE scores and confidence
 * - Custom variant naming for protein constructs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

// Confidence levels to import (same filtering as v3)
const IMPORT_CONFIDENCE_LEVELS = [
  'Very High Confidence',
  'Worth Investigating',
  'Low iPTM - Proceed with Caution'
];

/**
 * Calculate v3-style confidence using interface quality-centric scheme
 * (for backward compatibility in confidence field)
 */
function calculateV3Confidence(iptm, contacts, iplddt) {
  const iptmVal = parseFloat(iptm) || 0;
  const contactsVal = parseInt(contacts) || 0;
  const ipLDDTVal = parseFloat(iplddt) || 0;

  // HIGH CONFIDENCE
  const meetsHighCriteria =
    iptmVal >= 0.7 ||
    (contactsVal >= 40 && ipLDDTVal >= 80) ||
    (contactsVal >= 30 && iptmVal >= 0.5 && ipLDDTVal >= 80);

  const isExcludedFromHigh = iptmVal < 0.75 && contactsVal < 5;

  if (meetsHighCriteria && !isExcludedFromHigh) {
    return 'High';
  }

  // MEDIUM CONFIDENCE
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

/**
 * Normalize ipSAE confidence class from Python format to database ENUM
 */
function normalizeIpsaeConfidence(pythonClass) {
  const mapping = {
    'High Confidence': 'High',
    'Medium Confidence': 'Medium',
    'Low/Ambiguous': 'Low',
    'Low Confidence': 'Low',
    'Very Low': 'Very Low'
  };
  return mapping[pythonClass] || pythonClass;
}

/**
 * Extract variant from path (Cterm, Nterm, FL, etc.)
 * Examples:
 *   /path/Hs_Cter_IFT52_46/AF3/file.json -> Cterm
 *   /path/Hs_Nter_IFT52_46/AF3/file.json -> Nterm
 *   /path/IFT52_46/AF3/file.json -> FL
 */
function extractVariant(fullPath) {
  const pathParts = fullPath.split('/');

  // Look for variant indicators in path components
  for (const part of pathParts) {
    if (part.includes('Cter') || part.includes('_Cter_') || part.includes('_Cterm_')) {
      return 'Cterm';
    }
    if (part.includes('Nter') || part.includes('_Nter_') || part.includes('_Nterm_')) {
      return 'Nterm';
    }
    if (part.includes('_FL_') || part === 'FL') {
      return 'FL';
    }
  }

  // Default to FL if no variant specified
  return 'FL';
}

/**
 * Extract complex name from directory name or file path
 * Examples:
 *   q9nqc8_q9y366_with_a0avf1 -> Q9NQC8_Q9Y366
 *   Q96LB3_Q8WYA0_IFT74_81 -> IFT74_IFT81
 */
function extractComplexName(directoryName) {
  // Remove _with_* suffix
  const baseName = directoryName.split('_with_')[0];

  // Try to extract gene names (uppercase, longer than 3 chars)
  const parts = directoryName.split('_');
  const geneNames = parts.filter(p =>
    p.length > 3 &&
    p.toUpperCase() === p &&
    !p.startsWith('Q') &&
    !p.startsWith('P') &&
    !p.startsWith('O') &&
    !p.startsWith('A') &&
    p !== 'WITH'
  );

  if (geneNames.length >= 2) {
    return geneNames.join('_');
  }

  // Fallback: use uppercase base name
  return baseName.toUpperCase();
}

/**
 * Extract UniProt IDs from directory name
 * Handles patterns like: q9nqc8_q9y366_with_a0avf1, Q96LB3_Q8WYA0_IFT74_81
 */
function extractUniProtIDs(directoryName) {
  const uniprotPattern = /[QPOAB][0-9][A-Z0-9]{4}/gi;
  const matches = directoryName.match(uniprotPattern) || [];

  // Return unique uppercase IDs
  return [...new Set(matches.map(m => m.toUpperCase()))];
}

/**
 * Get or create a protein entry
 */
async function getOrCreateProtein(uniprotId, geneName = null) {
  try {
    // Check if protein exists
    const existingProtein = await sql`
      SELECT id FROM proteins WHERE uniprot_id = ${uniprotId}
    `;

    if (existingProtein.rows.length > 0) {
      return existingProtein.rows[0].id;
    }

    // Create new protein with Unknown organism (will be filled by organism_lookup later)
    const newProtein = await sql`
      INSERT INTO proteins (uniprot_id, gene_name, organism, organism_code)
      VALUES (${uniprotId}, ${geneName}, 'Unknown'::organism_type, NULL)
      RETURNING id
    `;

    return newProtein.rows[0].id;
  } catch (error) {
    console.error(`Error getting/creating protein ${uniprotId}:`, error);
    throw error;
  }
}

/**
 * Create or get protein complex
 */
async function getOrCreateComplex(complexName, displayName, numProteins) {
  try {
    // Check if complex exists
    const existingComplex = await sql`
      SELECT id FROM protein_complexes WHERE complex_name = ${complexName}
    `;

    if (existingComplex.rows.length > 0) {
      console.log(`  ✓ Complex already exists: ${displayName}`);
      return existingComplex.rows[0].id;
    }

    // Create new complex
    const newComplex = await sql`
      INSERT INTO protein_complexes (complex_name, display_name, num_proteins)
      VALUES (${complexName}, ${displayName}, ${numProteins})
      RETURNING id
    `;

    console.log(`  ✓ Created complex: ${displayName} (${numProteins} proteins)`);
    return newComplex.rows[0].id;
  } catch (error) {
    console.error(`Error creating complex ${complexName}:`, error);
    throw error;
  }
}

/**
 * Link a protein to a complex
 */
async function linkProteinToComplex(complexId, proteinId, chainId, position) {
  try {
    // Check if link exists
    const existingLink = await sql`
      SELECT id FROM complex_proteins
      WHERE complex_id = ${complexId}
        AND protein_id = ${proteinId}
        AND chain_id = ${chainId}
    `;

    if (existingLink.rows.length > 0) {
      return existingLink.rows[0].id;
    }

    // Create link
    await sql`
      INSERT INTO complex_proteins (complex_id, protein_id, chain_id, position, role)
      VALUES (${complexId}, ${proteinId}, ${chainId}, ${position}, 'bait')
    `;

  } catch (error) {
    console.error(`Error linking protein to complex:`, error);
    throw error;
  }
}

/**
 * Import a single complex-prey interaction (v4 with ipSAE)
 */
async function importComplexInteraction(complexId, prediction, proteinCache, sourcePath) {
  try {
    const directoryName = prediction.directory_name;

    // Extract prey protein ID from directory name
    const allProteins = extractUniProtIDs(directoryName);
    const baitProteins = extractUniProtIDs(directoryName.split('_with_')[0]);
    const preyProteins = allProteins.filter(p => !baitProteins.includes(p));

    if (preyProteins.length === 0) {
      console.log(`  ⚠ Cannot determine prey protein for ${directoryName}`);
      return null;
    }

    const preyUniprotId = preyProteins[0];

    // Get or create prey protein
    let preyProteinId = proteinCache.get(preyUniprotId);
    if (!preyProteinId) {
      preyProteinId = await getOrCreateProtein(preyUniprotId);
      proteinCache.set(preyUniprotId, preyProteinId);
    }

    // Construct full source path
    const fullSourcePath = prediction.directory
      ? path.join(sourcePath, prediction.directory)
      : sourcePath;

    // Check if interaction already exists (UPSERT check)
    const existingInteraction = await sql`
      SELECT id FROM complex_interactions
      WHERE bait_complex_id = ${complexId}
        AND prey_protein_id = ${preyProteinId}
        AND source_path = ${fullSourcePath}
    `;

    if (existingInteraction.rows.length > 0) {
      // Update existing with v4 data
      const ipsae = prediction.ipsae || null;
      const ipsaeConfidence = prediction.ipsae_confidence_class
        ? normalizeIpsaeConfidence(prediction.ipsae_confidence_class)
        : null;
      const ipsaePaeCutoff = prediction.ipsae_pae_cutoff || 10.0;

      await sql`
        UPDATE complex_interactions
        SET ipsae = ${ipsae},
            ipsae_confidence = ${ipsaeConfidence}::ipsae_confidence_level,
            ipsae_pae_cutoff = ${ipsaePaeCutoff},
            analysis_version = 'v4'
        WHERE id = ${existingInteraction.rows[0].id}
      `;

      return { preyUniprotId, isUpdate: true };
    }

    // Prepare per-chain pLDDT data
    const perChainPlddt = JSON.stringify(prediction.per_chain_interface_plddt || {});

    // Calculate v3-style confidence for backward compatibility
    const calculatedConfidence = calculateV3Confidence(
      prediction.iptm,
      prediction.contacts_pae3,
      prediction.mean_interface_plddt
    );

    // Extract v4 ipSAE data
    const ipsae = prediction.ipsae || null;
    const ipsaeConfidence = prediction.ipsae_confidence_class
      ? normalizeIpsaeConfidence(prediction.ipsae_confidence_class)
      : null;
    const ipsaePaeCutoff = prediction.ipsae_pae_cutoff || 10.0;

    // Insert complex interaction with v4 data
    await sql`
      INSERT INTO complex_interactions (
        bait_complex_id,
        prey_protein_id,
        iptm,
        contacts_pae_lt_3,
        contacts_pae_lt_6,
        interface_plddt,
        confidence,
        source_path,
        alphafold_version,
        per_chain_plddt,
        ranking_score,
        ptm,
        mean_plddt,
        interface_residue_count,
        ipsae,
        ipsae_confidence,
        ipsae_pae_cutoff,
        analysis_version
      ) VALUES (
        ${complexId},
        ${preyProteinId},
        ${prediction.iptm || 0},
        ${prediction.contacts_pae3 || 0},
        ${prediction.contacts_pae6 || 0},
        ${prediction.mean_interface_plddt || 0},
        ${calculatedConfidence}::confidence_level,
        ${fullSourcePath},
        'AF3',
        ${perChainPlddt},
        ${prediction.ranking_score || 0},
        ${prediction.ptm || 0},
        ${prediction.mean_plddt || 0},
        ${prediction.interface_residue_count || 0},
        ${ipsae},
        ${ipsaeConfidence}::ipsae_confidence_level,
        ${ipsaePaeCutoff},
        'v4'
      )
    `;

    return { preyUniprotId, isUpdate: false };

  } catch (error) {
    console.error(`Error importing interaction:`, error);
    throw error;
  }
}

/**
 * Main import function
 */
async function importComplexData(jsonFilePath, customVariant = null) {
  console.log('\n🚀 AlphaFold 3 Complex-Prey Data Importer (v4 with ipSAE)');
  console.log('═'.repeat(70));

  // Check if file exists
  if (!fs.existsSync(jsonFilePath)) {
    console.error(`\n❌ Error: File not found: ${jsonFilePath}`);
    process.exit(1);
  }

  // Read JSON file
  console.log(`\n📄 Reading: ${jsonFilePath}`);
  const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));

  const predictions = jsonData.high_confidence_predictions || jsonData.filtered_predictions || [];

  if (predictions.length === 0) {
    console.log('\n⚠️  No predictions found in JSON file');
    process.exit(0);
  }

  console.log(`\n✓ Found ${predictions.length} high-confidence predictions`);
  console.log(`  Analysis type: ${jsonData.analysis_type || 'unknown'}`);
  console.log(`  Bait chains: ${jsonData.bait_chains || 'auto-detected'}`);
  console.log(`  Prey chains: ${jsonData.prey_chains || 'auto-detected'}`);
  console.log(`  Version: ${jsonData.version || 'unknown'}`);

  // Show ipSAE distribution if available
  if (jsonData.ipsae_distribution) {
    console.log('\n📊 ipSAE Distribution:');
    Object.entries(jsonData.ipsae_distribution).forEach(([level, count]) => {
      console.log(`  ${level}: ${count}`);
    });
  }

  // Detect complex configuration from first prediction
  const firstPred = predictions[0];
  const baitChains = firstPred.bait_chains || [];
  const preyChains = firstPred.prey_chains || [];

  console.log(`\n🔍 Complex configuration: [${baitChains.join('+')}] : [${preyChains.join('+')}]`);

  // Extract bait protein IDs from first directory name
  const firstDir = firstPred.directory_name || firstPred.directory;
  const baitIds = extractUniProtIDs(firstDir.split('_with_')[0]);

  console.log(`  Detected ${baitIds.length} bait proteins: ${baitIds.join(', ')}`);

  // Step 1: Create/get bait proteins
  console.log('\n📋 Step 1: Creating/fetching bait proteins...');
  const proteinCache = new Map();
  const baitProteinIds = [];

  for (const uniprotId of baitIds) {
    const proteinId = await getOrCreateProtein(uniprotId);
    baitProteinIds.push(proteinId);
    proteinCache.set(uniprotId, proteinId);
    console.log(`  ✓ Protein ${uniprotId} (ID: ${proteinId})`);
  }

  // Step 2: Create protein complex
  console.log('\n📋 Step 2: Creating protein complex...');
  const variant = customVariant || extractVariant(jsonFilePath);
  const baseComplexName = extractComplexName(firstDir);
  const complexName = `${baseComplexName}_${variant}`;
  const displayName = variant === 'FL'
    ? baitIds.join(' & ')
    : `${baitIds.join(' & ')} (${variant})`;

  if (customVariant) {
    console.log(`  Custom variant name: ${variant}`);
  } else {
    console.log(`  Auto-detected variant: ${variant}`);
  }
  const complexId = await getOrCreateComplex(complexName, displayName, baitIds.length);

  // Step 3: Link proteins to complex
  console.log('\n📋 Step 3: Linking proteins to complex...');
  for (let i = 0; i < baitIds.length; i++) {
    const chainId = baitChains[i] || String.fromCharCode(65 + i); // A, B, C, ...
    await linkProteinToComplex(complexId, baitProteinIds[i], chainId, i);
    console.log(`  ✓ Linked ${baitIds[i]} as chain ${chainId} (position ${i})`);
  }

  // Step 4: Import complex-prey interactions
  console.log('\n📋 Step 4: Importing complex-prey interactions...');
  console.log(`  Filtering: Only importing ${IMPORT_CONFIDENCE_LEVELS.join(', ')}`);
  console.log('');

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  const sourcePath = path.dirname(jsonFilePath);

  for (let i = 0; i < predictions.length; i++) {
    const prediction = predictions[i];
    const confidenceClass = prediction.confidence_class || '';

    // Skip Very Low confidence
    if (!IMPORT_CONFIDENCE_LEVELS.includes(confidenceClass)) {
      skippedCount++;
      continue;
    }

    const result = await importComplexInteraction(
      complexId,
      prediction,
      proteinCache,
      sourcePath
    );

    if (result) {
      if (result.isUpdate) {
        updatedCount++;
      } else {
        importedCount++;
      }

      const ipsaeInfo = prediction.ipsae
        ? `ipSAE: ${prediction.ipsae.toFixed(3)} (${prediction.ipsae_confidence_class})`
        : 'ipSAE: N/A';

      console.log(`  [${i + 1}/${predictions.length}] ${prediction.directory_name}: ${confidenceClass} (iPTM: ${prediction.iptm}, iPAE<6Å: ${prediction.contacts_pae6}, ${ipsaeInfo})`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('✅ Import complete!');
  console.log(`  Complex: ${displayName} (${baitIds.length} proteins)`);
  console.log(`  New interactions: ${importedCount}`);
  console.log(`  Updated interactions: ${updatedCount}`);
  console.log(`  Skipped low-confidence: ${skippedCount}`);
  console.log('');
}

// Main execution
const jsonFilePath = process.argv[2];
const customVariant = process.argv[3] || null;

if (!jsonFilePath) {
  console.error('❌ Usage: node import_complex_af3_v4.mjs /path/to/AF3_bait_prey_analysis_v4.json [VARIANT_NAME]');
  console.error('\nExamples:');
  console.error('  Full-length:');
  console.error('    node import_complex_af3_v4.mjs /path/to/AF3/AF3_bait_prey_analysis_v4.json');
  console.error('  Custom variant:');
  console.error('    node import_complex_af3_v4.mjs /path/to/AF3/AF3_bait_prey_analysis_v4.json "Cterm_141-107aa"');
  process.exit(1);
}

if (!process.env.POSTGRES_URL) {
  console.error('❌ POSTGRES_URL environment variable is required');
  process.exit(1);
}

importComplexData(jsonFilePath, customVariant)
  .then(() => {
    console.log('✅ Script completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Assign organisms: node db/incremental_organism_lookup.mjs');
    console.log('  2. Fetch aliases: node db/fetch_aliases.mjs');
    console.log('  3. Populate gene names: node -e "const { sql } = require(\'@vercel/postgres\'); ..."');
    console.log('  4. Update complex names: node db/update_complex_display_names.mjs');
    console.log('  5. Check database: node db/check_db.mjs');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Fatal error:', err);
    console.error(err.stack);
    process.exit(1);
  });
