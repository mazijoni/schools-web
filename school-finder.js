// =================== School Finder JS (Worldwide) ===================

const KEYWORDS = [
  // Norwegian
  'grunn', 'grunnskole', 'barneskole', 'folkeskole',
  // English
  'primary', 'elementary', 'primary school', 'elementary school', 'junior school',
  // International variations
  'international school', 'bilingual school', 'primary', 'elementary', 'school'
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

// Event listeners
searchBtn.addEventListener('click', handleSearch);
cityInput.addEventListener('keypress', e => { if(e.key==='Enter') handleSearch(); });
filterBtn.addEventListener('click', () => filtersDiv.classList.toggle('show'));
typeFilter.addEventListener('change', applyFilters);
nameSearch.addEventListener('input', applyFilters);
exportBtn.addEventListener('click', exportCSV);

// Geocode city using Nominatim (OpenStreetMap)
async function geocodeCity(city) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('City not found');
  const data = await res.json();
  if (!data.length) throw new Error('City not found');

  const place = data[0];
  const lat = parseFloat(place.lat);
  const lon = parseFloat(place.lon);
  const delta = 0.15; // roughly 15 km around center

  return { 
    lat, 
    lon, 
    bbox: [lon - delta, lat - delta, lon + delta, lat + delta],
    name: place.display_name.split(',')[0]
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
      ${nameFilters}
    );
    out center tags qt;
  `;
}

// Query Overpass API
async function queryOverpass(query) {
  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  for (const url of servers) {
    try {
      const res = await fetch(url, { method: 'POST', body: query, headers: {'Content-Type':'text/plain'} });
      if (!res.ok) continue;
      return await res.json();
    } catch(err) {
      console.warn(`Server failed: ${url}`, err.message);
    }
  }
  throw new Error('All Overpass servers failed');
}

// Detect school type
function detectType(tags) {
  if(!tags) return 'Unknown';
  const name = (tags.name||'').toLowerCase();
  const operator = (tags.operator||'').toLowerCase();

  if(['private','independent','montessori','friskole','waldorf','steiner','international'].some(k=>name.includes(k)||operator.includes(k))) return 'Private';
  if(['public','government','state','municipal','kommune','primary','elementary'].some(k=>name.includes(k)||operator.includes(k))) return 'Public';
  return 'Unknown';
}

// Extract email
function extractEmail(tags) {
  if(!tags) return '';
  const keys = ['email','contact:email','operator:email','school:email'];
  for(const k of keys){
    if(tags[k] && tags[k].includes('@')) return tags[k].trim();
  }
  return '';
}

// Show error
function showError(msg){
  errorDiv.textContent = msg;
  errorDiv.style.display='block';
  setTimeout(()=>errorDiv.style.display='none',5000);
}

// Handle search
async function handleSearch() {
  const city = cityInput.value.trim();
  if(!city) return showError('Please enter a city');

  loadingDiv.style.display='block';
  resultsDiv.classList.remove('show');
  emptyStateDiv.style.display='none';
  allSchools = [];
  currentCity = city;

  try {
    const cityInfo = await geocodeCity(city);
    cityName.textContent = cityInfo.name;

    const query = buildOverpassQuery(cityInfo.bbox);
    const result = await queryOverpass(query);

    const elements = result.elements || [];
    const seen = new Set();

    allSchools = elements.map(el=>{
      const tags = el.tags||{};
      const name = tags.name||'Unnamed School';
      const lowerName = name.toLowerCase();
      if(seen.has(lowerName)) return null;
      seen.add(lowerName);

      return {
        name,
        website: tags.website||tags['contact:website']||'',
        type: detectType(tags),
        principal: extractEmail(tags)
      };
    }).filter(Boolean);

    loadingDiv.style.display='none';
    if(!allSchools.length){
      emptyStateDiv.style.display='block';
      showError('No schools found in this area');
      return;
    }
    resultsDiv.classList.add('show');
    applyFilters();

  } catch(err){
    loadingDiv.style.display='none';
    emptyStateDiv.style.display='block';
    showError(err.message||'Search failed');
  }
}

// Apply filters
function applyFilters(){
  const typeValue = typeFilter.value.toLowerCase();
  const searchValue = nameSearch.value.toLowerCase();

  const filtered = allSchools.filter(s=>{
    const matchesType = typeValue==='all'||s.type.toLowerCase()===typeValue;
    const matchesSearch = s.name.toLowerCase().includes(searchValue);
    return matchesType && matchesSearch;
  });

  schoolCount.textContent = filtered.length;
  renderSchools(filtered);
}

// Render schools
function renderSchools(schools){
  if(!schools.length){
    schoolsGrid.innerHTML='<div style="text-align:center;padding:40px;color:#718096;">No schools match your filters</div>';
    return;
  }
  schoolsGrid.innerHTML = schools.map(s=>{
    const badgeClass=`badge-${s.type.toLowerCase()}`;
    return `
      <div class="school-card">
        <div class="school-header">
          <div class="school-info">
            <div class="school-name">${escapeHtml(s.name)}</div>
            <div class="school-details">
              ${s.website?`<div class="school-detail"><a href="${escapeHtml(s.website)}" target="_blank">${escapeHtml(s.website)}</a></div>`:''}
              ${s.principal?`<div class="school-detail">${escapeHtml(s.principal)}</div>`:''}
            </div>
          </div>
          <div class="badge ${badgeClass}">${s.type}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Export CSV
function exportCSV(){
  const typeValue = typeFilter.value.toLowerCase();
  const searchValue = nameSearch.value.toLowerCase();

  const filtered = allSchools.filter(s=>{
    const matchesType = typeValue==='all'||s.type.toLowerCase()===typeValue;
    const matchesSearch = s.name.toLowerCase().includes(searchValue);
    return matchesType && matchesSearch;
  });

  const headers = ['School Name','Website','Type','Principal'];
  const rows = filtered.map(s=>[s.name,s.website,s.type,s.principal]);
  const csv = [headers,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');

  const blob = new Blob([csv],{type:'text/csv'});
  const url = window.URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`${currentCity.replace(/[^a-z0-9]/gi,'_')}_schools.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// Escape HTML
function escapeHtml(text){
  const div=document.createElement('div');
  div.textContent=text;
  return div.innerHTML;
}
