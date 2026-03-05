import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

async function uploadToBlob(file) {
  const { upload } = await import('@vercel/blob/client');
  const blob = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/upload',
  });
  return blob.url;
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

function MapEmbed({ adresse, ville, pays }) {
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(true);
  const q = encodeURIComponent(`${adresse || ""} ${ville || ""} ${pays || ""}`.trim());

  useEffect(() => {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`)
      .then(r => r.json())
      .then(data => { if (data[0]) setCoords({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }); setLoading(false); })
      .catch(() => setLoading(false));
  }, [q]);

  const gmUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;

  if (loading) return (
    <div className="rounded-xl border border-slate-700/40 h-52 flex items-center justify-center text-slate-600 text-sm">
      <span className="animate-pulse">Géolocalisation…</span>
    </div>
  );
  if (!coords) return (
    <div className="rounded-xl border border-slate-700/40 h-52 flex flex-col items-center justify-center gap-2">
      <span className="text-slate-500 text-sm">Adresse non géolocalisée</span>
      <a href={gmUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 text-xs underline">Google Maps →</a>
    </div>
  );

  const bbox = 0.008;
  const osmSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - bbox},${coords.lat - bbox},${coords.lon + bbox},${coords.lat + bbox}&layer=mapnik&marker=${coords.lat},${coords.lon}`;

  return (
    <div className="rounded-xl border border-slate-700/40 overflow-hidden">
      <iframe src={osmSrc} width="100%" height="280" style={{ border: "none", display: "block", filter: "invert(0.88) hue-rotate(180deg) saturate(0.6)" }} title="Carte" loading="lazy" />
      <div className="bg-slate-800/80 px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-slate-400 truncate">📍 {adresse}, {ville}</span>
        <a href={gmUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 hover:text-amber-300 whitespace-nowrap ml-3 underline underline-offset-2">Google Maps →</a>
      </div>
    </div>
  );
}

const BADGE_COLORS = {
  blue:  "bg-blue-900/30 text-blue-300 border-blue-700/40",
  green: "bg-emerald-900/30 text-emerald-300 border-emerald-700/40",
  amber: "bg-amber-900/30 text-amber-300 border-amber-700/40",
  red:   "bg-red-900/30 text-red-300 border-red-700/40",
  slate: "bg-slate-700/30 text-slate-300 border-slate-600/40",
};
function Badge({ children, color = "slate" }) {
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${BADGE_COLORS[color]}`}>{children}</span>;
}
function Card({ title, icon, children, accent }) {
  return (
    <div className={`rounded-xl border p-5 ${accent ? "border-amber-700/30 bg-amber-950/8" : "border-slate-700/35 bg-slate-800/20"}`}>
      <h3 className="text-xs font-semibold tracking-widest uppercase text-slate-500 mb-4 flex items-center gap-2"><span>{icon}</span>{title}</h3>
      {children}
    </div>
  );
}
function RiskTag({ v }) {
  const m = { solide:["green","Solide"], correcte:["amber","Correcte"], fragile:["red","Fragile"], inconnue:["slate","Inconnue"], faible:["green","Faible"], moyen:["amber","Moyen"], élevé:["red","Élevé"] };
  const [c, l] = m[v] || ["slate", v || "N/D"];
  return <Badge color={c}>● {l}</Badge>;
}
function SwotGrid({ swot }) {
  const items = [
    { k:"forces",       label:"Forces",       icon:"💪", bg:"bg-emerald-950/20 border-emerald-700/30", tc:"text-emerald-400" },
    { k:"faiblesses",   label:"Faiblesses",   icon:"⚠️", bg:"bg-red-950/20 border-red-700/30",        tc:"text-red-400" },
    { k:"opportunites", label:"Opportunités", icon:"🚀", bg:"bg-blue-950/20 border-blue-700/30",       tc:"text-blue-400" },
    { k:"menaces",      label:"Menaces",      icon:"🌩️", bg:"bg-amber-950/20 border-amber-700/30",    tc:"text-amber-400" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(b => (
        <div key={b.k} className={`rounded-xl border p-4 ${b.bg}`}>
          <div className={`text-xs font-bold tracking-wider uppercase mb-3 ${b.tc}`}>{b.icon} {b.label}</div>
          <ul className="space-y-1.5">{(swot?.[b.k]||[]).map((s,i)=><li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-slate-600 shrink-0">—</span>{s}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
function StepBar({ step }) {
  const steps = [{ label:"Lecture IM", icon:"📄" }, { label:"Recherche web", icon:"🌐" }, { label:"Synthèse", icon:"⚡" }];
  return (
    <div className="flex items-center justify-center gap-1 mb-6 flex-wrap">
      {steps.map((s,i) => (
        <div key={i} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${step >= i+1 ? "bg-amber-500/15 text-amber-300 border-amber-500/35" : "text-slate-600 border-slate-700/30"}`}>
            {s.icon} {s.label}
            {step === i+1 && <span className="w-3 h-3 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin" />}
            {step > i+1  && <span className="text-emerald-400">✓</span>}
          </div>
          {i < 2 && <div className={`w-6 h-px mx-1 ${step > i+1 ? "bg-amber-500/40" : "bg-slate-700/40"}`} />}
        </div>
      ))}
    </div>
  );
}

