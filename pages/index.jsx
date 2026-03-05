import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

// ─── API helpers ────────────────────────────────────────────────────────────
async function uploadToBlob(file) {
  const resp = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "x-filename": file.name },
    body: file,
  });
  if (!resp.ok) throw new Error(`Upload échoué (${resp.status})`);
  const { url } = await resp.json();
  return url;
}
async function extractFromIM(blobUrl, filename) {
  const resp = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blobUrl, filename }),
  });
  if (!resp.ok) throw new Error(`Extraction échouée (${resp.status})`);
  return resp.json();
}
async function enrichWithWebSearch(imData) {
  const resp = await fetch("/api/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imData }),
  });
  if (!resp.ok) throw new Error(`Enrichissement échoué (${resp.status})`);
  return resp.json();
}

// ─── Design tokens (Remake Live palette) ───────────────────────────────────
const C = {
  navy:    "#0B1437",
  navyMid: "#132050",
  navyLight:"#1A2D65",
  red:     "#E8262A",
  redMid:  "#C41E22",
  redLight:"rgba(232,38,42,0.15)",
  white:   "#FFFFFF",
  grey100: "#F5F7FA",
  grey200: "#E4E9F2",
  grey400: "#8492A6",
  grey600: "#475569",
  green:   "#10B981",
  amber:   "#F59E0B",
  blue:    "#3B82F6",
};

