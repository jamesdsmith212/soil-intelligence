"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import SoilGridExplorer, { type SoilGridPayload } from "./SoilGridExplorer";
import NutrientPlanner, { type NutrientData, type PlannerSoilField } from "./NutrientPlanner";

type SoilData = SoilGridPayload & { synthetic?: boolean; fields: (SoilGridPayload["fields"][number] & PlannerSoilField)[] };

export default function Home() {
  const [soil, setSoil] = useState<SoilData | null>(null);
  const [nutrients, setNutrients] = useState<NutrientData | null>(null);
  const [planner, setPlanner] = useState(false);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"loading" | "locked" | "error" | "ready">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [soilResponse, nutrientResponse] = await Promise.all([
        fetch("/api/soil-data", { cache: "no-store" }),
        fetch("/api/nutrient-data", { cache: "no-store" }),
      ]);
      if (soilResponse.status === 401 || nutrientResponse.status === 401) { setState("locked"); return; }
      if (!soilResponse.ok || !nutrientResponse.ok) throw new Error("Data unavailable. Check dataset configuration and access settings.");
      setSoil(await soilResponse.json());
      setNutrients(await nutrientResponse.json());
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load data");
      setState("error");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error("Access was not accepted. Check the passphrase and server configuration.");
      setPassword("");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed"); }
  };

  if (state !== "ready" || !soil || !nutrients) return <main className="access-shell"><section className="access-card">
    <h1>Soil Intelligence</h1>
    {state === "loading" ? <p role="status">Loading soil data…</p> : state === "locked" ? <form onSubmit={login}>
      <label>Passphrase<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <button type="submit">Open soil maps</button>
    </form> : <button onClick={() => void load()}>Retry</button>}
    {error && <p role="alert">{error}</p>}
  </section></main>;

  return <>
    {soil.synthetic && <div className="demo-notice" role="note">Synthetic demo: invented fields, results and prices. Not farm data or agronomic advice.</div>}
    {planner ? <NutrientPlanner soilFields={soil.fields} nutrientData={nutrients} onBack={() => setPlanner(false)} /> : <SoilGridExplorer
      data={soil} demoMode={Boolean(soil.synthetic)} onPlanner={() => setPlanner(true)} onLock={async () => {
        if (soil.synthetic) { await load(); return; }
        await fetch("/api/auth/logout", { method: "POST" });
        setSoil(null); setNutrients(null); setState("locked");
      }} />}
  </>;
}