function ResultSheet({ im, enriched }) {
  const [tab, setTab] = useState("overview");
  const rec = enriched.verdict_independant?.recommandation;
  const recColor = rec === "À étudier" ? "green" : rec === "Prudence" ? "amber" : "red";
  const tabs = [
    { id:"overview",     label:"Vue d'ensemble",     icon:"📋" },
    { id:"localisation", label:"Localisation + Carte",icon:"📍" },
    { id:"locataires",   label:"Locataires",          icon:"🏢" },
    { id:"marche",       label:"Marché",              icon:"📊" },
    { id:"projets",      label:"Projets zone",        icon:"🏗️" },
    { id:"swot",         label:"SWOT",                icon:"⚡" },
  ];

  return (
    <div className="animate-fadeIn space-y-5">
      <div className="rounded-2xl border border-slate-700/40 bg-gradient-to-br from-slate-800/70 to-slate-900/70 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-72 h-72 bg-amber-500/4 rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="relative">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs tracking-widest uppercase text-amber-500/70 mb-1">Fiche Synthétique · Sources croisées</p>
              <h2 className="text-2xl font-bold text-white">{im.titre || "Actif Immobilier"}</h2>
              <p className="text-slate-500 text-sm mt-1">{im.localisation?.adresse} — {im.localisation?.ville}</p>
              <div className="flex gap-2 mt-3 flex-wrap">
                <Badge color="slate">{im.classe_actif}</Badge>
                <Badge color={enriched.verdict_independant?.fiabilite_im === "optimiste" ? "red" : enriched.verdict_independant?.fiabilite_im === "réaliste" ? "green" : "amber"}>
                  IM {enriched.verdict_independant?.fiabilite_im}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <Badge color={recColor}>{rec}</Badge>
              <div className="text-5xl font-black text-white mt-2 leading-none">{enriched.verdict_independant?.note}</div>
              <div className="text-xs text-slate-600 mt-1">/10</div>
            </div>
          </div>
          {enriched.verdict_independant?.resume && (
            <p className="mt-5 text-slate-300 text-sm leading-relaxed border-t border-slate-700/40 pt-4 italic">
              "{enriched.verdict_independant.resume}"
            </p>
          )}
          {enriched.verdict_independant?.points_divergence?.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-950/20 border border-red-700/25">
              <p className="text-xs text-red-400 font-semibold mb-1.5">⚠️ Écarts IM vs Réalité</p>
              {enriched.verdict_independant.points_divergence.map((p,i) => <p key={i} className="text-xs text-slate-400 mt-0.5">▸ {p}</p>)}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Prix demandé",     im.financier?.prix_demande,        "text-white"],
          ["Rendement vendeur",im.financier?.rendement_vendeur,   "text-amber-300"],
          ["Surface totale",   im.etat_locatif?.surface_totale,   "text-white"],
          ["WAL",              im.durees_engagement?.wal,         "text-blue-300"],
        ].map(([l,v,c]) => (
          <div key={l} className="rounded-xl border border-slate-700/35 bg-slate-800/25 p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">{l}</div>
            <div className={`text-sm font-bold ${c}`}>{v || "N/D"}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${tab === t.id ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "text-slate-500 hover:text-slate-300 border-transparent"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Card title="Structure Financière" icon="💰" accent>
            <div className="grid grid-cols-2 gap-2">
              {[["Prix demandé",im.financier?.prix_demande],["Rdt vendeur",im.financier?.rendement_vendeur],["Rdt brut calculé",im.financier?.rendement_brut_calcule],["Valeur /m²",im.financier?.valeur_m2],["VLM selon IM",im.financier?.valeur_locative_theorique],["Loyer total/an",im.etat_locatif?.loyer_total_annuel]].map(([l,v]) => (
                <div key={l} className="bg-slate-800/50 rounded-lg p-2.5">
                  <div className="text-xs text-slate-500">{l}</div>
                  <div className="text-sm font-semibold text-amber-300 mt-0.5">{v || "N/D"}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Durées d'Engagement" icon="📅">
            {[["WAL moyen pondéré",im.durees_engagement?.wal,"text-white"],["Bail le + long",im.durees_engagement?.bail_plus_long,"text-emerald-400"],["Bail le + court",im.durees_engagement?.bail_plus_court,"text-amber-400"]].map(([l,v,c]) => (
              <div key={l} className="flex justify-between items-center py-2.5 border-b border-slate-700/25 last:border-0">
                <span className="text-sm text-slate-400">{l}</span>
                <span className={`text-sm font-semibold ${c}`}>{v || "N/D"}</span>
              </div>
            ))}
          </Card>
          <Card title="Occupation" icon="🏗️">
            <div className="flex items-end gap-4">
              <div className="text-5xl font-black text-white">{im.etat_locatif?.taux_occupation || "N/D"}</div>
              <div className="pb-1"><div className="text-xs text-slate-500">Surface</div><div className="text-sm font-semibold text-white">{im.etat_locatif?.surface_totale}</div></div>
            </div>
          </Card>
          <Card title="Contexte de Marché" icon="🌍">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-400">Dynamisme</span>
                <Badge color={enriched.contexte_marche?.dynamisme?.includes("actif") ? "green" : "amber"}>{enriched.contexte_marche?.dynamisme || "N/D"}</Badge>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{enriched.contexte_marche?.tendance_investisseurs}</p>
            </div>
          </Card>
        </div>
      )}

      {tab === "localisation" && (
        <div className="space-y-5">
          <MapEmbed adresse={im.localisation?.adresse} ville={im.localisation?.ville} pays={im.localisation?.pays} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card title="Transports" icon="🚇">
              <div className="space-y-2 text-sm text-slate-300">
                {im.transports?.metro?.length > 0 && <div><span className="text-slate-500 mr-2">Métro</span>{im.transports.metro.join(", ")}</div>}
                {im.transports?.rer?.length > 0 && <div><span className="text-slate-500 mr-2">RER</span>{im.transports.rer.join(", ")}</div>}
                {im.transports?.gare && im.transports.gare !== "N/D" && <div><span className="text-slate-500 mr-2">Gare</span>{im.transports.gare}</div>}
                {im.transports?.bus?.length > 0 && <div><span className="text-slate-500 mr-2">Bus</span>{im.transports.bus.join(", ")}</div>}
                {im.transports?.analyse_im && <p className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-700/30">{im.transports.analyse_im}</p>}
              </div>
            </Card>
            <Card title="Analyse Localisation" icon="📍">
              <p className="text-sm text-slate-300 leading-relaxed">{im.localisation?.analyse_im || "N/D"}</p>
            </Card>
          </div>
        </div>
      )}

      {tab === "locataires" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-700/20 bg-amber-950/10 p-3 text-xs text-amber-300/80">
            ℹ️ Analyse indépendante croisée avec sources web — au-delà de la présentation de l'IM.
          </div>
          {im.etat_locatif?.locataires?.map((loc) => {
            const el = enriched.locataires_analyse?.find(l =>
              l.nom?.toLowerCase().includes(loc.nom?.toLowerCase()?.slice(0,5)) ||
              loc.nom?.toLowerCase().includes(l.nom?.toLowerCase()?.slice(0,5))
            );
            return (
              <div key={loc.nom} className="rounded-xl border border-slate-700/35 bg-slate-800/20 p-5">
                <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                  <div>
                    <h4 className="text-base font-bold text-white">{loc.nom}</h4>
                    <p className="text-slate-500 text-sm">{loc.secteur}</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {el?.sante_financiere && <RiskTag v={el.sante_financiere} />}
                    {el?.risque && <Badge color={el.risque === "faible" ? "green" : el.risque === "élevé" ? "red" : "amber"}>Risque {el.risque}</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {[["Surface",loc.surface],["Loyer/an",loc.loyer_annuel],["€/m²/an",loc.loyer_m2],["Échéance",loc.echeance_bail]].map(([l,v]) => (
                    <div key={l} className="bg-slate-800/50 rounded-lg p-2.5">
                      <div className="text-xs text-slate-500">{l}</div>
                      <div className="text-sm font-semibold text-white">{v || "N/D"}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">📄 Selon l'IM</p>
                    <p className="text-sm text-slate-400 leading-relaxed">{loc.note_im}</p>
                  </div>
                  {el && (
                    <div>
                      <p className="text-xs text-amber-400/80 mb-1.5">🌐 Sources externes</p>
                      <p className="text-sm text-slate-300 leading-relaxed">{el.commentaire}</p>
                      {el.sources?.length > 0 && <ul className="mt-2 space-y-1">{el.sources.map((s,i) => <li key={i} className="text-xs text-slate-500 flex gap-1"><span>▸</span>{s}</li>)}</ul>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "marche" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["Loyer marché (IM)",      im.marche_locatif_im?.loyer_marche_cite,          "text-amber-300/80"],
              ["Loyer marché réel (web)",enriched.marche_locatif_reel?.fourchette_loyers,  "text-white"],
              ["Tendance",               enriched.marche_locatif_reel?.tendance,            enriched.marche_locatif_reel?.tendance === "hausse" ? "text-emerald-400" : enriched.marche_locatif_reel?.tendance === "baisse" ? "text-red-400" : "text-slate-300"],
            ].map(([l,v,c]) => (
              <div key={l} className="rounded-xl border border-slate-700/35 bg-slate-800/20 p-4">
                <div className="text-xs text-slate-500 mb-1">{l}</div>
                <div className={`text-lg font-bold ${c}`}>{v || "N/D"}</div>
              </div>
            ))}
          </div>
          <Card title="Analyse Marché Indépendante" icon="🔍">
            <p className="text-sm text-slate-300 leading-relaxed mb-4">{enriched.marche_locatif_reel?.analyse}</p>
            {enriched.marche_locatif_reel?.offres_trouvees?.length > 0 && (
              <>
                <p className="text-xs text-slate-500 mb-2">Offres observées :</p>
                <ul className="space-y-1.5">{enriched.marche_locatif_reel.offres_trouvees.map((o,i) => <li key={i} className="text-sm text-slate-400 flex gap-2"><span className="text-amber-500/60">▸</span>{o}</li>)}</ul>
              </>
            )}
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Risques Macro" icon="📉">
              <ul className="space-y-2">{enriched.contexte_marche?.risques_macro?.map((r,i) => <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-red-500/60">▸</span>{r}</li>)}</ul>
            </Card>
            <Card title="Opportunités Macro" icon="📈">
              <ul className="space-y-2">{enriched.contexte_marche?.opportunites_macro?.map((o,i) => <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-emerald-500/60">▸</span>{o}</li>)}</ul>
            </Card>
          </div>
        </div>
      )}

      {tab === "projets" && (
        <div className="space-y-3">
          {(!enriched.projets_zone || enriched.projets_zone.length === 0) && (
            <div className="text-center text-slate-600 py-12">Aucun projet identifié dans la zone</div>
          )}
          {enriched.projets_zone?.map((p,i) => (
            <div key={i} className="rounded-xl border border-slate-700/35 bg-slate-800/20 p-4 flex gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 ${p.impact === "positif" ? "bg-emerald-900/30" : p.impact === "négatif" ? "bg-red-900/30" : "bg-slate-700/30"}`}>
                {p.type === "bureau" ? "🏢" : p.type === "hotel" ? "🏨" : p.type === "logement" ? "🏠" : p.type === "transport" ? "🚇" : "🏗️"}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-white">{p.nom}</span>
                  <Badge color={p.impact === "positif" ? "green" : p.impact === "négatif" ? "red" : "slate"}>{p.impact}</Badge>
                  <Badge color="slate">{p.statut}</Badge>
                </div>
                <p className="text-sm text-slate-400">{p.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "swot" && (
        <div className="space-y-5">
          <SwotGrid swot={enriched.swot} />
          {enriched.verdict_independant?.points_divergence?.length > 0 && (
            <div className="rounded-xl border border-red-700/25 bg-red-950/10 p-5">
              <h3 className="text-xs font-semibold tracking-widest uppercase text-red-400 mb-3">⚠️ Points de Vigilance Critiques</h3>
              <ul className="space-y-2">{enriched.verdict_independant.points_divergence.map((p,i) => <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-red-500 shrink-0">▸</span>{p}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      </Head>
      <div className="min-h-screen" style={{ background: "#090c13" }}>
        <div className="fixed inset-0 pointer-events-none">
          <div style={{ position:"absolute", top:40, left:"25%", width:384, height:384, background:"rgba(120,53,15,0.06)", borderRadius:"50%", filter:"blur(80px)" }} />
          <div style={{ position:"absolute", bottom:"25%", right:"20%", width:256, height:256, background:"rgba(49,46,129,0.06)", borderRadius:"50%", filter:"blur(80px)" }} />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 py-10">
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <div style={{ background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.25)" }} className="w-7 h-7 rounded-lg flex items-center justify-center text-sm">🏛</div>
              <span className="text-xs tracking-widest uppercase font-semibold" style={{ color:"#475569" }}>RE Investment Analyzer</span>
            </div>
            <h1 className="text-3xl font-bold text-white">Analyse d'<span style={{ color:"#f59e0b" }}>Investment Memorandum</span></h1>
            <p className="mt-2 text-sm max-w-xl" style={{ color:"#475569" }}>Fiche synthétique enrichie par web search — locataires, loyers réels, projets urbains, SWOT critique.</p>
          </div>

          {!done && (
            <>
              <div
                onClick={() => !step && inputRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                style={{ borderColor: dragging ? "rgba(245,158,11,0.5)" : "rgba(71,85,105,0.4)", background: dragging ? "rgba(120,53,15,0.12)" : "rgba(30,41,59,0.12)", cursor: step > 0 ? "default" : "pointer", opacity: step > 0 ? 0.4 : 1 }}
                className="rounded-2xl border-2 border-dashed transition-all duration-300 p-10 text-center mb-5">
                <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => handleFile(e.target.files[0])} />
                <div className="text-4xl mb-3">{dragging ? "📂" : "📄"}</div>
                {file ? (
                  <div><p className="font-semibold text-white">{file.name}</p><p className="text-sm mt-1" style={{ color:"#64748b" }}>{(file.size/1024/1024).toFixed(2)} MB</p></div>
                ) : (
                  <div><p className="font-medium text-white">Glissez votre Investment Memorandum</p><p className="text-sm mt-1" style={{ color:"#475569" }}>ou cliquez · PDF uniquement</p></div>
                )}
              </div>
              {error && <div className="mb-4 rounded-lg p-3 text-sm" style={{ border:"1px solid rgba(239,68,68,0.35)", background:"rgba(127,29,29,0.15)", color:"#f87171" }}>{error}</div>}
              {step > 0 && <StepBar step={step} />}
              {file && step === 0 && (
                <button onClick={analyze} className="w-full rounded-xl font-bold py-3.5 transition-all text-sm tracking-wide" style={{ background:"#f59e0b", color:"#0f172a" }}
                  onMouseEnter={e => e.target.style.background = "#fbbf24"}
                  onMouseLeave={e => e.target.style.background = "#f59e0b"}>
                  Lancer l'analyse complète →
                </button>
              )}
            </>
          )}

          {done && (
            <>
              <button onClick={() => { setStep(0); setFile(null); setImData(null); setEnriched(null); }}
                className="mb-6 text-xs flex items-center gap-1 transition-colors"
                style={{ color:"#64748b" }}
                onMouseEnter={e => e.target.style.color = "#94a3b8"}
                onMouseLeave={e => e.target.style.color = "#64748b"}>
                ← Analyser un autre document
              </button>
              <ResultSheet im={imData} enriched={enriched} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
