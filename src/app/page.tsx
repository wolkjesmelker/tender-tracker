import { FileText, TrendingUp, Clock, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/lib/button-variants';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { StatusChart } from '@/components/dashboard/status-chart';
import { StatusBadge } from '@/components/aanbestedingen/status-badge';
import { formatDate } from '@/lib/utils';
import { Aanbesteding } from '@/types';

// Mock data — replace with Supabase queries once env is configured
const mockAanbestedingen: Aanbesteding[] = [
  {
    id: '1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'Renovatie gemeentehuis Utrecht',
    opdrachtgever: 'Gemeente Utrecht',
    sluitingsdatum: new Date(Date.now() + 7 * 86400000).toISOString(),
    status: 'gevonden',
    totaal_score: 78,
    is_upload: false,
  },
  {
    id: '2',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'ICT-infrastructuur provincie Zuid-Holland',
    opdrachtgever: 'Provincie Zuid-Holland',
    sluitingsdatum: new Date(Date.now() + 14 * 86400000).toISOString(),
    status: 'gekwalificeerd',
    totaal_score: 85,
    is_upload: false,
  },
  {
    id: '3',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'Groenonderhoud Almere 2025',
    opdrachtgever: 'Gemeente Almere',
    sluitingsdatum: new Date(Date.now() + 3 * 86400000).toISOString(),
    status: 'in_aanbieding',
    totaal_score: 92,
    is_upload: false,
  },
  {
    id: '4',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'Beveiligingsdiensten Rijkswaterstaat',
    opdrachtgever: 'Rijkswaterstaat',
    sluitingsdatum: new Date(Date.now() - 5 * 86400000).toISOString(),
    status: 'afgewezen',
    totaal_score: 45,
    is_upload: false,
  },
];

const statusCounts = mockAanbestedingen.reduce(
  (acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  },
  {} as Record<string, number>
);

export default function DashboardPage() {
  const totalAanbestedingen = mockAanbestedingen.length;
  const inAanbieding = statusCounts['in_aanbieding'] ?? 0;
  const gevonden = statusCounts['gevonden'] ?? 0;
  const urgentDeadline = mockAanbestedingen.filter((a) => {
    if (!a.sluitingsdatum) return false;
    const days = Math.ceil((new Date(a.sluitingsdatum).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 7;
  }).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overzicht van uw aanbestedingspijplijn
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Totaal aanbestedingen"
          value={totalAanbestedingen}
          description="Alle aanbestedingen"
          icon={FileText}
          iconClassName="bg-blue-50 text-blue-600"
        />
        <KpiCard
          title="In aanbieding"
          value={inAanbieding}
          description="Actieve aanbiedingen"
          icon={TrendingUp}
          iconClassName="bg-green-50 text-green-600"
        />
        <KpiCard
          title="Nieuw gevonden"
          value={gevonden}
          description="Wachten op kwalificatie"
          icon={CheckCircle}
          iconClassName="bg-yellow-50 text-yellow-600"
        />
        <KpiCard
          title="Urgente deadlines"
          value={urgentDeadline}
          description="Sluitingsdatum binnen 7 dagen"
          icon={AlertCircle}
          iconClassName="bg-red-50 text-red-600"
        />
      </div>

      {/* Chart + Recent table */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status verdeling</CardTitle>
            <CardDescription>Huidige pijplijn per status</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusChart
              data={{
                gevonden: statusCounts['gevonden'] ?? 0,
                gekwalificeerd: statusCounts['gekwalificeerd'] ?? 0,
                in_aanbieding: statusCounts['in_aanbieding'] ?? 0,
                afgewezen: statusCounts['afgewezen'] ?? 0,
              }}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recente aanbestedingen</CardTitle>
              <CardDescription>Meest recent bijgewerkt</CardDescription>
            </div>
            <Link href="/aanbestedingen" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Alle bekijken
              <ArrowRight className="ml-1 size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mockAanbestedingen.map((item) => {
                const daysLeft = item.sluitingsdatum
                  ? Math.ceil(
                      (new Date(item.sluitingsdatum).getTime() - Date.now()) / 86400000
                    )
                  : null;

                return (
                  <Link
                    key={item.id}
                    href={`/aanbestedingen/${item.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.titel}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.opdrachtgever}
                      </p>
                    </div>
                    <div className="ml-4 flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={item.status} />
                      {daysLeft !== null && (
                        <span
                          className={`text-xs ${
                            daysLeft < 0
                              ? 'text-muted-foreground line-through'
                              : daysLeft <= 7
                              ? 'font-medium text-red-600'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {daysLeft < 0
                            ? `${Math.abs(daysLeft)}d geleden`
                            : `${daysLeft}d resterend`}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming deadlines card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4 text-orange-500" />
            Aankomende sluitingsdata
          </CardTitle>
          <CardDescription>
            Aanbestedingen met een deadline binnen 14 dagen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {mockAanbestedingen
              .filter((a) => {
                if (!a.sluitingsdatum) return false;
                const days = Math.ceil(
                  (new Date(a.sluitingsdatum).getTime() - Date.now()) / 86400000
                );
                return days >= 0 && days <= 14;
              })
              .sort(
                (a, b) =>
                  new Date(a.sluitingsdatum!).getTime() -
                  new Date(b.sluitingsdatum!).getTime()
              )
              .map((item) => {
                const days = Math.ceil(
                  (new Date(item.sluitingsdatum!).getTime() - Date.now()) / 86400000
                );
                return (
                  <Link
                    key={item.id}
                    href={`/aanbestedingen/${item.id}`}
                    className="rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-tight">{item.titel}</p>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                          days <= 3
                            ? 'bg-red-100 text-red-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {days}d
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(item.sluitingsdatum)}
                    </p>
                  </Link>
                );
              })}
            {mockAanbestedingen.filter((a) => {
              if (!a.sluitingsdatum) return false;
              const days = Math.ceil(
                (new Date(a.sluitingsdatum).getTime() - Date.now()) / 86400000
              );
              return days >= 0 && days <= 14;
            }).length === 0 && (
              <p className="col-span-full text-sm text-muted-foreground">
                Geen aankomende deadlines binnen 14 dagen
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
