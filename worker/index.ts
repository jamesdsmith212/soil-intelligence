/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import soilData from "../data/soil-data.json";
import nutrientData from "../data/nutrient-data.json";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SOIL_VIEWER_PASSWORD?: string;
  DEMO_MODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SESSION_COOKIE = "soil-intelligence_soil_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();
const PLANNER_VERSIONS = ["legacy_v1", "nutrient_planner_v2"] as const;

type PlannerVersion = (typeof PLANNER_VERSIONS)[number];

type StoredPlan = Record<string, unknown> & {
  fieldId: string;
  planId: string;
  plannerVersion: PlannerVersion;
  sourcePlanId: string | null;
  migrationWarnings: string[];
  updatedAt: string;
};

type LegacyPlanRow = {
  field_id: string;
  plan_json: string;
  updated_at: string;
};

type VersionedPlanRow = LegacyPlanRow & {
  plan_id: string;
  planner_version: string;
  source_plan_id: string | null;
  migration_warnings_json: string;
};

type ExportApplication = Record<string, unknown> & {
  fieldId: string;
  planId: string;
  plannerVersion: PlannerVersion;
  sourcePlanId: string | null;
  canonicalId: string | null;
  fieldName: string;
  areaHa: number | null;
  planUpdatedAt: string;
};

function apiResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

function toBase64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signatureFor(expiry: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(
    await crypto.subtle.sign("HMAC", key, encoder.encode(expiry)),
  );
}

async function secretsMatch(provided: string, expected: string) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function hasValidSession(request: Request, secret: string) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expiry = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  const expectedSignature = await signatureFor(expiry, secret);
  return secretsMatch(signature, expectedSignature);
}

function sessionCookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlannerVersion(value: unknown): value is PlannerVersion {
  return (
    typeof value === "string" &&
    (PLANNER_VERSIONS as readonly string[]).includes(value)
  );
}

function legacyPlanId(fieldId: string) {
  return `legacy_v1:${fieldId}`;
}

function migrationWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, 500))
    .slice(0, 50);
}

