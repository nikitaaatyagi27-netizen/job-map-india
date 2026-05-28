import React, { useEffect, useRef, memo } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getCompanyInitials } from '../../utils/companyLogoFallback';

const hashCode = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return h;
};

const spreadCoords = (company) => {
  if (!company?.coords) return null;
  const h = hashCode(company.employer_name);
  return {
    lat: Number(company.coords.lat) + ((h % 31) - 15) * 0.018,
    lng: Number(company.coords.lng) + ((h % 41) - 20) * 0.018,
  };
};

// Velocity → visual treatment
function getVelocityStyle(hiringVelocity) {
  const trend  = hiringVelocity?.trend;
  const jobs7  = hiringVelocity?.last7Days || 0;

  if ((trend === 'accelerating' && jobs7 >= 3) || jobs7 >= 5) {
    return {
      ring: '0 0 0 2px #22c55e',
      badgeBg: '#15803d',
      pulse: false,
      label: `🔥 ${jobs7} this week`
    };
  }
  if (jobs7 >= 1) {
    return {
      ring: '0 0 0 2px #f59e0b',
      badgeBg: '#92400e',
      pulse: false,
      label: `${jobs7} this week`
    };
  }
  return { ring: null, badgeBg: '#0f172a', pulse: false, label: null };
}

// ATS provider → border accent color
const ATS_BORDER = {
  greenhouse:      '#22c55e',
  lever:           '#3b82f6',
  ashby:           '#a855f7',
  smartrecruiters: '#f97316',
  workday:         '#ec4899',
};

function buildMarkerHTML(company) {
  const initials = getCompanyInitials(company.employer_name);
  const count    = company.roles?.length || 1;
  const escapedName = (company.employer_name || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const vel    = getVelocityStyle(company.hiringVelocity);
  const atsBorder = company.atsProvider ? (ATS_BORDER[company.atsProvider] || null) : null;

  // ATS indicator dot (bottom-left corner of the marker)
  const atsDot = atsBorder
    ? `<div style="position:absolute;bottom:-4px;left:-4px;width:10px;height:10px;border-radius:50%;background:${atsBorder};border:1.5px solid #0f172a;z-index:2"></div>`
    : '';

  // Velocity badge (top-right — replaces the plain job count when active)
  const badgeStyle = `position:absolute;top:-8px;right:-8px;background:${vel.badgeBg};color:white;` +
    `border-radius:10px;min-width:20px;height:20px;display:flex;justify-content:center;` +
    `align-items:center;font-size:10px;font-weight:700;padding:0 4px;` +
    `border:1.5px solid rgba(255,255,255,0.25);box-shadow:0 1px 4px rgba(0,0,0,0.5);z-index:3`;

  // Pulse animation for aggressively hiring companies
  const pulseStyle = vel.pulse
    ? `animation:jmi-pulse 1.8s ease-in-out infinite;`
    : '';

  const borderStyle = vel.ring
    ? `box-shadow:${vel.ring};`
    : atsBorder
      ? `box-shadow:0 0 0 2px ${atsBorder};`
      : '';

  const logoHTML = company.employer_logo
    ? `<img src="${company.employer_logo}" alt="${escapedName}" style="width:44px;height:44px;object-fit:contain;border-radius:10px" onerror="this.style.display='none';var s=this.nextElementSibling;if(s)s.style.display='flex';"/><span style="display:none;width:44px;height:44px;border-radius:10px;background:#1e293b;justify-content:center;align-items:center;font-size:13px;font-weight:bold;color:#93c5fd;font-family:Roboto,sans-serif">${initials}</span>`
    : `<span style="width:44px;height:44px;border-radius:10px;background:#1e293b;display:flex;justify-content:center;align-items:center;font-size:13px;font-weight:bold;color:#93c5fd;font-family:Roboto,sans-serif">${initials}</span>`;

  return `<div style="position:relative;cursor:pointer;width:44px;height:44px">` +
    `<div class="company-square" style="width:44px;height:44px;border-radius:10px;background:transparent;` +
    `display:flex;justify-content:center;align-items:center;overflow:hidden;` +
    `transition:transform 0.2s,opacity 0.3s,filter 0.3s,border-color 0.25s;${borderStyle}${pulseStyle}">` +
    `${logoHTML}</div>` +
    `<div style="${badgeStyle}">${count}</div>` +
    atsDot +
    `</div>`;
}

// Inject pulse keyframe once
const PULSE_CSS = `@keyframes jmi-pulse{0%,100%{box-shadow:0 0 0 2.5px #22c55e,0 0 10px 3px rgba(34,197,94,0.5)}50%{box-shadow:0 0 0 4px #22c55e,0 0 18px 7px rgba(34,197,94,0.25)}}`;
if (typeof document !== 'undefined' && !document.getElementById('jmi-pulse-style')) {
  const style = document.createElement('style');
  style.id = 'jmi-pulse-style';
  style.textContent = PULSE_CSS;
  document.head.appendChild(style);
}

function MarkersManager({ jobs, setChildClicked, highlightedNames }) {
  const map = useMap();
  const markersRef   = useRef([]);
  const squareMapRef = useRef({});

  useEffect(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    squareMapRef.current = {};

    if (!jobs?.length) return;

    jobs.forEach((company) => {
      const pos = spreadCoords(company);
      if (!pos) return;

      const icon = L.divIcon({
        html: buildMarkerHTML(company),
        className: '',
        iconSize: [50, 50],
        iconAnchor: [22, 22],
      });

      const marker = L.marker([pos.lat, pos.lng], { icon }).addTo(map);
      marker.on('click', () => setChildClicked(company));

      const el = marker.getElement();
      if (el) {
        const square = el.querySelector('.company-square');
        if (square) {
          squareMapRef.current[company.employer_name] = square;
          square.addEventListener('mouseenter', () => {
            if (square.dataset.dimmed !== 'true') square.style.transform = 'scale(1.18)';
          });
          square.addEventListener('mouseleave', () => {
            if (square.dataset.dimmed !== 'true') square.style.transform = '';
          });
        }
      }

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      squareMapRef.current = {};
    };
  }, [jobs, map, setChildClicked]);

  useEffect(() => {
    for (const [name, square] of Object.entries(squareMapRef.current)) {
      if (!highlightedNames) {
        square.style.opacity   = '1';
        square.style.filter    = '';
        square.dataset.dimmed  = 'false';
      } else if (highlightedNames.has(name)) {
        square.style.opacity   = '1';
        square.style.filter    = '';
        square.style.transform = 'scale(1.15)';
        square.dataset.dimmed  = 'false';
      } else {
        square.style.opacity   = '0.2';
        square.style.filter    = 'grayscale(80%)';
        square.dataset.dimmed  = 'true';
      }
    }
  }, [highlightedNames]);

  return null;
}

const Map = memo(({ coords, jobs, setChildClicked, highlightedNames }) => (
  <MapContainer
    center={[coords.lat, coords.lng]}
    zoom={5}
    style={{ height: '100%', width: '100%', background: '#0f172a' }}
    zoomControl={false}
    preferCanvas
    wheelDebounceTime={200}
    wheelPxPerZoomLevel={120}
  >
    <TileLayer
      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      subdomains="abcd"
      maxZoom={20}
      keepBuffer={2}
      updateWhenZooming={false}
    />
    <ZoomControl position="bottomright" />
    <MarkersManager jobs={jobs} setChildClicked={setChildClicked} highlightedNames={highlightedNames} />
  </MapContainer>
));

export default Map;
