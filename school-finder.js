// School Finder JavaScript


const KEYWORDS = [
  // Norwegian
  'grunn', 'grunnskole', 'barneskole', 'folkeskole',
  // English
  'primary', 'elementary', 'primary school', 'elementary school', 'junior school',
  // Danish/Swedish
  'grund', 'grundskole', 'grundskola',
  // German
  'grundschule',
  // French
  'école primaire', 'primaire',
  // Spanish
  'primaria', 'escuela primaria',
  // Portuguese
  'escola primária', 'primário',
  // Italian
  'scuola primaria', 'primaria',
  // Dutch
  'basisschool',
  // Russian
  'начальная школа', 'школа',
  // Chinese (Simplified)
  '小学', '初等学校',
  // Chinese (Traditional)
  '小學', '初等學校',
  // Japanese
  '小学校', 'しょうがっこう',
  // Korean
  '초등학교',
  // Arabic
  'المدرسة الابتدائية', 'ابتدائي',
  // Hindi
  'प्राथमिक विद्यालय', 'प्राथमिक स्कूल',
  // Turkish
  'ilkokul', 'temel eğitim',
  // Greek
  'δημοτικό σχολείο',
  // Polish
  'szkoła podstawowa',
  // Czech/Slovak
  'základní škola', 'základná škola',
  // Finnish
  'peruskoulu', 'alakoulu',
  // Hungarian
  'általános iskola',
  // Romanian
  'școala primară', 'școala elementară',
  // Swedish
  'grundskola', 'lågstadium',
  // International variations
  'international school', 'bilingual school'
];


let allSchools = [];
let currentCity = '';

// DOM Elements
const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const errorDiv = document.getElementById('error');
const loadingDiv = document.getElementById('loading');
const resultsDiv = document.getElementById('results');
const emptyStateDiv = document.getElementById('emptyState');
const schoolsGrid = document.getElementById('schoolsGrid');
const schoolCount = document.getElementById('schoolCount');
const cityName = document.getElementById('cityName');
const filterBtn = document.getElementById('filterBtn');
const filtersDiv = document.getElementById('filters');
const typeFilter = document.getElementById('typeFilter');
const nameSearch = document.getElementById('nameSearch');
const exportBtn = document.getElementById('exportBtn');

// Event Listeners
searchBtn.addEventListener('click', handleSearch);
cityInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSearch();
});
filterBtn.addEventListener('click', () => {
  filtersDiv.classList.toggle('show');
});
typeFilter.addEventListener('change', applyFilters);
nameSearch.addEventListener('input', applyFilters);
exportBtn.addEventListener('click', exportCSV);

