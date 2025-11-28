#!/usr/bin/env node
/**
 * Fix Complex Source Paths - Migration Script
 * ===========================================
 *
 * Updates complex_interactions table to use full absolute paths instead of relative directory names.
 *
 * PROBLEM:
 * - Old imports stored relative paths (e.g., "q96lb3_q8wya0_with_q9h7x7")
 * - Should store full paths (e.g., "/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/Q96LB3_Q8WYA0_IFT74_81/AF3/q96lb3_q8wya0_with_q9h7x7")
 *
 * SOLUTION:
 * This script attempts to reconstruct full paths based on known base directories.
 *
 * Usage:
 *   node db/fix_complex_source_paths.mjs
 *
 * Environment Variables:
 *   POSTGRES_URL - Database connection string (required)
 */

import { sql } from '@vercel/postgres';
import path from 'path';
import fs from 'fs';

// Known base directories where complex data typically lives
const BASE_PATHS = [
  '/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD',
  '/emcc/au14762/AF',
];

/**
 * Search for a directory in known base paths
 */
function findFullPath(relativePath) {
  // If it's already a full path, return it
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  // Try each base path
  for (const basePath of BASE_PATHS) {
    // Try direct join
    const directPath = path.join(basePath, relativePath);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    // Try searching subdirectories
    try {
      const subdirs = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const subdir of subdirs) {
        const searchPath = path.join(basePath, subdir, 'AF3', relativePath);
        if (fs.existsSync(searchPath)) {
          return searchPath;
        }
      }
    } catch (error) {
      // Skip if can't read directory
      continue;
    }
  }

  // If not found, return original (will be logged as unfixable)
  return relativePath;
}

async function fixSourcePaths() {
  console.log('Complex Source Path Migration');
  console.log('============================\n');

  try {
    // Get all complex interactions with relative paths
    console.log('Step 1: Finding complex interactions with relative paths...');
    const { rows: interactions } = await sql`
      SELECT id, source_path, bait_complex_id
      FROM complex_interactions
      WHERE source_path NOT LIKE '/%'  -- Not starting with / (not absolute)
      ORDER BY id
    `;

    if (interactions.length === 0) {
      console.log('✓ No interactions need updating - all paths are already absolute!\n');
      return;
    }

    console.log(`Found ${interactions.length} interactions with relative paths\n`);

    // Process each interaction
    console.log('Step 2: Attempting to resolve full paths...');
    let updatedCount = 0;
    let unfixableCount = 0;
    const unfixable = [];

    for (const interaction of interactions) {
      const fullPath = findFullPath(interaction.source_path);

      if (path.isAbsolute(fullPath) && fullPath !== interaction.source_path) {
        // Successfully found full path, update it
        await sql`
          UPDATE complex_interactions
          SET source_path = ${fullPath}
          WHERE id = ${interaction.id}
        `;

        console.log(`  ✓ [${interaction.id}] ${interaction.source_path} → ${fullPath}`);
        updatedCount++;
      } else {
        // Could not resolve
        console.log(`  ✗ [${interaction.id}] ${interaction.source_path} (not found)`);
        unfixableCount++;
        unfixable.push({
          id: interaction.id,
          path: interaction.source_path,
          complex_id: interaction.bait_complex_id
        });
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(70));
    console.log('Migration Complete!');
    console.log('═'.repeat(70));
    console.log(`Total interactions processed: ${interactions.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Could not resolve: ${unfixableCount}`);

    if (unfixableCount > 0) {
      console.log('\n⚠️ The following paths could not be automatically resolved:');
      for (const item of unfixable) {
        console.log(`   ID ${item.id} (complex ${item.complex_id}): ${item.path}`);
      }
      console.log('\nYou may need to manually update these paths or re-import the data.');
    }

    console.log('\n✓ Run "node db/check_db.mjs" to verify the updates');
    console.log('');

  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
fixSourcePaths()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
