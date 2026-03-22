import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as pdfParseModule from 'pdf-parse';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = (pdfParseModule as any).default ?? pdfParseModule;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractTextFromStorage(storagePath: string, mimeType: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('analyse-bestanden')
    .download(storagePath);

  if (error || !data) return '[Bestand niet beschikbaar]';

  const buffer = Buffer.from(await data.arrayBuffer());

  if (mimeType === 'application/pdf') {
    try {
      const pdf = await pdfParse(buffer);
      return pdf.text.slice(0, 20000);
    } catch {
      return '[PDF tekst kon niet worden gelezen]';
    }
  }
  return buffer.toString('utf-8').slice(0, 20000);
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    // Status: bezig
    await supabase
      .from('analyse_sessies')
      .update({ status: 'analyse_bezig' })
      .eq('id', id);

    // Bestanden ophalen
    const { data: bestanden } = await supabase
      .from('sessie_bestanden')
      .select('*')
      .eq('sessie_id', id);

    if (!bestanden?.length) {
      await supabase.from('analyse_sessies').update({ status: 'fout' }).eq('id', id);
      return NextResponse.json({ error: 'Geen bestanden gevonden' }, { status: 400 });
    }

    // Tekst extraheren uit alle bestanden
    const tekstDelen = await Promise.all(
      bestanden.map(async (b) => {
        const tekst = await extractTextFromStorage(b.storage_path, b.mime_type ?? 'text/plain');
        return `=== ${b.naam} ===\n${tekst}`;
      })
    );
    const gecombineerdeTekst = tekstDelen.join('\n\n');

    // Criteria ophalen
    const { data: criteria } = await supabase
      .from('criteria')
      .select('*')
      .eq('is_actief', true)
      .order('volgorde');

    const criteriaLijst = criteria?.map((c) => `- ${c.naam} (gewicht: ${c.gewicht})`).join('\n') ?? '';

    // Volledige AI analyse uitvoeren
    const analyseResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `Je bent een expert aanbestedingsanalist. Analyseer de aanbestedingsdocumenten grondig.
Geef uitsluitend een JSON-object terug (geen markdown, geen extra tekst) met deze structuur:
{
  "naam": "beschrijvende naam van de aanbesteding",
  "samenvatting": "uitgebreide samenvatting van 400-600 tekens",
  "metadata": {
    "opdrachtgever": "naam aanbestedende dienst",
    "sluitingsdatum": "YYYY-MM-DD of null",
    "publicatiedatum": "YYYY-MM-DD of null",
    "referentienummer": "kenmerk of null",
    "type_opdracht": "Diensten / Leveringen / Werken",
    "regio": "regio of gemeente",
    "waarde": "geraamde waarde of null"
  },
  "criteria_scores": {
    "criterium_naam": score_0_tot_100
  },
  "totaal_score": gewogen_gemiddelde_0_tot_100,
  "aanbeveling": "kort advies: wel/niet inschrijven en waarom"
}

${criteriaLijst ? `Score op deze criteria:\n${criteriaLijst}` : ''}`,
        },
        {
          role: 'user',
          content: gecombineerdeTekst.slice(0, 15000),
        },
      ],
    });

    let analyseData: Record<string, unknown> = {};
    try {
      const content = analyseResponse.choices[0]?.message?.content ?? '{}';
      analyseData = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    } catch {
      analyseData = {};
    }

    // Sessie updaten met analyseresultaten
    await supabase
      .from('analyse_sessies')
      .update({
        status: 'gereed',
        naam: (analyseData.naam as string) || undefined,
        ai_samenvatting: analyseData.samenvatting as string ?? null,
        metadata: analyseData.metadata ?? {},
        criteria_scores: analyseData.criteria_scores ?? {},
        totaal_score: analyseData.totaal_score as number ?? null,
        notities: analyseData.aanbeveling
          ? `Aanbeveling: ${analyseData.aanbeveling}`
          : undefined,
      })
      .eq('id', id);

    return NextResponse.json({ success: true, sessie_id: id });
  } catch (err) {
    console.error('Analyse error:', err);
    await supabase.from('analyse_sessies').update({ status: 'fout' }).eq('id', id);
    return NextResponse.json({ error: 'Analyse mislukt', detail: String(err) }, { status: 500 });
  }
}
