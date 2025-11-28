#!/usr/bin/env node
/**
 * CIF File Collection Script for Cilia Local Deployment
 * ======================================================
 *
 * Reads the SQLite database, finds corresponding CIF files from AlphaPulldown
 * predictions, and copies them to a local structures directory.
 *
 * Output:
 * - structures/ directory with all CIF files
 * - cif_manifest.json with mappings
 *
 * Usage:
 *   node scripts/collect_cif_files.mjs
 */

import Database from 'better-sqlite3';
import { readdir, access, constants, copyFile, mkdir } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const DB_PATH = join(dirname(__dirname), 'protoview.db');
const STRUCTURES_DIR = join(dirname(__dirname), 'structures');
const MANIFEST_PATH = join(dirname(__dirname), 'cif_manifest.json');

// Base directory for AlphaPulldown predictions
const AF3_BASE_DIR = '/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD';

/**
 * Extract interaction directory name from source_path
 */
function extractDirectoryFromSourcePath(sourcePath) {
  if (!sourcePath) return null;

  // Split by forward slash
  const parts = sourcePath.split('/');

  // Look for pattern: lowercase_and_lowercase (interaction directory)
  for (const part of parts) {
    if (part.includes('_and_') && part === part.toLowerCase()) {
      return part.split('/')[0];
    }
  }

  return null;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find CIF file in AlphaPulldown directory structure
 */
async function findCifFile(baitUniprot, baitGene, preyUniprot, preyGene, sourcePath) {
  // Extract directory name from source_path
  let directoryName = extractDirectoryFromSourcePath(sourcePath);

  if (!directoryName) {
    // Try to construct from UniProt IDs
    directoryName = `${baitUniprot.toLowerCase()}_and_${preyUniprot.toLowerCase()}`;
  }

  // Try different bait directory patterns
  const baitPatterns = [];

  if (baitGene) {
    baitPatterns.push(`${baitUniprot}_${baitGene}`);
    baitPatterns.push(`${baitUniprot}_${baitGene.toUpperCase()}`);
    baitPatterns.push(`${baitUniprot}_${baitGene.toLowerCase()}`);
  }
  baitPatterns.push(baitUniprot);

  for (const baitDir of baitPatterns) {
    const baitPath = join(AF3_BASE_DIR, baitDir, 'AF3', directoryName);

    // Check if directory exists
    if (await fileExists(baitPath)) {
      // Look for model.cif file
      const cifPath1 = join(baitPath, `${directoryName}_model.cif`);
      const cifPath2 = join(baitPath, `${directoryName.split('_')[0]}_model.cif`);

      let cifPath = null;
      if (await fileExists(cifPath1)) {
        cifPath = cifPath1;
      } else if (await fileExists(cifPath2)) {
        cifPath = cifPath2;
      } else {
        // Try to find any *_model.cif file
        try {
          const files = await readdir(baitPath);
          const cifFiles = files.filter(f => f.endsWith('_model.cif'));
          if (cifFiles.length > 0) {
            cifPath = join(baitPath, cifFiles[0]);
          }
        } catch (e) {
          continue;
        }
      }

      if (cifPath) {
        return {
          cif_path: cifPath,
          bait_directory: baitDir,
          interaction_directory: directoryName,
          prediction_directory: baitPath
        };
      }
    }
  }

  return null;
}

async function main() {
  console.log('='.repeat(80));
  console.log('CIF FILE COLLECTION SCRIPT - Cilia Local Deployment');
  console.log('='.repeat(80));
  console.log();

  // Check if database exists
  if (!existsSync(DB_PATH)) {
    console.error(`❌ Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  // Check if AlphaPulldown directory exists
  if (!await fileExists(AF3_BASE_DIR)) {
    console.error(`❌ AlphaPulldown base directory not found: ${AF3_BASE_DIR}`);
    console.error('This script must be run on a machine with access to AlphaFold predictions.');
    process.exit(1);
  }

  console.log(`📁 Database: ${DB_PATH}`);
  console.log(`📁 AlphaPulldown: ${AF3_BASE_DIR}`);
  console.log(`📁 Output: ${STRUCTURES_DIR}`);
  console.log();

  // Create structures directory
  if (!existsSync(STRUCTURES_DIR)) {
    await mkdir(STRUCTURES_DIR, { recursive: true });
    console.log(`✅ Created structures directory`);
  }

  // Open database
  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Get all interactions
    console.log('📊 Querying database...');
    const interactions = db.prepare(`
      SELECT
        i.id,
        b.uniprot_id as bait_uniprot,
        b.gene_name as bait_gene,
        p.uniprot_id as prey_uniprot,
        p.gene_name as prey_gene,
        i.source_path,
        i.ipsae
      FROM interactions i
      JOIN proteins b ON i.bait_protein_id = b.id
      JOIN proteins p ON i.prey_protein_id = p.id
      WHERE i.alphafold_version = 'AF3'
      ORDER BY i.id
    `).all();

    console.log(`✅ Found ${interactions.length} AF3 interactions in database`);
    console.log();

    console.log('🔍 Searching for CIF files...');
    console.log();

    // Process each interaction
    const manifest = {
      generated_at: new Date().toISOString(),
      total: interactions.length,
      found: 0,
      not_found: 0,
      errors: 0,
      entries: {}
    };

    let processedCount = 0;

    for (const inter of interactions) {
      processedCount++;

      try {
        // Find CIF file
        const result = await findCifFile(
          inter.bait_uniprot,
          inter.bait_gene,
          inter.prey_uniprot,
          inter.prey_gene,
          inter.source_path
        );

        if (result) {
          // Copy CIF file to structures directory
          const outputFilename = `${result.interaction_directory}.cif`;
          const outputPath = join(STRUCTURES_DIR, outputFilename);

          await copyFile(result.cif_path, outputPath);

          manifest.entries[inter.id] = {
            id: inter.id,
            bait_uniprot: inter.bait_uniprot,
            bait_gene: inter.bait_gene || 'Unknown',
            prey_uniprot: inter.prey_uniprot,
            prey_gene: inter.prey_gene || 'Unknown',
            ipsae: inter.ipsae,
            source_json: inter.source_path,
            status: 'found',
            cif_path: outputPath,
            original_cif_path: result.cif_path,
            interaction_directory: result.interaction_directory,
            notes: [],
            prediction_directory: result.prediction_directory
          };

          manifest.found++;

          if (processedCount % 50 === 0) {
            console.log(`  Processed ${processedCount}/${interactions.length} - Found: ${manifest.found}, Missing: ${manifest.not_found}`);
          }
        } else {
          manifest.entries[inter.id] = {
            id: inter.id,
            bait_uniprot: inter.bait_uniprot,
            bait_gene: inter.bait_gene || 'Unknown',
            prey_uniprot: inter.prey_uniprot,
            prey_gene: inter.prey_gene || 'Unknown',
            ipsae: inter.ipsae,
            source_json: inter.source_path,
            status: 'not_found',
            cif_path: null,
            interaction_directory: null,
            notes: ['CIF file not found in AlphaPulldown directories']
          };

          manifest.not_found++;
        }
      } catch (error) {
        manifest.entries[inter.id] = {
          id: inter.id,
          bait_uniprot: inter.bait_uniprot,
          bait_gene: inter.bait_gene || 'Unknown',
          prey_uniprot: inter.prey_uniprot,
          prey_gene: inter.prey_gene || 'Unknown',
          status: 'error',
          cif_path: null,
          interaction_directory: null,
          notes: [`Error: ${error.message}`]
        };

        manifest.errors++;
      }
    }

    console.log();
    console.log(`✅ Processing complete!`);
    console.log(`  Total interactions: ${manifest.total}`);
    console.log(`  Found CIF files: ${manifest.found} (${(manifest.found/manifest.total*100).toFixed(1)}%)`);
    console.log(`  Missing CIF files: ${manifest.not_found} (${(manifest.not_found/manifest.total*100).toFixed(1)}%)`);
    console.log(`  Errors: ${manifest.errors}`);
    console.log();

    // Calculate total size
    if (manifest.found > 0) {
      const { statSync } = await import('fs');
      let totalSize = 0;
      for (const entry of Object.values(manifest.entries)) {
        if (entry.cif_path && existsSync(entry.cif_path)) {
          totalSize += statSync(entry.cif_path).size;
        }
      }
      const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
      const sizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);
      console.log(`💾 Total size: ${sizeMB} MB (${sizeGB} GB)`);
      console.log();
    }

    // Save manifest
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`✅ Saved manifest to: ${MANIFEST_PATH}`);
    console.log();

    // Show some examples
    if (manifest.found > 0) {
      console.log('Sample collected files:');
      let sampleCount = 0;
      for (const [interId, data] of Object.entries(manifest.entries)) {
        if (data.status === 'found' && sampleCount < 5) {
          console.log(`  ID ${interId}: ${data.bait_gene} ↔ ${data.prey_gene}`);
          console.log(`    File: structures/${data.interaction_directory}.cif`);
          sampleCount++;
        }
      }
      console.log();
    }

    // Show missing examples
    if (manifest.not_found > 0) {
      console.log('Sample missing files:');
      let sampleCount = 0;
      for (const [interId, data] of Object.entries(manifest.entries)) {
        if (data.status === 'not_found' && sampleCount < 5) {
          console.log(`  ID ${interId}: ${data.bait_gene} ↔ ${data.prey_gene}`);
          console.log(`    UniProt: ${data.bait_uniprot} / ${data.prey_uniprot}`);
          sampleCount++;
        }
      }
      console.log();
    }

    console.log('='.repeat(80));
    console.log('COMPLETE');
    console.log('='.repeat(80));
    console.log();
    console.log('Next steps:');
    console.log('1. Review cif_manifest.json');
    console.log('2. Check structures/ directory');
    console.log('3. Update .gitignore to exclude structures/ (too large for git)');
    console.log('4. Provide structures/ directory to implementer separately');
    console.log();

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
