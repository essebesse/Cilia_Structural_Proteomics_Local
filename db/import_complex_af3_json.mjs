#!/usr/bin/env node
/**
 * Import AlphaFold 3 Complex-Prey Interaction Data
 * =================================================
 *
 * Imports bait-prey complex data where multiple proteins form a complex bait.
 * Examples: AB:C, ABC:D, ABCD:E, etc.
 *
 * Usage:
 *   node db/import_complex_af3_json.mjs /path/to/AF3_bait_prey_analysis_v3.json [VARIANT_NAME]
 *
 * Arguments:
 *   JSON_FILE     - Path to AF3_bait_prey_analysis_v3.json (required)
 *   VARIANT_NAME  - Custom variant name (optional, default: auto-detect from path)
 *                   Examples: "Cterm_141-107aa", "Nterm_1-150aa", "Middle_domain"
 *
 * Features:
 * - Automatically extracts complex proteins from bait_chains array
 * - Creates complex entries and links component proteins
 * - Imports only high-confidence interactions (filters out "Very Low")
 * - Preserves per-chain interface pLDDT data
 * - Supports complexes with any number of proteins (2, 3, 4+)
 * - Custom variant naming for protein constructs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

// Confidence levels to import (same filtering as single proteins)
const IMPORT_CONFIDENCE_LEVELS = [
  'Very High Confidence',
  'Worth Investigating',
  'Low iPTM - Proceed with Caution'
];

/**
 * Calculate confidence level using interface quality-centric scheme
 * Same logic as frontend, migration script, and single protein import
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
 *   Q96LB3_Q8WYA0_IFT74_81 -> IFT74_IFT81
 *   q96lb3_q8wya0_with_q9h7x7 -> Q96LB3_Q8WYA0
 */
function extractComplexName(directoryName) {
  // Try to extract meaningful name from directory
  // Pattern: proteinA_proteinB_with_prey OR proteinA_proteinB_geneName
  const parts = directoryName.split('_');

  // Look for gene names (uppercase, longer than 3 chars)
  const geneNames = parts.filter(p =>
    p.length > 3 &&
    p.toUpperCase() === p &&
    !p.startsWith('Q') &&
    !p.startsWith('P') &&
    !p.startsWith('O') &&
    p !== 'WITH'
  );

  if (geneNames.length >= 2) {
    return geneNames.join('_');
  }

  // Fallback: use first part of directory name
  return directoryName.split('_with_')[0].toUpperCase();
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

    // Create new protein
    const newProtein = await sql`
      INSERT INTO proteins (uniprot_id, gene_name)
      VALUES (${uniprotId}, ${geneName})
      RETURNING id
    `;

    return newProtein.rows[0].id;
  } catch (error) {
    console.error(`Error getting/creating protein ${uniprotId}:`, error);
    throw error;
  }
}

/**
 * Extract UniProt IDs from directory name
 * Handles patterns like: q96lb3_q8wya0_with_prey, Q96LB3_Q8WYA0_IFT74_81
 */
