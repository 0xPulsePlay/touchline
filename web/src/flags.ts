/** Country name → flag emoji for the World Cup corpus (fallback: ⚽). */
const ISO: Record<string, string> = {
  Algeria: "DZ", Argentina: "AR", Australia: "AU", Austria: "AT", Belgium: "BE",
  "Bosnia & Herzegovina": "BA", Brazil: "BR", Canada: "CA", "Cape Verde": "CV",
  Colombia: "CO", "Congo DR": "CD", "Costa Rica": "CR", Croatia: "HR", Curacao: "CW",
  Ecuador: "EC", Egypt: "EG", England: "GB", France: "FR", Germany: "DE", Ghana: "GH",
  Haiti: "HT", Iran: "IR", Iraq: "IQ", "Ivory Coast": "CI", Japan: "JP", Jordan: "JO",
  Mexico: "MX", Morocco: "MA", Myanmar: "MM", Netherlands: "NL", "New Zealand": "NZ",
  Norway: "NO", Panama: "PA", Paraguay: "PY", Portugal: "PT", Qatar: "QA",
  "Saudi Arabia": "SA", Scotland: "GB", Senegal: "SN", "South Africa": "ZA",
  "South Korea": "KR", Spain: "ES", Sweden: "SE", Switzerland: "CH", Tunisia: "TN",
  USA: "US", Uruguay: "UY", Uzbekistan: "UZ", Vietnam: "VN",
};

const SPECIAL: Record<string, string> = { England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" };

export function flag(team: string): string {
  if (SPECIAL[team]) return SPECIAL[team];
  const iso = ISO[team];
  if (!iso) return "⚽";
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
