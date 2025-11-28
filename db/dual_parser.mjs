import fs from 'fs';
import { createPool } from '@vercel/postgres';

// --- CONFIGURATION ---
const AF3_FILE = 'ALL_RESULTS_FINAL_ANNOTATED.txt';
const AF2_FILE = 'high_confidence_af2_predictions_v2_summary_ALL.txt';
const AF2_SOURCE_PATH = '/emcc/au14762/AF';
const AF3_SOURCE_PATH = '/emcc/au14762/elo_lab/AlphaPulldown/AF3_APD';
// ---------------------

// AF3 Regex patterns
const af3ResultHeaderRegex = /^--- Results from: (.*) ---$/;
const af3ConfidenceHeaderRegex = /^(VERY HIGH CONFIDENCE|WORTH INVESTIGATING|LOW iPTM - PROCEED WITH CAUTION).*/;

// AF2 patterns
const af2ConfidenceMap = {
    'Very High': 'Very High',
    'High': 'High',
    'Medium': 'Medium',
    'Low': 'Low'
};

async function main() {
    console.log('Starting dual database synchronization process (AF2 + AF3)...');

    if (!process.env.POSTGRES_URL) {
        console.error('❌ ERROR: POSTGRES_URL environment variable is not set.');
        console.error('Please set it to your Neon database connection string before running.');
        process.exit(1);
    }

    // Parse both files
    console.log('Parsing AF3 data...');
    const af3Data = parseAF3File();

    console.log('Parsing AF2 data...');
    const af2Data = parseAF2File();

    // Combine proteins and interactions
    const allProteins = new Map([...af3Data.proteins, ...af2Data.proteins]);
    const allInteractions = [...af3Data.interactions, ...af2Data.interactions];

    console.log(`Total unique proteins: ${allProteins.size}`);
    console.log(`Total interactions: ${allInteractions.length} (AF3: ${af3Data.interactions.length}, AF2: ${af2Data.interactions.length})`);

    if (allInteractions.length === 0) {
        console.log('No interactions found. Nothing to sync.');
        return;
    }

    // Sync to database
    await syncToDb(allProteins, allInteractions);
}

function parseAF3File() {
    console.log(`Reading ${AF3_FILE}...`);
    const fileContent = fs.readFileSync(AF3_FILE, 'utf-8');
    const lines = fileContent.split('\n');

    const proteins = new Map();
    const interactions = [];

    let currentSourcePath = 'Unknown';
    let currentConfidence = 'Unknown';

    for (const line of lines) {
        const headerMatch = line.match(af3ResultHeaderRegex);
        if (headerMatch) {
            currentSourcePath = headerMatch[1].trim();
            continue;
        }

        const confidenceMatch = line.match(af3ConfidenceHeaderRegex);
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
                                alphafold_version: 'AF3',
                            });
                        }
                    }
                }
            }
        }
    }

    console.log(`AF3: Found ${proteins.size} proteins and ${interactions.length} interactions`);
    return { proteins, interactions };
}

