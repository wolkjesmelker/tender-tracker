import { Plus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TenderTable } from '@/components/aanbestedingen/tender-table';
import { createClient } from '@/lib/supabase/server';
import { Aanbesteding } from '@/types';

export const dynamic = 'force-dynamic';

export default async function AanbestedingenPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('aanbestedingen')
    .select('*')
    .order('updated_at', { ascending: false });

  const aanbestedingen: Aanbesteding[] = (data ?? []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    titel: row.titel,
    beschrijving: row.beschrijving ?? undefined,
    opdrachtgever: row.opdrachtgever ?? undefined,
    publicatiedatum: row.publicatiedatum ?? undefined,
    sluitingsdatum: row.sluitingsdatum ?? undefined,
    bron_url: row.bron_url ?? undefined,
    bron_website: row.bron_website ?? undefined,
    status: row.status as Aanbesteding['status'],
    pre_kwalificatie_nummer: row.pre_kwalificatie_nummer ?? undefined,
    definitief_nummer: row.definitief_nummer ?? undefined,
    ruwe_tekst: row.ruwe_tekst ?? undefined,
    document_urls: row.document_urls ?? undefined,
    criteria_scores: (row.criteria_scores as Record<string, number>) ?? undefined,
    totaal_score: row.totaal_score ?? undefined,
    ai_samenvatting: row.ai_samenvatting ?? undefined,
    highlight_data: (row.highlight_data as Record<string, string[]>) ?? undefined,
    is_upload: row.is_upload,
    bestandsnaam: row.bestandsnaam ?? undefined,
    notities: row.notities ?? undefined,
  }));

  if (error) {
    console.error('Supabase error:', error);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aanbestedingen</h1>
          <p className="text-muted-foreground">
            Beheer en volg alle aanbestedingen in uw pijplijn
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="mr-2 size-3.5" />
            Exporteren
          </Button>
          <Button size="sm">
            <Plus className="mr-2 size-3.5" />
            Nieuwe aanbesteding
          </Button>
        </div>
      </div>

      <TenderTable data={aanbestedingen} />
    </div>
  );
}