// ─── Map Component (Leaflet + OSM with Google Maps link) ────────────────────
function MapWithTransport({ adresse, ville, pays, transports, classeActif }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(true);
  const q = encodeURIComponent(`${adresse || ""} ${ville || ""} ${pays || ""}`.trim());
  const gmUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;

  useEffect(() => {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (data[0]) setCoords({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [q]);

  useEffect(() => {
    if (!coords || !mapRef.current || typeof window === "undefined") return;
    if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; }

    import("leaflet").then(L => {
      if (!mapRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false })
        .setView([coords.lat, coords.lon], 15);
      leafletRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap"
      }).addTo(map);

      // Main marker
      const icon = L.divIcon({
        html: `<div style="width:14px;height:14px;background:${C.red};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
        className: "",
        iconAnchor: [7, 7],
      });
      L.marker([coords.lat, coords.lon], { icon })
        .bindPopup(`<b style="color:${C.navy}">${adresse}</b>`)
        .addTo(map);

      // Transport circles based on asset class
      const circleConfigs = classeActif === "logistique" || classeActif === "industriel"
        ? [
            { r: 5000,  color: C.green,  label: "5km", opacity: 0.12 },
            { r: 20000, color: C.blue,   label: "20km", opacity: 0.08 },
          ]
        : classeActif === "commerce"
        ? [
            { r: 500,  color: C.green,  label: "500m (5min à pied)", opacity: 0.15 },
            { r: 1000, color: C.amber,  label: "1km (10min à pied)", opacity: 0.1 },
            { r: 3000, color: C.blue,   label: "3km (zone chalandise)", opacity: 0.07 },
          ]
        : [
            { r: 300,  color: C.green,  label: "300m (5min à pied)", opacity: 0.18 },
            { r: 600,  color: C.amber,  label: "600m (8min à pied)", opacity: 0.12 },
            { r: 1200, color: C.blue,   label: "1,2km (15min TC)", opacity: 0.07 },
          ];

      circleConfigs.forEach(cfg => {
        L.circle([coords.lat, coords.lon], {
          radius: cfg.r,
          color: cfg.color,
          fillColor: cfg.color,
          fillOpacity: cfg.opacity,
          weight: 1.5,
          opacity: 0.5,
        }).addTo(map);
      });

      setTimeout(() => map.invalidateSize(), 100);
    });

    return () => {
      if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; }
    };
  }, [coords, classeActif]);

  const circleLabels = classeActif === "logistique" || classeActif === "industriel"
    ? [{ color: C.green, label: "5km" }, { color: C.blue, label: "20km" }]
    : classeActif === "commerce"
    ? [{ color: C.green, label: "500m — zone piétonne" }, { color: C.amber, label: "1km — zone de proximité" }, { color: C.blue, label: "3km — zone de chalandise" }]
    : [{ color: C.green, label: "300m — 5min à pied" }, { color: C.amber, label: "600m — 8min à pied" }, { color: C.blue, label: "1,2km — 15min TC" }];

  return (
    <div style={{ borderRadius: 16, overflow: "hidden", border: `1px solid ${C.navyLight}`, background: C.navyMid }}>
      {loading ? (
        <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center", color: C.grey400 }}>
          <span style={{ animation: "pulse 1.5s infinite" }}>Géolocalisation…</span>
        </div>
      ) : !coords ? (
        <div style={{ height: 320, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <span style={{ color: C.grey400, fontSize: 14 }}>Adresse non géolocalisée</span>
          <a href={gmUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.red, fontSize: 13, textDecoration: "none", border: `1px solid ${C.redLight}`, padding: "6px 14px", borderRadius: 8 }}>
            Ouvrir dans Google Maps →
          </a>
        </div>
      ) : (
        <>
          <div ref={mapRef} style={{ width: "100%", height: 340 }} />
          <div style={{ background: C.navyMid, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {circleLabels.map((cl, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: cl.color, opacity: 0.7 }} />
                  <span style={{ fontSize: 11, color: C.grey400 }}>{cl.label}</span>
                </div>
              ))}
            </div>
            <a href={gmUrl} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 12, color: C.red, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Google Maps
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Lease Table ─────────────────────────────────────────────────────────────
function LeaseTable({ locataires }) {
  if (!locataires || locataires.length === 0) return (
    <div style={{ textAlign: "center", color: C.grey400, padding: "32px 0" }}>Aucun locataire renseigné</div>
  );
  const cols = [
    { key: "nom",          label: "Locataire" },
    { key: "surface",      label: "Surface" },
    { key: "loyer_annuel", label: "Loyer/an" },
    { key: "loyer_m2",     label: "€/m²/an" },
    { key: "date_debut_bail", label: "Début" },
    { key: "date_break",   label: "Break" },
    { key: "date_fin_bail",label: "Fin bail" },
    { key: "walb",         label: "WALB" },
    { key: "walt",         label: "WALT" },
    { key: "type_bail",    label: "Type bail" },
  ];
  return (
    <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${C.navyLight}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.navyLight }}>
            {cols.map(c => (
              <th key={c.key} style={{ padding: "10px 14px", textAlign: "left", color: C.grey400, fontWeight: 600, fontSize: 11, letterSpacing: "0.05em", whiteSpace: "nowrap", borderBottom: `1px solid ${C.navyLight}` }}>
                {c.label.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locataires.map((loc, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? C.navyMid : "rgba(19,32,80,0.4)", transition: "background 0.15s" }}>
              {cols.map(c => (
                <td key={c.key} style={{ padding: "10px 14px", color: c.key === "nom" ? C.white : c.key === "walb" || c.key === "walt" ? C.amber : C.grey200, fontWeight: c.key === "nom" ? 600 : 400, whiteSpace: "nowrap", borderBottom: `1px solid rgba(26,45,101,0.5)` }}>
                  {loc[c.key] || "N/D"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tenant Card (health + sources) ──────────────────────────────────────────
function TenantCard({ loc, enrichedData }) {
  const el = enrichedData?.find(l =>
    l.nom?.toLowerCase().includes(loc.nom?.toLowerCase()?.slice(0, 6)) ||
    loc.nom?.toLowerCase().includes(l.nom?.toLowerCase()?.slice(0, 6))
  );
  const healthColor = el?.sante_financiere === "solide" ? C.green
    : el?.sante_financiere === "fragile" ? C.red
    : C.amber;

  return (
    <div style={{ borderRadius: 14, border: `1px solid ${C.navyLight}`, background: C.navyMid, padding: 20, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{loc.nom}</div>
          <div style={{ fontSize: 12, color: C.grey400, marginTop: 2 }}>{loc.secteur}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {el?.sante_financiere && (
            <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: `${healthColor}20`, border: `1px solid ${healthColor}40`, color: healthColor }}>
              ● {el.sante_financiere.charAt(0).toUpperCase() + el.sante_financiere.slice(1)}
            </span>
          )}
          {el?.risque && (
            <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: el.risque === "faible" ? `${C.green}20` : el.risque === "élevé" ? `${C.red}20` : `${C.amber}20`, border: `1px solid ${el.risque === "faible" ? C.green : el.risque === "élevé" ? C.red : C.amber}40`, color: el.risque === "faible" ? C.green : el.risque === "élevé" ? C.red : C.amber }}>
              Risque {el.risque}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 16 }}>
        {[["Surface", loc.surface], ["Loyer/an", loc.loyer_annuel], ["€/m²/an", loc.loyer_m2], ["WALB", loc.walb]].map(([l, v]) => (
          <div key={l} style={{ background: C.navy, borderRadius: 10, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: C.grey400 }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.white, marginTop: 2 }}>{v || "N/D"}</div>
          </div>
        ))}
      </div>

      {el && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          {/* Financials */}
          <div style={{ background: C.navy, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.grey400, letterSpacing: "0.05em", marginBottom: 10 }}>DONNÉES FINANCIÈRES</div>
            {[["CA", el.chiffre_affaires], ["Résultat net", el.resultat_net], ["Effectifs", el.effectifs], ["Notation", el.notation]].map(([l, v]) => v && v !== "N/D" && (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.grey400 }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.white }}>{v}</span>
              </div>
            ))}
            {el.actualites && (
              <div style={{ marginTop: 10, padding: "8px", background: `${C.amber}10`, borderRadius: 8, border: `1px solid ${C.amber}20` }}>
                <div style={{ fontSize: 11, color: C.amber, marginBottom: 4 }}>📰 Actualités</div>
                <div style={{ fontSize: 12, color: C.grey200 }}>{el.actualites}</div>
              </div>
            )}
          </div>
          {/* Analysis + sources */}
          <div style={{ background: C.navy, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.grey400, letterSpacing: "0.05em", marginBottom: 8 }}>ANALYSE & SOURCES</div>
            {el.commentaire && <p style={{ fontSize: 12, color: C.grey200, lineHeight: 1.6, marginBottom: 12 }}>{el.commentaire}</p>}
            {el.sources?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {el.sources.map((s, i) => (
                  <a key={i} href={s.url || "#"} target="_blank" rel="noopener noreferrer"
                     style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.red, textDecoration: "none", padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.redLight}`, background: C.redLight }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    {s.label || s}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asset-class specific panel ───────────────────────────────────────────────
function AssetClassPanel({ classeActif, analysis }) {
  if (!analysis) return null;

  const isLogistique = classeActif === "logistique" || classeActif === "industriel";
  const isCommerce = classeActif === "commerce";
  const isBureau = classeActif === "bureau";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Bureau: transport accessibility */}
      {isBureau && analysis.transports_detail && (
        <Card title="Accessibilité Transports" icon="🚇">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.transports_detail.lignes_proches?.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ fontSize: 16 }}>🚉</span>
                <span style={{ color: C.grey200 }}>{l}</span>
              </div>
            ))}
            {analysis.transports_detail.isochrone_15min_tc && (
              <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: `${C.blue}15`, border: `1px solid ${C.blue}30` }}>
                <span style={{ fontSize: 12, color: "#93C5FD" }}>🕐 Zone 15min TC : {analysis.transports_detail.isochrone_15min_tc}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 13, color: C.grey400 }}>Score accessibilité</span>
              {analysis.transports_detail.score_accessibilite && (
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: analysis.transports_detail.score_accessibilite === "excellent" ? `${C.green}20` : `${C.amber}20`, color: analysis.transports_detail.score_accessibilite === "excellent" ? C.green : C.amber }}>
                  {analysis.transports_detail.score_accessibilite.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Commerce: catchment zone */}
      {isCommerce && analysis.zone_chalandise && (
        <Card title="Zone de Chalandise" icon="🏪">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[["Population 5min", analysis.zone_chalandise.population_5min], ["Population 10min", analysis.zone_chalandise.population_10min], ["Trafic piéton", analysis.zone_chalandise.trafic_pietonne]].filter(([, v]) => v && v !== "N/A" && v !== "N/D").map(([l, v]) => (
              <div key={l} style={{ background: C.navy, borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: C.grey400 }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>
          {analysis.zone_chalandise.concurrents_proches?.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: C.grey400, marginBottom: 8, letterSpacing: "0.05em" }}>CONCURRENCE DIRECTE</div>
              {analysis.zone_chalandise.concurrents_proches.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: C.grey200, marginBottom: 6 }}>
                  <span style={{ color: C.red }}>▸</span>{c}
                </div>
              ))}
            </>
          )}
        </Card>
      )}

      {/* Logistics: road access */}
      {isLogistique && analysis.accessibilite_logistique && (
        <Card title="Accessibilité Logistique" icon="🛣️">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.accessibilite_logistique.autoroute_plus_proche && analysis.accessibilite_logistique.autoroute_plus_proche !== "N/A" && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: C.grey400 }}>Autoroute</span>
                <span style={{ fontSize: 13, color: C.white }}>{analysis.accessibilite_logistique.autoroute_plus_proche}</span>
              </div>
            )}
            {analysis.accessibilite_logistique.port_aeroport && analysis.accessibilite_logistique.port_aeroport !== "N/A" && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: C.grey400 }}>Port / Aéroport</span>
                <span style={{ fontSize: 13, color: C.white }}>{analysis.accessibilite_logistique.port_aeroport}</span>
              </div>
            )}
            {analysis.accessibilite_logistique.axes_details?.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: C.grey200 }}>
                <span style={{ color: C.green }}>▸</span>{a}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Concurrence */}
      {analysis.concurrence?.length > 0 && (
        <Card title="Concurrence & Contexte" icon="⚔️">
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {analysis.concurrence.map((c, i) => (
              <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: C.grey200 }}>
                <span style={{ color: C.amber, flexShrink: 0 }}>▸</span>{c}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Points spécifiques */}
      {analysis.points_specifiques?.length > 0 && (
        <Card title="Points Spécifiques" icon="🎯">
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {analysis.points_specifiques.map((p, i) => (
              <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: C.grey200 }}>
                <span style={{ color: C.blue, flexShrink: 0 }}>▸</span>{p}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ─── UI primitives ───────────────────────────────────────────────────────────
function Card({ title, icon, children }) {
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${C.navyLight}`, background: C.navyMid, padding: "18px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", color: C.grey400, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{icon}</span>{title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function KPI({ label, value, color = C.white, sub }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${C.navyLight}`, background: C.navyMid, padding: "14px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.grey400, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value || "N/D"}</div>
      {sub && <div style={{ fontSize: 11, color: C.grey600, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SwotGrid({ swot }) {
  const items = [
    { k: "forces",       label: "Forces",       icon: "💪", border: C.green, text: C.green },
    { k: "faiblesses",   label: "Faiblesses",   icon: "⚠️", border: C.red,   text: C.red },
    { k: "opportunites", label: "Opportunités", icon: "🚀", border: C.blue,  text: C.blue },
    { k: "menaces",      label: "Menaces",      icon: "⛈️", border: C.amber, text: C.amber },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {items.map(b => (
        <div key={b.k} style={{ borderRadius: 14, border: `1px solid ${b.border}30`, background: `${b.border}08`, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: b.text, marginBottom: 12 }}>{b.icon} {b.label}</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {(swot?.[b.k] || []).map((s, i) => (
              <li key={i} style={{ fontSize: 13, color: "#CBD5E1", display: "flex", gap: 8 }}>
                <span style={{ color: "#475569", flexShrink: 0 }}>—</span>{s}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function StepBar({ step }) {
  const steps = [{ label: "Lecture IM", icon: "📄" }, { label: "Recherche web", icon: "🌐" }, { label: "Synthèse", icon: "⚡" }];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${step >= i + 1 ? C.red + "50" : C.navyLight}`, background: step >= i + 1 ? C.redLight : "transparent", color: step >= i + 1 ? "#FCA5A5" : C.grey600 }}>
            {s.icon} {s.label}
            {step === i + 1 && <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.red}50`, borderTopColor: C.red, display: "inline-block", animation: "spin 0.8s linear infinite" }} />}
            {step > i + 1 && <span style={{ color: C.green }}>✓</span>}
          </div>
          {i < 2 && <div style={{ width: 24, height: 1, background: step > i + 1 ? C.red + "40" : C.navyLight, margin: "0 4px" }} />}
        </div>
      ))}
    </div>
  );
}

// ─── Main Result Sheet ───────────────────────────────────────────────────────
function ResultSheet({ im, enriched }) {
  const [tab, setTab] = useState("overview");
  const rec = enriched.verdict_independant?.recommandation;
  const recColor = rec === "À étudier" ? C.green : rec === "Prudence" ? C.amber : C.red;

  const tabs = [
    { id: "overview",     label: "Vue d'ensemble",      icon: "📋" },
    { id: "localisation", label: "Carte & Localisation", icon: "📍" },
    { id: "etat_locatif", label: "État Locatif",         icon: "📊" },
    { id: "locataires",   label: "Santé Locataires",     icon: "🏢" },
    { id: "marche",       label: "Marché",               icon: "💹" },
    { id: "projets",      label: "Projets Zone",         icon: "🏗️" },
    { id: "swot",         label: "SWOT",                 icon: "⚡" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header card */}
      <div style={{ borderRadius: 18, border: `1px solid ${C.navyLight}`, background: `linear-gradient(135deg, ${C.navyMid}, ${C.navy})`, padding: "24px 28px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, background: `${C.red}08`, borderRadius: "50%" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: C.red, fontWeight: 700, marginBottom: 6 }}>FICHE SYNTHÉTIQUE · SOURCES CROISÉES</div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: C.white, margin: 0 }}>{im.titre || "Actif Immobilier"}</h2>
              <p style={{ fontSize: 13, color: C.grey400, marginTop: 4 }}>{im.localisation?.adresse} — {im.localisation?.ville}, {im.localisation?.pays}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: `${C.blue}20`, border: `1px solid ${C.blue}40`, color: "#93C5FD" }}>{im.classe_actif}</span>
                <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: enriched.verdict_independant?.fiabilite_im === "optimiste" ? `${C.red}20` : `${C.green}20`, border: `1px solid ${enriched.verdict_independant?.fiabilite_im === "optimiste" ? C.red : C.green}40`, color: enriched.verdict_independant?.fiabilite_im === "optimiste" ? "#FCA5A5" : "#6EE7B7" }}>
                  IM {enriched.verdict_independant?.fiabilite_im}
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 700, background: `${recColor}20`, border: `1px solid ${recColor}50`, color: recColor }}>{rec}</span>
              <div style={{ fontSize: 52, fontWeight: 900, color: C.white, lineHeight: 1, marginTop: 8 }}>{enriched.verdict_independant?.note}</div>
              <div style={{ fontSize: 13, color: C.grey600 }}>/10</div>
            </div>
          </div>
          {enriched.verdict_independant?.resume && (
            <p style={{ marginTop: 18, fontSize: 13, color: "#94A3B8", lineHeight: 1.7, borderTop: `1px solid ${C.navyLight}`, paddingTop: 14, fontStyle: "italic" }}>
              "{enriched.verdict_independant.resume}"
            </p>
          )}
          {enriched.verdict_independant?.points_divergence?.length > 0 && (
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: `${C.red}10`, border: `1px solid ${C.red}25` }}>
              <div style={{ fontSize: 11, color: C.red, fontWeight: 700, marginBottom: 6 }}>⚠️ ÉCARTS IM vs RÉALITÉ</div>
              {enriched.verdict_independant.points_divergence.map((p, i) => (
                <p key={i} style={{ fontSize: 12, color: "#94A3B8", marginTop: 3 }}>▸ {p}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        <KPI label="Prix demandé" value={im.financier?.prix_demande} color={C.white} />
        <KPI label="Rendement vendeur" value={im.financier?.rendement_vendeur} color={C.amber} />
        <KPI label="Surface totale" value={im.etat_locatif?.surface_totale} color={C.white} />
        <KPI label="WALB" value={im.durees_engagement?.walb} color="#93C5FD" />
        <KPI label="Taux occupation" value={im.etat_locatif?.taux_occupation} color={C.green} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", transition: "all 0.15s", border: `1px solid ${tab === t.id ? C.red + "50" : "transparent"}`, background: tab === t.id ? C.redLight : "transparent", color: tab === t.id ? "#FCA5A5" : C.grey400 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card title="Structure Financière" icon="💰">
            {[["Prix demandé", im.financier?.prix_demande], ["Rdt vendeur", im.financier?.rendement_vendeur], ["Rdt brut calculé", im.financier?.rendement_brut_calcule], ["Valeur /m²", im.financier?.valeur_m2], ["VLM (IM)", im.financier?.valeur_locative_theorique], ["Loyer total/an", im.etat_locatif?.loyer_total_annuel]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.navyLight}` }}>
                <span style={{ fontSize: 13, color: C.grey400 }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.amber }}>{v || "N/D"}</span>
              </div>
            ))}
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Durées d'Engagement" icon="📅">
              {[["WALB", im.durees_engagement?.walb, "#93C5FD"], ["WALT", im.durees_engagement?.walt, C.white], ["Bail le + long", im.durees_engagement?.bail_plus_long, C.green], ["Bail le + court", im.durees_engagement?.bail_plus_court, C.amber]].map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.navyLight}` }}>
                  <span style={{ fontSize: 13, color: C.grey400 }}>{l}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: c }}>{v || "N/D"}</span>
                </div>
              ))}
            </Card>
            <Card title="Contexte de Marché" icon="🌍">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: C.grey400 }}>Dynamisme</span>
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: enriched.contexte_marche?.dynamisme?.includes("actif") ? `${C.green}20` : `${C.amber}20`, color: enriched.contexte_marche?.dynamisme?.includes("actif") ? C.green : C.amber }}>
                  {enriched.contexte_marche?.dynamisme || "N/D"}
                </span>
              </div>
              <p style={{ fontSize: 12, color: C.grey400, lineHeight: 1.6, margin: 0 }}>{enriched.contexte_marche?.tendance_investisseurs}</p>
            </Card>
          </div>
        </div>
      )}

      {tab === "localisation" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <MapWithTransport adresse={im.localisation?.adresse} ville={im.localisation?.ville} pays={im.localisation?.pays} transports={im.transports} classeActif={im.classe_actif} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Card title="Transports" icon="🚇">
              {im.transports?.metro?.length > 0 && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, color: C.grey600, display: "block", marginBottom: 4 }}>MÉTRO</span>{im.transports.metro.map((l, i) => <div key={i} style={{ fontSize: 13, color: C.grey200, marginBottom: 3 }}>🟦 {l}</div>)}</div>}
              {im.transports?.rer?.length > 0 && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, color: C.grey600, display: "block", marginBottom: 4 }}>RER</span>{im.transports.rer.map((l, i) => <div key={i} style={{ fontSize: 13, color: C.grey200, marginBottom: 3 }}>🔵 {l}</div>)}</div>}
              {im.transports?.tram?.length > 0 && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 11, color: C.grey600, display: "block", marginBottom: 4 }}>TRAM</span>{im.transports.tram.map((l, i) => <div key={i} style={{ fontSize: 13, color: C.grey200, marginBottom: 3 }}>🟩 {l}</div>)}</div>}
              {im.transports?.gare && im.transports.gare !== "N/D" && <div><span style={{ fontSize: 11, color: C.grey600 }}>GARE</span><div style={{ fontSize: 13, color: C.grey200, marginTop: 4 }}>🚂 {im.transports.gare}</div></div>}
            </Card>
            <Card title="Analyse Localisation" icon="📍">
              <p style={{ fontSize: 13, color: C.grey200, lineHeight: 1.7, margin: 0 }}>{im.localisation?.analyse_im || "N/D"}</p>
            </Card>
          </div>
          {/* Asset-class specific local analysis */}
          <AssetClassPanel classeActif={im.classe_actif} analysis={enriched.analyse_classe_actif} />
        </div>
      )}

      {tab === "etat_locatif" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            <KPI label="Taux occupation" value={im.etat_locatif?.taux_occupation} color={C.green} />
            <KPI label="Surface totale" value={im.etat_locatif?.surface_totale} color={C.white} />
            <KPI label="Loyer total/an" value={im.etat_locatif?.loyer_total_annuel} color={C.amber} />
            <KPI label="Nb locataires" value={im.etat_locatif?.locataires?.length?.toString()} color={C.white} />
          </div>
          <Card title="Tableau des Baux" icon="📋">
            <LeaseTable locataires={im.etat_locatif?.locataires} />
          </Card>
        </div>
      )}

      {tab === "locataires" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ padding: "10px 14px", borderRadius: 10, background: `${C.amber}10`, border: `1px solid ${C.amber}20`, fontSize: 12, color: "#FCD34D", marginBottom: 8 }}>
            ℹ️ Analyse indépendante croisée avec sources web — au-delà de la présentation de l'IM.
          </div>
          {im.etat_locatif?.locataires?.map((loc, i) => (
            <TenantCard key={i} loc={loc} enrichedData={enriched.locataires_analyse} />
          ))}
        </div>
      )}

      {tab === "marche" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <KPI label="Loyer IM" value={im.marche_locatif_im?.loyer_marche_cite} color={C.grey200} sub="Source: IM" />
            <KPI label="Loyer marché réel" value={enriched.marche_locatif_reel?.fourchette_loyers} color={C.white} sub="Source: Web" />
            <KPI label="Tendance" value={enriched.marche_locatif_reel?.tendance} color={enriched.marche_locatif_reel?.tendance === "hausse" ? C.green : enriched.marche_locatif_reel?.tendance === "baisse" ? C.red : C.amber} />
          </div>
          <Card title="Analyse Marché Indépendante" icon="🔍">
            <p style={{ fontSize: 13, color: C.grey200, lineHeight: 1.7, marginBottom: 16 }}>{enriched.marche_locatif_reel?.analyse}</p>
            {enriched.marche_locatif_reel?.offres_trouvees?.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: C.grey600, marginBottom: 10, letterSpacing: "0.05em" }}>OFFRES OBSERVÉES</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {enriched.marche_locatif_reel.offres_trouvees.map((o, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, background: C.navy, gap: 12 }}>
                      <span style={{ fontSize: 13, color: C.grey200 }}>▸ {o.description || o}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        {o.loyer && <span style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>{o.loyer}</span>}
                        {o.source_url && o.source_url !== "https://..." && (
                          <a href={o.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.red, textDecoration: "none", border: `1px solid ${C.redLight}`, padding: "3px 8px", borderRadius: 6 }}>
                            🔗 Source
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {enriched.marche_locatif_reel?.sources_marche?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: C.grey600, marginBottom: 8, letterSpacing: "0.05em" }}>SOURCES MARCHÉ</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {enriched.marche_locatif_reel.sources_marche.map((s, i) => (
                    <a key={i} href={s.url || "#"} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.red, textDecoration: "none", padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.redLight}`, background: C.redLight }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      {s.label || s}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Card title="Risques Macro" icon="📉">
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {enriched.contexte_marche?.risques_macro?.map((r, i) => (
                  <li key={i} style={{ fontSize: 13, color: C.grey200, display: "flex", gap: 8 }}>
                    <span style={{ color: C.red, flexShrink: 0 }}>▸</span>{r}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Opportunités Macro" icon="📈">
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {enriched.contexte_marche?.opportunites_macro?.map((o, i) => (
                  <li key={i} style={{ fontSize: 13, color: C.grey200, display: "flex", gap: 8 }}>
                    <span style={{ color: C.green, flexShrink: 0 }}>▸</span>{o}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === "projets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(!enriched.projets_zone || enriched.projets_zone.length === 0) ? (
            <div style={{ textAlign: "center", color: C.grey400, padding: "48px 0" }}>Aucun projet identifié dans la zone</div>
          ) : enriched.projets_zone.map((p, i) => (
            <div key={i} style={{ borderRadius: 14, border: `1px solid ${C.navyLight}`, background: C.navyMid, padding: 16, display: "flex", gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, background: p.impact === "positif" ? `${C.green}20` : p.impact === "négatif" ? `${C.red}20` : `${C.grey600}20`, flexShrink: 0 }}>
                {p.type === "bureau" ? "🏢" : p.type === "hotel" ? "🏨" : p.type === "logement" ? "🏠" : p.type === "transport" ? "🚇" : "🏗️"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.white }}>{p.nom}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: p.impact === "positif" ? `${C.green}20` : p.impact === "négatif" ? `${C.red}20` : `${C.grey600}20`, color: p.impact === "positif" ? C.green : p.impact === "négatif" ? C.red : C.grey400 }}>{p.impact}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, background: `${C.blue}15`, color: "#93C5FD" }}>{p.statut}</span>
                </div>
                <p style={{ fontSize: 13, color: C.grey400, margin: 0 }}>{p.description}</p>
                {p.source_url && p.source_url !== "https://..." && (
                  <a href={p.source_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 11, color: C.red, textDecoration: "none" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Source
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "swot" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SwotGrid swot={enriched.swot} />
          {enriched.verdict_independant?.points_divergence?.length > 0 && (
            <div style={{ borderRadius: 14, border: `1px solid ${C.red}25`, background: `${C.red}08`, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", color: C.red, marginBottom: 12 }}>⚠️ POINTS DE VIGILANCE CRITIQUES</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {enriched.verdict_independant.points_divergence.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, color: "#CBD5E1", display: "flex", gap: 8 }}>
                    <span style={{ color: C.red, flexShrink: 0 }}>▸</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Home() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState(0);
  const [imData, setImData] = useState(null);
  const [enriched, setEnriched] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef();

  const handleFile = useCallback((f) => {
    if (!f) return;
    if (f.type !== "application/pdf") { setError("PDF uniquement."); return; }
    setFile(f); setError(""); setStep(0); setImData(null); setEnriched(null);
  }, []);

  const analyze = async () => {
    if (!file) return;
    setError("");
    try {
      setStep(1);
      const blobUrl = await uploadToBlob(file);
      const im = await extractFromIM(blobUrl, file.name);
      setImData(im);
      setStep(2);
      const en = await enrichWithWebSearch(im);
      setEnriched(en);
      setStep(3);
    } catch (e) {
      setError("Erreur : " + e.message);
      setStep(0);
    }
  };

  const done = step === 3 && imData && enriched;

  return (
    <>
      <Head>
        <title>RE Investment Analyzer</title>
        <meta name="description" content="Analyse d'Investment Memorandum immobilier" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>{`
          * { -webkit-font-smoothing: antialiased; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif !important; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: ${C.navy}; }
          ::-webkit-scrollbar-thumb { background: ${C.navyLight}; border-radius: 3px; }
          .leaflet-container { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
        `}</style>
      </Head>
      <div style={{ minHeight: "100vh", background: C.navy, color: C.white }}>
        {/* BG decoration */}
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -80, left: "15%", width: 500, height: 500, background: `${C.red}05`, borderRadius: "50%", filter: "blur(100px)" }} />
          <div style={{ position: "absolute", bottom: "20%", right: "10%", width: 350, height: 350, background: `${C.navyLight}60`, borderRadius: "50%", filter: "blur(80px)" }} />
        </div>

        <div style={{ position: "relative", maxWidth: 860, margin: "0 auto", padding: "40px 20px 60px" }}>
          {/* Header */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: `${C.red}20`, border: `1px solid ${C.red}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏛</div>
              <span style={{ fontSize: 11, letterSpacing: "0.1em", fontWeight: 700, color: C.grey600 }}>RE INVESTMENT ANALYZER</span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: C.white, margin: "0 0 8px" }}>
              Analyse d'<span style={{ color: C.red }}>Investment Memorandum</span>
            </h1>
            <p style={{ fontSize: 13, color: C.grey600, margin: 0, maxWidth: 560 }}>
              Fiche synthétique enrichie — localisation interactive, état locatif complet, santé financière des locataires avec sources, loyers de marché réels.
            </p>
          </div>

          {!done && (
            <>
              <div
                onClick={() => !step && inputRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                style={{ borderRadius: 18, border: `2px dashed ${dragging ? C.red : C.navyLight}`, background: dragging ? C.redLight : `${C.navyMid}80`, cursor: step > 0 ? "default" : "pointer", opacity: step > 0 ? 0.5 : 1, padding: "48px 24px", textAlign: "center", marginBottom: 20, transition: "all 0.2s" }}>
                <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                <div style={{ fontSize: 36, marginBottom: 12 }}>{dragging ? "📂" : "📄"}</div>
                {file ? (
                  <div>
                    <p style={{ fontWeight: 700, color: C.white, fontSize: 15 }}>{file.name}</p>
                    <p style={{ fontSize: 12, color: C.grey600, marginTop: 4 }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontWeight: 600, color: C.white, fontSize: 15, margin: "0 0 6px" }}>Glissez votre Investment Memorandum</p>
                    <p style={{ fontSize: 13, color: C.grey600, margin: 0 }}>ou cliquez · PDF uniquement</p>
                  </div>
                )}
              </div>

              {error && (
                <div style={{ marginBottom: 16, borderRadius: 10, padding: "10px 14px", fontSize: 13, background: `${C.red}15`, border: `1px solid ${C.red}35`, color: "#FCA5A5" }}>{error}</div>
              )}
              {step > 0 && <StepBar step={step} />}
              {file && step === 0 && (
                <button onClick={analyze} style={{ width: "100%", borderRadius: 14, fontWeight: 700, padding: "14px 24px", fontSize: 14, letterSpacing: "0.03em", cursor: "pointer", background: C.red, color: C.white, border: "none", transition: "background 0.15s" }}
                  onMouseEnter={e => e.target.style.background = C.redMid}
                  onMouseLeave={e => e.target.style.background = C.red}>
                  Lancer l'analyse complète →
                </button>
              )}
            </>
          )}

          {done && (
            <>
              <button onClick={() => { setStep(0); setFile(null); setImData(null); setEnriched(null); }}
                style={{ marginBottom: 20, fontSize: 12, color: C.grey600, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: 0 }}>
                ← Analyser un autre document
              </button>
              <div style={{ animation: "fadeIn 0.4s ease-out" }}>
                <ResultSheet im={imData} enriched={enriched} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