function parseAF2File() {
    console.log(`Reading ${AF2_FILE}...`);
    const fileContent = fs.readFileSync(AF2_FILE, 'utf-8');
    const lines = fileContent.split('\n');

    const proteins = new Map();
    const interactions = [];

    let currentConfidence = 'Unknown';
    let inDataSection = false;

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Check for confidence level headers
        if (trimmedLine.includes('Very High:') || trimmedLine.includes('High:') ||
            trimmedLine.includes('Medium:') || trimmedLine.includes('Low:')) {
            continue;
        }

        // Look for data lines with the expected format
        // Format: directory, "Pulldown", iptm, contacts_3, contacts_5, contacts_8, contacts_12, confidence
        const parts = trimmedLine.split(/\s+/);
        if (parts.length >= 8 && parts[1] === 'Pulldown') {
            const directory = parts[0];
            const iptm_ptm = parseFloat(parts[2]);  // Column 2, not 1
            const contacts_3 = parseInt(parts[3]);   // Column 3, not 2
            const contacts_5 = parseInt(parts[4]);   // Column 4, not 3
            const contacts_8 = parseInt(parts[5]);   // Column 5, not 4
            const contacts_12 = parseInt(parts[6]);  // Column 6, not 5
            const confidence = parts[7];             // Column 7, not 6

            // Validate this is a data line
            if (!isNaN(iptm_ptm) && !isNaN(contacts_3) && af2ConfidenceMap[confidence]) {
                // For AF2 data, we need to create protein entries from directory names
                // Handle different naming patterns: "protein1_and_protein2" vs "protein1_protein2"
                let bait_protein, prey_protein;

                if (directory.includes('_and_')) {
                    // Pattern: "Cr54N_and_Cre01.g032150.t1.1"
                    const parts = directory.split('_and_');
                    bait_protein = parts[0] || directory;
                    prey_protein = parts[1] || directory;
                } else {
                    // Pattern: "81CH_abTub" or single protein names
                    const parts = directory.split('_');
                    bait_protein = parts[0] || directory;
                    prey_protein = parts[1] || parts[0]; // Use same if only one part
                }

                // Create synthetic UniProt-like IDs for AF2 data
                const bait_uniprot = `AF2_${bait_protein}`;
                const prey_uniprot = `AF2_${prey_protein}`;

                if (!proteins.has(bait_uniprot)) proteins.set(bait_uniprot, bait_protein);
                if (!proteins.has(prey_uniprot)) proteins.set(prey_uniprot, prey_protein);

                interactions.push({
                    bait_uniprot,
                    prey_uniprot,
                    iptm: iptm_ptm,
                    contacts_pae_lt_3: contacts_3,
                    contacts_pae_lt_6: contacts_5, // Using 5Å data for 6Å column
                    interface_plddt: null, // AF2 data doesn't have interface pLDDT
                    confidence: af2ConfidenceMap[confidence],
                    source_path: AF2_SOURCE_PATH,
                    alphafold_version: 'AF2',
                });
            }
        }
    }

    console.log(`AF2: Found ${proteins.size} proteins and ${interactions.length} interactions`);
    return { proteins, interactions };
}

async function syncToDb(proteins, interactions) {
    const pool = createPool({
        connectionString: process.env.POSTGRES_URL,
    });
    const client = await pool.connect();
    console.log('Successfully connected to the database.');

    try {
        // Ensure schema is up to date (separate transaction)
        console.log('Updating database schema...');
        try {
            await client.query(`ALTER TYPE confidence_level ADD VALUE IF NOT EXISTS 'Very High'`);
            await client.query(`ALTER TYPE confidence_level ADD VALUE IF NOT EXISTS 'High'`);
            await client.query(`ALTER TYPE confidence_level ADD VALUE IF NOT EXISTS 'Medium'`);
        } catch (e) {
            console.log('Confidence levels already exist or error adding them:', e.message);
        }

        try {
            await client.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS alphafold_version VARCHAR(10)`);
        } catch (e) {
            console.log('AlphaFold version column already exists or error adding it:', e.message);
        }

        // Now start data transaction
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
                `INSERT INTO interactions (bait_protein_id, prey_protein_id, iptm, contacts_pae_lt_3, contacts_pae_lt_6, interface_plddt, confidence, source_path, alphafold_version)
                 SELECT p_bait.id, p_prey.id, $3, $4, $5, $6, $7, $8, $9
                 FROM proteins p_bait, proteins p_prey
                 WHERE p_bait.uniprot_id = $1 AND p_prey.uniprot_id = $2
                 ON CONFLICT (bait_protein_id, prey_protein_id, source_path) DO NOTHING;`,
                [inter.bait_uniprot, inter.prey_uniprot, inter.iptm, inter.contacts_pae_lt_3, inter.contacts_pae_lt_6,
                 inter.interface_plddt, inter.confidence, inter.source_path, inter.alphafold_version]
            );
        }

        await client.query('COMMIT');
        console.log('✅ Database synchronization successful.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Database synchronization failed. Changes were rolled back.');
        console.error(e);
    } finally {
        client.release();
        await pool.end();
        console.log('Database connection closed.');
    }
}

main();