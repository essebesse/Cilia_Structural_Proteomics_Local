import { createPool } from '@vercel/postgres';

async function fixAlphaFoldVersions() {
    console.log('Fixing AlphaFold version NULL values...');

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
        await client.query('BEGIN');

        // Update AF3 interactions (from AlphaPulldown path)
        const af3Update = await client.query(`
            UPDATE interactions
            SET alphafold_version = 'AF3'
            WHERE source_path LIKE '%AlphaPulldown%'
            AND alphafold_version IS NULL
        `);
        console.log(`Updated ${af3Update.rowCount} AF3 interactions`);

        // Update AF2 interactions (from AF path)
        const af2Update = await client.query(`
            UPDATE interactions
            SET alphafold_version = 'AF2'
            WHERE source_path LIKE '%/emcc/au14762/AF%'
            AND alphafold_version IS NULL
        `);
        console.log(`Updated ${af2Update.rowCount} AF2 interactions`);

        // Update any remaining NULL values based on confidence levels
        // AF3 uses "Very High Confidence", AF2 uses "Very High"
        const af3ConfidenceUpdate = await client.query(`
            UPDATE interactions
            SET alphafold_version = 'AF3'
            WHERE confidence IN ('Very High Confidence', 'Worth Investigating', 'Low iPTM - Proceed with Caution')
            AND alphafold_version IS NULL
        `);
        console.log(`Updated ${af3ConfidenceUpdate.rowCount} AF3 interactions by confidence`);

        const af2ConfidenceUpdate = await client.query(`
            UPDATE interactions
            SET alphafold_version = 'AF2'
            WHERE confidence IN ('Very High', 'High', 'Medium', 'Low')
            AND alphafold_version IS NULL
        `);
        console.log(`Updated ${af2ConfidenceUpdate.rowCount} AF2 interactions by confidence`);

        await client.query('COMMIT');

        // Check results
        console.log('\n=== RESULTS ===');
        const versionCounts = await client.query(`
            SELECT alphafold_version, COUNT(*)
            FROM interactions
            GROUP BY alphafold_version
        `);
        console.log('AlphaFold version distribution:', versionCounts.rows);

        console.log('✅ AlphaFold versions fixed successfully.');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Fix failed:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('Database connection closed.');
    }
}

fixAlphaFoldVersions();