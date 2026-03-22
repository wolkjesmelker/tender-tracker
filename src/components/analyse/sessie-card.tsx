'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, PlayCircle, Trash2, Calendar, Building2, Tag, BarChart2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnalyseSessie, SESSIE_STATUS_LABELS, SESSIE_STATUS_COLORS } from '@/types';
import { createClient } from '@/lib/supabase/client';

interface Props {
  sessie: AnalyseSessie;
  onDeleted: (id: string) => void;
  onUpdated: (sessie: AnalyseSessie) => void;
}

export function SessieCard({ sessie, onDeleted, onUpdated }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const supabase = createClient();

  const runAnalyse = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRunning(true);
    onUpdated({ ...sessie, status: 'analyse_bezig' });

    try {
      const res = await fetch(`/api/analyse/${sessie.id}/run`, { method: 'POST' });
      if (res.ok) {
        const { data } = await supabase
          .from('analyse_sessies')
          .select('*')
          .eq('id', sessie.id)
          .single();
        if (data) {
          onUpdated({
            id: data.id,
            naam: data.naam,
            status: data.status as AnalyseSessie['status'],
            notities: data.notities ?? undefined,
            ai_samenvatting: data.ai_samenvatting ?? undefined,
            metadata: data.metadata as AnalyseSessie['metadata'],
            criteria_scores: data.criteria_scores as Record<string, number>,
            totaal_score: data.totaal_score ?? undefined,
            aantal_bestanden: data.aantal_bestanden,
            created_at: data.created_at,
            updated_at: data.updated_at,
          });
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const deleteSessie = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('analyse_sessies').delete().eq('id', sessie.id);
    onDeleted(sessie.id);
  };

  const formatDate = (iso?: string) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20"
      onClick={() => router.push(`/analyse/${sessie.id}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-sm leading-snug">{sessie.naam}</CardTitle>
            {sessie.metadata?.opdrachtgever && (
              <CardDescription className="mt-1 flex items-center gap-1 text-xs">
                <Building2 className="size-3 shrink-0" />
                {sessie.metadata.opdrachtgever}
              </CardDescription>
            )}
          </div>
          <Badge
            variant="outline"
            className={`shrink-0 text-[10px] ${SESSIE_STATUS_COLORS[sessie.status]}`}
          >
            {running ? (
              <><Loader2 className="mr-1 size-2.5 animate-spin" />Bezig…</>
            ) : (
              SESSIE_STATUS_LABELS[sessie.status]
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {sessie.ai_samenvatting && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {sessie.ai_samenvatting}
          </p>
        )}

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="size-3" />
            {sessie.aantal_bestanden} {sessie.aantal_bestanden === 1 ? 'bestand' : 'bestanden'}
          </span>
          {sessie.metadata?.sluitingsdatum && (
            <span className="flex items-center gap-1">
              <Calendar className="size-3" />
              Sluit {formatDate(sessie.metadata.sluitingsdatum)}
            </span>
          )}
          {sessie.metadata?.type_opdracht && (
            <span className="flex items-center gap-1">
              <Tag className="size-3" />
              {sessie.metadata.type_opdracht}
            </span>
          )}
          {sessie.totaal_score != null && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <BarChart2 className="size-3" />
              Score: {Math.round(sessie.totaal_score)}/100
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            onClick={runAnalyse}
            disabled={running || sessie.status === 'analyse_bezig'}
          >
            {running ? (
              <Loader2 className="mr-1.5 size-3 animate-spin" />
            ) : (
              <PlayCircle className="mr-1.5 size-3" />
            )}
            {sessie.status === 'gereed' ? 'Heranalyseer' : 'Analyseer'}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-destructive hover:text-destructive"
            onClick={deleteSessie}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Aangemaakt {formatDate(sessie.created_at)}
        </p>
      </CardContent>
    </Card>
  );
}
