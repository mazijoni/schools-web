// ==================== CONFIG ====================
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

// ==================== DOM ====================
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

// ==================== EVENTS ====================
searchBtn.addEventListener('click', handleSearch);
cityInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });
filterBtn.addEventListener('click', () => { filtersDiv.classList.toggle('show'); });
typeFilter.addEventListener('change', applyFilters);
nameSearch.addEventListener('input', applyFilters);
exportBtn.addEventListener('click', exportCSV);

// ==================== SEARCH FLOW ====================
async function handleSearch() {
  const city = cityInput.value.trim();
  if (!city) return showError('Please enter a city name');

  errorDiv.style.display = 'none';
  loadingDiv.style.display = 'block';
  resultsDiv.classList.remove('show');
  emptyStateDiv.style.display = 'none';
  allSchools = [];
  currentCity = city;

  try {
    // 1️⃣ Geocode city
    const cityInfo = await geocodeCity(city);
    cityName.textContent = cityInfo.name;

    // 2️⃣ Try Overpass (Norway/local) first
    let result = await queryOverpass(buildOverpassQuery(cityInfo.bbox));
    allSchools = parseOverpassResults(result);

    // 3️⃣ If nothing found, fallback to SerpAPI
    if (allSchools.length === 0) {
      allSchools = await fetchFromSerpAPI(city);
    }

    loadingDiv.style.display = 'none';

    if (allSchools.length === 0) {
      showError('No schools found in this city');
      emptyStateDiv.style.display = 'block';
      return;
    }

    resultsDiv.classList.add('show');
    applyFilters();
  } catch (err) {
    loadingDiv.style.display = 'none';
    showError(err.message || 'An error occurred while searching');
    emptyStateDiv.style.display = 'block';
  }
}

// ==================== GEOCODE ====================
async function geocodeCity(city) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(city)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data = await res.json();
  if (!data.features?.length) throw new Error('City not found');

  const feature = data.features[0];
  const [lon, lat] = feature.geometry.coordinates;
  const delta = 0.15;
  return { lat, lon, bbox: [lon - delta, lat - delta, lon + delta, lat + delta], name: feature.properties.name || city };
}

