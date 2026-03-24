/**
 * POST /api/webhook/cowork
 *
 * Webhook ontvanger voor Claude Cowork / externe computer-use agents.
 * Authenticatie via header: X-Webhook-Secret
 *
 * Verwacht payload:
 * {
 *   job_id?: string,          // optioneel: koppel aan bestaande scrape_job
 *   bron_naam: string,
 *   bron_url: string,
 *   zoekterm?: string,
 *   tenders: Array<{
 *     titel: string,
 *     beschrijving?: string,
 *     opdrachtgever?: string,
 *     sluitingsdatum?: string,
 *     publicatiedatum?: string,
 *     referentienummer?: string,
 *     type_opdracht?: string,
 *     waarde?: string,
 *     url?: string,
 *     bestanden?: string[],  // URLs naar documenten
 *   }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { z } from 'zod';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TenderSchema = z.object({
  titel: z.string(),
  beschrijving: z.string().optional(),
  opdrachtgever: z.string().optional(),
  sluitingsdatum: z.string().optional(),
  publicatiedatum: z.string().optional(),
  referentienummer: z.string().optional(),
  type_opdracht: z.string().optional(),
  waarde: z.string().optional(),
  regio: z.string().optional(),
  url: z.string().optional(),
  bestanden: z.array(z.string()).optional(),
});

const PayloadSchema = z.object({
  job_id: z.string().uuid().optional(),
  bron_naam: z.string(),
  bron_url: z.string(),
  zoekterm: z.string().optional(),
  tenders: z.array(TenderSchema),
});

export async function POST(request: NextRequest) {
  // Authenticatie
  const secret = request.headers.get('X-Webhook-Secret') ?? request.headers.get('x-webhook-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON' }, { status: 400 });
  }

  const parse = PayloadSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json({ error: 'Ongeldige payload', detail: parse.error.flatten() }, { status: 400 });
  }

  const { job_id, bron_naam, bron_url, zoekterm, tenders } = parse.data;

  if (!tenders.length) {
    return NextResponse.json({ verwerkt: 0, sessies: [] });
  }

  // Job bijwerken als job_id meegegeven
  if (job_id) {
    await supabase.from('scrape_jobs').update({
      status: 'gereed',
      resultaten: tenders,
      aantal_gevonden: tenders.length,
      completed_at: new Date().toISOString(),
    }).eq('id', job_id);
  }

  // Per tender een analyse_sessie aanmaken
  const gemaakteSessies: string[] = [];

  for (const tender of tenders) {
    // AI: samenvatting genereren
    let samenvatting: string | null = null;
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Maak een beknopte samenvatting (max 300 tekens) van deze aanbesteding:\nTitel: ${tender.titel}\nOpdrachtgever: ${tender.opdrachtgever ?? 'onbekend'}\nBeschrijving: ${tender.beschrijving ?? 'geen'}`
        }]
      });
      samenvatting = res.choices[0]?.message?.content?.slice(0, 400) ?? null;
    } catch { /* skip samenvatting als AI faalt */ }

    const { data: sessie } = await supabase
      .from('analyse_sessies')
      .insert({
        naam: tender.titel,
        status: 'nieuw',
        ai_samenvatting: samenvatting,
        metadata: {
          opdrachtgever: tender.opdrachtgever ?? null,
          sluitingsdatum: tender.sluitingsdatum ?? null,
          publicatiedatum: tender.publicatiedatum ?? null,
          referentienummer: tender.referentienummer ?? null,
          type_opdracht: tender.type_opdracht ?? null,
          regio: tender.regio ?? null,
          waarde: tender.waarde ?? null,
          bron_naam,
          bron_url: tender.url ?? bron_url,
          zoekterm: zoekterm ?? null,
        },
        aantal_bestanden: tender.bestanden?.length ?? 0,
      })
      .select('id')
      .single();

    if (sessie) gemaakteSessies.push(sessie.id);
  }

  return NextResponse.json({
    ontvangen: tenders.length,
    verwerkt: gemaakteSessies.length,
    sessie_ids: gemaakteSessies,
  });
}

// GET: webhook info ophalen (voor de UI)
export async function GET(request: NextRequest) {
  const secret = request.headers.get('X-Webhook-Secret') ?? request.headers.get('x-webhook-secret');
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    status: 'actief',
    endpoint: '/api/webhook/cowork',
    methode: 'POST',
    authenticatie: 'Header: X-Webhook-Secret',
  });
}
