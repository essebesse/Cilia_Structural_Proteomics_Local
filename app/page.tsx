'use client';

import { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Card, Spinner, Table, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { NetworkVisualization } from '../components/NetworkVisualization';

// Define types for our data
interface ValidationData {
  validated: boolean;
  method: string;
  source: string;
  date: string;
  notes?: string | null;
  source_file?: string | null;
}

interface InteractionData {
  bait_uniprot: string;
  bait_gene: string;
  bait_organism?: string;
  bait_organism_code?: string;
  bait_common_name?: string;
  prey_uniprot: string;
  prey_gene: string;
  prey_organism?: string;
  prey_organism_code?: string;
  prey_common_name?: string;
  confidence: string | null;
  iptm: number;
  contacts_pae_lt_3?: number;
  contacts_pae_lt_6?: number;
  interface_plddt?: number;
  alphafold_version: string;
  ipsae?: number | null;
  ipsae_confidence?: string | null;
  ipsae_pae_cutoff?: number | null;
  analysis_version?: string | null;
  experimental_validation?: ValidationData | null;
}

export default function Home() {
  const [searchTerm, setSearchTerm] = useState('Q8NEZ3'); // Default search term for demo
  const [interactions, setInteractions] = useState([]);
  const [secondaryInteractions, setSecondaryInteractions] = useState([]);
  const [secondaryProtein, setSecondaryProtein] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<'v3' | 'ipsae'>('v3');
  const [confidenceFilters, setConfidenceFilters] = useState({
    'High': true,
    'Medium': true,
    'Low': true,
    'AF2': true,
  });
  const [ipsaeFilters, setIpsaeFilters] = useState({
    'High': true,
    'Medium': true,
    'Low': true,  // Low/Ambiguous ON by default
  });
  const [baitProteins, setBaitProteins] = useState([]);
  const [selectedBait, setSelectedBait] = useState('');
  const [networkDimensions, setNetworkDimensions] = useState({ width: 450, height: 620 });

  // Complex-related state
  const [searchMode, setSearchMode] = useState<'protein' | 'complex'>('protein');
  const [complexes, setComplexes] = useState([]);
  const [selectedComplex, setSelectedComplex] = useState('');
  const [currentComplexInfo, setCurrentComplexInfo] = useState<any>(null);

  const fetchBaitProteins = async () => {
    try {
      const res = await fetch(`/api/baits?mode=${filterMode}`);
      if (res.ok) {
        const data = await res.json();
        setBaitProteins(data.baits || []);
      }
    } catch (error) {
      console.error('Failed to fetch bait proteins:', error);
    }
  };

  const fetchComplexes = async () => {
    try {
      const res = await fetch(`/api/complexes?mode=${filterMode}`);
      if (res.ok) {
        const data = await res.json();
        setComplexes(data.complexes || []);
      }
    } catch (error) {
      console.error('Failed to fetch complexes:', error);
    }
  };

  const handleBaitSelection = (baitId: string) => {
    setSelectedBait(baitId);
    setSearchTerm(baitId);
    setSearchMode('protein');
    setSelectedComplex('');
    setCurrentComplexInfo(null); // Clear complex info when switching to protein mode
    setSecondaryInteractions([]); // Clear secondary when changing main search
    setSecondaryProtein('');
  };

  const handleComplexSelection = async (complexName: string) => {
    setSelectedComplex(complexName);
    setSelectedBait('');
    setSearchMode('complex');
    setSecondaryInteractions([]);
    setSecondaryProtein('');

    if (!complexName) {
      setInteractions([]);
      setCurrentComplexInfo(null);
      return;
    }

    // Fetch complex interactions
    setLoading(true);

    try {
      const cacheBuster = Date.now();

      // Build URL with mode parameter for v4 filtering
      let url = `/api/complex-interactions/${complexName}?t=${cacheBuster}&mode=${filterMode}`;

      // Add confidence filters
      const activeFilters = filterMode === 'ipsae' ? ipsaeFilters : confidenceFilters;
      const enabledLevels = Object.entries(activeFilters)
        .filter(([_, enabled]) => enabled)
        .map(([level]) => level)
        .join(',');

      if (enabledLevels) {
        url += `&confidence=${enabledLevels}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const response = await res.json();
        setCurrentComplexInfo(response.complex);

        // For v4 mode, API filters by ipSAE confidence (accurate server-side)
        // For v3 mode, ALWAYS apply client-side filtering (recalculates confidence from metrics)
        let data = response.interactions || [];

        // Apply client-side filtering in v3 mode (server returns all v3 data)
        // v4 mode is already filtered by API based on ipSAE confidence
        if (filterMode === 'v3') {
          data = data.filter((inter: any) => {
            const level = getConfidenceLevel(inter);
            return activeFilters[level as keyof typeof activeFilters];
          });
        }

        // Auto-detect optimal mode: If ALL interactions have ipSAE scores (v4 data),
        // and we're in v3 mode, suggest switching to v4
        if (filterMode === 'v3' && response.interactions && response.interactions.length > 0) {
          const allHaveIpsae = response.interactions.every((i: any) => i.ipsae !== null && i.analysis_version === 'v4');
          if (allHaveIpsae) {
            console.log('Complex has only v4 (ipSAE) data, auto-switching to ipSAE mode');
            setFilterMode('ipsae');
            // Will trigger re-fetch via useEffect
            return;
          }
        }

        setInteractions(data);
      }
    } catch (error) {
      console.error('Failed to fetch complex interactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = async (nodeId: string, nodeName: string) => {
    setSecondaryLoading(true);
    setSecondaryProtein(nodeId);

    try {
      const cacheBuster = Date.now();

      // Build URL with mode and confidence filters
      const activeFilters = filterMode === 'ipsae' ? ipsaeFilters : confidenceFilters;
      const enabledLevels = Object.entries(activeFilters)
        .filter(([_, enabled]) => enabled)
        .map(([level]) => level)
        .join(',');

      let url = `/api/interactions/${nodeId}?t=${cacheBuster}&mode=${filterMode}`;
      if (enabledLevels) {
        url += `&confidence=${enabledLevels}`;
      }

      const res = await fetch(url);

      if (res.ok) {
        const response = await res.json();
        let data = response.interactions || response;

        // Client-side filtering based on dynamically calculated confidence
        data = data.filter((inter: any) => {
          const level = getConfidenceLevel(inter);
          return confidenceFilters[level as keyof typeof confidenceFilters];
        });

        setSecondaryInteractions(data);
      }
    } catch (error) {
      console.error('Failed to fetch secondary interactions:', error);
    } finally {
      setSecondaryLoading(false);
    }
  };

  const getProteinDisplayName = (inter: any, isProtein: 'bait' | 'prey', includeTooltip: boolean = false) => {
    const prefix = isProtein;
    const commonName = inter[`${prefix}_common_name`];
    const geneName = inter[`${prefix}_gene`];
    const organismCode = inter[`${prefix}_organism_code`];

    // For display, use gene name (potentially truncated)
    // common_name stores full description for tooltips
    const displayName = geneName;
    const organismPrefix = organismCode ? `${organismCode}:` : '';

    const fullDisplayName = `${organismPrefix}${displayName}`;

    // If tooltip requested and name is truncated, render with tooltip
    if (includeTooltip && displayName && displayName.endsWith('...') && commonName) {
      return (
        <>
          {organismPrefix}
          {renderGeneNameWithTooltip(displayName, commonName)}
        </>
      );
    }

    return fullDisplayName;
  };

  const getProteinLink = (uniprotId: string, organismCode?: string) => {
    // Guard against undefined/null values
    if (!uniprotId) {
      return '#';
    }

    // Remove AF2_ prefix if present
    const cleanId = uniprotId.startsWith('AF2_') ? uniprotId.substring(4) : uniprotId;

    // Only use ChlamyFP for CRE-formatted gene IDs (Phytozome format)
    if (cleanId.startsWith('Cre') || cleanId.startsWith('cre') || cleanId.startsWith('CRE')) {
      // Convert CRE11_G475000_T1_1 to Cre11.g475000.t1.1 format for ChlamyFP
      const chlamyFPId = cleanId.replace(/_/g, '.').replace(/CRE/i, 'Cre');
      return `https://chlamyfp.org/ChlamyFPv2/cr_info_sql.php?id=${encodeURIComponent(chlamyFPId)}`;
    }
    // For all other proteins (including Chlamydomonas UniProt IDs), use UniProt
    return `https://www.uniprot.org/uniprotkb/${cleanId}`;
  };

  // Render gene name with tooltip if truncated
  const renderGeneNameWithTooltip = (displayName: string, fullDescription?: string) => {
    // If name ends with "..." and we have a full description, show tooltip
    if (displayName.endsWith('...') && fullDescription) {
      return (
        <OverlayTrigger
          placement="top"
          overlay={<Tooltip id={`tooltip-${displayName}`}>{fullDescription}</Tooltip>}
        >
          <span style={{ cursor: 'help', borderBottom: '1px dotted #999' }}>
            {displayName}
          </span>
        </OverlayTrigger>
      );
    }
    return displayName;
  };

  const handleSearch = async () => {
    if (!searchTerm) return;
    setLoading(true);

    // Clear complex info when doing manual search (protein mode)
    setSearchMode('protein');
    setSelectedComplex('');
    setCurrentComplexInfo(null);

    try {
      console.log('Fetching data for:', searchTerm);
      const cacheBuster = Date.now();

      // Build URL with mode and confidence filters
      const activeFilters = filterMode === 'ipsae' ? ipsaeFilters : confidenceFilters;
      const enabledLevels = Object.entries(activeFilters)
        .filter(([_, enabled]) => enabled)
        .map(([level]) => level)
        .join(',');

      let url = `/api/interactions/${searchTerm}?t=${cacheBuster}&mode=${filterMode}`;
      if (enabledLevels) {
        url += `&confidence=${enabledLevels}`;
      }
      console.log('Full URL:', url);

      const res = await fetch(url);
      console.log('Response status:', res.status);
      console.log('Response ok:', res.ok);

      if (!res.ok) {
        // Get the error response body
        const errorText = await res.text();
        console.error('Error response body:', errorText);
        throw new Error(`HTTP error! status: ${res.status}, body: ${errorText.substring(0, 200)}`);
      }

      const response = await res.json();
      console.log('Received response:', response);

      // Handle the new API response structure
      let data = response.interactions || response;

      if (!Array.isArray(data)) {
        throw new Error('Expected interactions array, got: ' + typeof data);
      }

      console.log('Processing interactions:', data.length);

      // Client-side filtering based on dynamically calculated confidence
      data = data.filter((inter: any) => {
        const level = getConfidenceLevel(inter);
        return confidenceFilters[level as keyof typeof confidenceFilters];
      });

      setInteractions(data as any);

    } catch (error) {
      console.error("Failed to fetch interactions:", error);
      alert('Error fetching data: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch data when v3 filters change (only in v3 mode)
  useEffect(() => {
    if (filterMode !== 'v3') return;

    if (searchMode === 'complex' && selectedComplex) {
      handleComplexSelection(selectedComplex);
    } else if (searchMode === 'protein' && searchTerm) {
      handleSearch();
    }
  }, [confidenceFilters]);

  // Re-fetch data when v4 filters change (only in v4 mode)
  useEffect(() => {
    if (filterMode !== 'ipsae') return;

    if (searchMode === 'complex' && selectedComplex) {
      handleComplexSelection(selectedComplex);
    } else if (searchMode === 'protein' && searchTerm) {
      handleSearch();
    }
  }, [ipsaeFilters]);

  // Re-fetch data when mode changes (v3 ↔ v4)
  useEffect(() => {
    if (searchMode === 'complex' && selectedComplex) {
      handleComplexSelection(selectedComplex);
    } else if (searchMode === 'protein' && searchTerm) {
      handleSearch();
    }
  }, [filterMode]);

  // Handle responsive sizing
  useEffect(() => {
    const updateDimensions = () => {
      setNetworkDimensions({
        width: Math.max(350, window.innerWidth * 0.37),
        height: Math.max(300, window.innerHeight * 0.4)
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Fetch data on initial load
  useEffect(() => {
    fetchBaitProteins();
    fetchComplexes();
    handleSearch();
  }, []);

  // Re-fetch dropdown lists when mode changes (to show accurate counts)
  useEffect(() => {
    fetchBaitProteins();
    fetchComplexes();
  }, [filterMode]);

  // Auto-search when bait protein is selected
  useEffect(() => {
    if (selectedBait && searchMode === 'protein') {
      handleSearch();
    }
  }, [selectedBait]);

  // Update secondary interactions when confidence filters change
  useEffect(() => {
    if (secondaryProtein && secondaryInteractions.length > 0) {
      // Re-fetch secondary interactions to apply new filters
      handleNodeClick(secondaryProtein, secondaryProtein);
    }
  }, [confidenceFilters]);

  // Get confidence level from database (calculated at import/migration time)
  const getConfidenceLevel = (inter: any): string => {
    // In v4 mode, use ipSAE confidence
    if (filterMode === 'ipsae' && inter.ipsae_confidence) {
      return inter.ipsae_confidence;
    }

    // AF2 predictions have NULL confidence - display as "AF2"
    if (inter.alphafold_version === 'AF2') {
      return 'AF2';
    }

    // For AF3 in v3 mode, recalculate confidence based on metrics
    // (don't rely on database value which might be in old format)
    const iptm = parseFloat(inter.iptm) || 0;
    const contacts = parseInt(inter.contacts_pae_lt_3) || 0;
    const ipLDDT = parseFloat(inter.interface_plddt) || 0;

    // HIGH CONFIDENCE
    const meetsHighCriteria =
      iptm >= 0.7 ||
      (contacts >= 40 && ipLDDT >= 80) ||
      (contacts >= 30 && iptm >= 0.5 && ipLDDT >= 80);

    const isExcludedFromHigh = iptm < 0.75 && contacts < 5;

    if (meetsHighCriteria && !isExcludedFromHigh) {
      return 'High';
    }

    // MEDIUM CONFIDENCE
    if (
      iptm >= 0.6 ||
      (contacts >= 20 && ipLDDT >= 75) ||
      (contacts >= 15 && iptm >= 0.45)
    ) {
      return 'Medium';
    }

    // LOW CONFIDENCE
    return 'Low';
  };

  const confidenceColors: { [key: string]: string } = {
    'High': '#28a745',                     // Green
    'Medium': '#ffc107',                   // Orange
    'Low': '#dc3545',                      // Red
    'AF2': '#6c757d',                      // Gray
  };

  return (
    <Container fluid className="p-4 bg-light">
      <Row>
        <Col md={3}>
          <Card className="shadow-sm" style={{ height: '40vh' }}>
            <Card.Body style={{ height: '100%', overflowY: 'auto' }}>
              <Form.Group className="mb-3">
                <Form.Label>Select Bait Protein</Form.Label>
                <Form.Select
                  value={selectedBait}
                  onChange={(e) => handleBaitSelection(e.target.value)}
                  className="mb-2"
                >
                  <option value="">Choose a bait protein...</option>
                  {baitProteins.map((bait: any) => (
                    <option key={bait.uniprot_id} value={bait.uniprot_id}>
                      {bait.organism_code ? `${bait.organism_code}:` : ''}{bait.gene_name} ({bait.uniprot_id}) - {bait.interaction_count} interactions
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  Select from {baitProteins.length} available bait proteins
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Select Protein Complex</Form.Label>
                <Form.Select
                  value={selectedComplex}
                  onChange={(e) => handleComplexSelection(e.target.value)}
                  className="mb-2"
                >
                  <option value="">Choose a complex...</option>
                  {complexes.map((complex: any) => (
                    <option key={complex.id} value={complex.complex_name}>
                      {complex.display_name} ({complex.interaction_count} interactions)
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  Select from {complexes.length} available complexes
                </Form.Text>
                {currentComplexInfo && (
                  <div className="mt-2 p-2 bg-light border rounded">
                    <small className="text-muted">
                      <strong>Components:</strong><br />
                      {currentComplexInfo.proteins?.map((p: any, i: number) => (
                        <span key={i}>
                          {i > 0 && ' + '}
                          {p.organism_code && `${p.organism_code}:`}
                          {p.gene_name || p.uniprot_id} ({p.uniprot_id})
                        </span>
                      ))}
                    </small>
                  </div>
                )}
              </Form.Group>

              <hr />
              
              <Form onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
                <Form.Group className="mb-3">
                  <Form.Label>Search Protein</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="e.g., Q8NEZ3, WDR19, IFT27, 54, CCNO"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <Form.Text className="text-muted">
                    Search by UniProt ID, gene name, protein alias, IFT number, or user-defined name
                  </Form.Text>
                </Form.Group>
                <Button variant="primary" type="submit" className="w-100" disabled={loading}>Search</Button>
              </Form>

              <hr />

              <h5>Analysis Mode</h5>
              <Form className="mb-3">
                <Form.Check
                  type="radio"
                  id="mode-v3"
                  name="filterMode"
                  label="Interface Quality (v3)"
                  checked={filterMode === 'v3'}
                  onChange={() => setFilterMode('v3')}
                />
                <Form.Text className="text-muted d-block mb-2" style={{fontSize: '0.85em', marginLeft: '1.5em'}}>
                  iPTM + PAE contacts + interface pLDDT
                </Form.Text>

                <Form.Check
                  type="radio"
                  id="mode-ipsae"
                  name="filterMode"
                  label="ipSAE Scoring (v4)"
                  checked={filterMode === 'ipsae'}
                  onChange={() => setFilterMode('ipsae')}
                />
                <Form.Text className="text-muted d-block" style={{fontSize: '0.85em', marginLeft: '1.5em'}}>
                  More stringent, fewer false positives
                </Form.Text>
              </Form>

              <hr />

              <h5>Confidence Levels</h5>
              {filterMode === 'v3' ? (
                <Form>
                  {Object.keys(confidenceFilters).map(level => (
                    <Form.Check
                      key={level}
                      type="checkbox"
                      id={`check-${level}`}
                      label={level}
                      checked={(confidenceFilters as any)[level]}
                      onChange={(e) => setConfidenceFilters(prev => ({ ...prev, [level]: e.target.checked }))}
                    />
                  ))}
                </Form>
              ) : (
                <Form>
                  <Form.Check
                    type="checkbox"
                    id="ipsae-high"
                    label="High (>0.7)"
                    checked={ipsaeFilters.High}
                    onChange={(e) => setIpsaeFilters(prev => ({ ...prev, High: e.target.checked }))}
                  />
                  <Form.Text className="text-muted d-block mb-2" style={{fontSize: '0.8em', marginLeft: '1.5em'}}>
                    Strong evidence
                  </Form.Text>

                  <Form.Check
                    type="checkbox"
                    id="ipsae-medium"
                    label="Medium (0.5-0.7)"
                    checked={ipsaeFilters.Medium}
                    onChange={(e) => setIpsaeFilters(prev => ({ ...prev, Medium: e.target.checked }))}
                  />
                  <Form.Text className="text-muted d-block mb-2" style={{fontSize: '0.8em', marginLeft: '1.5em'}}>
                    Very promising
                  </Form.Text>

                  <Form.Check
                    type="checkbox"
                    id="ipsae-low"
                    label="Low (0.3-0.5)"
                    checked={ipsaeFilters.Low}
                    onChange={(e) => setIpsaeFilters(prev => ({ ...prev, Low: e.target.checked }))}
                  />
                  <Form.Text className="text-muted d-block" style={{fontSize: '0.8em', marginLeft: '1.5em'}}>
                    Ambiguous, needs inspection
                  </Form.Text>
                </Form>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col md={9}>
          <Row className="h-100">
            {/* Main Network */}
            <Col md={6}>
              <Card className="shadow-sm h-100">
                <Card.Body style={{ height: '40vh', position: 'relative', padding: '0' }}>
                  {loading ? (
                    <div className="d-flex justify-content-center align-items-center h-100">
                      <Spinner animation="border" variant="primary" />
                      <span className="ms-3">Loading...</span>
                    </div>
                  ) : interactions.length > 0 ? (
                    <NetworkVisualization
                      interactions={interactions}
                      width={networkDimensions.width}
                      height={networkDimensions.height}
                      onNodeClick={handleNodeClick}
                      title={searchMode === 'complex' && currentComplexInfo
                        ? `${currentComplexInfo.display_name} Interactions`
                        : `${searchTerm} Interactions`}
                      centerProtein={searchMode === 'complex' && currentComplexInfo
                        ? currentComplexInfo.complex_name
                        : searchTerm}
                      showLayoutControl={true}
                      legendType="nodes"
                    />
                  ) : (
                    <div className="d-flex justify-content-center align-items-center h-100">
                      <div className="text-center">
                        <h5>No interactions found</h5>
                        <p>{searchMode === 'complex' ? 'Select a complex' : `Search term: ${searchTerm}`}</p>
                        <p>{searchMode === 'complex' ? 'Choose a complex from the dropdown' : 'Click a bait protein to start'}</p>
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>

            {/* Secondary Network */}
            <Col md={6}>
              <Card className="shadow-sm h-100">
                <Card.Body style={{ height: '40vh', position: 'relative', padding: '0' }}>
                  {secondaryLoading ? (
                    <div className="d-flex justify-content-center align-items-center h-100">
                      <Spinner animation="border" variant="secondary" />
                      <span className="ms-3">Loading...</span>
                    </div>
                  ) : secondaryInteractions.length > 0 ? (
                    <NetworkVisualization
                      interactions={secondaryInteractions}
                      width={networkDimensions.width}
                      height={networkDimensions.height}
                      title={`${secondaryProtein} Interactions`}
                      centerProtein={secondaryProtein}
                      showLayoutControl={false}
                      legendType="edges"
                    />
                  ) : (
                    <div className="d-flex justify-content-center align-items-center h-100">
                      <div className="text-center">
                        <h5>Click a protein node</h5>
                        <p>Click any protein in the main network to see its interactions here</p>
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
      <Row className="mt-4">
        <Col>
          <Card className="shadow-sm">
            <Card.Header>Interaction Details</Card.Header>
            <Card.Body>
              <Table striped bordered hover responsive>
                <thead>
                  <tr>
                    <th>{searchMode === 'complex' ? 'Bait Complex' : 'Bait'}</th>
                    <th>Prey</th>
                    {filterMode === 'ipsae' && <th>ipSAE</th>}
                    <th>Confidence</th>
                    <th>iPTM</th>
                    <th>iPAE &lt;3Å</th>
                    <th>iPAE &lt;6Å</th>
                    <th>ipLDDT</th>
                    <th>AlphaFold</th>
                    <th>Experimental</th>
                  </tr>
                </thead>
                <tbody>
                  {interactions.map((inter: any, index) => (
                    <tr key={index}>
                      <td>
                        {searchMode === 'complex' && currentComplexInfo ? (
                          <span>
                            <strong>{currentComplexInfo.display_name}</strong>
                            <br />
                            <small className="text-muted">
                              {currentComplexInfo.proteins?.map((p: any) => p.gene_name).join(' + ')}
                            </small>
                          </span>
                        ) : (
                          <>
                            {getProteinDisplayName(inter, 'bait', true)} (
                            <a
                              href={getProteinLink(inter.bait_uniprot, inter.bait_organism_code)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-decoration-none"
                            >
                              {inter.bait_uniprot}
                            </a>
                            )
                          </>
                        )}
                      </td>
                      <td>
                        {getProteinDisplayName(inter, 'prey', true)} (
                        <a
                          href={getProteinLink(inter.prey_uniprot, inter.prey_organism_code)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-decoration-none"
                        >
                          {inter.prey_uniprot}
                        </a>
                        )
                      </td>
                      {filterMode === 'ipsae' && (
                        <td>
                          {inter.ipsae !== null && inter.ipsae !== undefined ? (
                            <strong style={{
                              color: inter.ipsae_confidence === 'High' ? '#28a745' :
                                     inter.ipsae_confidence === 'Medium' ? '#ffc107' : '#dc3545'
                            }}>
                              {inter.ipsae.toFixed(3)}
                            </strong>
                          ) : (
                            <span className="text-muted">N/A</span>
                          )}
                        </td>
                      )}
                      <td>
                        {(() => {
                          const level = filterMode === 'ipsae' && inter.ipsae_confidence
                            ? inter.ipsae_confidence
                            : getConfidenceLevel(inter);
                          const color = filterMode === 'ipsae' && inter.ipsae_confidence
                            ? (inter.ipsae_confidence === 'High' ? '#28a745' :
                               inter.ipsae_confidence === 'Medium' ? '#ffc107' : '#dc3545')
                            : (confidenceColors[level] || '#000');
                          return (
                            <span style={{ color }}>
                              ● {level}
                            </span>
                          );
                        })()}
                      </td>
                      <td>{inter.iptm.toFixed(2)}</td>
                      <td>
                        {inter.alphafold_version === 'AF2'
                          ? 'N/A'
                          : (inter.contacts_pae_lt_3 ?? 0)
                        }
                      </td>
                      <td>
                        {inter.alphafold_version === 'AF2'
                          ? 'N/A'
                          : (inter.contacts_pae_lt_6 ?? 0)
                        }
                      </td>
                      <td>{inter.interface_plddt ? inter.interface_plddt.toFixed(1) : 'N/A'}</td>
                      <td>
                        <span className={`badge ${inter.alphafold_version === 'AF3' ? 'bg-primary' : 'bg-secondary'}`}>
                          {inter.alphafold_version}
                        </span>
                      </td>
                      <td>
                        {inter.experimental_validation && inter.experimental_validation.validated ? (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip id={`validation-tooltip-${index}`}>
                                <div style={{ textAlign: 'left' }}>
                                  <strong>Method:</strong> {inter.experimental_validation.method}<br />
                                  <strong>Source:</strong> {inter.experimental_validation.source}<br />
                                  <strong>Date:</strong> {inter.experimental_validation.date}
                                  {inter.experimental_validation.notes && (
                                    <><br /><strong>Notes:</strong> {inter.experimental_validation.notes}</>
                                  )}
                                  {inter.experimental_validation.source_file && (
                                    <><br /><strong>Data File:</strong><br /><small>{inter.experimental_validation.source_file}</small></>
                                  )}
                                </div>
                              </Tooltip>
                            }
                          >
                            <span className="badge bg-success" style={{ cursor: 'pointer' }}>
                              ✓ Yes
                            </span>
                          </OverlayTrigger>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Bait Protein/Complex Source Paths Section */}
      {interactions.length > 0 && searchMode === 'protein' && (
        <Row className="mt-4">
          <Col>
            <Card className="shadow-sm">
              <Card.Header>Bait Protein Source Paths</Card.Header>
              <Card.Body>
                <Table striped bordered hover responsive size="sm">
                  <thead>
                    <tr>
                      <th>Bait Protein</th>
                      <th>Source Folder Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(
                      new Map(
                        interactions
                          .filter((inter: any) => inter.bait_uniprot) // Only show if bait_uniprot exists
                          .map((inter: any) => [
                            inter.bait_uniprot,
                            {
                              gene: inter.bait_gene,
                              uniprot: inter.bait_uniprot,
                              path: inter.source_path
                            }
                          ])
                      ).values()
                    )
                    .filter((bait: any) => bait && bait.uniprot) // Extra safety: ensure bait and uniprot exist
                    .map((bait: any, index) => (
                      <tr key={index}>
                        <td>
                          <strong>{bait.gene || bait.uniprot}</strong> (
                          <a
                            href={getProteinLink(bait.uniprot)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-decoration-none"
                          >
                            {bait.uniprot}
                          </a>
                          )
                        </td>
                        <td>
                          <code className="text-muted small">
                            {bait.path || 'N/A'}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Complex Source Paths Section */}
      {interactions.length > 0 && searchMode === 'complex' && currentComplexInfo && (
        <Row className="mt-4">
          <Col>
            <Card className="shadow-sm">
              <Card.Header>Complex Source Paths</Card.Header>
              <Card.Body>
                <Table striped bordered hover responsive size="sm">
                  <thead>
                    <tr>
                      <th>Complex</th>
                      <th>Source Folder Paths</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>{currentComplexInfo.display_name}</strong>
                        <br />
                        <small className="text-muted">
                          {currentComplexInfo.proteins?.map((p: any) =>
                            `${p.organism_code}:${p.gene_name}`
                          ).join(' + ')}
                        </small>
                      </td>
                      <td>
                        {Array.from(new Set(interactions.map((i: any) => i.source_path))).map((path: any, idx: number) => (
                          <div key={idx}>
                            <code className="text-muted small">{path}</code>
                          </div>
                        ))}
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </Container>
  );
}
