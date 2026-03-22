import { Plus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TenderTable } from '@/components/aanbestedingen/tender-table';
import { Aanbesteding } from '@/types';

// Mock data — replace with Supabase query
const mockData: Aanbesteding[] = [
  {
    id: '1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'Renovatie gemeentehuis Utrecht',
    beschrijving: 'Complete renovatie van het historische gemeentehuis inclusief verduurzaming.',
    opdrachtgever: 'Gemeente Utrecht',
    publicatiedatum: new Date(Date.now() - 10 * 86400000).toISOString(),
    sluitingsdatum: new Date(Date.now() + 7 * 86400000).toISOString(),
    bron_url: 'https://www.tenderned.nl',
    bron_website: 'TenderNed',
    status: 'gevonden',
    totaal_score: 78,
    ai_samenvatting: 'Renovatieopdracht voor het historisch gemeentehuis van Utrecht met focus op duurzaamheid.',
    is_upload: false,
  },
  {
    id: '2',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'ICT-infrastructuur provincie Zuid-Holland',
    beschrijving: 'Levering en beheer van ICT-infrastructuur voor alle provinciale gebouwen.',
    opdrachtgever: 'Provincie Zuid-Holland',
    publicatiedatum: new Date(Date.now() - 5 * 86400000).toISOString(),
    sluitingsdatum: new Date(Date.now() + 14 * 86400000).toISOString(),
    bron_website: 'TenderNed',
    status: 'gekwalificeerd',
    totaal_score: 85,
    is_upload: false,
  },
  {
    id: '3',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'Groenonderhoud Almere 2025',
    beschrijving: 'Meerjarig contract voor groenonderhoud in alle wijken van Almere.',
    opdrachtgever: 'Gemeente Almere',
    publicatiedatum: new Date(Date.now() - 15 * 86400000).toISOString(),
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
    beschrijving: 'Bewaking en beveiliging van Rijkswaterstaat locaties in Noord-Holland.',
    opdrachtgever: 'Rijkswaterstaat',
    publicatiedatum: new Date(Date.now() - 30 * 86400000).toISOString(),
    sluitingsdatum: new Date(Date.now() - 5 * 86400000).toISOString(),
    status: 'afgewezen',
    totaal_score: 45,
    is_upload: false,
  },
  {
    id: '5',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    titel: 'Schoonmaakdiensten Belastingdienst',
    opdrachtgever: 'Belastingdienst',
    sluitingsdatum: new Date(Date.now() + 21 * 86400000).toISOString(),
    status: 'gevonden',
    totaal_score: 61,
    is_upload: true,
    bestandsnaam: 'aanbesteding_belastingdienst.pdf',
  },
];

export default function AanbestedingenPage() {
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

      <TenderTable data={mockData} />
    </div>
  );
}
