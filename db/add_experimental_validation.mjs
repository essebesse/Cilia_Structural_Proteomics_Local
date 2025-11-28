import { sql } from '@vercel/postgres';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function addValidationColumn() {
  console.log('\n='.repeat(80));
  console.log('ADDING EXPERIMENTAL VALIDATION TO DATABASE');
  console.log('='.repeat(80));

  // Check if column exists
  const checkCol = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'interactions'
    AND column_name = 'experimental_validation'
  `;

  if (checkCol.rowCount === 0) {
    console.log('\n✓ Adding experimental_validation column to interactions table...');
    await sql`
      ALTER TABLE interactions
      ADD COLUMN experimental_validation JSONB
    `;
    console.log('  Column added successfully!');
  } else {
    console.log('\n✓ experimental_validation column already exists');
  }
}

async function addMSValidation() {
  console.log('\n='.repeat(80));
  console.log('ADDING MS VALIDATION DATA');
  console.log('='.repeat(80));

  // Prompt user for validation details
  console.log('\nThis will mark interactions as validated by mass spectrometry.');
  const method = await question('Method type (e.g., "PD_MS"): ');
  const source = await question('Source/Lab (e.g., "Tina/Carsten"): ');
  const notes = await question('Notes (optional, press Enter to skip): ');
  const date = new Date().toISOString().split('T')[0];

  console.log('\n' + '-'.repeat(80));
  console.log('Available baits for validation:');
  console.log('  1. IFT121 (WDR35, Q9P2L0)');
  console.log('  2. IFT122 (Q9HBG6)');
  console.log('  3. IFT43 (Q96FT9)');
  console.log('  4. All of the above');
  console.log('-'.repeat(80));

  const choice = await question('\nSelect bait (1-4): ');

  const baits = [];
  if (choice === '1') {
    baits.push({ name: 'IFT121', uniprot: 'Q9P2L0', ms_file: 'IFT121' });
  } else if (choice === '2') {
    baits.push({ name: 'IFT122', uniprot: 'Q9HBG6', ms_file: 'IFT122' });
  } else if (choice === '3') {
    baits.push({ name: 'IFT43', uniprot: 'Q96FT9', ms_file: 'IFT43' });
  } else {
    baits.push(
      { name: 'IFT121', uniprot: 'Q9P2L0', ms_file: 'IFT121' },
      { name: 'IFT122', uniprot: 'Q9HBG6', ms_file: 'IFT122' },
      { name: 'IFT43', uniprot: 'Q96FT9', ms_file: 'IFT43' }
    );
  }

  const validationData = {
    validated: true,
    method: method,
    source: source,
    date: date,
    notes: notes || null
  };

  console.log('\nValidation data to add:');
  console.log(JSON.stringify(validationData, null, 2));

  const confirm = await question('\nProceed with adding validation? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  // Read MS data from file
  const fs = await import('fs');
  const ms_data = JSON.parse(fs.readFileSync('/tmp/ms_data.json', 'utf8'));

  let totalUpdated = 0;

  for (const bait of baits) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Processing ${bait.name} (${bait.uniprot})`);
    console.log('='.repeat(80));

    // Get MS hits for this bait
    const ms_uniprots = new Set(ms_data[bait.ms_file].unique_uniprots);
    console.log(`MS hits: ${ms_uniprots.size} proteins`);

    // Get AF3 predictions for this bait
    const af3_result = await sql`
      SELECT
        i.id,
        p2.uniprot_id,
        p2.gene_name,
        i.iptm,
        i.contacts_pae_lt_3
      FROM interactions i
      JOIN proteins p1 ON i.bait_protein_id = p1.id
      JOIN proteins p2 ON i.prey_protein_id = p2.id
      WHERE p1.uniprot_id = ${bait.uniprot}
      AND i.alphafold_version = 'AF3'
    `;

    console.log(`AF3 predictions: ${af3_result.rowCount} interactions`);

    // Find overlaps and update
    let baitUpdated = 0;
    for (const row of af3_result.rows) {
      if (ms_uniprots.has(row.uniprot_id)) {
        await sql`
          UPDATE interactions
          SET experimental_validation = ${JSON.stringify(validationData)}
          WHERE id = ${row.id}
        `;
        console.log(`  ✓ Validated: ${row.uniprot_id} (${row.gene_name || 'N/A'}) - iPTM: ${row.iptm}`);
        baitUpdated++;
        totalUpdated++;
      }
    }

    console.log(`\nUpdated ${baitUpdated} interactions for ${bait.name}`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TOTAL: Updated ${totalUpdated} interactions with MS validation`);
  console.log('='.repeat(80));

  rl.close();
  process.exit(0);
}

async function main() {
  try {
    await addValidationColumn();
    await addMSValidation();
  } catch (error) {
    console.error('Error:', error);
    rl.close();
    process.exit(1);
  }
}

main();
