import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

// ─── API helpers ─────────────────────────────────────────────────────────────
async function uploadToBlob(file) {
  const r = await fetch("/api/upload", { method:"POST", headers:{"Content-Type":"application/pdf","x-filename":file.name}, body:file });
  if (!r.ok) throw new Error(`Upload échoué (${r.status})`);
  return (await r.json()).url;
}
async function extractFromIM(blobUrl, filename) {
  const r = await fetch("/api/extract", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ blobUrl, filename }) });
  if (!r.ok) throw new Error(`Extraction échouée (${r.status})`);
  return r.json();
}
async function enrichWithWebSearch(imData) {
  const r = await fetch("/api/enrich", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ imData }) });
  if (!r.ok) throw new Error(`Enrichissement échoué (${r.status})`);
  return r.json();
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  navy:"#0B1437", navyMid:"#132050", navyLight:"#1A2D65",
  sky:"#4A90D9", skyLight:"#EBF4FF", skyMid:"#2E6BAD",
  red:"#E8262A", redMid:"#C41E22", redLight:"rgba(232,38,42,0.15)",
  white:"#FFFFFF", grey100:"#F0F4F8", grey200:"#E4E9F2",
  grey400:"#8492A6", grey600:"#475569",
  green:"#10B981", amber:"#F59E0B", blue:"#3B82F6",
};

// ─── Transparent scoring ──────────────────────────────────────────────────────
const DEFAULT_WEIGHTS = {
  rendement:    { label:"Rendement",          pct:25, desc:"Taux acte en main vs marché" },
  locataires:   { label:"Solidité locataires", pct:25, desc:"Santé financière & durée baux" },
  localisation: { label:"Localisation",        pct:20, desc:"Emplacement & accessibilité" },
  marche:       { label:"Dynamisme marché",    pct:15, desc:"Tendance offre/demande locale" },
  risques:      { label:"Gestion des risques", pct:15, desc:"Diversification, vacance, macro" },
};

function computeScore(enriched, weights) {
  const aiNote   = parseFloat(enriched?.verdict_independant?.note) || 5;
  const fiab     = enriched?.verdict_independant?.fiabilite_im;
  const tendance = enriched?.marche_locatif_reel?.tendance;
  const vacance  = enriched?.marche_locatif_reel?.vacance_zone;

  const sub = {
    rendement:    fiab==="conservateur"?8.2 : fiab==="réaliste"?6.5 : 4.2,
    locataires:   Math.min(10, aiNote * 1.05),
    localisation: Math.min(10, aiNote * 0.95),
    marche:       tendance==="hausse"?8 : tendance==="stable"?6 : 4,
    risques:      vacance==="faible"?8 : vacance==="modérée"?6 : 4,
  };

  const total = Object.entries(weights)
    .reduce((acc, [k,w]) => acc + (sub[k]||5) * (w.pct/100), 0);

  return { total: Math.min(10, Math.max(0, total)).toFixed(1), sub };
}

