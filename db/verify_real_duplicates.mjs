#!/usr/bin/env node
import { sql } from '@vercel/postgres';

// Check IFT172 → IFT57 (user said it shows duplicate)
const result = await sql`
  SELECT
    i.id,
    p1.uniprot_id as bait,
    p1.gene_name as bait_gene,
    p2.uniprot_id as prey,
    p2.gene_name as prey_gene,
    i.iptm,
    i.contacts_pae_lt_3,
    i.interface_plddt,
    i.source_path
  FROM interactions i
  JOIN proteins p1 ON i.bait_protein_id = p1.id
  JOIN proteins p2 ON i.prey_protein_id = p2.id
  WHERE p1.uniprot_id = 'Q9UG01'
    AND p2.gene_name = 'IFT57'
  ORDER BY i.id
`;

console.log('═══════════════════════════════════════════════════════════');
console.log('DUPLICATE VERIFICATION: IFT172 → IFT57');
console.log('═══════════════════════════════════════════════════════════\n');

result.rows.forEach(row => {
  const source = row.source_path ? row.source_path.split('/').pop() : 'NULL';
  console.log(`🔑 Database Row ID: ${row.id}`);
  console.log(`   Bait: ${row.bait_gene} (${row.bait})`);
  console.log(`   Prey: ${row.prey_gene} (${row.prey})`);
  console.log(`   iPTM: ${row.iptm}, Contacts: ${row.contacts_pae_lt_3}, ipLDDT: ${row.interface_plddt}`);
  console.log(`   Source: ${source}`);
  console.log('');
});

console.log(`Total database rows: ${result.rows.length}`);
console.log('');

if (result.rows.length > 1) {
  console.log('✅ CONFIRMED: These are REAL DATABASE DUPLICATES');
  console.log('   Multiple rows exist with different row IDs');
  console.log('   Each row is a separate entry in the interactions table');
} else if (result.rows.length === 1) {
  console.log('⚠️  Only 1 row found - This is a DISPLAY ISSUE, not a database duplicate');
  console.log('   The frontend is showing the same row twice');
} else {
  console.log('❌ No rows found');
}
