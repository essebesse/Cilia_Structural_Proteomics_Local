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
 * Find CIF file using the source_path directly from database
 */
async function findCifFile(baitUniprot, baitGene, preyUniprot, preyGene, sourcePath) {
  if (!sourcePath) {
    return null;
  }

  // The source_path points to either:
  // 1. A JSON file: /path/to/AF3/AF3_PD_analysis_v4.json
  // 2. A directory: /path/to/AF3/
  // CIF files are in subdirectories: /path/to/AF3/proteinA_and_proteinB/proteinA_and_proteinB_model.cif

  let sourceDir;
  if (sourcePath.endsWith('.json')) {
    sourceDir = dirname(sourcePath);
  } else {
    sourceDir = sourcePath;
  }

  // Expected directory and CIF filename format
  const cifBasename = `${baitUniprot.toLowerCase()}_and_${preyUniprot.toLowerCase()}`;
  const interactionDir = join(sourceDir, cifBasename);
  const cifPath1 = join(interactionDir, `${cifBasename}_model.cif`);
  const cifPath2 = join(interactionDir, `${cifBasename}.cif`);

  // Try both naming conventions
  if (await fileExists(cifPath1)) {
    return {
      cif_path: cifPath1,
      source_directory: sourceDir
    };
  }

  if (await fileExists(cifPath2)) {
    return {
      cif_path: cifPath2,
      source_directory: sourceDir
    };
  }

  // Try to find any matching subdirectory with CIF files
  try {
    const subdirs = await readdir(sourceDir, { withFileTypes: true });
    const matchingDirs = subdirs.filter(d =>
      d.isDirectory() &&
      d.name.includes(baitUniprot.toLowerCase()) &&
      d.name.includes(preyUniprot.toLowerCase())
    );

    for (const dir of matchingDirs) {
      const dirPath = join(sourceDir, dir.name);
      try {
        const files = await readdir(dirPath);
        const cifFiles = files.filter(f => f.endsWith('.cif') || f.endsWith('_model.cif'));

        if (cifFiles.length > 0) {
          return {
            cif_path: join(dirPath, cifFiles[0]),
            source_directory: dirPath
          };
        }
      } catch {
        continue;
      }
    }
  } catch (e) {
    // Directory doesn't exist or can't be read
    return null;
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

  console.log(`📁 Database: ${DB_PATH}`);
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
          const outputFilename = `${inter.bait_uniprot.toLowerCase()}_and_${inter.prey_uniprot.toLowerCase()}.cif`;
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
            interaction_directory: dirname(result.cif_path),
            notes: [],
            prediction_directory: result.source_directory
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
