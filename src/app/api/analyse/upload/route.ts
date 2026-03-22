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

async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    try {
      const data = await pdfParse(buffer);
      return data.text.slice(0, 20000);
    } catch {
      return `[PDF: ${filename} — tekst kon niet worden uitgelezen]`;
    }
  }
  // text/plain, text/markdown, application/json, etc.
  try {
    return buffer.toString('utf-8').slice(0, 20000);
  } catch {
    return `[Bestand: ${filename} — kon niet worden gelezen als tekst]`;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files.length) {
      return NextResponse.json({ error: 'Geen bestanden meegestuurd' }, { status: 400 });
    }

    // Extract text from all files
    const fileTexts: { naam: string; tekst: string; buffer: Buffer; mimeType: string }[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const tekst = await extractText(buffer, file.type || 'text/plain', file.name);
      fileTexts.push({ naam: file.name, tekst, buffer, mimeType: file.type || 'application/octet-stream' });
    }

    const gecombineerdeTekst = fileTexts.map((f) => `=== ${f.naam} ===\n${f.tekst}`).join('\n\n');

    // AI: naam extraheren + metadata ophalen
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Je bent een expert in het analyseren van aanbestedingsdocumenten. 
Extraheer de volgende informatie en geef een JSON-object terug (geen markdown, alleen pure JSON):
{
  "naam": "korte beschrijvende naam van de aanbesteding, bijv. 'Riool Maastricht 2026' of 'ICT-dienstverlening gemeente Utrecht'",
  "opdrachtgever": "naam van de aanbestedende dienst/gemeente/instelling",
  "sluitingsdatum": "datum in ISO formaat YYYY-MM-DD of null",
  "publicatiedatum": "datum in ISO formaat YYYY-MM-DD of null",
  "referentienummer": "kenmerk of referentienummer of null",
  "type_opdracht": "Diensten / Leveringen / Werken",
  "regio": "regio of gemeente of null",
  "waarde": "geraamde waarde of null",
  "samenvatting": "samenvatting van max 400 tekens"
}`,
        },
        {
          role: 'user',
          content: `Analyseer deze aanbestedingsdocumenten:\n\n${gecombineerdeTekst.slice(0, 15000)}`,
        },
      ],
    });

    let extractedData: Record<string, string> = {};
    try {
      const content = aiResponse.choices[0]?.message?.content ?? '{}';
      extractedData = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    } catch {
      extractedData = { naam: files[0]?.name.replace(/\.[^.]+$/, '') ?? 'Nieuwe sessie' };
    }

    const sessieNaam = (extractedData.naam as string) || files[0]?.name.replace(/\.[^.]+$/, '') || 'Nieuwe sessie';

    // Sessie aanmaken in database
    const { data: sessie, error: sessieError } = await supabase
      .from('analyse_sessies')
      .insert({
        naam: sessieNaam,
        status: 'nieuw',
        ai_samenvatting: extractedData.samenvatting ?? null,
        metadata: {
          opdrachtgever: extractedData.opdrachtgever ?? null,
          sluitingsdatum: extractedData.sluitingsdatum ?? null,
          publicatiedatum: extractedData.publicatiedatum ?? null,
          referentienummer: extractedData.referentienummer ?? null,
          type_opdracht: extractedData.type_opdracht ?? null,
          regio: extractedData.regio ?? null,
          waarde: extractedData.waarde ?? null,
        },
        aantal_bestanden: files.length,
      })
      .select()
      .single();

    if (sessieError || !sessie) {
      return NextResponse.json({ error: 'Sessie aanmaken mislukt', detail: sessieError?.message }, { status: 500 });
    }

    // Bestanden uploaden naar Supabase storage
    const bestandRecords = [];
    for (const fileData of fileTexts) {
      const storagePath = `${sessie.id}/${Date.now()}-${fileData.naam}`;
      const { error: uploadError } = await supabase.storage
        .from('analyse-bestanden')
        .upload(storagePath, fileData.buffer, {
          contentType: fileData.mimeType,
          upsert: false,
        });

      if (!uploadError) {
        bestandRecords.push({
          sessie_id: sessie.id,
          naam: fileData.naam,
          storage_path: storagePath,
          mime_type: fileData.mimeType,
          grootte: fileData.buffer.length,
        });
      }
    }

    if (bestandRecords.length > 0) {
      await supabase.from('sessie_bestanden').insert(bestandRecords);
    }

    return NextResponse.json({
      sessie_id: sessie.id,
      naam: sessieNaam,
      status: 'nieuw',
    });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Interne fout', detail: String(err) }, { status: 500 });
  }
}