function parseLegacyPlan(row: LegacyPlanRow): StoredPlan | null {
  try {
    return {
      ...(JSON.parse(row.plan_json) as Record<string, unknown>),
      fieldId: row.field_id,
      planId: legacyPlanId(row.field_id),
      plannerVersion: "legacy_v1",
      sourcePlanId: null,
      migrationWarnings: [],
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function parseVersionedPlan(row: VersionedPlanRow): StoredPlan | null {
  if (!isPlannerVersion(row.planner_version)) return null;
  try {
    return {
      ...(JSON.parse(row.plan_json) as Record<string, unknown>),
      fieldId: row.field_id,
      planId: row.plan_id,
      plannerVersion: row.planner_version,
      sourcePlanId: row.source_plan_id,
      migrationWarnings: migrationWarnings(
        JSON.parse(row.migration_warnings_json),
      ),
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

async function readStoredPlans(
  db: D1Database,
  plannerVersion?: PlannerVersion,
) {
  const plans: StoredPlan[] = [];
  if (!plannerVersion || plannerVersion === "legacy_v1") {
    const result = await db
      .prepare(
        "SELECT field_id, plan_json, updated_at FROM nutrient_plans ORDER BY field_id",
      )
      .all<LegacyPlanRow>();
    plans.push(
      ...result.results.flatMap((row) => {
        const plan = parseLegacyPlan(row);
        return plan ? [plan] : [];
      }),
    );
  }
  if (!plannerVersion || plannerVersion === "nutrient_planner_v2") {
    const result = await db
      .prepare(
        `SELECT plan_id, field_id, planner_version, source_plan_id,
                migration_warnings_json, plan_json, updated_at
         FROM nutrient_plan_versions
         WHERE planner_version = 'nutrient_planner_v2'
         ORDER BY field_id, updated_at`,
      )
      .all<VersionedPlanRow>();
    plans.push(
      ...result.results.flatMap((row) => {
        const plan = parseVersionedPlan(row);
        return plan ? [plan] : [];
      }),
    );
  }
  return plans;
}

async function requirePrivateAccess(
  request: Request,
  password: string | undefined,
  syntheticDemo = false,
) {
  if (syntheticDemo) return null;
  if (!password) {
    return apiResponse({ error: "Private access is not configured." }, 503);
  }
  if (!(await hasValidSession(request, password))) {
    return apiResponse({ error: "Authentication required." }, 401);
  }
  return null;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const password = env.SOIL_VIEWER_PASSWORD;
    // Anonymous access is an explicit, synthetic-only demo feature, never a
    // fallback for missing credentials. User datasets must disable DEMO_MODE.
    const syntheticDemo = env.DEMO_MODE === "true"
      && (soilData as { synthetic?: boolean }).synthetic === true
      && (nutrientData as { synthetic?: boolean }).synthetic === true;

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!password) {
        return apiResponse(
          { error: "Private access is not configured." },
          503,
        );
      }
      const body = (await request.json().catch(() => ({}))) as {
        password?: unknown;
      };
      const providedPassword =
        typeof body.password === "string" ? body.password : "";
      if (!(await secretsMatch(providedPassword, password))) {
        return apiResponse({ error: "That passphrase was not recognised." }, 401);
      }
      const expiry = String(Date.now() + SESSION_SECONDS * 1000);
      const token = `${expiry}.${await signatureFor(expiry, password)}`;
      return apiResponse(
        { authenticated: true },
        200,
        { "Set-Cookie": sessionCookie(request, token, SESSION_SECONDS) },
      );
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return apiResponse(
        { authenticated: false },
        200,
        { "Set-Cookie": sessionCookie(request, "", 0) },
      );
    }

    if (url.pathname === "/api/soil-data") {
      const accessError = await requirePrivateAccess(request, password, syntheticDemo);
      if (accessError) return accessError;
      return apiResponse(soilData);
    }

    if (url.pathname === "/api/nutrient-data") {
      const accessError = await requirePrivateAccess(request, password, syntheticDemo);
      if (accessError) return accessError;
      return apiResponse(nutrientData);
    }

    if (url.pathname === "/api/nutrient-plans" && request.method === "GET") {
      const accessError = await requirePrivateAccess(request, password, syntheticDemo);
      if (accessError) return accessError;
      if (!env.DB) {
        return apiResponse({ error: "Shared plan storage is unavailable." }, 503);
      }
      const requestedVersion = url.searchParams.get("plannerVersion");
      if (requestedVersion !== null && !isPlannerVersion(requestedVersion)) {
        return apiResponse({ error: "The planner version is not valid." }, 400);
      }
      const plans = await readStoredPlans(
        env.DB,
        requestedVersion ?? undefined,
      );
      return apiResponse({ plans });
    }

    if (url.pathname === "/api/nutrient-plans" && request.method === "PUT") {
      const accessError = await requirePrivateAccess(request, password, syntheticDemo);
      if (accessError) return accessError;
      if (!env.DB) {
        return apiResponse({ error: "Shared plan storage is unavailable." }, 503);
      }
      const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const requestedVersion = body?.plannerVersion ?? "legacy_v1";
      if (!isPlannerVersion(requestedVersion)) {
        return apiResponse({ error: "The planner version is not valid." }, 400);
      }
      const plannerVersion = requestedVersion;
      const fieldId = typeof body?.fieldId === "string" ? body.fieldId : "";
      const knownField = nutrientData.fields.some(
        (field) => field.fieldId === fieldId,
      );
      const economics = isRecord(body?.economics) ? body.economics : null;
      const cropValuePerTonne = Number(economics?.cropValuePerTonne ?? 0);
      const priceUncertaintyPct = Number(economics?.priceUncertaintyPct ?? 10);
      const discountRatePct = Number(economics?.discountRatePct ?? 5);
      const rawCropValuesByYear = isRecord(economics?.cropValuesByYear)
        ? economics.cropValuesByYear
        : {};
      const cropValuesByYear = Object.fromEntries(
        Object.entries(rawCropValuesByYear)
          .filter(
            ([year]) =>
              /^\d{4}$/.test(year) &&
              Number(year) >= 2020 &&
              Number(year) <= 2100,
          )
          .slice(0, 30)
          .map(([year, value]) => [year, Number(value)]),
      );
      const cropValuesAreValid = Object.values(cropValuesByYear).every(
        (value) =>
          Number.isFinite(value) && value >= 0 && value <= 2000,
      );
      const optionalRecordKeys = [
        "targets",
        "measurementTolerances",
        "soilMetadata",
        "productEffectivenessOverrides",
        "operationalCosts",
        "recycledEffectivenessOverride",
        "v2Assumptions",
        "v2EconomicSummary",
      ];
      const optionalRecordValuesAreValid = optionalRecordKeys.every(
        (key) => body?.[key] === undefined || isRecord(body[key]),
      );
      const optionalObjectOrArrayKeys = ["soilBuildCoefficients"];
      const optionalObjectOrArrayValuesAreValid =
        optionalObjectOrArrayKeys.every(
          (key) =>
            body?.[key] === undefined ||
            isRecord(body[key]) ||
            Array.isArray(body[key]),
        );
      const optionalStringKeys = [
        "cropResponseScenario",
        "interactionMethod",
      ];
      const optionalStringsAreValid = optionalStringKeys.every(
        (key) => body?.[key] === undefined || typeof body[key] === "string",
      );
      const applicationsAreValid =
        body?.proposedApplications === undefined ||
        (Array.isArray(body.proposedApplications) &&
          body.proposedApplications.length <= 50);
      const annualApplicationsAreValid =
        body?.annualApplications === undefined ||
        (Array.isArray(body.annualApplications) &&
          body.annualApplications.length <= 250);
      const legacyShapeIsValid =
        isRecord(body?.cropAdjustments) &&
        Array.isArray(body?.proposedApplications) &&
        economics !== null;
      const horizonYears = Number(body?.horizonYears);
      const horizonYearsIsValid =
        body?.horizonYears === undefined ||
        (Number.isInteger(horizonYears) &&
          horizonYears >= 1 &&
          horizonYears <= 30);
      if (
        !knownField ||
        !body ||
        (plannerVersion === "legacy_v1" && !legacyShapeIsValid) ||
        !applicationsAreValid ||
        !annualApplicationsAreValid ||
        !optionalRecordValuesAreValid ||
        !optionalObjectOrArrayValuesAreValid ||
        !optionalStringsAreValid ||
        !horizonYearsIsValid ||
        (body.repeatRotation !== undefined &&
          typeof body.repeatRotation !== "boolean") ||
        (body.grassResponseEnabled !== undefined &&
          typeof body.grassResponseEnabled !== "boolean") ||
        (body.cropAdjustments !== undefined &&
          !isRecord(body.cropAdjustments)) ||
        (body.economics !== undefined && economics === null) ||
        !Number.isFinite(cropValuePerTonne) ||
        cropValuePerTonne < 0 ||
        cropValuePerTonne > 2000 ||
        !Number.isFinite(priceUncertaintyPct) ||
        priceUncertaintyPct < 0 ||
        priceUncertaintyPct > 100 ||
        !Number.isFinite(discountRatePct) ||
        discountRatePct < 0 ||
        discountRatePct > 30 ||
        !cropValuesAreValid ||
        (body.economicSummary !== undefined &&
          !isRecord(body.economicSummary)) ||
        (typeof body.notes !== "string" && body.notes !== undefined)
      ) {
        return apiResponse({ error: "The field plan is not valid." }, 400);
      }
      const legacyCompatiblePlan = {
        fieldId,
        cropAdjustments: body.cropAdjustments ?? {},
        proposedApplications: body.proposedApplications ?? [],
        economics: {
          cropValuePerTonne,
          priceUncertaintyPct,
          discountRatePct,
          cropValuesByYear,
        },
        economicSummary: body.economicSummary ?? null,
        notes: String(body.notes ?? "").slice(0, 5000),
      };
      const requestedPlanId =
        typeof body.planId === "string" ? body.planId.trim() : "";
      if (
        requestedPlanId.length > 200 ||
        (requestedPlanId && !/^[A-Za-z0-9:._-]+$/.test(requestedPlanId))
      ) {
        return apiResponse({ error: "The plan ID is not valid." }, 400);
      }
      const sourcePlanId =
        typeof body.sourcePlanId === "string"
          ? body.sourcePlanId.trim().slice(0, 200) || null
          : null;
      const warnings = migrationWarnings(body.migrationWarnings);
      const v2Keys = [
        "targets",
        "soilBuildCoefficients",
        "measurementTolerances",
        "horizonYears",
        "repeatRotation",
        "grassResponseEnabled",
        "cropResponseScenario",
        "interactionMethod",
        "soilMetadata",
        "productEffectivenessOverrides",
        "operationalCosts",
        "recycledEffectivenessOverride",
        "annualApplications",
        "v2Assumptions",
        "v2EconomicSummary",
      ];
      const v2Values = Object.fromEntries(
        v2Keys.flatMap((key) =>
          body[key] === undefined ? [] : [[key, body[key]]],
        ),
      );
      const planId =
        plannerVersion === "legacy_v1"
          ? legacyPlanId(fieldId)
          : requestedPlanId || crypto.randomUUID();
      const plan =
        plannerVersion === "legacy_v1"
          ? legacyCompatiblePlan
          : {
              ...legacyCompatiblePlan,
              cropValuesByYear,
              ...v2Values,
              plannerVersion,
              planId,
              sourcePlanId,
              migrationWarnings: warnings,
            };
      const planJson = JSON.stringify(plan);
      if (planJson.length > 100_000) {
        return apiResponse({ error: "The field plan is too large." }, 413);
      }
      const updatedAt = new Date().toISOString();
      if (plannerVersion === "legacy_v1") {
        await env.DB.prepare(
          `INSERT INTO nutrient_plans (field_id, plan_json, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(field_id) DO UPDATE SET
             plan_json = excluded.plan_json,
             updated_at = excluded.updated_at`,
        )
          .bind(fieldId, planJson, updatedAt)
          .run();
        return apiResponse({
          ...plan,
          planId,
          plannerVersion,
          sourcePlanId: null,
          migrationWarnings: [],
          updatedAt,
        });
      }
      const existing = await env.DB.prepare(
        `SELECT field_id, planner_version
         FROM nutrient_plan_versions
         WHERE plan_id = ?1`,
      )
        .bind(planId)
        .first<{ field_id: string; planner_version: string }>();
      if (
        existing &&
        (existing.field_id !== fieldId ||
          existing.planner_version !== plannerVersion)
      ) {
        return apiResponse(
          { error: "That plan ID belongs to a different plan." },
          409,
        );
      }
      await env.DB.prepare(
        `INSERT INTO nutrient_plan_versions (
           plan_id, field_id, planner_version, source_plan_id,
           migration_warnings_json, plan_json, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(plan_id) DO UPDATE SET
           plan_json = excluded.plan_json,
           updated_at = excluded.updated_at`,
      )
        .bind(
          planId,
          fieldId,
          plannerVersion,
          sourcePlanId,
          JSON.stringify(warnings),
          planJson,
          updatedAt,
        )
        .run();
      return apiResponse({ ...plan, updatedAt });
    }

    if (
      url.pathname === "/api/nutrient-plans/copy-to-v2" &&
      request.method === "POST"
    ) {
      const accessError = await requirePrivateAccess(request, password, syntheticDemo);
      if (accessError) return accessError;
      if (!env.DB) {
        return apiResponse({ error: "Shared plan storage is unavailable." }, 503);
      }
      const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const fieldId = typeof body?.fieldId === "string" ? body.fieldId : "";
      const expectedSourcePlanId = legacyPlanId(fieldId);
      const requestedSourcePlanId =
        typeof body?.sourcePlanId === "string"
          ? body.sourcePlanId
          : expectedSourcePlanId;
      if (
        !nutrientData.fields.some((field) => field.fieldId === fieldId) ||
        requestedSourcePlanId !== expectedSourcePlanId
      ) {
        return apiResponse({ error: "The legacy source plan is not valid." }, 400);
      }
      const row = await env.DB.prepare(
        `SELECT field_id, plan_json, updated_at
         FROM nutrient_plans
         WHERE field_id = ?1`,
      )
        .bind(fieldId)
        .first<LegacyPlanRow>();
      const legacyPlan = row ? parseLegacyPlan(row) : null;
      if (!legacyPlan) {
        return apiResponse({ error: "The legacy source plan was not found." }, 404);
      }
      const planId = crypto.randomUUID();
      const warnings = [
        "Review target strategies, soil-build coefficients and measurement tolerances before relying on v2 results.",
        "The legacy economic summary is retained for comparison; recalculate it with the v2 annual trajectory model.",
        ...migrationWarnings(body?.migrationWarnings),
      ];
      const updatedAt = new Date().toISOString();
      const legacyValues = Object.fromEntries(
        Object.entries(legacyPlan).filter(
          ([key]) =>
            ![
              "updatedAt",
              "planId",
              "plannerVersion",
              "sourcePlanId",
              "migrationWarnings",
            ].includes(key),
        ),
      );
      const copiedPlan = {
        ...legacyValues,
        fieldId,
        plannerVersion: "nutrient_planner_v2" as const,
        planId,
        sourcePlanId: expectedSourcePlanId,
        migrationWarnings: warnings,
      };
      const planJson = JSON.stringify(copiedPlan);
      if (planJson.length > 100_000) {
        return apiResponse({ error: "The copied plan is too large." }, 413);
      }
      await env.DB.prepare(
        `INSERT INTO nutrient_plan_versions (
           plan_id, field_id, planner_version, source_plan_id,
           migration_warnings_json, plan_json, updated_at
         )
         VALUES (?1, ?2, 'nutrient_planner_v2', ?3, ?4, ?5, ?6)`,
      )
        .bind(
          planId,
          fieldId,
          expectedSourcePlanId,
          JSON.stringify(warnings),
          planJson,
          updatedAt,
        )
        .run();
      return apiResponse({ ...copiedPlan, updatedAt }, 201);
    }

    if (url.pathname === "/api/nutrient-export" && request.method === "GET") {
      const accessError = await requirePrivateAccess(request, password, syntheticDemo);
      if (accessError) return accessError;
      if (!env.DB) {
        return apiResponse({ error: "Shared plan storage is unavailable." }, 503);
      }
      const plans = await readStoredPlans(env.DB);
      const format = url.searchParams.get("format") ?? "json";
      const proposedApplications: ExportApplication[] = plans.flatMap((plan) => {
        const field = nutrientData.fields.find(
          (item) => item.fieldId === plan.fieldId,
        );
        const applications = Array.isArray(plan.proposedApplications)
          ? plan.proposedApplications.filter(isRecord)
          : [];
        return applications.map(
          (application): ExportApplication => ({
            ...application,
            fieldId: plan.fieldId,
            planId: plan.planId,
            plannerVersion: plan.plannerVersion,
            sourcePlanId: plan.sourcePlanId,
            canonicalId: field?.canonicalId ?? null,
            fieldName: field?.fieldName ?? plan.fieldId,
            areaHa:
              soilData.fields.find((item) => item.id === plan.fieldId)
                ?.areaHa ?? null,
            planUpdatedAt: plan.updatedAt,
          }),
        );
      });
      if (format === "csv") {
        const headers = [
          "field_id",
          "plan_id",
          "planner_version",
          "source_plan_id",
          "canonical_field_id",
          "field_name",
          "area_ha",
          "application_id",
          "product_id",
          "rate",
          "unit",
          "application_date",
          "price_override_gbp_per_tonne",
          "application_cost_gbp_per_ha",
          "crop_value_gbp_per_tonne",
          "price_uncertainty_pct",
          "discount_rate_pct",
          "crop_values_by_year_json",
          "plan_updated_at",
        ];
        const rows = proposedApplications.map((application) => [
          application.fieldId,
          application.planId,
          application.plannerVersion,
          application.sourcePlanId,
          application.canonicalId,
          application.fieldName,
          application.areaHa,
          application.id,
          application.productId,
          application.rate,
          application.unit,
          application.timing,
          application.priceOverride,
          application.applicationCostPerHa,
          (
            plans.find((plan) => plan.planId === application.planId)
              ?.economics as Record<string, unknown> | undefined
          )?.cropValuePerTonne,
          (
            plans.find((plan) => plan.planId === application.planId)
              ?.economics as Record<string, unknown> | undefined
          )?.priceUncertaintyPct,
          (
            plans.find((plan) => plan.planId === application.planId)
              ?.economics as Record<string, unknown> | undefined
          )?.discountRatePct,
          JSON.stringify(
            (
              plans.find((plan) => plan.planId === application.planId)
                ?.economics as Record<string, unknown> | undefined
            )?.cropValuesByYear ?? {},
          ),
          application.planUpdatedAt,
        ]);
        const csv = [headers, ...rows]
          .map((row) => row.map(csvCell).join(","))
          .join("\n");
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="soil-intelligence-proposed-nutrient-applications.csv"',
            "Cache-Control": "no-store",
          },
        });
      }
      const annualApplications = plans.flatMap((plan) =>
        Array.isArray(plan.annualApplications)
          ? plan.annualApplications.filter(isRecord).map((application) => ({
              fieldId: plan.fieldId,
              planId: plan.planId,
              plannerVersion: plan.plannerVersion,
              sourcePlanId: plan.sourcePlanId,
              ...application,
            }))
          : [],
      );
      const databaseExport = {
        schemaVersion: "2.0.0",
        exportedAt: new Date().toISOString(),
        modelAsAt: nutrientData.modelAsAt,
        sources: nutrientData.sources,
        model: nutrientData.model,
        tables: {
          fields: nutrientData.fields.map((field) => ({
            fieldId: field.fieldId,
            canonicalId: field.canonicalId,
            fieldName: field.fieldName,
            testDate: field.testDate,
            areaHa:
              soilData.fields.find((item) => item.id === field.fieldId)
                ?.areaHa ?? null,
          })),
          crop_assumptions: nutrientData.fields.flatMap((field) =>
            field.rotations.map((rotation) => ({
              fieldId: field.fieldId,
              ...rotation,
            })),
          ),
          recorded_applications: nutrientData.fields.flatMap((field) =>
            field.recordedApplications.map((application) => ({
              fieldId: field.fieldId,
              ...application,
            })),
          ),
          products: nutrientData.products,
          saved_field_plans: plans.map((plan) => ({
            fieldId: plan.fieldId,
            planId: plan.planId,
            plannerVersion: plan.plannerVersion,
            sourcePlanId: plan.sourcePlanId,
            migrationWarnings: plan.migrationWarnings,
            cropAdjustments: plan.cropAdjustments ?? {},
            targets: plan.targets ?? null,
            soilBuildCoefficients: plan.soilBuildCoefficients ?? null,
            measurementTolerances: plan.measurementTolerances ?? null,
            horizonYears: plan.horizonYears ?? null,
            repeatRotation: plan.repeatRotation ?? null,
            cropResponseScenario: plan.cropResponseScenario ?? null,
            interactionMethod: plan.interactionMethod ?? null,
            soilMetadata: plan.soilMetadata ?? null,
            productEffectivenessOverrides:
              plan.productEffectivenessOverrides ?? null,
            recycledEffectivenessOverride:
              plan.recycledEffectivenessOverride ?? null,
            operationalCosts: plan.operationalCosts ?? null,
            grassResponseEnabled: plan.grassResponseEnabled ?? false,
            annualApplications: plan.annualApplications ?? [],
            v2Assumptions: plan.v2Assumptions ?? null,
            notes: plan.notes ?? "",
            updatedAt: plan.updatedAt,
          })),
          economic_assumptions: plans.map((plan) => ({
            fieldId: plan.fieldId,
            planId: plan.planId,
            plannerVersion: plan.plannerVersion,
            ...(isRecord(plan.economics) ? plan.economics : {}),
            updatedAt: plan.updatedAt,
          })),
          economic_estimates: plans.flatMap((plan) => {
            const estimate =
              plan.plannerVersion === "nutrient_planner_v2"
                ? plan.v2EconomicSummary
                : plan.economicSummary;
            return isRecord(estimate)
              ? [
                  {
                    fieldId: plan.fieldId,
                    planId: plan.planId,
                    plannerVersion: plan.plannerVersion,
                    ...estimate,
                    updatedAt: plan.updatedAt,
                  },
                ]
              : [];
          }),
          proposed_applications: proposedApplications,
          annual_applications: annualApplications,
        },
      };
      return new Response(`${JSON.stringify(databaseExport, null, 2)}\n`, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="soil-intelligence-nutrient-planner-database.json"',
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
