'use client';

import { useState, useEffect } from 'react';
import { FolderSearch, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { UploadDropzone } from '@/components/analyse/upload-dropzone';
import { SessieCard } from '@/components/analyse/sessie-card';
import { AnalyseSessie } from '@/types';
import { createClient } from '@/lib/supabase/client';

export default function AnalysePage() {
  const [sessies, setSessies] = useState<AnalyseSessie[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('analyse_sessies')
        .select('*')
        .order('created_at', { ascending: false });

      if (data) {
        setSessies(
          data.map((s) => ({
            id: s.id,
            naam: s.naam,
            status: s.status as AnalyseSessie['status'],
            notities: s.notities ?? undefined,
            ai_samenvatting: s.ai_samenvatting ?? undefined,
            metadata: s.metadata as AnalyseSessie['metadata'],
            criteria_scores: s.criteria_scores as Record<string, number>,
            totaal_score: s.totaal_score ?? undefined,
            aantal_bestanden: s.aantal_bestanden,
            created_at: s.created_at,
            updated_at: s.updated_at,
          }))
        );
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  const handleUploaded = (sessieId: string, naam: string) => {
    const nieuw: AnalyseSessie = {
      id: sessieId,
      naam,
      status: 'nieuw',
      aantal_bestanden: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setSessies((prev) => [nieuw, ...prev]);
  };

  const handleDeleted = (id: string) => {
    setSessies((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdated = (updated: AnalyseSessie) => {
    setSessies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analyse</h1>
        <p className="text-muted-foreground">
          Upload aanbestedingsdocumenten voor AI-analyse. Elke upload wordt een herbruikbare sessiekaart.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Upload zone */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Nieuwe analyse</h2>
          </div>
          <UploadDropzone onUploaded={handleUploaded} />
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Hoe het werkt</p>
            <p>1. Sleep één of meerdere bestanden in het vak</p>
            <p>2. AI extraheert automatisch de aanbestedingsnaam</p>
            <p>3. Er wordt een sessiekaart aangemaakt</p>
            <p>4. Klik "Analyseer" voor volledige scoring</p>
            <p>5. Voeg later extra bestanden toe en heranalyse</p>
          </div>
        </div>

        {/* Sessies overzicht */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderSearch className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Sessiekaarten</h2>
            </div>
            {!loading && (
              <span className="text-xs text-muted-foreground">{sessies.length} sessies</span>
            )}
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-52" />)}
            </div>
          ) : sessies.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <FolderSearch className="size-10 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium">Nog geen sessies</p>
                <p className="text-xs text-muted-foreground">
                  Upload bestanden om een eerste sessiekaart aan te maken
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sessies.map((sessie) => (
                <SessieCard
                  key={sessie.id}
                  sessie={sessie}
                  onDeleted={handleDeleted}
                  onUpdated={handleUpdated}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
