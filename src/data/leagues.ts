export interface LeagueData {
  id: string;
  name: string;
  country: string;
  teams: string[];
}

export const ALL_LEAGUES: LeagueData[] = [
  {
    id: "premier",
    name: "英超",
    country: "英格兰",
    teams: [
      "Red Devils", "London Cannons", "Blue Moon", "Stamford Blue",
      "Anfield Reds", "Tottenham White", "Magpie United", "Villa Clarets",
      "Wolves Gold", "Everton Toffees", "Fulham Whites", "Brentford Bees",
      "Crystal Eagles", "Brighton Seagulls", "Forest Reds", "Burnley Clarets",
      "Sheffield Blades", "Luton Hatters",
    ],
  },
  {
    id: "laliga",
    name: "西甲",
    country: "西班牙",
    teams: [
      "Madrid White", "Catalonia FC", "Madrid Red-White", "Sevilla Red",
      "Bilbao Lions", "Valencia Bats", "Villarreal Yellow", "San Sebastián Blue",
      "Betis Green", "Celta Sky", "Mallorca Red", "Osasuna Red",
      "Almería Red", "Cádiz Yellow", "Granada Red", "Las Palmas Yellow",
      "Girona Red-White", "Rayo Vallecano",
    ],
  },
  {
    id: "seriea",
    name: "意甲",
    country: "意大利",
    teams: [
      "Milan Red-Black", "Milan Blue", "Turin Zebra", "Rome Red-Wolf",
      "Napoli Blue", "Florence Purple", "Bergamo Blue-Black", "Bologna Red-Blue",
      "Rome Blue-Eagle", "Genoa Red-Blue", "Monza Red-White", "Turin Red",
      "Udinese White-Black", "Lecce Yellow-Red", "Cagliari Red-Blue", "Verona Yellow-Blue",
      "Salernitana Red", "Sassuolo Green-Black",
    ],
  },
  {
    id: "bundesliga",
    name: "德甲",
    country: "德国",
    teams: [
      "Munich Red", "Dortmund Yellow", "Leipzig Red-Bull", "Leverkusen Red-Black",
      "Frankfurt Eagle", "Wolfsburg Green", "Mönchengladbach Green-White", "Stuttgart Red",
      "Bremen Green", "Freiburg Red", "Hoffenheim Blue", "Mainz Red",
      "Augsburg Red-Green", "Bochum Blue", "Darmstadt Blue", "Heidenheim Red",
      "Köln Red", "Union Berlin Red",
    ],
  },
  {
    id: "ligue1",
    name: "法甲",
    country: "法国",
    teams: [
      "Paris Blue-Red", "Marseille White-Blue", "Lyon White-Red", "Monaco Red-White",
      "Lille Red", "Rennes Red-Black", "Nice Red-Black", "Lens Yellow-Red",
      "Strasbourg Blue", "Montpellier Orange", "Toulouse Purple", "Nantes Yellow-Green",
      "Reims Red-White", "Brest Red", "Le Havre Blue", "Metz Red",
      "Lorient Orange", "Clermont Red-Blue",
    ],
  },
  {
    id: "primeira",
    name: "葡超",
    country: "葡萄牙",
    teams: [
      "Lisbon Eagle", "Porto Dragon", "Lisbon Lion", "Braga Red",
      "Guimarães White", "Famalicão Blue", "Boavista Black-White", "Estoril Yellow",
      "Portimonense Black", "Rio Ave Green", "Vizela Blue", "Arouca Yellow",
      "Casa Pia Black", "Chaves Blue", "Farense White", "Estrela Red",
      "Gil Vicente Red", "Moreirense Green",
    ],
  },
  {
    id: "superlig",
    name: "土超",
    country: "土耳其",
    teams: [
      "Istanbul Lion", "Istanbul Eagle", "Istanbul Black-White", "Trabzon Blue",
      "Ankara Grey", "Konya Green", "Kayseri Red", "Antalya Red-White",
      "Adana Blue", "Alanya Orange", "Sivas Red", "Gaziantep Red-Black",
      "Karagümrük Red", "Hatay Blue", "Rize Blue", "Pendik Red",
      "Samsun Red", "Istanbul Blue",
    ],
  },
  {
    id: "eredivisie",
    name: "荷甲",
    country: "荷兰",
    teams: [
      "Amsterdam Red-White", "Eindhoven Red-White", "Rotterdam Red-White", "Alkmaar Red",
      "Enschede Red", "Utrecht Red-White", "Nijmegen Red-Green", "Heerenveen Blue",
      "Tilburg Blue-White", "Arnhem Yellow-Black", "Waalwijk Yellow", "Almere Black",
      "Zwolle Blue", "Breda Yellow", "Doetinchem Blue", "Volendam Orange",
      "Emmen Red", "Eindhoven Blue-White",
    ],
  },
];

export function getLeagueById(id: string): LeagueData | undefined {
  return ALL_LEAGUES.find((l) => l.id === id);
}
