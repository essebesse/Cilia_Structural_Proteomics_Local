import { createPool } from '@vercel/postgres';
import fetch from 'node-fetch';

const BATCH_SIZE = 50; // UniProt API batch size
const DELAY_MS = 100; // Delay between requests to be nice to UniProt

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchUniProtAliases(uniprotIds) {
    console.log(`Fetching aliases for ${uniprotIds.length} proteins from UniProt...`);

    const allAliases = new Map();

    // Process in batches
    for (let i = 0; i < uniprotIds.length; i += BATCH_SIZE) {
        const batch = uniprotIds.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(uniprotIds.length/BATCH_SIZE)}`);

        try {
            const ids = batch.filter(id => id && !id.startsWith('AF2_')).join(',');
            if (!ids) continue;

            const url = `https://rest.uniprot.org/uniprotkb/accessions?accessions=${ids}&format=json&fields=accession,gene_names,protein_name`;

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'ProtoviewApp/1.0 (research@example.com)'
                }
            });

            if (!response.ok) {
                console.warn(`UniProt API error for batch: ${response.status} ${response.statusText}`);
                await sleep(DELAY_MS * 3); // Longer delay on error
                continue;
            }

            const data = await response.json();

            for (const entry of data.results || []) {
                const aliases = [];
                const uniprotId = entry.primaryAccession;

                // Gene names
                if (entry.genes && entry.genes.length > 0) {
                    for (const gene of entry.genes) {
                        if (gene.geneName && gene.geneName.value) {
                            aliases.push({ name: gene.geneName.value, type: 'gene_name' });
                        }
                        if (gene.synonyms) {
                            for (const synonym of gene.synonyms) {
                                if (synonym.value) {
                                    aliases.push({ name: synonym.value, type: 'gene_synonym' });
                                }
                            }
                        }
                    }
                }

                // Protein names
                if (entry.proteinDescription) {
                    if (entry.proteinDescription.recommendedName) {
                        const recName = entry.proteinDescription.recommendedName.fullName;
                        if (recName && recName.value) {
                            aliases.push({ name: recName.value, type: 'protein_name' });
                        }

                        // Short names
                        if (entry.proteinDescription.recommendedName.shortNames) {
                            for (const shortName of entry.proteinDescription.recommendedName.shortNames) {
                                if (shortName.value) {
                                    aliases.push({ name: shortName.value, type: 'short_name' });
                                }
                            }
                        }
                    }

                    // Alternative names
                    if (entry.proteinDescription.alternativeNames) {
                        for (const altName of entry.proteinDescription.alternativeNames) {
                            if (altName.fullName && altName.fullName.value) {
                                aliases.push({ name: altName.fullName.value, type: 'alternative_name' });
                            }
                        }
                    }
                }

                if (aliases.length > 0) {
                    allAliases.set(uniprotId, aliases);
                }
            }

        } catch (error) {
            console.error(`Error fetching batch starting at ${i}:`, error.message);
        }

        await sleep(DELAY_MS);
    }

    return allAliases;
}

async function main() {
    console.log('Starting protein alias fetching and database sync...');

    if (!process.env.POSTGRES_URL) {
        console.error('❌ ERROR: POSTGRES_URL environment variable is not set.');
        process.exit(1);
    }

    const pool = createPool({
        connectionString: process.env.POSTGRES_URL,
    });
    const client = await pool.connect();
    console.log('Successfully connected to the database.');

    try {
        // Create aliases table if it doesn't exist
        console.log('Creating aliases table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS protein_aliases (
                id SERIAL PRIMARY KEY,
                protein_id INTEGER REFERENCES proteins(id) ON DELETE CASCADE,
                alias_name VARCHAR(255) NOT NULL,
                alias_type VARCHAR(50),
                source VARCHAR(50) DEFAULT 'uniprot',
                UNIQUE(protein_id, alias_name)
            )
        `);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_protein_aliases_on_alias_name ON protein_aliases(alias_name)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_protein_aliases_alias_name_lower ON protein_aliases(LOWER(alias_name))`);

        // Get all UniProt IDs from database
        const proteinsQuery = await client.query('SELECT id, uniprot_id FROM proteins WHERE uniprot_id NOT LIKE \'AF2_%\'');
        const proteins = proteinsQuery.rows;

        console.log(`Found ${proteins.length} UniProt proteins to process`);

        const uniprotIds = proteins.map(p => p.uniprot_id);

        // Fetch aliases from UniProt
        const allAliases = await fetchUniProtAliases(uniprotIds);

        console.log(`Fetched aliases for ${allAliases.size} proteins`);

        // Insert aliases into database
        await client.query('BEGIN');

        let insertedCount = 0;
        for (const protein of proteins) {
            const aliases = allAliases.get(protein.uniprot_id);
            if (!aliases) continue;

            // First add the current gene_name as an alias if it exists
            const currentGene = await client.query('SELECT gene_name FROM proteins WHERE id = $1', [protein.id]);
            if (currentGene.rows[0]?.gene_name && currentGene.rows[0].gene_name.trim()) {
                try {
                    await client.query(
                        'INSERT INTO protein_aliases (protein_id, alias_name, alias_type, source) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                        [protein.id, currentGene.rows[0].gene_name.trim(), 'current_gene_name', 'database']
                    );
                } catch (e) {
                    // Ignore conflicts
                }
            }

            // Add UniProt aliases
            for (const alias of aliases) {
                try {
                    await client.query(
                        'INSERT INTO protein_aliases (protein_id, alias_name, alias_type, source) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                        [protein.id, alias.name.trim(), alias.type, 'uniprot']
                    );
                    insertedCount++;
                } catch (e) {
                    // Ignore conflicts and continue
                }
            }
        }

        await client.query('COMMIT');

        console.log(`✅ Successfully inserted ${insertedCount} aliases`);

        // Show summary
        const summary = await client.query(`
            SELECT alias_type, COUNT(*) as count
            FROM protein_aliases
            GROUP BY alias_type
            ORDER BY count DESC
        `);

        console.log('\nAlias distribution:');
        for (const row of summary.rows) {
            console.log(`  ${row.alias_type}: ${row.count}`);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Alias fetching failed:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('Database connection closed.');
    }
}

main();