// Geocode city using Photon API
async function geocodeCity(city) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(city)}&limit=1`;
  const res = await fetch(url);
  
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data = await res.json();
  if (!data.features?.length) throw new Error('City not found');

  const feature = data.features[0];
  const [lon, lat] = feature.geometry.coordinates;
  const delta = 0.15;
  
  return { 
    lat, 
    lon, 
    bbox: [lon - delta, lat - delta, lon + delta, lat + delta],
    name: feature.properties.name || city
  };
}

// Build Overpass query
function buildOverpassQuery(bbox) {
  const bboxStr = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  const nameFilters = KEYWORDS.map(k => 
    `node["name"~"${k}",i](${bboxStr});way["name"~"${k}",i](${bboxStr});relation["name"~"${k}",i](${bboxStr});`
  ).join('\n');
  
  return `
    [out:json][timeout:60];
    (
      node["amenity"="school"](${bboxStr});
      way["amenity"="school"](${bboxStr});
      relation["amenity"="school"](${bboxStr});
      node["building"="school"](${bboxStr});
      way["building"="school"](${bboxStr});
      relation["building"="school"](${bboxStr});
      node["education"="school"](${bboxStr});
      way["education"="school"](${bboxStr});
      relation["education"="school"](${bboxStr});
      node["school:type"](${bboxStr});
      way["school:type"](${bboxStr});
      relation["school:type"](${bboxStr});
      ${nameFilters}
    );
    out center tags qt;
  `;
}

// Query Overpass API
async function queryOverpass(query) {
  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter'
  ];

  for (const url of servers) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) continue;
      return await res.json();
    } catch (err) {
      console.warn(`Failed on ${url}:`, err.message);
    }
  }
  throw new Error('All Overpass servers failed');
}

function detectType(tags) {
  if (!tags) return 'Unknown';

  const name = (tags.name || '').toLowerCase();
  const operator = (tags.operator || '').toLowerCase();
  const ownership = (tags.ownership || '').toLowerCase();
  const isced = (tags['isced:level'] || '').toLowerCase();
  const schoolType = (tags['school:type'] || '').toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();

  // Explicit tags first
  if (['public', 'government', 'state', 'municipal', 'kommunal'].includes(operator) || 
      ['public', 'government', 'state', 'municipal', 'kommunal'].includes(ownership) ||
      ['public'].includes(schoolType)) return 'Public';

  if (['private', 'independent', 'foundation', 'charter', 'mission', 'religious'].includes(operator) || 
      ['private', 'independent', 'foundation', 'charter', 'mission', 'religious'].includes(ownership) ||
      ['private'].includes(schoolType)) return 'Private';

  // Name hints (worldwide)
  const privateHints = [
    'privat', 'privée', 'private', 'independent', 'foundation', 'montessori',
    'friskole', 'waldorf', 'steiner', 'bilingual', 'international', 'charter',
    'boarding', 'religious', 'mission', 'catholic', 'christian', 'islamic', 'jewish'
  ];

  const publicHints = [
    'kommune', 'municipal', 'fylkeskommune', 'public', 'government', 'state',
    'statlig', 'offentlig', 'community', 'city', 'county', 'regional', 'district',
    'national', 'folkeskole', 'grunnskole', 'primary', 'elementary', 'secondary',
    'comprehensive', 'gymnasium', 'lycée', 'liceo', 'szkoła podstawowa', 'peruskoulu'
  ];

  if (privateHints.some(h => name.includes(h) || operator.includes(h) || ownership.includes(h))) return 'Private';
  if (publicHints.some(h => name.includes(h) || operator.includes(h) || ownership.includes(h))) return 'Public';

  // ISCED hint: Level 1 = primary (usually public)
  if (isced && ['1'].some(level => isced.includes(level))) return 'Public';

  // Fallback based on amenity/building tag
  if (amenity === 'school' || tags.building === 'school') return 'Unknown';

  return 'Unknown';
}

// Extract principal information
function extractPrincipal(tags) {
  if (!tags) return '';

  const personKeys = [
    'contact:person', 'contact:name', 'operator:person', 'operator:name', 'operator:contact',
    'headteacher', 'principal', 'headmaster', 'head_teacher', 'head_master',
    'school:principal', 'school:headmaster', 'school:head_teacher', 'head', 'director',
    'school:director', 'leadership', 'management:person',
    'rektor', 'skolerektor', 'skolebestyrer', 'skoleleder', 'skolesjef',
    'inspektør', 'undervisningsinspektør', 'avdelingsleder', 'studierektor', 'assisterende rektor',
    'school:rektor', 'contact:rektor', 'operator:rektor', 'name:rektor',
    'school:skoleleder', 'contact:skoleleder', 'contact', 'contact:details',
    'description', 'operator', 'operator:description'
  ];

  const nameTags = ['name', 'alt_name', 'official_name', 'short_name'];
  for (const nameTag of nameTags) {
    const name = tags[nameTag];
    if (name && typeof name === 'string') {
      const lower = name.toLowerCase();
      if (lower.includes('rektor:') || lower.includes('principal:') || lower.includes('head:')) {
        const match = name.match(/(?:rektor|principal|head):\s*([^,;]+)/i);
        if (match) return match[1].trim();
      }
    }
  }

  for (const key of personKeys) {
    const v = tags[key];
    if (v && typeof v === 'string') {
      const cleaned = v.trim();
      if (
        cleaned &&
        !cleaned.includes('http') &&
        !cleaned.includes('www.') &&
        !cleaned.includes('@') &&
        !cleaned.match(/^\+?\d[\d\s-]+$/)
      ) {
        return cleaned;
      }
    }
  }

  const descriptionTags = ['description', 'contact:details', 'operator:description'];
  for (const key of descriptionTags) {
    const desc = tags[key];
    if (desc && typeof desc === 'string') {
      const lower = desc.toLowerCase();
      if (
        lower.includes('rektor') ||
        lower.includes('principal') ||
        lower.includes('head teacher') ||
        lower.includes('skoleleder')
      ) {
        const parts = desc.split(/[.,;:\n]/);
        for (const part of parts) {
          if (
            part.toLowerCase().includes('rektor') ||
            part.toLowerCase().includes('principal') ||
            part.toLowerCase().includes('head teacher') ||
            part.toLowerCase().includes('skoleleder')
          ) {
            return part.trim();
          }
        }
      }
    }
  }

  return '';
}


// Show error message
function showError(message) {
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

// Main search handler
async function handleSearch() {
  const city = cityInput.value.trim();
  
  if (!city) {
    showError('Please enter a city name');
    return;
  }

  // Reset state
  errorDiv.style.display = 'none';
  loadingDiv.style.display = 'block';
  resultsDiv.classList.remove('show');
  emptyStateDiv.style.display = 'none';
  allSchools = [];
  currentCity = city;

  try {
    // Geocode city
    const cityInfo = await geocodeCity(city);
    cityName.textContent = cityInfo.name;
    
    // Build and execute query
    const query = buildOverpassQuery(cityInfo.bbox);
    const result = await queryOverpass(query);

    const elements = result.elements || [];
    
    // Process schools
    const seen = new Set();
    allSchools = elements
      .filter(el => {
        const tags = el.tags || {};
        const name = (tags.name || '').toLowerCase();
        const amenity = tags.amenity || '';
        const building = tags.building || '';
        return (
          amenity === 'school' ||
          building === 'school' ||
          tags.education ||
          tags['school:type'] ||
          KEYWORDS.some(k => name.includes(k))
        );
      })
      .map(el => {
        const tags = el.tags || {};
        const name = tags.name || 'Unnamed School';
        const website = tags.website || tags['contact:website'] || '';
        const type = detectType(tags);
        const principal = extractPrincipal(tags);

        // Exclude VGS, college, high schools, and anything after primary/elementary
        const lowerName = name.toLowerCase();
        if (
          lowerName.includes('vgs') || 
          lowerName.includes('college') || 
          lowerName.includes('high school') || 
          lowerName.includes('secondary') || 
          lowerName.includes('videregående') ||
          lowerName.includes('gymnasium')
        ) {
          return null;
        }

        if (seen.has(lowerName)) return null;
        seen.add(lowerName);

        return { name, website, type, principal };
      })
      .filter(Boolean);


    loadingDiv.style.display = 'none';

    if (allSchools.length === 0) {
      showError('No schools found in this city');
      emptyStateDiv.style.display = 'block';
      return;
    }

    // Display results
    resultsDiv.classList.add('show');
    applyFilters();

  } catch (err) {
    loadingDiv.style.display = 'none';
    showError(err.message || 'An error occurred while searching');
    emptyStateDiv.style.display = 'block';
  }
}

// Apply filters and render schools
function applyFilters() {
  const typeValue = typeFilter.value.toLowerCase();
  const searchValue = nameSearch.value.toLowerCase();

  const filtered = allSchools.filter(school => {
    const matchesType = typeValue === 'all' || school.type.toLowerCase() === typeValue;
    const matchesSearch = school.name.toLowerCase().includes(searchValue);
    return matchesType && matchesSearch;
  });

  schoolCount.textContent = filtered.length;
  renderSchools(filtered);
}

// Render schools to the grid
function renderSchools(schools) {
  if (schools.length === 0) {
    schoolsGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #718096;">No schools match your filters</div>';
    return;
  }

  schoolsGrid.innerHTML = schools.map(school => {
    const badgeClass = `badge-${school.type.toLowerCase()}`;
    
    return `
      <div class="school-card">
        <div class="school-header">
          <div class="school-info">
            <div class="school-name">${escapeHtml(school.name)}</div>
            <div class="school-details">
              ${school.website ? `
                <div class="school-detail">
                  <svg xmlns="http://www.w3.org/2000/svg" height="17px" viewBox="0 -960 960 960" width="17px" fill="#d30aac"><path d="M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z"/></svg>
                  <a href="${escapeHtml(school.website)}" target="_blank" rel="noopener">${escapeHtml(school.website)}</a>
                </div>
              ` : ''}
              ${school.principal ? `
                <div class="school-detail">
                  <svg xmlns="http://www.w3.org/2000/svg" height="17px" viewBox="0 -960 960 960" width="17px" fill="#000000"><path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z"/></svg>
                  ${escapeHtml(school.principal)}
                </div>
              ` : ''}
            </div>
          </div>
          <div class="badge ${badgeClass}">${school.type}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Export to CSV
function exportCSV() {
  const typeValue = typeFilter.value.toLowerCase();
  const searchValue = nameSearch.value.toLowerCase();

  const filtered = allSchools.filter(school => {
    const matchesType = typeValue === 'all' || school.type.toLowerCase() === typeValue;
    const matchesSearch = school.name.toLowerCase().includes(searchValue);
    return matchesType && matchesSearch;
  });

  const headers = ['School Name', 'Website', 'Type', 'Principal'];
  const rows = filtered.map(s => [
    s.name,
    s.website,
    s.type,
    s.principal
  ]);
  
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentCity.replace(/[^a-z0-9]/gi, '_')}_schools.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}