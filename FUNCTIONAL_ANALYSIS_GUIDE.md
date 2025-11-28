# Functional Analysis of Protein Interactors - Guideline

**Purpose:** Extract all interactors for a target protein from the database and perform systematic functional analysis to identify pathways, biological processes, and functional themes.

## When to Use This Guide

- After importing new AF3/AF2 data for a protein of interest
- When you want to understand the functional context of protein interactions
- To identify enriched pathways or biological processes
- To validate predictions against known biology
- To generate hypotheses for experimental follow-up

---

## Workflow Overview

```
1. Extract Interactors from Database
   ↓
2. Enrich with UniProt/GO/Pathway Data
   ↓
3. Perform Functional Grouping & Pathway Analysis
   ↓
4. Evaluate Confidence & Filter Results
   ↓
5. Generate Summary Report with Insights
```

---

## Step 1: Extract All Interactors from Database

### Query Template

```javascript
// Extract all interactors for a target protein
const { sql } = require('@vercel/postgres');

const targetProtein = 'Q9Y3A4'; // or gene name like 'RRP7A'

const result = await sql`
  SELECT
    i.iptm,
    i.confidence,
    i.contacts_pae_lt_3,
    i.contacts_pae_lt_6,
    i.interface_plddt,
    i.alphafold_version,
    CASE
      WHEN bait.uniprot_id = ${targetProtein} OR bait.gene_name = ${targetProtein} THEN prey.uniprot_id
      ELSE bait.uniprot_id
    END as interactor_uniprot,
    CASE
      WHEN bait.uniprot_id = ${targetProtein} OR bait.gene_name = ${targetProtein} THEN prey.gene_name
      ELSE bait.gene_name
    END as interactor_gene,
    CASE
      WHEN bait.uniprot_id = ${targetProtein} OR bait.gene_name = ${targetProtein} THEN prey.organism
      ELSE bait.organism
    END as interactor_organism
  FROM interactions i
  JOIN proteins bait ON i.bait_protein_id = bait.id
  JOIN proteins prey ON i.prey_protein_id = prey.id
  WHERE bait.uniprot_id = ${targetProtein}
     OR prey.uniprot_id = ${targetProtein}
     OR bait.gene_name = ${targetProtein}
     OR prey.gene_name = ${targetProtein}
  ORDER BY i.iptm DESC, i.contacts_pae_lt_3 DESC
`;
```

### Quick Command Line Version

```bash
export POSTGRES_URL="postgresql://neondb_owner:npg_q2HCPRojzJ0i@ep-falling-shadow-agzy57k0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

node -e "const { sql } = require('@vercel/postgres'); (async () => {
  const target = 'RRP7A';
  const result = await sql\`
    SELECT
      CASE WHEN bait.gene_name = \${target} THEN prey.gene_name ELSE bait.gene_name END as interactor,
      CASE WHEN bait.gene_name = \${target} THEN prey.uniprot_id ELSE bait.uniprot_id END as uniprot_id,
      i.iptm, i.confidence, i.contacts_pae_lt_3, i.interface_plddt
    FROM interactions i
    JOIN proteins bait ON i.bait_protein_id = bait.id
    JOIN proteins prey ON i.prey_protein_id = prey.id
    WHERE bait.gene_name = \${target} OR prey.gene_name = \${target}
    ORDER BY i.iptm DESC
  \`;
  console.table(result.rows);
})()"
```

---

## Step 2: Enrich Interactor Data

### A. Get Protein Functions from UniProt

**API Endpoint:**
```
https://rest.uniprot.org/uniprotkb/{uniprot_id}.json?fields=accession,gene_names,protein_name,cc_function,cc_pathway,cc_subcellular_location,go
```

**Key Fields to Extract:**
- **Protein name**: Full name and description
- **Function (CC_FUNCTION)**: What the protein does
- **Pathway (CC_PATHWAY)**: Known pathways it participates in
- **Subcellular location**: Where it's found in the cell
- **GO terms**: Gene Ontology annotations (Biological Process, Molecular Function, Cellular Component)

**Example Batch Fetch:**
```bash
# Fetch data for multiple proteins
curl -X POST https://rest.uniprot.org/idmapping/run \
  -d "ids=Q9Y3A4,Q9H6R4,Q13671" \
  -d "from=UniProtKB_AC-ID" \
  -d "to=UniProtKB"
```

### B. Use STRING Database for Functional Enrichment