// ==================== OVERPASS ====================
function buildOverpassQuery(bbox) {
  const bboxStr = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  const nameFilters = KEYWORDS.map(k => `node["name"~"${k}",i](${bboxStr});way["name"~"${k}",i](${bboxStr});relation["name"~"${k}",i](${bboxStr});`).join('\n');
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

async function queryOverpass(query) {
  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter'
  ];
  for (const url of servers) {
    try {
      const res = await fetch(url, { method: 'POST', body: query, headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' }});
      if (!res.ok) continue;
      return await res.json();
    } catch {}
  }
  return { elements: [] };
}

function parseOverpassResults(result) {
  const elements = result.elements || [];
  const seen = new Set();
  return elements
    .filter(el => {
      const tags = el.tags || {};
      const name = (tags.name || '').toLowerCase();
      const amenity = tags.amenity || '';
      const building = tags.building || '';
      return amenity === 'school' || building === 'school' || tags.education || tags['school:type'] || KEYWORDS.some(k => name.includes(k));
    })
    .map(el => {
      const tags = el.tags || {};
      const name = tags.name || 'Unnamed School';
      const lowerName = name.toLowerCase();
      if (['vgs','college','high school','secondary','videregående','gymnasium'].some(s => lowerName.includes(s))) return null;
      if (seen.has(lowerName)) return null;
      seen.add(lowerName);
      return { name, website: tags.website || tags['contact:website'] || '', type: detectType(tags), principal: extractEmail(tags) };
    })
    .filter(Boolean);
}

// ==================== SERPAPI FALLBACK ====================
async function fetchFromSerpAPI(city) {
  const apiKey = '81f2c16c07dd6535612e39beaa796ae8ba523edb7befcb28e1dc6852a8402bd0';
  const url = `https://serpapi.com/search.json?q=schools+in+${encodeURIComponent(city)}&engine=google_maps&api_key=${apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.local_results?.map(school => ({
      name: school.title || 'Unnamed School',
      website: school.website || '',
      type: 'Unknown',
      principal: ''
    })) || [];
  } catch {
    return [];
  }
}

// ==================== HELPERS ====================
function detectType(tags) {
  if (!tags) return 'Unknown';
  const name = (tags.name || '').toLowerCase();
  const operator = (tags.operator || '').toLowerCase();
  const ownership = (tags.ownership || '').toLowerCase();
  const isced = (tags['isced:level'] || '').toLowerCase();
  const schoolType = (tags['school:type'] || '').toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();

  const privateHints = ['privat','privée','private','independent','foundation','montessori','friskole','waldorf','steiner','bilingual','international','charter','boarding','religious','mission','catholic','christian','islamic','jewish'];
  const publicHints = ['kommune','municipal','fylkeskommune','public','government','state','statlig','offentlig','community','city','county','regional','district','national','folkeskole','grunnskole','primary','elementary','secondary','comprehensive','gymnasium','lycée','liceo','szkoła podstawowa','peruskoulu'];

  if (['public','government','state','municipal','kommunal'].includes(operator) || ['public','government','state','municipal','kommunal'].includes(ownership) || ['public'].includes(schoolType)) return 'Public';
  if (['private','independent','foundation','charter','mission','religious'].includes(operator) || ['private','independent','foundation','charter','mission','religious'].includes(ownership) || ['private'].includes(schoolType)) return 'Private';
  if (privateHints.some(h => name.includes(h) || operator.includes(h) || ownership.includes(h))) return 'Private';
  if (publicHints.some(h => name.includes(h) || operator.includes(h) || ownership.includes(h))) return 'Public';
  if (isced && ['1'].some(level => isced.includes(level))) return 'Public';
  if (amenity === 'school' || tags.building === 'school') return 'Unknown';
  return 'Unknown';
}

function extractEmail(tags) {
  if (!tags) return '';
  const emailKeys = ['email','contact:email','operator:email','school:email','contact:mail','mail'];
  for (const key of emailKeys) {
    const value = tags[key];
    if (value && typeof value === 'string' && value.includes('@') && value.includes('.')) return value.trim();
  }
  const descKeys = ['description','contact:details','note','operator:description'];
  for (const key of descKeys) {
    const desc = tags[key];
    if (desc && typeof desc === 'string') {
      const match = desc.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (match) return match[0];
    }
  }
  return '';
}

// ==================== UI ====================
function showError(message) {
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
}

function applyFilters() {
  const typeValue = typeFilter.value.toLowerCase();
  const searchValue = nameSearch.value.toLowerCase();
  const filtered = allSchools.filter(school => (typeValue === 'all' || school.type.toLowerCase() === typeValue) && school.name.toLowerCase().includes(searchValue));
  schoolCount.textContent = filtered.length;
  renderSchools(filtered);
}

function renderSchools(schools) {
  if (schools.length === 0) {
    schoolsGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #718096;">No schools match your filters</div>';
    return;
  }
  schoolsGrid.innerHTML = schools.map(school => `
    <div class="school-card">
      <div class="school-name">${escapeHtml(school.name)}</div>
      <div class="school-type">${school.type}</div>
      ${school.website ? `<div class="school-website"><a href="${escapeHtml(school.website)}" target="_blank">${escapeHtml(school.website)}</a></div>` : ''}
      ${school.principal ? `<div class="school-principal">${escapeHtml(school.principal)}</div>` : ''}
    </div>
  `).join('');
}

function exportCSV() {
  const typeValue = typeFilter.value.toLowerCase();
  const searchValue = nameSearch.value.toLowerCase();
  const filtered = allSchools.filter(school => (typeValue === 'all' || school.type.toLowerCase() === typeValue) && school.name.toLowerCase().includes(searchValue));
  const headers = ['School Name','Website','Type','Principal'];
  const rows = filtered.map(s => [s.name, s.website, s.type, s.principal]);
  const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentCity.replace(/[^a-z0-9]/gi,'_')}_schools.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
