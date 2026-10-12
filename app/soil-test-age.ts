export type DatedSoilRecord = {
  dateSort: string;
  date?: string;
  datePrecision?: string;
};

export const TEST_AGE_BANDS = {
  recent: {
    label: "Tested within 1 year",
    shortLabel: "≤1 year old",
    color: "#2e7355",
  },
  current: {
    label: "Tested 1–3 years ago",
    shortLabel: "1–3 years old",
    color: "#78a36e",
  },
  dueSoon: {
    label: "Tested 3–5 years ago",
    shortLabel: "3–5 years old",
    color: "#dc9a2f",
  },
  overdue: {
    label: "Tested over 5 years ago",
    shortLabel: "Over 5 years old",
    color: "#bd4739",
  },
  noData: {
    label: "No recorded soil test",
    shortLabel: "No test",
    color: "#d4d8d0",
  },
} as const;

export type TestAgeBandKey = keyof typeof TEST_AGE_BANDS;

export const latestSoilRecord = <T extends DatedSoilRecord>(records: T[]) =>
  [...records]
    .filter((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.dateSort))
    .sort((left, right) => left.dateSort.localeCompare(right.dateSort))
    .at(-1) ?? null;

export const soilTestAgeYears = (
  dateSort: string,
  asAt = new Date(),
) => {
  const testedAt = new Date(`${dateSort}T00:00:00Z`);
  if (Number.isNaN(testedAt.getTime())) return null;
  return Math.max(
    0,
    (asAt.getTime() - testedAt.getTime()) / (365.2425 * 24 * 60 * 60 * 1000),
  );
};

export const soilTestAgeBand = (
  record: DatedSoilRecord | null,
  asAt = new Date(),
): TestAgeBandKey => {
  if (!record) return "noData";
  const age = soilTestAgeYears(record.dateSort, asAt);
  if (age === null) return "noData";
  if (age <= 1) return "recent";
  if (age <= 3) return "current";
  if (age <= 5) return "dueSoon";
  return "overdue";
};
