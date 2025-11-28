import { sql } from '@vercel/postgres';

async function main() {
  console.log('\n='.repeat(80));
  console.log('UPDATING MS VALIDATION DATA WITH SOURCE FILE PATH');
  console.log('='.repeat(80));

  const validationData = {
    validated: true,
    method: 'PD_MS',
    source: 'Tina/Carsten',
    date: '2025-10-30',
    notes: 'IFT-A complex validation - skeletal ciliopathy project',
    source_file: '/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD/MS_PD_data_Tina_Carsten_IFT43_121_122.xlsx'
  };

  console.log('\nUpdated validation metadata:');
  console.log(JSON.stringify(validationData, null, 2));

  // Update all existing MS validation records
  const result = await sql`
    UPDATE interactions
    SET experimental_validation = ${JSON.stringify(validationData)}::jsonb
    WHERE experimental_validation IS NOT NULL
    AND experimental_validation->>'method' = 'PD_MS'
  `;

  console.log(`\n✓ Updated ${result.rowCount} interaction records with source file path`);

  // Also update complex_interactions if any exist
  const complexResult = await sql`
    UPDATE complex_interactions
    SET experimental_validation = ${JSON.stringify(validationData)}::jsonb
    WHERE experimental_validation IS NOT NULL
    AND experimental_validation->>'method' = 'PD_MS'
  `;

  console.log(`✓ Updated ${complexResult.rowCount} complex interaction records with source file path`);

  console.log('\n='.repeat(80));
  console.log('Update complete!');
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
