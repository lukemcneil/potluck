import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { checkOwner } from "@/lib/insights/owner";
import {
  fetchDailyActivity,
  fetchEventBreakdown,
  fetchSignupTimeline,
  fetchTopRecipes,
  fetchTotals,
  padDailySeries,
} from "@/lib/insights/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Insights",
  // No description, no opengraph — this page is owner-only and shouldn't
  // ever leak its existence to crawlers.
  robots: { index: false, follow: false },
};

const DAYS = 30;

export default async function InsightsPage() {
  const check = await checkOwner();
  // Always 404 for non-owners. We don't render a "Forbidden" page —
  // that would confirm the URL exists. notFound() is the same response
  // a non-existent route would produce.
  if (check.kind !== "ok") notFound();

  // Parallel fetches: every panel is independent. The DB is local so
  // latency is dominated by Drizzle's prepare/serialize overhead, but
  // we still parallelize because that overhead adds up across 5
  // queries.
  const [totals, activityRaw, breakdown, topRecipes, signupsRaw] =
    await Promise.all([
      fetchTotals(),
      fetchDailyActivity(DAYS),
      fetchEventBreakdown(DAYS),
      fetchTopRecipes(DAYS, 8),
      fetchSignupTimeline(DAYS),
    ]);

  const activity = padDailySeries(activityRaw, DAYS, (day) => ({
    day,
    totalEvents: 0,
    activeUsers: 0,
  }));
  const signups = padDailySeries(signupsRaw, DAYS, (day) => ({
    day,
    signups: 0,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Insights
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What people are doing in your app, last {DAYS} days. Owner-only;
          this page does not exist for anyone else.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryTile label="Users" value={totals.totalUsers} />
        <SummaryTile label="Recipes" value={totals.totalRecipes} />
        <SummaryTile
          label="Active 7d"
          value={totals.activeUsers7d}
          hint="distinct signed-in users with any event"
        />
        <SummaryTile
          label="Active 30d"
          value={totals.activeUsers30d}
          hint="distinct signed-in users with any event"
        />
        <SummaryTile
          label="Events 30d"
          value={totals.totalEvents}
          hint="all logged actions across the app"
        />
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <Panel
          title="Daily activity"
          subtitle="Total events per day. Hover-free sparkline; use the table below if you need exact numbers."
        >
          <DailyChart
            data={activity}
            barColor="hsl(var(--primary))"
            getValue={(r) => r.totalEvents}
          />
          <DailyTable
            data={activity}
            columns={[
              { key: "totalEvents", label: "Events" },
              { key: "activeUsers", label: "Users" },
            ]}
          />
        </Panel>

        <Panel
          title="Signups"
          subtitle="New accounts per day. A flat line is normal for a finished, family-scale app — spikes here signal someone shared the link."
        >
          <DailyChart
            data={signups}
            barColor="hsl(160 60% 45%)"
            getValue={(r) => r.signups}
          />
          <DailyTable
            data={signups.filter((r) => r.signups > 0)}
            columns={[{ key: "signups", label: "Signups" }]}
            emptyMessage="No new signups in this window."
          />
        </Panel>
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <Panel
          title="What people did"
          subtitle="Counts by event kind. The largest bars tell you which features actually get used."
        >
          <KindBreakdown rows={breakdown} />
        </Panel>

        <Panel
          title="Top viewed recipes"
          subtitle="Recipe detail page renders in the window, excluding the author viewing their own recipe."
        >
          <TopRecipesTable rows={topRecipes} />
        </Panel>
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        Dashboard powered by the <code>events</code> SQLite table — see{" "}
        <code>lib/insights/log.ts</code>. Add a new event kind there to start
        capturing it; the dashboard&apos;s breakdown panel auto-includes new
        kinds without code changes here.
      </p>
    </main>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">
        {value.toLocaleString()}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// Inline-SVG sparkline. Width is responsive (viewBox-only); the SVG
// itself fills the container. Bars use a small min-height so 0-value
// days still cast a visible tick (otherwise the user sees nothing and
// wonders if rendering broke).
function DailyChart<T>({
  data,
  getValue,
  barColor,
}: {
  data: T[];
  getValue: (row: T) => number;
  barColor: string;
}) {
  const values = data.map(getValue);
  const max = Math.max(1, ...values);
  const width = data.length * 12;
  const height = 60;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-16 w-full"
      role="img"
      aria-label="Daily activity sparkline"
    >
      {values.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, (v / max) * (height - 4));
        return (
          <rect
            key={i}
            x={i * 12 + 1}
            y={height - h}
            width={10}
            height={h}
            fill={barColor}
            opacity={v === 0 ? 0.25 : 0.9}
          />
        );
      })}
    </svg>
  );
}

// Tabular detail under each sparkline. Mostly for the days where the
// chart is too dense to read exact numbers off the bars.
function DailyTable<T extends { day: string }>({
  data,
  columns,
  emptyMessage,
}: {
  data: T[];
  columns: { key: keyof T; label: string }[];
  emptyMessage?: string;
}) {
  // Only render the last 7 days of detail to keep the panel compact;
  // the sparkline already shows the full window.
  const recent = data.slice(-7);
  if (recent.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {emptyMessage ?? "No data in this window."}
      </p>
    );
  }
  return (
    <table className="mt-3 w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="pb-1 text-left font-normal">Day (UTC)</th>
          {columns.map((c) => (
            <th key={String(c.key)} className="pb-1 text-right font-normal">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {recent.map((row) => (
          <tr
            key={row.day}
            className="border-t border-border/60 first:border-t-0"
          >
            <td className="py-0.5">{row.day.slice(5)}</td>
            {columns.map((c) => (
              <td
                key={String(c.key)}
                className="py-0.5 text-right tabular-nums"
              >
                {Number(row[c.key]).toLocaleString()}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KindBreakdown({ rows }: { rows: { kind: string; count: number }[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing logged yet — install this build, take a couple actions in the
        app, then refresh.
      </p>
    );
  }
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const pct = (r.count / max) * 100;
        return (
          <li key={r.kind} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-muted-foreground">
                {r.kind}
              </span>
              <span className="tabular-nums">{r.count.toLocaleString()}</span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TopRecipesTable({
  rows,
}: {
  rows: {
    recipeId: string;
    title: string;
    authorHandle: string | null;
    views: number;
  }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No recipe views yet from non-author viewers in this window.
      </p>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="pb-1 text-left font-normal">Recipe</th>
          <th className="pb-1 text-right font-normal">Views</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.recipeId}
            className="border-t border-border/60 first:border-t-0"
          >
            <td className="py-1 pr-2">
              <Link
                href={`/r/${r.recipeId}`}
                className="truncate underline-offset-2 hover:underline"
              >
                {r.title}
              </Link>
              {r.authorHandle && (
                <span className="ml-1 text-muted-foreground">
                  · @{r.authorHandle}
                </span>
              )}
            </td>
            <td className="py-1 text-right tabular-nums">
              {r.views.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