// ─── Map with satellite toggle ────────────────────────────────────────────────
function MapComponent({ adresse, ville, pays, classeActif }) {
  const mapRef   = useRef(null);
  const leafRef  = useRef(null);
  const layersRef= useRef(null);
  const [coords,   setCoords]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [satellite,setSatellite]= useState(false);
  const q     = encodeURIComponent(`${adresse||""} ${ville||""} ${pays||""}`.trim());
  const gmUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;

  useEffect(() => {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`)
      .then(r=>r.json()).then(d=>{ if(d[0]) setCoords({lat:+d[0].lat,lon:+d[0].lon}); setLoading(false); })
      .catch(()=>setLoading(false));
  }, [q]);

  useEffect(() => {
    if (!coords || !mapRef.current) return;
    if (leafRef.current) { leafRef.current.remove(); leafRef.current=null; }
    import("leaflet").then(L => {
      if (!mapRef.current) return;
      const map = L.map(mapRef.current, { zoomControl:true, scrollWheelZoom:false }).setView([coords.lat,coords.lon], 15);
      leafRef.current = map;

      const osmTile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",       { attribution:"© OpenStreetMap", maxZoom:19 });
      const satTile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution:"© Esri", maxZoom:19 });
      osmTile.addTo(map);
      layersRef.current = { osm:osmTile, sat:satTile, active:"osm", map, L };

      const icon = L.divIcon({ html:`<div style="width:14px;height:14px;background:${C.red};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>`, className:"", iconAnchor:[7,7] });
      L.marker([coords.lat,coords.lon],{icon}).bindPopup(`<b>${adresse||ville}</b>`).addTo(map);

      const circles = classeActif==="logistique"||classeActif==="industriel"
        ? [{r:5000,c:C.green,o:.12},{r:20000,c:C.blue,o:.07}]
        : classeActif==="commerce"
        ? [{r:500,c:C.green,o:.15},{r:1000,c:C.amber,o:.1},{r:3000,c:C.blue,o:.07}]
        : [{r:300,c:C.green,o:.18},{r:600,c:C.amber,o:.12},{r:1200,c:C.blue,o:.07}];
      circles.forEach(cfg => L.circle([coords.lat,coords.lon],{radius:cfg.r,color:cfg.c,fillColor:cfg.c,fillOpacity:cfg.o,weight:1.5,opacity:.5}).addTo(map));
      setTimeout(()=>map.invalidateSize(),100);
    });
    return ()=>{ if(leafRef.current){ leafRef.current.remove(); leafRef.current=null; } };
  }, [coords, classeActif]);

  const toggleLayer = () => {
    if (!layersRef.current) return;
    const {osm,sat,active,map} = layersRef.current;
    if (active==="osm") { map.removeLayer(osm); sat.addTo(map); layersRef.current.active="sat"; setSatellite(true); }
    else                { map.removeLayer(sat); osm.addTo(map); layersRef.current.active="osm"; setSatellite(false); }
  };

  const legendItems = classeActif==="logistique"||classeActif==="industriel"
    ? [{c:C.green,l:"5 km"},{c:C.blue,l:"20 km"}]
    : classeActif==="commerce"
    ? [{c:C.green,l:"500m – piétons"},{c:C.amber,l:"1km – proximité"},{c:C.blue,l:"3km – chalandise"}]
    : [{c:C.green,l:"300m – 5min"},{c:C.amber,l:"600m – 8min"},{c:C.blue,l:"1,2km – 15min TC"}];

  return (
    <div style={{borderRadius:16,overflow:"hidden",border:`1px solid ${C.navyLight}`,background:C.navyMid}}>
      {loading ? (
        <div style={{height:440,display:"flex",alignItems:"center",justifyContent:"center",color:C.grey400,fontSize:14}}>Géolocalisation…</div>
      ) : !coords ? (
        <div style={{height:440,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
          <span style={{color:C.grey400}}>Adresse non géolocalisée</span>
          <a href={gmUrl} target="_blank" rel="noopener noreferrer" style={{color:C.red,fontSize:13,textDecoration:"none",border:`1px solid ${C.redLight}`,padding:"6px 14px",borderRadius:8}}>Ouvrir dans Google Maps →</a>
        </div>
      ) : (
        <>
          <div style={{position:"relative"}}>
            <div ref={mapRef} style={{width:"100%",height:440}} />
            <button onClick={toggleLayer} style={{position:"absolute",top:10,right:10,zIndex:999,padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:satellite?C.amber:C.navyMid,color:satellite?C.navy:C.white,boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
              {satellite ? "🗺 Plan" : "🛰 Satellite"}
            </button>
          </div>
          <div style={{padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              {legendItems.map((li,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:li.c,opacity:.7}}/>
                  <span style={{fontSize:11,color:C.grey400}}>{li.l}</span>
                </div>
              ))}
            </div>
            <a href={gmUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:C.red,textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Google Maps
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Lease Table ──────────────────────────────────────────────────────────────
function LeaseTable({ locataires }) {
  if (!locataires?.length) return <div style={{textAlign:"center",color:C.grey400,padding:"32px 0"}}>Aucun locataire</div>;
  const cols = [
    {k:"nom",l:"Locataire",w:150},{k:"surface",l:"Surface",w:90},{k:"loyer_annuel",l:"Loyer/an",w:110},
    {k:"loyer_m2",l:"€/m²/an",w:90},{k:"date_debut_bail",l:"Début",w:80},{k:"date_break",l:"Break",w:80},
    {k:"date_fin_bail",l:"Fin bail",w:80},{k:"walb",l:"WALB",w:75},{k:"walt",l:"WALT",w:75},{k:"type_bail",l:"Type bail",w:110},
  ];
  return (
    <div style={{overflowX:"auto",borderRadius:12,border:`1px solid ${C.navyLight}`}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:960}}>
        <thead>
          <tr style={{background:C.navyLight}}>
            {cols.map(c=><th key={c.k} style={{padding:"10px 14px",textAlign:"left",color:C.grey400,fontWeight:600,fontSize:11,letterSpacing:".05em",whiteSpace:"nowrap",minWidth:c.w}}>{c.l.toUpperCase()}</th>)}
          </tr>
        </thead>
        <tbody>
          {locataires.map((loc,i)=>(
            <tr key={i} style={{background:i%2===0?C.navyMid:"rgba(19,32,80,.4)"}}>
              {cols.map(c=>(
                <td key={c.k} style={{padding:"10px 14px",color:c.k==="nom"?C.white:c.k==="walb"||c.k==="walt"?C.amber:C.grey200,fontWeight:c.k==="nom"?600:400,whiteSpace:"nowrap",borderBottom:`1px solid rgba(26,45,101,.5)`}}>
                  {loc[c.k]||"N/D"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Scoring Panel (fully transparent + editable weights) ─────────────────────
function ScoringPanel({ enriched }) {
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [open, setOpen]       = useState(false);
  const { total, sub } = computeScore(enriched, weights);
  const totalPct = Object.values(weights).reduce((a,w)=>a+w.pct, 0);
  const valid    = totalPct === 100;
  const noteColor= total>=7?C.green:total>=5?C.amber:C.red;
  const rec      = enriched?.verdict_independant?.recommandation;
  const recColor = rec==="À étudier"?C.green:rec==="Prudence"?C.amber:C.red;

  const howItWorks = [
    { comp:"Rendement", src:"Fiabilité IM déclarée par l'IA", logic:"IM conservateur → 8.2 | réaliste → 6.5 | optimiste → 4.2" },
    { comp:"Solidité locataires", src:"Note globale de l'IA ×1.05", logic:"Basé sur la solidité financière et la durée des baux" },
    { comp:"Localisation", src:"Note globale de l'IA ×0.95", logic:"Pondération légèrement réduite car plus subjectif" },
    { comp:"Dynamisme marché", src:"Tendance web (hausse/stable/baisse)", logic:"Hausse → 8 | Stable → 6 | Baisse → 4" },
    { comp:"Gestion des risques", src:"Vacance zone (faible/modérée/élevée)", logic:"Faible → 8 | Modérée → 6 | Élevée → 4" },
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Score card */}
      <div style={{borderRadius:16,border:`1px solid ${C.navyLight}`,background:C.navyMid,overflow:"hidden"}}>
        <div style={{background:`linear-gradient(135deg,${C.navyLight},${C.navyMid})`,padding:"24px 28px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:20}}>
          {/* Big score */}
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".08em",color:C.grey400,marginBottom:8}}>NOTE GLOBALE</div>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontSize:72,fontWeight:900,color:valid?noteColor:C.grey600,lineHeight:1}}>{valid?total:"—"}</span>
              <span style={{fontSize:24,color:C.grey600}}>/10</span>
            </div>
            {rec&&<span style={{marginTop:10,display:"inline-block",padding:"5px 16px",borderRadius:20,fontSize:13,fontWeight:700,background:`${recColor}20`,border:`1px solid ${recColor}50`,color:recColor}}>{rec}</span>}
          </div>
          {/* Sub-scores bars */}
          <div style={{display:"flex",flexDirection:"column",gap:10,minWidth:320}}>
            {Object.entries(weights).map(([k,w])=>{
              const score = sub[k]||5;
              const barColor = score>=7?C.green:score>=5?C.amber:C.red;
              return (
                <div key={k} style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{minWidth:160,fontSize:13,color:C.grey200,textAlign:"right"}}>{w.label} <span style={{color:C.grey600,fontSize:11}}>({w.pct}%)</span></div>
                  <div style={{flex:1,height:7,borderRadius:4,background:C.navyLight,overflow:"hidden"}}>
                    <div style={{width:`${(score/10)*100}%`,height:"100%",background:barColor,borderRadius:4,transition:"width .6s ease"}}/>
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:barColor,minWidth:30}}>{score.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Toggle methodology */}
        <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",padding:"12px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",borderTop:`1px solid ${C.navyLight}`,cursor:"pointer",color:C.grey400,fontSize:12}}>
          <span>⚙️ Méthodologie complète & personnalisation des pondérations</span>
          <span style={{transform:open?"rotate(180deg)":"none",transition:".2s",display:"inline-block"}}>▼</span>
        </button>
      </div>

      {/* Expandable methodology */}
      {open && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* How each score is calculated */}
          <div style={{borderRadius:14,border:`1px solid ${C.navyLight}`,background:C.navyMid,padding:"18px 20px"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".07em",color:C.grey400,marginBottom:14}}>📐 COMMENT CHAQUE SCORE EST CALCULÉ</div>
            <div style={{padding:"10px 14px",borderRadius:10,background:`${C.amber}10`,border:`1px solid ${C.amber}20`,fontSize:12,color:"#FCD34D",marginBottom:14}}>
              La note finale = somme des 5 scores × leur pondération. Les données proviennent de l'extraction IM et des recherches web. Aucun calcul caché.
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.navyLight}}>
                  {["Composante","Source de données","Logique de scoring"].map(h=>(
                    <th key={h} style={{padding:"8px 12px",textAlign:"left",color:C.grey400,fontWeight:600,fontSize:11,letterSpacing:".04em"}}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {howItWorks.map((row,i)=>(
                  <tr key={i} style={{background:i%2===0?C.navy:"transparent"}}>
                    <td style={{padding:"10px 12px",color:C.white,fontWeight:600,fontSize:12}}>{row.comp}</td>
                    <td style={{padding:"10px 12px",color:C.grey200,fontSize:12}}>{row.src}</td>
                    <td style={{padding:"10px 12px",color:C.grey400,fontSize:11,fontStyle:"italic"}}>{row.logic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Editable weights */}
          <div style={{borderRadius:14,border:`1px solid ${C.navyLight}`,background:C.navyMid,padding:"18px 20px"}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".07em",color:C.grey400,marginBottom:14}}>🎛 AJUSTER LES PONDÉRATIONS (total = 100%)</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
              {Object.entries(weights).map(([k,w])=>(
                <div key={k} style={{background:C.navy,borderRadius:10,padding:"14px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:600,color:C.white}}>{w.label}</span>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <input type="number" min="0" max="100" value={w.pct}
                        onChange={e=>setWeights(prev=>({...prev,[k]:{...prev[k],pct:Math.max(0,Math.min(100,parseInt(e.target.value)||0))}}))}
                        style={{width:54,padding:"4px 6px",borderRadius:6,border:`1px solid ${C.navyLight}`,background:C.navyMid,color:C.white,fontSize:13,fontWeight:700,textAlign:"center"}}/>
                      <span style={{fontSize:12,color:C.grey600}}>%</span>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:C.grey600,marginBottom:8}}>{w.desc}</div>
                  <div style={{fontSize:12,fontWeight:600,color:(sub[k]||5)>=7?C.green:(sub[k]||5)>=5?C.amber:C.red}}>
                    Score actuel : {(sub[k]||5).toFixed(1)}/10
                  </div>
                </div>
              ))}
            </div>
            {!valid&&<div style={{marginTop:12,textAlign:"center",fontSize:13,color:C.red,fontWeight:600}}>⚠️ Total actuel : {totalPct}% — doit faire 100%</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tenant Card ──────────────────────────────────────────────────────────────
function TenantCard({ loc, enrichedData }) {
  const el = (enrichedData||[]).find(x =>
    x.nom?.toLowerCase().includes((loc.nom||"").toLowerCase().slice(0,6)) ||
    (loc.nom||"").toLowerCase().includes((x.nom||"").toLowerCase().slice(0,6))
  );
  const hc = el?.sante_financiere==="solide"?C.green:el?.sante_financiere==="fragile"?C.red:C.amber;

  return (
    <div style={{borderRadius:14,border:`1px solid ${C.navyLight}`,background:C.navyMid,padding:20,marginBottom:12}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.white}}>{loc.nom}</div>
          <div style={{fontSize:12,color:C.grey400,marginTop:2}}>{loc.secteur}</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {el?.sante_financiere&&<span style={{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:600,background:`${hc}20`,border:`1px solid ${hc}40`,color:hc}}>● {el.sante_financiere.charAt(0).toUpperCase()+el.sante_financiere.slice(1)}</span>}
          {el?.risque&&<span style={{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:600,background:`${el.risque==="faible"?C.green:el.risque==="élevé"?C.red:C.amber}20`,border:`1px solid ${el.risque==="faible"?C.green:el.risque==="élevé"?C.red:C.amber}40`,color:el.risque==="faible"?C.green:el.risque==="élevé"?C.red:C.amber}}>Risque {el.risque}</span>}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:16}}>
        {[["Surface",loc.surface],["Loyer/an",loc.loyer_annuel],["€/m²/an",loc.loyer_m2],["WALB",loc.walb]].map(([l,v])=>(
          <div key={l} style={{background:C.navy,borderRadius:10,padding:"8px 12px"}}>
            <div style={{fontSize:11,color:C.grey400}}>{l}</div>
            <div style={{fontSize:13,fontWeight:600,color:C.white,marginTop:2}}>{v||"N/D"}</div>
          </div>
        ))}
      </div>

      {el&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={{background:C.navy,borderRadius:10,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.grey400,letterSpacing:".05em",marginBottom:10}}>DONNÉES FINANCIÈRES</div>
            {[["CA",el.chiffre_affaires],["Résultat net",el.resultat_net],["Effectifs",el.effectifs],["Notation",el.notation]].map(([l,v])=>v&&v!=="N/D"&&(
              <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:12,color:C.grey400}}>{l}</span>
                <span style={{fontSize:12,fontWeight:600,color:C.white}}>{v}</span>
              </div>
            ))}
            {el.actualites&&<div style={{marginTop:10,padding:8,background:`${C.amber}10`,borderRadius:8,border:`1px solid ${C.amber}20`}}>
              <div style={{fontSize:11,color:C.amber,marginBottom:4}}>📰 Actualités</div>
              <div style={{fontSize:12,color:C.grey200}}>{el.actualites}</div>
            </div>}
          </div>
          <div style={{background:C.navy,borderRadius:10,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.grey400,letterSpacing:".05em",marginBottom:8}}>ANALYSE & SOURCES</div>
            {el.commentaire&&<p style={{fontSize:12,color:C.grey200,lineHeight:1.6,marginBottom:12}}>{el.commentaire}</p>}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(el.sources||[]).map((s,i)=>(
                <a key={i} href={s.url||"#"} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.red,textDecoration:"none",padding:"5px 8px",borderRadius:7,border:`1px solid ${C.redLight}`,background:C.redLight}}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  {s.label||s}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asset-class panel ────────────────────────────────────────────────────────
function AssetClassPanel({ classeActif, analysis }) {
  if (!analysis) return null;
  const isLog = classeActif==="logistique"||classeActif==="industriel";
  const isCom = classeActif==="commerce";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {!isLog&&!isCom&&analysis.transports_detail&&(
        <Card title="Accessibilité TC" icon="🚆">
          {analysis.transports_detail.lignes_proches?.map((l,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:6}}>🚉 {l}</div>)}
          {analysis.transports_detail.isochrone_15min_tc&&<div style={{marginTop:8,padding:10,borderRadius:10,background:`${C.blue}15`,border:`1px solid ${C.blue}30`,fontSize:12,color:"#93C5FD"}}>🕐 Zone 15min : {analysis.transports_detail.isochrone_15min_tc}</div>}
        </Card>
      )}
      {isCom&&analysis.zone_chalandise&&(
        <Card title="Zone de Chalandise" icon="🏪">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            {[["Pop. 5min",analysis.zone_chalandise.population_5min],["Pop. 10min",analysis.zone_chalandise.population_10min],["Trafic piéton",analysis.zone_chalandise.trafic_pietonne]].filter(([,v])=>v&&v!=="N/D").map(([l,v])=>(
              <div key={l} style={{background:C.navy,borderRadius:9,padding:"9px 12px"}}><div style={{fontSize:11,color:C.grey400}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:C.white,marginTop:3}}>{v}</div></div>
            ))}
          </div>
          {analysis.zone_chalandise.concurrents_proches?.map((c,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:5}}><span style={{color:C.red}}>▸</span>{c}</div>)}
        </Card>
      )}
      {isLog&&analysis.accessibilite_logistique&&(
        <Card title="Accessibilité Logistique" icon="🛣️">
          {[["Autoroute",analysis.accessibilite_logistique.autoroute_plus_proche],["Port/Aéroport",analysis.accessibilite_logistique.port_aeroport]].filter(([,v])=>v&&v!=="N/D").map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:13,color:C.grey400}}>{l}</span><span style={{fontSize:13,color:C.white}}>{v}</span></div>
          ))}
          {analysis.accessibilite_logistique.axes_details?.map((a,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:5}}><span style={{color:C.green}}>▸</span>{a}</div>)}
        </Card>
      )}
      {analysis.concurrence?.length>0&&<Card title="Concurrence" icon="⚔️">{analysis.concurrence.map((c,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:5}}><span style={{color:C.amber}}>▸</span>{c}</div>)}</Card>}
      {analysis.points_specifiques?.length>0&&<Card title="Points Spécifiques" icon="🎯">{analysis.points_specifiques.map((p,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:5}}><span style={{color:C.blue}}>▸</span>{p}</div>)}</Card>}
    </div>
  );
}

// ─── UI primitives ────────────────────────────────────────────────────────────
function Card({ title, icon, children }) {
  return (
    <div style={{borderRadius:14,border:`1px solid ${C.navyLight}`,background:C.navyMid,padding:"18px 20px"}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:".07em",color:C.grey400,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><span>{icon}</span>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}
function KPI({ label, value, color=C.white, sub }) {
  return (
    <div style={{borderRadius:12,border:`1px solid ${C.navyLight}`,background:C.navyMid,padding:"14px 16px",textAlign:"center"}}>
      <div style={{fontSize:11,color:C.grey400,marginBottom:6}}>{label}</div>
      <div style={{fontSize:16,fontWeight:700,color}}>{value||"N/D"}</div>
      {sub&&<div style={{fontSize:11,color:C.grey600,marginTop:3}}>{sub}</div>}
    </div>
  );
}
function SwotGrid({ swot }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      {[{k:"forces",l:"Forces",icon:"💪",b:C.green},{k:"faiblesses",l:"Faiblesses",icon:"⚠️",b:C.red},{k:"opportunites",l:"Opportunités",icon:"🚀",b:C.blue},{k:"menaces",l:"Menaces",icon:"⛈️",b:C.amber}].map(({k,l,icon,b})=>(
        <div key={k} style={{borderRadius:14,border:`1px solid ${b}30`,background:`${b}08`,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:b,marginBottom:12}}>{icon} {l}</div>
          <ul style={{margin:0,padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:8}}>
            {(swot?.[k]||[]).map((s,i)=><li key={i} style={{fontSize:13,color:"#CBD5E1",display:"flex",gap:8}}><span style={{color:"#475569",flexShrink:0}}>—</span>{s}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
function StepBar({ step }) {
  const steps=[{l:"Lecture IM",icon:"📄"},{l:"Recherche web",icon:"🌐"},{l:"Synthèse",icon:"⚡"}];
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:24,flexWrap:"wrap"}}>
      {steps.map((s,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:600,border:`1px solid ${step>=i+1?C.red+"50":C.navyLight}`,background:step>=i+1?C.redLight:"transparent",color:step>=i+1?"#FCA5A5":C.grey600}}>
            {s.icon} {s.l}
            {step===i+1&&<span style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${C.red}50`,borderTopColor:C.red,display:"inline-block",animation:"spin .8s linear infinite"}}/>}
            {step>i+1 &&<span style={{color:C.green}}>✓</span>}
          </div>
          {i<2&&<div style={{width:24,height:1,background:step>i+1?C.red+"40":C.navyLight,margin:"0 4px"}}/>}
        </div>
      ))}
    </div>
  );
}

// ─── PDF Export ───────────────────────────────────────────────────────────────
function exportToPDF(im, enriched) {
  const w = window.open("","_blank");
  if (!w) return;
  const loc = enriched?.etat_locatif?.locataires || im?.etat_locatif?.locataires || [];
  const enrichedLoc = enriched?.locataires_analyse || [];
  const rows = loc.map(l=>{
    const e = enrichedLoc.find(x=>x.nom?.toLowerCase().includes((l.nom||"").toLowerCase().slice(0,5)));
    return `<tr><td>${l.nom||""}</td><td>${l.surface||""}</td><td>${l.loyer_annuel||""}</td><td>${l.loyer_m2||""}</td><td>${l.date_break||""}</td><td>${l.date_fin_bail||""}</td><td>${l.walb||""}</td><td>${e?.sante_financiere||"N/D"}</td></tr>`;
  }).join("");

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Analyse – ${im?.titre||"Actif"}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#0B1437;margin:0;padding:0;font-size:13px}
    .banner{background:#0B1437;color:white;padding:30px 44px 26px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:16}
    .banner h1{margin:0 0 6px;font-size:22px;font-weight:900}
    .banner .sub{font-size:12px;color:#8492A6;margin-top:4px}
    .banner .badge{padding:5px 16px;border-radius:20px;font-size:12px;font-weight:700;background:rgba(232,38,42,.18);border:1px solid rgba(232,38,42,.4);color:#E8262A}
    .sky-bar{background:#4A90D9;height:4px}
    .body{padding:28px 44px}
    h2{font-size:12px;font-weight:700;color:#0B1437;border-bottom:2px solid #4A90D9;padding-bottom:6px;margin:26px 0 14px;letter-spacing:.06em;text-transform:uppercase}
    .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:22px}
    .kpi{background:#F0F4F8;border-radius:10px;padding:12px 10px;text-align:center}
    .kpi .v{font-size:17px;font-weight:800;color:#0B1437;margin-top:4px}
    .kpi .l{font-size:10px;color:#8492A6;text-transform:uppercase;letter-spacing:.04em}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px}
    th{background:#0B1437;color:white;padding:8px 10px;text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase}
    td{padding:8px 10px;border-bottom:1px solid #E4E9F2;vertical-align:top}
    tr:nth-child(even) td{background:#F8FAFC}
    .swot{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
    .swot-cell{border-radius:10px;padding:14px}
    .swot-cell strong{font-size:12px}
    .swot-cell ul{margin:6px 0 0;padding:0 0 0 14px;line-height:1.8;font-size:12px}
    .verdict{background:#F0F4F8;border-radius:12px;padding:14px 18px;margin-bottom:20px;font-style:italic;color:#475569;line-height:1.7;font-size:13px}
    .footer{margin-top:40px;font-size:10px;color:#8492A6;border-top:1px solid #E4E9F2;padding-top:12px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="banner">
    <div>
      <div style="font-size:10px;letter-spacing:.1em;color:#E8262A;font-weight:700;margin-bottom:10px;text-transform:uppercase">RE Investment Analyzer · Fiche Synthétique</div>
      <h1>${im?.titre||"Actif Immobilier"}</h1>
      <div class="sub">${im?.localisation?.adresse||""} — ${im?.localisation?.ville||""}, ${im?.localisation?.pays||""}</div>
      <div class="sub">Classe d'actif : ${im?.classe_actif||""} · Généré le ${new Date().toLocaleDateString("fr-FR")}</div>
    </div>
    ${enriched?.verdict_independant?.recommandation?`<div class="badge">${enriched.verdict_independant.recommandation}</div>`:""}
  </div>
  <div class="sky-bar"></div>
  <div class="body">
    <div class="kpis">
      <div class="kpi"><div class="l">Prix demandé</div><div class="v">${im?.financier?.prix_demande||"N/D"}</div></div>
      <div class="kpi"><div class="l">Rendement</div><div class="v" style="color:#E8262A">${im?.financier?.rendement_vendeur||"N/D"}</div></div>
      <div class="kpi"><div class="l">Surface</div><div class="v">${im?.etat_locatif?.surface_totale||"N/D"}</div></div>
      <div class="kpi"><div class="l">WALB</div><div class="v">${im?.durees_engagement?.walb||"N/D"}</div></div>
      <div class="kpi"><div class="l">Occupation</div><div class="v" style="color:#10B981">${im?.etat_locatif?.taux_occupation||"N/D"}</div></div>
    </div>
    ${enriched?.verdict_independant?.resume?`<div class="verdict">"${enriched.verdict_independant.resume}"</div>`:""}
    <h2>État Locatif</h2>
    <table><thead><tr><th>Locataire</th><th>Surface</th><th>Loyer/an</th><th>€/m²/an</th><th>Break</th><th>Fin bail</th><th>WALB</th><th>Santé</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Marché Locatif</h2>
    <table><thead><tr><th>Indicateur</th><th>Selon IM</th><th>Marché réel (web)</th></tr></thead><tbody>
      <tr><td>Loyer marché</td><td>${im?.marche_locatif_im?.loyer_marche_cite||"N/D"}</td><td>${enriched?.marche_locatif_reel?.fourchette_loyers||"N/D"}</td></tr>
      <tr><td>Tendance</td><td>—</td><td>${enriched?.marche_locatif_reel?.tendance||"N/D"}</td></tr>
      <tr><td>Vacance zone</td><td>—</td><td>${enriched?.marche_locatif_reel?.vacance_zone||"N/D"}</td></tr>
    </tbody></table>
    ${enriched?.marche_locatif_reel?.analyse?`<p style="font-size:12px;color:#475569;line-height:1.7;margin-bottom:20px">${enriched.marche_locatif_reel.analyse}</p>`:""}
    <h2>SWOT</h2>
    <div class="swot">
      <div class="swot-cell" style="background:#f0fdf4;border:1px solid #bbf7d0"><strong style="color:#059669">💪 Forces</strong><ul>${(enriched?.swot?.forces||[]).map(s=>`<li>${s}</li>`).join("")}</ul></div>
      <div class="swot-cell" style="background:#fef2f2;border:1px solid #fecaca"><strong style="color:#dc2626">⚠️ Faiblesses</strong><ul>${(enriched?.swot?.faiblesses||[]).map(s=>`<li>${s}</li>`).join("")}</ul></div>
      <div class="swot-cell" style="background:#eff6ff;border:1px solid #bfdbfe"><strong style="color:#2563eb">🚀 Opportunités</strong><ul>${(enriched?.swot?.opportunites||[]).map(s=>`<li>${s}</li>`).join("")}</ul></div>
      <div class="swot-cell" style="background:#fffbeb;border:1px solid #fde68a"><strong style="color:#d97706">⛈️ Menaces</strong><ul>${(enriched?.swot?.menaces||[]).map(s=>`<li>${s}</li>`).join("")}</ul></div>
    </div>
    <p class="footer">Analyse générée par RE Investment Analyzer. Données issues de l'IM fourni et de sources web publiques. Ce document ne constitue pas un conseil en investissement.</p>
  </div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`);
  w.document.close();
}

// ─── Main Result Sheet ────────────────────────────────────────────────────────
function ResultSheet({ im, enriched, onReset }) {
  const [tab, setTab] = useState("overview");
  const rec      = enriched?.verdict_independant?.recommandation;
  const recColor = rec==="À étudier"?C.green:rec==="Prudence"?C.amber:C.red;

  const tabs = [
    {id:"overview",    l:"Vue d'ensemble",     icon:"📋"},
    {id:"score",       l:"Note & Scoring",      icon:"⭐"},
    {id:"localisation",l:"Carte",               icon:"📍"},
    {id:"etat_locatif",l:"État Locatif",        icon:"📊"},
    {id:"locataires",  l:"Locataires",          icon:"🏢"},
    {id:"marche",      l:"Marché",              icon:"💹"},
    {id:"projets",     l:"Projets Zone",        icon:"🏗️"},
    {id:"swot",        l:"SWOT",                icon:"⚡"},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>

      {/* ── Banner (bleu foncé → barre sky) ── */}
      <div style={{background:`linear-gradient(135deg, ${C.navy} 0%, ${C.navyMid} 100%)`,borderBottom:`4px solid ${C.sky}`}}>
        <div style={{maxWidth:1400,margin:"0 auto",padding:"26px 40px 22px",display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:10,letterSpacing:".1em",color:C.sky,fontWeight:700,marginBottom:8,textTransform:"uppercase"}}>RE Investment Analyzer · Fiche Synthétique · Sources croisées</div>
            <h2 style={{fontSize:24,fontWeight:900,color:C.white,margin:"0 0 5px"}}>{im.titre||"Actif Immobilier"}</h2>
            <p style={{fontSize:13,color:C.grey400,margin:0}}>{im.localisation?.adresse} — {im.localisation?.ville}, {im.localisation?.pays}</p>
            <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
              <span style={{padding:"3px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:`${C.sky}20`,border:`1px solid ${C.sky}40`,color:C.sky}}>{im.classe_actif}</span>
              <span style={{padding:"3px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:enriched.verdict_independant?.fiabilite_im==="optimiste"?`${C.red}20`:`${C.green}20`,border:`1px solid ${enriched.verdict_independant?.fiabilite_im==="optimiste"?C.red:C.green}40`,color:enriched.verdict_independant?.fiabilite_im==="optimiste"?"#FCA5A5":"#6EE7B7"}}>IM {enriched.verdict_independant?.fiabilite_im}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {rec&&<span style={{padding:"6px 18px",borderRadius:20,fontSize:13,fontWeight:700,background:`${recColor}20`,border:`1px solid ${recColor}50`,color:recColor}}>{rec}</span>}
            <button onClick={()=>exportToPDF(im,enriched)} style={{padding:"9px 18px",borderRadius:10,fontSize:13,fontWeight:700,border:`1px solid ${C.sky}40`,background:`${C.sky}15`,color:C.sky,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exporter PDF
            </button>
            <button onClick={onReset} style={{padding:"9px 18px",borderRadius:10,fontSize:13,fontWeight:600,border:`1px solid ${C.navyLight}`,background:"transparent",color:C.grey400,cursor:"pointer"}}>← Nouveau</button>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{maxWidth:1400,margin:"0 auto",padding:"0 40px 0",display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,paddingBottom:0}}>
          {[["Prix demandé",im.financier?.prix_demande,C.white],["Rendement",im.financier?.rendement_vendeur,C.amber],["Surface",im.etat_locatif?.surface_totale,C.white],["WALB",im.durees_engagement?.walb,"#93C5FD"],["Occupation",im.etat_locatif?.taux_occupation,C.green]].map(([l,v,c])=>(
            <div key={l} style={{textAlign:"center",padding:"14px 8px"}}>
              <div style={{fontSize:11,color:C.grey600,marginBottom:4,letterSpacing:".03em"}}>{l}</div>
              <div style={{fontSize:17,fontWeight:700,color:c}}>{v||"N/D"}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div style={{maxWidth:1400,margin:"0 auto",padding:"0 40px",display:"flex",gap:0,overflowX:"auto",borderTop:`1px solid ${C.navyLight}`}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"14px 18px",fontSize:13,fontWeight:600,whiteSpace:"nowrap",cursor:"pointer",background:"none",border:"none",borderBottom:`3px solid ${tab===t.id?C.sky:"transparent"}`,color:tab===t.id?C.white:C.grey400,transition:"all .15s",display:"flex",alignItems:"center",gap:6}}>
              {t.icon} {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div style={{flex:1,background:C.navy}}>
        <div style={{maxWidth:1400,margin:"0 auto",padding:"28px 40px"}}>

          {tab==="overview"&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
              <Card title="Structure Financière" icon="💰">
                {[["Prix demandé",im.financier?.prix_demande],["Rdt vendeur",im.financier?.rendement_vendeur],["Rdt brut calculé",im.financier?.rendement_brut_calcule],["Valeur /m²",im.financier?.valeur_m2],["VLM (IM)",im.financier?.valeur_locative_theorique],["Loyer total/an",im.etat_locatif?.loyer_total_annuel]].map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.navyLight}`}}>
                    <span style={{fontSize:13,color:C.grey400}}>{l}</span><span style={{fontSize:13,fontWeight:600,color:C.amber}}>{v||"N/D"}</span>
                  </div>
                ))}
              </Card>
              <Card title="Durées d'Engagement" icon="📅">
                {[["WALB",im.durees_engagement?.walb,"#93C5FD"],["WALT",im.durees_engagement?.walt,C.white],["Bail le + long",im.durees_engagement?.bail_plus_long,C.green],["Bail le + court",im.durees_engagement?.bail_plus_court,C.amber]].map(([l,v,c])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.navyLight}`}}>
                    <span style={{fontSize:13,color:C.grey400}}>{l}</span><span style={{fontSize:13,fontWeight:600,color:c}}>{v||"N/D"}</span>
                  </div>
                ))}
              </Card>
              <Card title="Contexte de Marché" icon="🌍">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{fontSize:13,color:C.grey400}}>Dynamisme</span>
                  <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:`${C.sky}20`,color:C.sky}}>{enriched.contexte_marche?.dynamisme||"N/D"}</span>
                </div>
                <p style={{fontSize:12,color:C.grey400,lineHeight:1.6,margin:0}}>{enriched.contexte_marche?.tendance_investisseurs}</p>
              </Card>
              {enriched.verdict_independant?.resume&&(
                <div style={{gridColumn:"1/-1",padding:"16px 20px",borderRadius:14,background:C.navyMid,border:`1px solid ${C.navyLight}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.grey400,letterSpacing:".07em",marginBottom:8}}>💬 SYNTHÈSE ANALYSTE</div>
                  <p style={{fontSize:13,color:"#94A3B8",lineHeight:1.7,margin:0,fontStyle:"italic"}}>"{enriched.verdict_independant.resume}"</p>
                </div>
              )}
              {enriched.verdict_independant?.points_divergence?.length>0&&(
                <div style={{gridColumn:"1/-1",padding:"14px 18px",borderRadius:14,background:`${C.red}08`,border:`1px solid ${C.red}25`}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.red,marginBottom:10}}>⚠️ ÉCARTS IM vs RÉALITÉ</div>
                  {enriched.verdict_independant.points_divergence.map((p,i)=><p key={i} style={{fontSize:13,color:"#94A3B8",marginTop:4}}>▸ {p}</p>)}
                </div>
              )}
            </div>
          )}

          {tab==="score"&&<ScoringPanel enriched={enriched}/>}

          {tab==="localisation"&&(
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:18}}>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <MapComponent adresse={im.localisation?.adresse} ville={im.localisation?.ville} pays={im.localisation?.pays} classeActif={im.classe_actif}/>
                <Card title="Analyse Localisation (IM)" icon="📍">
                  <p style={{fontSize:13,color:C.grey200,lineHeight:1.7,margin:0}}>{im.localisation?.analyse_im||"N/D"}</p>
                </Card>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <Card title="Transports" icon="🚆">
                  {/* Universal transport — no Paris-specific labels */}
                  {[
                    {icon:"🚇", label:"Métro / Subway", lines:im.transports?.metro},
                    {icon:"🚋", label:"Tramway",         lines:im.transports?.tram},
                    {icon:"🚂", label:"Train / RER",     lines:im.transports?.rer},
                    {icon:"🚌", label:"Bus",             lines:im.transports?.bus},
                  ].map(({icon,label,lines})=>
                    lines?.length>0 && lines[0]!=="N/D" ? (
                      <div key={label} style={{marginBottom:12}}>
                        <div style={{fontSize:11,color:C.grey600,marginBottom:5,letterSpacing:".04em"}}>{icon} {label.toUpperCase()}</div>
                        {lines.map((l,i)=><div key={i} style={{fontSize:13,color:C.grey200,marginBottom:3}}>▸ {l}</div>)}
                      </div>
                    ) : null
                  )}
                  {im.transports?.gare&&im.transports.gare!=="N/D"&&(
                    <div><div style={{fontSize:11,color:C.grey600,marginBottom:5}}>🚉 GARE</div><div style={{fontSize:13,color:C.grey200}}>▸ {im.transports.gare}</div></div>
                  )}
                </Card>
                <AssetClassPanel classeActif={im.classe_actif} analysis={enriched.analyse_classe_actif}/>
              </div>
            </div>
          )}

          {tab==="etat_locatif"&&(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
                <KPI label="Taux occupation" value={im.etat_locatif?.taux_occupation} color={C.green}/>
                <KPI label="Surface totale"  value={im.etat_locatif?.surface_totale}  color={C.white}/>
                <KPI label="Loyer total/an"  value={im.etat_locatif?.loyer_total_annuel} color={C.amber}/>
                <KPI label="Nb locataires"   value={im.etat_locatif?.locataires?.length?.toString()} color={C.white}/>
              </div>
              <Card title="Tableau des Baux" icon="📋">
                <LeaseTable locataires={im.etat_locatif?.locataires}/>
              </Card>
            </div>
          )}

          {tab==="locataires"&&(
            <div>
              <div style={{padding:"10px 14px",borderRadius:10,background:`${C.amber}10`,border:`1px solid ${C.amber}20`,fontSize:12,color:"#FCD34D",marginBottom:16}}>
                ℹ️ Données croisées avec sources web publiques. Cliquez les liens pour vérifier.
              </div>
              {im.etat_locatif?.locataires?.map((loc,i)=><TenantCard key={i} loc={loc} enrichedData={enriched.locataires_analyse}/>)}
            </div>
          )}

          {tab==="marche"&&(
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:18}}>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  <KPI label="Loyer IM"         value={im.marche_locatif_im?.loyer_marche_cite}         color={C.grey200} sub="Source : IM"/>
                  <KPI label="Loyer réel (web)" value={enriched.marche_locatif_reel?.fourchette_loyers} color={C.white}   sub="Source : Web"/>
                  <KPI label="Tendance"         value={enriched.marche_locatif_reel?.tendance}          color={enriched.marche_locatif_reel?.tendance==="hausse"?C.green:enriched.marche_locatif_reel?.tendance==="baisse"?C.red:C.amber}/>
                </div>
                <Card title="Analyse Marché" icon="🔍">
                  <p style={{fontSize:13,color:C.grey200,lineHeight:1.7,marginBottom:16}}>{enriched.marche_locatif_reel?.analyse}</p>
                  {enriched.marche_locatif_reel?.offres_trouvees?.length>0&&(
                    <><div style={{fontSize:11,color:C.grey600,marginBottom:10,letterSpacing:".05em"}}>OFFRES OBSERVÉES</div>
                    {enriched.marche_locatif_reel.offres_trouvees.map((o,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderRadius:10,background:C.navy,gap:12,marginBottom:6}}>
                        <span style={{fontSize:13,color:C.grey200}}>▸ {o.description||o}</span>
                        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                          {o.loyer&&<span style={{fontSize:13,fontWeight:700,color:C.amber}}>{o.loyer}</span>}
                          {o.source_url&&o.source_url!=="https://..."&&<a href={o.source_url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:C.red,textDecoration:"none",border:`1px solid ${C.redLight}`,padding:"3px 8px",borderRadius:6}}>🔗 Source</a>}
                        </div>
                      </div>
                    ))}</>
                  )}
                </Card>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <Card title="Risques Macro" icon="📉">
                  {(enriched.contexte_marche?.risques_macro||[]).map((r,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:8}}><span style={{color:C.red}}>▸</span>{r}</div>)}
                </Card>
                <Card title="Opportunités Macro" icon="📈">
                  {(enriched.contexte_marche?.opportunites_macro||[]).map((o,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:C.grey200,marginBottom:8}}><span style={{color:C.green}}>▸</span>{o}</div>)}
                </Card>
              </div>
            </div>
          )}

          {tab==="projets"&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {(!enriched.projets_zone||enriched.projets_zone.length===0)?(
                <div style={{gridColumn:"1/-1",textAlign:"center",color:C.grey400,padding:"48px 0"}}>Aucun projet identifié dans la zone</div>
              ):enriched.projets_zone.map((p,i)=>(
                <div key={i} style={{borderRadius:14,border:`1px solid ${C.navyLight}`,background:C.navyMid,padding:16,display:"flex",gap:14}}>
                  <div style={{width:42,height:42,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,background:p.impact==="positif"?`${C.green}20`:p.impact==="négatif"?`${C.red}20`:`${C.grey600}20`,flexShrink:0}}>
                    {p.type==="bureau"?"🏢":p.type==="hotel"?"🏨":p.type==="logement"?"🏠":p.type==="transport"?"🚇":"🏗️"}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                      <span style={{fontSize:14,fontWeight:700,color:C.white}}>{p.nom}</span>
                      <span style={{padding:"2px 8px",borderRadius:6,fontSize:11,fontWeight:600,background:p.impact==="positif"?`${C.green}20`:p.impact==="négatif"?`${C.red}20`:`${C.grey600}20`,color:p.impact==="positif"?C.green:p.impact==="négatif"?C.red:C.grey400}}>{p.impact}</span>
                      <span style={{padding:"2px 8px",borderRadius:6,fontSize:11,background:`${C.blue}15`,color:"#93C5FD"}}>{p.statut}</span>
                    </div>
                    <p style={{fontSize:13,color:C.grey400,margin:0}}>{p.description}</p>
                    {p.source_url&&p.source_url!=="https://..."&&<a href={p.source_url} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:8,fontSize:11,color:C.red,textDecoration:"none"}}>🔗 Source</a>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab==="swot"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <SwotGrid swot={enriched.swot}/>
              {enriched.verdict_independant?.points_divergence?.length>0&&(
                <div style={{borderRadius:14,border:`1px solid ${C.red}25`,background:`${C.red}08`,padding:20}}>
                  <div style={{fontSize:11,fontWeight:700,letterSpacing:".07em",color:C.red,marginBottom:12}}>⚠️ POINTS DE VIGILANCE CRITIQUES</div>
                  {enriched.verdict_independant.points_divergence.map((p,i)=><div key={i} style={{display:"flex",gap:8,fontSize:13,color:"#CBD5E1",marginBottom:8}}><span style={{color:C.red}}>▸</span>{p}</div>)}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [file,     setFile]     = useState(null);
  const [dragging, setDragging] = useState(false);
  const [step,     setStep]     = useState(0);
  const [imData,   setImData]   = useState(null);
  const [enriched, setEnriched] = useState(null);
  const [error,    setError]    = useState("");
  const inputRef = useRef();

  const handleFile = useCallback((f) => {
    if (!f) return;
    if (f.type!=="application/pdf") { setError("PDF uniquement."); return; }
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
    } catch(e) {
      setError("Erreur : "+e.message);
      setStep(0);
    }
  };

  const reset = () => { setStep(0); setFile(null); setImData(null); setEnriched(null); setError(""); };
  const done  = step===3 && imData && enriched;

  return (
    <>
      <Head>
        <title>RE Investment Analyzer</title>
        <meta name="description" content="Analyse d'Investment Memorandum immobilier"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
        <style>{`
          *{-webkit-font-smoothing:antialiased;box-sizing:border-box}
          body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif;background:${C.navy}}
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          ::-webkit-scrollbar{width:5px;height:5px}
          ::-webkit-scrollbar-track{background:${C.navy}}
          ::-webkit-scrollbar-thumb{background:${C.navyLight};border-radius:3px}
          .leaflet-container{font-family:-apple-system,BlinkMacSystemFont,sans-serif}
        `}</style>
      </Head>

      <div style={{minHeight:"100vh",background:C.navy,color:C.white}}>
        {!done ? (
          <div style={{maxWidth:640,margin:"0 auto",padding:"64px 24px"}}>
            <div style={{marginBottom:42}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <div style={{width:34,height:34,borderRadius:10,background:`${C.red}20`,border:`1px solid ${C.red}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>🏛</div>
                <span style={{fontSize:11,letterSpacing:".1em",fontWeight:700,color:C.grey600}}>RE INVESTMENT ANALYZER</span>
              </div>
              <h1 style={{fontSize:34,fontWeight:900,color:C.white,margin:"0 0 10px"}}>Analyse d'<span style={{color:C.red}}>Investment Memorandum</span></h1>
              <p style={{fontSize:13,color:C.grey600,margin:0,lineHeight:1.6}}>Carte interactive · État locatif complet · Santé financière des locataires · Loyers de marché réels · Export PDF</p>
            </div>

            <div onClick={()=>!step&&inputRef.current?.click()}
              onDrop={e=>{e.preventDefault();setDragging(false);handleFile(e.dataTransfer.files[0]);}}
              onDragOver={e=>{e.preventDefault();setDragging(true);}}
              onDragLeave={()=>setDragging(false)}
              style={{borderRadius:18,border:`2px dashed ${dragging?C.red:C.navyLight}`,background:dragging?C.redLight:`${C.navyMid}80`,cursor:step>0?"default":"pointer",opacity:step>0?.5:1,padding:"54px 24px",textAlign:"center",marginBottom:20,transition:"all .2s"}}>
              <input ref={inputRef} type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
              <div style={{fontSize:40,marginBottom:12}}>{dragging?"📂":"📄"}</div>
              {file?(
                <div><p style={{fontWeight:700,color:C.white,fontSize:15,margin:"0 0 4px"}}>{file.name}</p><p style={{fontSize:12,color:C.grey600,margin:0}}>{(file.size/1024/1024).toFixed(2)} MB</p></div>
              ):(
                <div><p style={{fontWeight:600,color:C.white,fontSize:15,margin:"0 0 6px"}}>Glissez votre Investment Memorandum</p><p style={{fontSize:13,color:C.grey600,margin:0}}>ou cliquez · PDF uniquement</p></div>
              )}
            </div>

            {error&&<div style={{marginBottom:16,borderRadius:10,padding:"10px 14px",fontSize:13,background:`${C.red}15`,border:`1px solid ${C.red}35`,color:"#FCA5A5"}}>{error}</div>}
            {step>0&&<StepBar step={step}/>}
            {file&&step===0&&(
              <button onClick={analyze} style={{width:"100%",borderRadius:14,fontWeight:700,padding:"14px 24px",fontSize:14,letterSpacing:".03em",cursor:"pointer",background:C.red,color:C.white,border:"none",transition:"background .15s"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.redMid}
                onMouseLeave={e=>e.currentTarget.style.background=C.red}>
                Lancer l'analyse complète →
              </button>
            )}
          </div>
        ) : (
          <div style={{animation:"fadeIn .4s ease-out"}}>
            <ResultSheet im={imData} enriched={enriched} onReset={reset}/>
          </div>
        )}
      </div>
    </>
  );
}