function extractUniProtIDs(directoryName) {
  const uniprotPattern = /[QPOAB][0-9][A-Z0-9]{4}/gi;
  const matches = directoryName.match(uniprotPattern) || [];

  // Return unique uppercase IDs
  return [...new Set(matches.map(m => m.toUpperCase()))];
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
 * Import a single complex-prey interaction
 */
async function importComplexInteraction(complexId, prediction, proteinCache, numBaitProteins, sourcePath) {
  try {
    const directoryName = prediction.directory_name;

    // Infer chains from chain_lengths if prey_chains not available
    const chainLengths = prediction.chain_lengths || {};
    const allChains = Object.keys(chainLengths).sort();
    const preyChain = prediction.prey_chains ? prediction.prey_chains[0] : allChains[allChains.length - 1];

    // Extract prey protein ID from directory name
    // Pattern: complexProteins_with_preyProtein
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

    // Check if interaction already exists
    const existingInteraction = await sql`
      SELECT id FROM complex_interactions
      WHERE bait_complex_id = ${complexId}
        AND prey_protein_id = ${preyProteinId}
        AND source_path = ${fullSourcePath}
    `;

    if (existingInteraction.rows.length > 0) {
      return null; // Already imported
    }

    // Prepare per-chain pLDDT data
    const perChainPlddt = JSON.stringify(prediction.per_chain_interface_plddt || {});

    // Calculate confidence using interface quality-centric scheme
    const calculatedConfidence = calculateConfidence(
      prediction.iptm,
      prediction.contacts_pae3,
      prediction.mean_interface_plddt
    );

    // Insert complex interaction
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
        interface_residue_count
      ) VALUES (
        ${complexId},
        ${preyProteinId},
        ${prediction.iptm || 0},
        ${prediction.contacts_pae3 || 0},
        ${prediction.contacts_pae6 || 0},
        ${prediction.mean_interface_plddt || 0},
        ${calculatedConfidence},
        ${fullSourcePath},
        'AF3',
        ${perChainPlddt},
        ${prediction.ranking_score || 0},
        ${prediction.ptm || 0},
        ${prediction.mean_plddt || 0},
        ${prediction.interface_residue_count || 0}
      )
    `;

    return preyUniprotId;

  } catch (error) {
    console.error(`Error importing interaction:`, error);
    throw error;
  }
}

/**
 * Main import function
 */
async function importComplexData(jsonFilePath, customVariant = null) {
  console.log('AlphaFold 3 Complex-Prey Data Importer');
  console.log('=====================================\n');

  // Read JSON file
  if (!fs.existsSync(jsonFilePath)) {
    console.error(`Error: File not found: ${jsonFilePath}`);
    process.exit(1);
  }

  const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
  const predictions = jsonData.high_confidence_predictions || jsonData.filtered_predictions || [];

  if (predictions.length === 0) {
    console.log('No predictions found in JSON file.');
    return;
  }

  // Get source path (directory containing the JSON file)
  const sourcePath = path.dirname(jsonFilePath);

  console.log(`Found ${predictions.length} high-confidence predictions`);
  console.log(`Analysis type: ${jsonData.analysis_type}`);
  console.log(`Bait chains: ${jsonData.bait_chains}`);
  console.log(`Prey chains: ${jsonData.prey_chains}\n`);

  // Determine complex name from first prediction
  const firstPrediction = predictions[0];
  const directoryName = firstPrediction.directory_name;
  const baitChains = firstPrediction.bait_chains || [];
  const preyChains = firstPrediction.prey_chains || [];

  console.log(`Complex configuration: [${baitChains.join('+')}] : [${preyChains.join('+')}]`);

  // Extract bait proteins from directory name
  const baitUniprotIds = extractUniProtIDs(directoryName.split('_with_')[0]);
  console.log(`Detected ${baitUniprotIds.length} bait proteins: ${baitUniprotIds.join(', ')}\n`);

  if (baitUniprotIds.length === 0) {
    console.error('Error: Could not extract bait protein IDs from directory name');
    process.exit(1);
  }

  // Use custom variant if provided, otherwise auto-detect
  const variant = customVariant || extractVariant(jsonFilePath);
  const baseComplexName = extractComplexName(directoryName);
  const complexName = `${baseComplexName}_${variant}`;

  if (customVariant) {
    console.log(`  Custom variant name: ${variant}`);
  } else {
    console.log(`  Auto-detected variant: ${variant}`);
  }

  // Protein cache to avoid redundant queries
  const proteinCache = new Map();

  // Step 1: Create or get all bait proteins
  console.log('Step 1: Creating/fetching bait proteins...');
  const baitProteinIds = [];
  for (const uniprotId of baitUniprotIds) {
    const proteinId = await getOrCreateProtein(uniprotId);
    baitProteinIds.push(proteinId);
    proteinCache.set(uniprotId, proteinId);
    console.log(`  ✓ Protein ${uniprotId} (ID: ${proteinId})`);
  }

  // Step 2: Create complex (initially with UniProt IDs, will be updated after gene names are fetched)
  console.log('\nStep 2: Creating protein complex...');
  const displayName = variant === 'FL'
    ? baitUniprotIds.join(' & ')
    : `${baitUniprotIds.join(' & ')} (${variant})`;
  const complexId = await getOrCreateComplex(complexName, displayName, baitUniprotIds.length);
  console.log('  ℹ Run "node db/update_complex_display_names.mjs" after fetching gene names to update display name');

  // Step 3: Link proteins to complex
  console.log('\nStep 3: Linking proteins to complex...');
  for (let i = 0; i < baitUniprotIds.length; i++) {
    const chainId = baitChains[i] || String.fromCharCode(65 + i); // A, B, C, etc.
    await linkProteinToComplex(complexId, baitProteinIds[i], chainId, i);
    console.log(`  ✓ Linked ${baitUniprotIds[i]} as chain ${chainId} (position ${i})`);
  }

  // Step 4: Import interactions
  console.log('\nStep 4: Importing complex-prey interactions...');
  console.log(`Filtering: Only importing ${IMPORT_CONFIDENCE_LEVELS.join(', ')}\n`);

  let importedCount = 0;
  let skippedCount = 0;

  for (const prediction of predictions) {
    const confidence = prediction.confidence_class;

    // Filter by confidence (same logic as single proteins)
    if (!IMPORT_CONFIDENCE_LEVELS.includes(confidence)) {
      skippedCount++;
      continue;
    }

    const preyId = await importComplexInteraction(complexId, prediction, proteinCache, baitUniprotIds.length, sourcePath);
    if (preyId) {
      importedCount++;
      console.log(`  [${importedCount}/${predictions.length}] ${prediction.directory_name}: ${confidence} (iPTM: ${prediction.iptm}, iPAE<6Å: ${prediction.contacts_pae6})`);
    }
  }

  console.log(`\n✓ Import complete!`);
  console.log(`  Complex: ${displayName} (${baitUniprotIds.length} proteins)`);
  console.log(`  Imported: ${importedCount} interactions`);
  console.log(`  Skipped: ${skippedCount} low-confidence predictions`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run organism lookup: node db/incremental_organism_lookup.mjs`);
  console.log(`  2. Fetch protein aliases: node db/fetch_aliases.mjs`);
  console.log(`  3. View complex in web app: https://ciliaaf3predictions.vercel.app/`);
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node db/import_complex_af3_json.mjs <path_to_AF3_bait_prey_analysis_v3.json> [VARIANT_NAME]');
  console.error('\nExamples:');
  console.error('  Full-length:');
  console.error('    node db/import_complex_af3_json.mjs /path/to/AF3/AF3_bait_prey_analysis_v3.json');
  console.error('  Custom variant:');
  console.error('    node db/import_complex_af3_json.mjs /path/to/AF3/AF3_bait_prey_analysis_v3.json "Cterm_141-107aa"');
  process.exit(1);
}

const jsonFile = args[0];
const customVariant = args[1] || null;

importComplexData(jsonFile, customVariant)
  .then(() => {
    console.log('\n✓ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Import failed:', error);
    process.exit(1);
  });