**STRING API** (https://string-db.org/api):
- Provides pathway enrichment (KEGG, Reactome)
- Gene Ontology enrichment
- Disease associations
- Tissue expression patterns

**Example API Call:**
```
https://string-db.org/api/json/enrichment?identifiers=RAB5A%0DRIN1%0DRAB8A&species=9606
```

### C. Alternative: Use Enrichr API

**Enrichr** (https://maayanlab.cloud/Enrichr/):
- Supports multiple gene list enrichment databases
- KEGG pathways, GO terms, WikiPathways, Reactome
- Disease associations, transcription factors

**Submit gene list:**
```bash
curl -X POST https://maayanlab.cloud/Enrichr/addList \
  -F "list=RAB5A
RIN1
RAB8A
SEC23B
SEC24A" \
  -F "description=RRP7A_interactors"
```

---

## Step 3: Functional Grouping & Analysis

### A. Manual Grouping by Function

Group interactors by functional category:

**Example Categories:**
- **Vesicular trafficking**: RAB proteins, SEC proteins
- **RNA processing**: RRP, NOL proteins
- **Signal transduction**: Kinases, GTPases
- **Cytoskeleton**: Tubulins, actins
- **Protein quality control**: Chaperones, ubiquitin pathway
- **Metabolism**: Enzymes, metabolic regulators

### B. Pathway Enrichment

**Key Questions:**
1. **Are there overrepresented pathways?**
   - E.g., "5 out of 20 interactors are in vesicular transport pathway"
   - Calculate enrichment p-value using hypergeometric test

2. **Do interactors share GO terms?**
   - Biological Process: e.g., "ribosome biogenesis", "vesicle trafficking"
   - Cellular Component: e.g., "nucleolus", "Golgi apparatus"
   - Molecular Function: e.g., "GTPase activity", "protein binding"

3. **Are there protein complexes?**
   - Look for known complexes (CORUM database)
   - Example: "SEC23B + SEC24A = COPII complex"

### C. Confidence-Weighted Analysis

**Filter by confidence level:**
```javascript
// High confidence only (most reliable)
const highConfInteractors = results.filter(r => r.confidence === 'High');

// High + Medium confidence (balanced)
const reliableInteractors = results.filter(r => ['High', 'Medium'].includes(r.confidence));

// Include all (exploratory)
const allInteractors = results;
```

**Consider structural metrics:**
- **iPTM ≥ 0.7**: Strong predicted interaction
- **contacts_pae_lt_3 ≥ 40**: Large interface
- **interface_plddt ≥ 80**: High confidence interface

---

## Step 4: Organism-Specific Analysis

### Cross-Species Conservation

If interactors are from multiple organisms (Human vs. Chlamydomonas):

**Check for:**
1. **Conserved interactions**: Same protein found in both organisms
2. **Functional homologs**: Different proteins, same function
3. **Species-specific interactions**: Unique to one organism

**Example Analysis:**
```
Target: Human RRP7A
Interactors:
- Human: NOL6, RIN1, RAB proteins (nucleolar + vesicular)
- Chlamydomonas homolog: IFT proteins, flagellar proteins

Interpretation: Human protein has nucleolar role, Cr homolog has ciliary role
```

---

## Step 5: Generate Summary Report

### Report Template

```markdown
# Functional Analysis: [Protein Name] ([UniProt ID])

## Overview
- **Target Protein**: [Name] ([UniProt])
- **Organism**: [Organism]
- **Total Interactors**: [N] ([X] High, [Y] Medium, [Z] Low confidence)
- **Data Source**: [AF3/AF2]

## Interactor Summary Table

| Interactor | UniProt | Confidence | iPTM | Contacts | Function | Pathway |
|------------|---------|------------|------|----------|----------|---------|
| [Gene]     | [ID]    | High       | 0.85 | 120      | [Brief]  | [Path]  |

## Functional Grouping

### 1. [Functional Category 1] (N interactors)
- **Proteins**: [List]
- **Shared GO terms**: [GO:XXXXX], [GO:YYYYY]
- **Pathways**: [KEGG/Reactome pathway]
- **Interpretation**: [What this suggests about target protein function]

### 2. [Functional Category 2] (N interactors)
[Same structure]

## Pathway Enrichment Results

### Top Enriched Pathways (p < 0.05)
1. **[Pathway Name]** (p = [value])
   - Interactors: [List]
   - Biological relevance: [Explain]

2. **[Pathway Name]** (p = [value])
   - Interactors: [List]
   - Biological relevance: [Explain]

## Key Observations

1. **[Observation 1]**
   - [Evidence from data]
   - [Interpretation]

2. **[Observation 2]**
   - [Evidence from data]
   - [Interpretation]

## Notable High-Confidence Interactions

- **[Protein A - Protein B]** (iPTM: X.XX, contacts: XXX)
  - Known biology: [What's known in literature]
  - Novelty: [New finding or validates known interaction]

## Biological Interpretation

### Proposed Role(s) for [Target Protein]:
1. **[Role 1]**: Based on [evidence]
2. **[Role 2]**: Based on [evidence]

### Functional Context:
[Synthesize findings into coherent biological story]

## Recommendations for Experimental Validation

### High Priority:
1. **[Interaction 1]**: [Why it's interesting + suggested experiment]
2. **[Interaction 2]**: [Why it's interesting + suggested experiment]

### Medium Priority:
[List with rationale]

## Caveats & Considerations

- **AF2/AF3 limitations**: [Any structural concerns]
- **Missing interactions**: [Known interactors not found]
- **Cross-organism extrapolation**: [If applicable]

## References & Resources

- UniProt: [Links]
- STRING: [Links]
- PubMed: [Relevant papers]
```

---

## Best Practices

### 1. Confidence Filtering Strategy

**For exploratory analysis:**
- Include all confidence levels initially
- Note trends at each confidence tier
- Focus interpretation on High confidence

**For publication/validation:**
- Prioritize High confidence (iPTM ≥ 0.7 or contacts ≥ 40)
- Use Medium confidence for secondary evidence
- Mention Low confidence only if highly relevant

### 2. Cross-Reference with Literature

Always check:
- **PubMed** for known interactions
- **BioGRID/IntAct** for experimental evidence
- **CORUM** for known complexes
- **HPRD** (human) or **Chlamydomonas Compendium** (Cr)

### 3. Consider Biological Context

**Ask:**
- Does this make sense given what we know about the target protein?
- Are these proteins co-localized (same cellular compartment)?
- Are they co-expressed (same tissues/conditions)?
- Is there evolutionary conservation?

### 4. Handle Ambiguous Results

**If functional theme is unclear:**
- Group by structural features (e.g., "all are GTPases")
- Look for shared domains (Pfam database)
- Check if they're in same protein family
- Consider that protein may be multifunctional

---

## Automation Scripts

### Quick Extraction Script

Create `scripts/extract_interactors.mjs`:
```javascript
#!/usr/bin/env node
import { sql } from '@vercel/postgres';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node extract_interactors.mjs <protein_name_or_id>');
  process.exit(1);
}

const result = await sql`
  SELECT
    CASE WHEN bait.gene_name = ${target} OR bait.uniprot_id = ${target}
         THEN prey.uniprot_id ELSE bait.uniprot_id END as uniprot_id,
    CASE WHEN bait.gene_name = ${target} OR bait.uniprot_id = ${target}
         THEN prey.gene_name ELSE bait.gene_name END as gene_name,
    i.iptm, i.confidence, i.contacts_pae_lt_3, i.interface_plddt
  FROM interactions i
  JOIN proteins bait ON i.bait_protein_id = bait.id
  JOIN proteins prey ON i.prey_protein_id = prey.id
  WHERE bait.gene_name = ${target} OR prey.gene_name = ${target}
     OR bait.uniprot_id = ${target} OR prey.uniprot_id = ${target}
  ORDER BY i.confidence DESC, i.iptm DESC
`;

console.log('Interactors for', target);
console.table(result.rows);

// Export as CSV
const csv = 'uniprot_id,gene_name,iptm,confidence,contacts,iplddt\n' +
  result.rows.map(r => `${r.uniprot_id},${r.gene_name},${r.iptm},${r.confidence},${r.contacts_pae_lt_3},${r.interface_plddt}`).join('\n');

require('fs').writeFileSync(`${target}_interactors.csv`, csv);
console.log(`\nExported to ${target}_interactors.csv`);
```

### Batch UniProt Fetch Script

Create `scripts/fetch_uniprot_functions.mjs`:
```javascript
#!/usr/bin/env node
import fetch from 'node-fetch';
import { readFileSync } from 'fs';

const uniprotIds = process.argv[2].split(',');

for (const id of uniprotIds) {
  const url = `https://rest.uniprot.org/uniprotkb/${id}.json?fields=gene_names,protein_name,cc_function,cc_pathway,go_p,go_c,go_f`;

  const response = await fetch(url);
  const data = await response.json();

  console.log(`\n=== ${id} ===`);
  console.log('Name:', data.proteinDescription?.recommendedName?.fullName?.value);
  console.log('Gene:', data.genes?.[0]?.geneName?.value);
  console.log('Function:', data.comments?.find(c => c.commentType === 'FUNCTION')?.texts?.[0]?.value);
  console.log('GO Biological Process:', data.goTerms?.filter(g => g.aspect === 'P').slice(0, 3).map(g => g.goTerm).join(', '));

  await new Promise(r => setTimeout(r, 1000)); // Rate limit
}
```

---

## Example Use Case: Analyzing RRP7A Interactors

**Step 1: Extract**
```bash
node extract_interactors.mjs RRP7A
# Output: 68 interactors found
```

**Step 2: Categorize by confidence**
- High: 23 interactors (focus here)
- Medium: 20 interactors (secondary)
- Low: 25 interactors (exploratory)

**Step 3: Functional grouping (High confidence)**
- **RAB GTPases**: RAB5A, RAB5B, RAB5C, RAB8A, RAB8B, RAB1A, RAB10, RAB21, RAB34
  - **Function**: Vesicular trafficking, endocytosis
  - **GO**: "GTPase activity", "vesicle-mediated transport"
  - **Interpretation**: RRP7A may have a role in vesicle trafficking

- **RIN1**: RAB5 effector, endocytic pathway
  - **Function**: Regulates RAB5 activity
  - **Links to**: Multiple RAB proteins above
  - **Interpretation**: Supports vesicular trafficking hypothesis

- **NOL6**: Nucleolar protein, rRNA processing
  - **Function**: Ribosome biogenesis
  - **Location**: Nucleolus
  - **Interpretation**: RRP7A's canonical role (rRNA processing)

- **SEC23B/SEC24A**: COPII complex components
  - **Function**: ER-to-Golgi trafficking
  - **Pathway**: "Protein export from ER"
  - **Interpretation**: Early secretory pathway involvement

**Step 4: Pathway enrichment**
- **Vesicle-mediated transport** (p = 1.2e-8) - HIGHLY ENRICHED
- **Protein transport** (p = 3.4e-6)
- **rRNA processing** (p = 0.02)

**Step 5: Biological interpretation**
> **RRP7A interacts primarily with vesicular trafficking machinery**, particularly RAB GTPases and their effectors. This suggests a novel role beyond its known nucleolar function. The presence of COPII complex components (SEC23B/SEC24A) indicates potential involvement in ER-to-Golgi transport. The interaction with NOL6 validates its established role in ribosome biogenesis.

**Recommendation:** Validate RAB protein interactions experimentally (co-IP, localization studies).

---

## Troubleshooting

### Issue: No clear functional pattern

**Possible reasons:**
1. Protein is multifunctional (legitimate)
2. Many false positives in Low confidence tier
3. Protein is a hub with diverse interactions
4. Novel protein with unknown function

**Solutions:**
- Focus on High confidence only
- Check if protein has known domains/motifs
- Look for interactors that form complexes with each other (network modules)

### Issue: All interactors are from one pathway

**Check:**
- Is this a bait bias? (Was the prey library enriched for this pathway?)
- Is this organism-specific? (Human vs. Chlamydomonas difference)
- Is this condition-specific? (Some interactions only occur under certain conditions)

---

## Future Enhancements

1. **Automated pathway enrichment**: Integrate STRING/Enrichr API calls
2. **Network visualization**: Generate interaction networks with pathways colored
3. **Comparative analysis**: Compare interactors across homologs (Human vs. Cr)
4. **Temporal analysis**: Track how interactions change across different datasets
5. **Machine learning**: Predict function from interaction patterns

---

## Key Takeaways

****Always start with High confidence** interactions for interpretation
****Use multiple databases** (UniProt, STRING, GO) for comprehensive view
****Look for functional themes** - groups of related proteins are more meaningful than individual hits
****Validate against literature** - check if findings match known biology
****Consider structural metrics** - iPTM, contacts, ipLDDT give quality indicators
****Generate hypotheses** - use findings to guide experimental work
****Document caveats** - be transparent about AF2/AF3 limitations

---

## Resources

**Databases:**
- UniProt: https://www.uniprot.org/
- STRING: https://string-db.org/
- Enrichr: https://maayanlab.cloud/Enrichr/
- Gene Ontology: http://geneontology.org/
- KEGG: https://www.genome.jp/kegg/
- Reactome: https://reactome.org/
- CORUM (complexes): https://mips.helmholtz-muenchen.de/corum/
- BioGRID: https://thebiogrid.org/

**APIs:**
- UniProt REST API: https://www.uniprot.org/help/api
- STRING API: https://string-db.org/help/api/
- Enrichr API: https://maayanlab.cloud/Enrichr/help#api

**Chlamydomonas-specific:**
- ChlamyFP: https://chlamyfp.org/
- Phytozome: https://phytozome-next.jgi.doe.gov/

---

*Last updated: 2025-10-12*
*Associated with: Protoview (https://ciliaaf3predictions.vercel.app/)*
