import fs from 'fs';
import { createClient } from '@vercel/postgres';

// --- CONFIGURATION ---
const INPUT_FILE = 'ALL_RESULTS_FINAL_ANNOTATED.txt';
// ---------------------

// Regex patterns to parse the data
const resultHeaderRegex = /^--- Results from: (.*) ---$/;
const confidenceHeaderRegex = /^(VERY HIGH CONFIDENCE|WORTH INVESTIGATING|LOW iPTM - PROCEED WITH CAUTION).*/;
const dataLineRegex = /^([a-z0-9_]+_and_[a-z0-9_]+)\s+([0-9.]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9.]+)\s+\[([A-Z0-9_.-]+):([^&]+?)\s*&\s*([A-Z0-9_.-]+):([^]]+)\]/i;

async function main() {
    console.log('Starting database synchronization process...');

    if (!process.env.POSTGRES_URL) {
        console.error('❌ ERROR: POSTGRES_URL environment variable is not set.');
        console.error('Please set it to your Neon database connection string before running.');
        process.exit(1);
    }

    // Step 1: Parse the local text file
    console.log(`Reading and parsing ${INPUT_FILE}...`);
    const { proteins, interactions } = parseLocalFile();
    if (interactions.length === 0) {
        console.log('No interactions found in the input file. Nothing to sync.');
        return;
    }
    console.log(`Parsing complete. Found ${proteins.size} unique proteins and ${interactions.length} interactions.`);

    // Step 2: Sync with the database
    await syncToDb(proteins, interactions);
}

function parseLocalFile() {
    const fileContent = fs.readFileSync(INPUT_FILE, 'utf-8');
    const lines = fileContent.split('\n');

    const proteins = new Map();
    const interactions = [];

    let currentSourcePath = 'Unknown';
    let currentConfidence = 'Unknown';

    for (const line of lines) {
        const headerMatch = line.match(resultHeaderRegex);
        if (headerMatch) {
            currentSourcePath = headerMatch[1].trim();
            continue;
        }

        const confidenceMatch = line.match(confidenceHeaderRegex);
        if (confidenceMatch) {
            const confidenceStr = confidenceMatch[1];
            if (confidenceStr === 'VERY HIGH CONFIDENCE') currentConfidence = 'Very High Confidence';
            else if (confidenceStr === 'WORTH INVESTIGATING') currentConfidence = 'Worth Investigating';
            else if (confidenceStr === 'LOW iPTM - PROCEED WITH CAUTION') currentConfidence = 'Low iPTM - Proceed with Caution';
            continue;
        }

        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
            const directory = parts[0];
            if (!directory.includes('_and_')) continue;

            const iptm = parseFloat(parts[1]);
            const pae_lt_3 = parseInt(parts[2]);
            const pae_lt_6 = parseInt(parts[3]);
            const int_plddt = parseFloat(parts[4]);
            
            const geneNameMatch = line.match(/\[(.*\])/);
            if (geneNameMatch) {
                const geneNameStr = geneNameMatch[1];
                const geneNameParts = geneNameStr.split(/\s*&\s*/);
                if (geneNameParts.length === 2) {
                    const bait_part = geneNameParts[0].split(':');
                    const prey_part = geneNameParts[1].split(':');
                    
                    if (bait_part.length === 2 && prey_part.length === 2) {
                        const bait_uniprot = bait_part[0].trim();
                        const bait_gene = bait_part[1].trim();
                        const prey_uniprot = prey_part[0].trim();
                        const prey_gene = prey_part[1].trim();

                        if (bait_uniprot && prey_uniprot) {
                            if (!proteins.has(bait_uniprot)) proteins.set(bait_uniprot, bait_gene);
                            if (!proteins.has(prey_uniprot)) proteins.set(prey_uniprot, prey_gene);

                            interactions.push({
                                bait_uniprot,
                                prey_uniprot,
                                iptm,
                                contacts_pae_lt_3: pae_lt_3,
                                contacts_pae_lt_6: pae_lt_6,
                                interface_plddt: int_plddt,
                                confidence: currentConfidence,
                                source_path: currentSourcePath,
                            });
                        }
                    }
                }
            }
        }
    }
    return { proteins, interactions };
}

async function syncToDb(proteins, interactions) {
    const client = createClient({
        connectionString: process.env.POSTGRES_URL,
    });
    await client.connect();
    console.log('Successfully connected to the database.');

    try {
        await client.query('BEGIN');

        // Sync Proteins
        console.log(`Syncing ${proteins.size} unique proteins...`);
        for (const [uniprot, gene] of proteins.entries()) {
            await client.query(
                `INSERT INTO proteins (uniprot_id, gene_name) VALUES ($1, $2) ON CONFLICT (uniprot_id) DO NOTHING;`,
                [uniprot, gene]
            );
        }

        // Sync Interactions
        console.log(`Syncing ${interactions.length} interactions...`);
        for (const inter of interactions) {
            await client.query(
                `INSERT INTO interactions (bait_protein_id, prey_protein_id, iptm, contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt, confidence, source_path)
                 SELECT p_bait.id, p_prey.id, $3, $4, $5, $6, $7, $8
                 FROM proteins p_bait, proteins p_prey
                 WHERE p_bait.uniprot_id = $1 AND p_prey.uniprot_id = $2
                 ON CONFLICT (bait_protein_id, prey_protein_id, source_path) DO NOTHING;`,
                [inter.bait_uniprot, inter.prey_uniprot, inter.iptm, inter.contacts_pae_lt_3, inter.contacts_pae_lt_6, inter.interface_plddt, inter.confidence, inter.source_path]
            );
        }

        await client.query('COMMIT');
        console.log('✅ Database synchronization successful.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Database synchronization failed. Changes were rolled back.');
        console.error(e);
    } finally {
        await client.end();
        console.log('Database connection closed.');
    }
}

main();