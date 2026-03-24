/**
 * POST /api/scrape/start
 *
 * Triggert een Claude-gestuurde scrapesessie voor een bron.
 * Claude gebruikt tool calling om pagina's op te halen en tenders te extraheren.
 * Voor sites met login: Claude genereert instructies voor de Computer Use agent.
 *
 * Body: { bron_id: string, zoekterm?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { zodSchema } from '@ai-sdk/provider-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Eenvoudige HTML → tekst converter
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000);
}

export async function POST(request: NextRequest) {
  const { bron_id, zoekterm } = await request.json();

  if (!bron_id) {
    return NextResponse.json({ error: 'bron_id verplicht' }, { status: 400 });
  }

  // Bron ophalen
  const { data: bron } = await supabase
    .from('bron_websites')
    .select('*')
    .eq('id', bron_id)
    .single();

  if (!bron) {
    return NextResponse.json({ error: 'Bron niet gevonden' }, { status: 404 });
  }

  // Scrape job aanmaken
  const { data: job } = await supabase
    .from('scrape_jobs')
    .insert({
      bron_id: bron.id,
      bron_naam: bron.naam,
      bron_url: bron.url,
      zoekterm: zoekterm ?? null,
      status: 'bezig',
      started_at: new Date().toISOString(),
      triggered_by: 'manual',
    })
    .select()
    .single();

  if (!job) {
    return NextResponse.json({ error: 'Job aanmaken mislukt' }, { status: 500 });
  }

  // Controleer of Anthropic API key beschikbaar is
  if (!process.env.ANTHROPIC_API_KEY) {
    // Zonder Anthropic: job op fout zetten + instructies genereren voor handmatige cowork setup
    await supabase.from('scrape_jobs').update({
      status: 'fout',
      fout_melding: 'ANTHROPIC_API_KEY niet ingesteld. Gebruik de webhook voor externe computer-use agent.',
    }).eq('id', job.id);

    return NextResponse.json({
      job_id: job.id,
      status: 'fout',
      instructie: `Voeg ANTHROPIC_API_KEY toe aan .env.local. Of gebruik de webhook direct vanuit een externe Claude Computer Use agent.`,
      webhook_url: `${request.nextUrl.origin}/api/webhook/cowork`,
      webhook_secret: process.env.WEBHOOK_SECRET,
    }, { status: 202 });
  }

  const heeftLogin = !!(bron.gebruikersnaam && bron.wachtwoord);

  // Claude met tool calling starten (asynchroon afhandelen)
  runClaudeScraper(job.id, bron, zoekterm, heeftLogin, request.nextUrl.origin).catch(console.error);

  return NextResponse.json({
    job_id: job.id,
    status: 'bezig',
    bericht: heeftLogin
      ? 'Claude start scrapesessie. Let op: inloggen vereist mogelijk een Computer Use agent.'
      : 'Claude start scrapesessie via directe fetch.',
  });
}

async function runClaudeScraper(
  jobId: string,
  bron: Record<string, string>,
  zoekterm: string | undefined,
  heeftLogin: boolean,
  origin: string
) {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const gevondenTenders: object[] = [];

  try {
    const systemPrompt = `Je bent een expert web scraper voor aanbestedingen.
Je taak: bezoek de opgegeven website, zoek naar aanbestedingen${zoekterm ? ` met zoekterm "${zoekterm}"` : ''}, en extraheer alle gevonden tenders als gestructureerde data.
Gebruik de fetch_page tool om pagina's op te halen.
Extraheer per tender minimaal: titel, opdrachtgever, sluitingsdatum, en URL.
${heeftLogin ? `Let op: deze site vereist login (gebruikersnaam: ${bron.gebruikersnaam}). Probeer publieke pagina's te scrapen of gebruik de zoekfunctie direct.` : ''}
Geef uiteindelijk de extract_results tool aan met alle gevonden tenders.`;

    const userMessage = `Scrape aanbestedingen van: ${bron.url}
${bron.zoekpad ? `Zoekpad/filter: ${bron.zoekpad}` : ''}
${zoekterm ? `Zoekterm: ${zoekterm}` : ''}
${bron.vakgebied ? `Vakgebied: ${bron.vakgebied}` : ''}

Stap 1: Haal de hoofdpagina op
Stap 2: Zoek naar aanbestedingsoverzichten of zoekfuncties
Stap 3: Extraheer alle gevonden tenders`;

    await generateText({
      model: anthropic('claude-opus-4-5'),
      system: systemPrompt,
      prompt: userMessage,
      tools: {
        fetch_page: {
          description: 'Haal een webpagina op en retourneer de tekstinhoud',
          inputSchema: zodSchema(z.object({
            url: z.string().describe('De URL om op te halen'),
            zoekterm: z.string().optional().describe('Optionele zoekterm voor in de URL'),
          })),
          execute: async ({ url, zoekterm: qt }: { url: string; zoekterm?: string }) => {
            try {
              let targetUrl = url;
              if (qt) {
                const u = new URL(url);
                u.searchParams.set('q', qt);
                u.searchParams.set('search', qt);
                targetUrl = u.toString();
              }
              const res = await fetch(targetUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; TenderTracker/1.0)',
                  'Accept': 'text/html,application/xhtml+xml',
                },
                signal: AbortSignal.timeout(15000),
              });
              const html = await res.text();
              return { url: targetUrl, status: res.status, tekst: htmlToText(html) };
            } catch (e) {
              return { url, status: 0, tekst: `Fout: ${String(e)}` };
            }
          },
        },

        extract_results: {
          description: 'Geef de geëxtraheerde tenders op als gestructureerde data',
          inputSchema: zodSchema(z.object({
            tenders: z.array(z.object({
              titel: z.string(),
              opdrachtgever: z.string().optional(),
              beschrijving: z.string().optional(),
              sluitingsdatum: z.string().optional(),
              publicatiedatum: z.string().optional(),
              referentienummer: z.string().optional(),
              type_opdracht: z.string().optional(),
              waarde: z.string().optional(),
              regio: z.string().optional(),
              url: z.string().optional(),
            })),
            opmerkingen: z.string().optional(),
          })),
          execute: async ({ tenders, opmerkingen }: { tenders: object[]; opmerkingen?: string }) => {
            gevondenTenders.push(...tenders);
            return { opgeslagen: tenders.length, opmerkingen };
          },
        },
      },
    });

    // Resultaten opslaan
    if (gevondenTenders.length > 0) {
      await supabase.from('scrape_jobs').update({
        status: 'gereed',
        resultaten: gevondenTenders,
        aantal_gevonden: gevondenTenders.length,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);

      // Webhook intern aanroepen om sessies aan te maken
      await fetch(`${origin}/api/webhook/cowork`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': process.env.WEBHOOK_SECRET!,
        },
        body: JSON.stringify({
          job_id: jobId,
          bron_naam: bron.naam,
          bron_url: bron.url,
          tenders: gevondenTenders,
        }),
      });
    } else {
      await supabase.from('scrape_jobs').update({
        status: 'gereed',
        resultaten: [],
        aantal_gevonden: 0,
        completed_at: new Date().toISOString(),
        fout_melding: 'Geen tenders gevonden. Mogelijk vereist de site inloggen via de Computer Use agent.',
      }).eq('id', jobId);
    }
  } catch (err) {
    await supabase.from('scrape_jobs').update({
      status: 'fout',
      fout_melding: String(err),
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}
