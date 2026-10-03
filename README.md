# gym-progress — dziennik treningowy

Monorepo: backend w `training_journal/`, frontend w `frontend/`, treningi w `data/`.
Lokalna ścieżka projektu: `~/Sources/gym-progress`.
Repozytorium: [spacholski1225/gym-progress](https://github.com/spacholski1225/gym-progress), gałąź `master`.

Prywatne API FastAPI do zapisu treningów. Dane są plikami JSON, jeden trening na dzień.
Każda zmiana zapisana przez API tworzy lokalny commit Git obejmujący tylko dany trening.
Bez kont, logowania, bazy SQL i automatycznego push. Dostęp docelowo wyłącznie przez VPN.

Frontend React/TypeScript jest w `frontend/`. Po wejściu wybiera się jeden z trzech planów
treningowych: Plan A jest gotowy, a plany B i C są oznaczone jako będące w przygotowaniu.
Obok wyboru planu widać ostatni zapisany trening i jego datę pobrane z serwera.
Lista ćwiczeń prowadzi do osobnego ekranu edycji serii. Nowy trening kopiuje wyniki ostatniego
wcześniejszego treningu zapisanego na serwerze i dostępnego w pamięci telefonu. Pierwszy
trening ma puste pola i trzy serie. Zmiana kolejności/nazwy ćwiczeń wynika z aktualnego planu;
kopiowanie jest po stałym ID i jednostce, więc kilogramy nigdy nie są kopiowane jako sekundy.

## Uruchomienie całej aplikacji

Do zbudowania frontendu potrzebujesz Node.js **22+** i pnpm **11.19.0**.
Na Macu Node można zainstalować przez `brew install node`, a następnie
`npm install -g pnpm@11.19.0`. Używaj wersji zależności zapisanych w `pnpm-lock.yaml`.

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ..
.venv/bin/python -m uvicorn training_journal.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Otwórz **<http://127.0.0.1:8000/>**. Nie otwieraj `frontend/index.html` jako lokalnego
pliku: jest to źródło wymagające zbudowania przez Vite. Po buildzie FastAPI serwuje
`frontend/dist/` pod `/`, a API nadal pod `/api/`. Jeśli backend działał przed buildem,
zrestartuj go, aby zamontował frontend. Nie jest potrzebny osobny serwer Node na RPi.
Możesz zbudować frontend na Macu i skopiować `frontend/dist/` na RPi obok kodu backendu.
Artefakty buildu są poza Gitem; kod, lockfile i pliki treningów pozostają w repozytorium.

Praca nad interfejsem: uruchom backend na porcie 8000, a w drugim terminalu
`cd frontend` i `pnpm dev`. Vite na porcie 5173 przekazuje `/api` do backendu.
Pełne działanie offline testuj na produkcyjnym buildzie; tryb deweloperski nie rejestruje
service workera.

### Korzystanie na iPhonie

Docelowy adres z RPi musi mieć **HTTPS z certyfikatem zaufanym przez iPhone**, także za VPN.
Wyjątek dla `localhost` pozwala testować offline lokalnie na komputerze; zwykłe HTTP pod
adresem IP RPi nie wystarcza do instalowalnej aplikacji działającej offline.
W Safari otwórz adres aplikacji, wybierz udostępnianie, a następnie „Do ekranu początkowego”.
Konfiguracja certyfikatu i reverse proxy wymaga docelowego adresu serwera — nie jest tu wdrożona.

- **Trening:** lista w ustalonej kolejności; dotknięcie ćwiczenia otwiera jego serie.
  „Gotowe” wraca do listy. Liczby z przecinkiem i kropką są obsługiwane, klawiatura jest numeryczna.
  Można dodawać/usuwać serie. Usunięcie wypełnionej serii wymaga potwierdzenia.
  Zmiana jednostki czyści wartości ciężaru/czasu po potwierdzeniu, bez ich przeliczania.
- **Zapis lokalny:** każda zmiana trafia do IndexedDB, również niepełny tekst w polu.
  Zdjęcia ćwiczeń wybrane z biblioteki telefonu są pomniejszane, przechowywane lokalnie
  na tym urządzeniu i używane jako miniatury na liście ćwiczeń; nie są wysyłane na serwer.
  Zakończony zapis potwierdza komunikat na dole. Błąd pamięci pokazuje ostrzeżenie i umożliwia
  pobranie kopii. Nowa wersja aplikacji nie przeładowuje formularza automatycznie.
- **Synchronizacja:** tylko przyciskiem, także dla niepełnego treningu. Powrót połączenia
  może odświeżyć odczyty, ale nigdy automatycznie nie wysyła formularza.
  Zmiany zrobione podczas synchronizacji pozostają lokalne i wymagają kolejnego kliknięcia.
  Przy konflikcie można pobrać lokalną kopię, wybrać własną wersję lub wersję serwera.
- **Historia:** treningi zapisane na serwerze i lokalne szkice zawierające zmiany. Puste,
  nowo utworzone szkice nie są pokazywane; po udanym odświeżeniu lista lokalnych dokumentów
  odpowiada serwerowi. Wybranie daty pozwala edytować ten dzień bez tworzenia nowego treningu.
  Dostępny jest eksport lokalnej kopii JSON.
- **Postępy:** sześć wykresów, 30/90 dni, maksymalny ciężar lub czas danej sesji.
  Wykresy obejmują wyłącznie zapisane wersje serwerowe, również odczytane z pamięci offline.
  Punkt można dotknąć; pod wykresem jest dostępna również lista wartości.

Lokalne dane należą do konkretnego adresu aplikacji i urządzenia. Adresy na portach 8000,
8001 i 5173 mają oddzielne magazyny. Zmiana adresu nie usuwa JSON-ów na serwerze, ale lokalne
szkice nie przeniosą się automatycznie. Nie czyść danych Safari przed synchronizacją.
Eksport JSON jest kopią do pobrania; automatyczny import kopii nie jest częścią tej wersji.

### Testy frontendu

```sh
cd frontend
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Testy jednostkowe sprawdzają liczby, kopiowanie wyników, zakresy dat, zapis offline,
wyścig edycji z synchronizacją, konflikt rewizji oraz awarię Git i pamięci telefonu.
Test E2E uruchamia prawdziwe FastAPI i Git w tymczasowym repozytorium, używa osobnego
profilu przeglądarki i usuwa testowe dane po zakończeniu. Nie zapisuje treningów w `data/`
tego projektu. Na Macu korzysta z zainstalowanego Chrome; poza nim z Chromium Playwrighta.
Możesz wskazać `CHROME_PATH` oraz `PYTHON` jako ścieżki do własnych programów.
Zrzuty kontrolne trafiają do ignorowanego `frontend/test-results/`.

Sprawdzone automatycznie w Chromium przy szerokościach 320/390/768 px, z prawdziwym
service workerem i przeładowaniem bez sieci. Ostateczny test instalacji, klawiatury i układu
na fizycznym iPhonie wymaga otwarcia docelowego adresu HTTPS.

## Uruchomienie

Wymagania: Linux lub macOS, Python **3.11+**, Git. Na RPi zalecany 64-bitowy Raspberry Pi OS
z Pythonem 3.11 lub nowszym. Projekt uruchamiamy z checkoutu repozytorium.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m uvicorn training_journal.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Polecenia wykonuj w katalogu `gym-progress`. W dostarczonym projekcie środowisko `.venv`
jest już przygotowane na obecnym komputerze; na RPi utwórz nowe, nie kopiuj `.venv` z macOS.

- Swagger UI: <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- OpenAPI: <http://127.0.0.1:8000/openapi.json>
- Plan: <http://127.0.0.1:8000/api/plan>

`requirements.lock` zawiera dokładne wersje użyte przy testach. `pyproject.toml` opisuje
pakiet i zakresy zależności. Testy uruchomisz przez `.venv/bin/python -m pytest -q`.
Nie uruchamiają one zapisów w prawdziwym `data/`: każdy test ma osobne tymczasowe repozytorium.

## Plan i model

`plan.json` zawiera Plan A ukierunkowany na nogi, `plan-b.json` zawiera Plan B
ukierunkowany na klatkę, barki, plecy i nogi, a `plan-c.json` zawiera Plan C
ukierunkowany na klatkę, barki, ramiona i dwójki. Wszystkie plany mają domyślnie trzy serie;
konkretny trening może zmienić liczbę serii (minimum jedna) i jednostkę ćwiczenia.

Plan definiuje również `rest_seconds` — domyślną przerwę między seriami ćwiczenia w sekundach.
Wartość `null` oznacza pustą, nieustawioną przerwę. Nowy trening kopiuje tę wartość z planu,
a jej zmiana na ekranie ćwiczenia jest zapisywana w konkretnym treningu.

Każde ćwiczenie ma również opcjonalne `instructions` z instrukcją wykonania oraz zdjęcie.
Instrukcję wpisuje się po otwarciu ikony informacji. W tym samym miejscu przycisk „Dodaj zdjęcie”
otwiera bibliotekę zdjęć na iPhonie; po wybraniu zdjęcie pojawia się jako podgląd i miniatura.
Instrukcja zapisana w treningu jest kopiowana do kolejnego nowego treningu tego samego planu
wraz z seriami. Zdjęcie pozostaje ustawieniem lokalnym telefonu.

Seria zawsze ma oba klucze:

```json
{"value": 23.5, "reps": 8}
```

Dla planka: `{"value": 60, "reps": 1}` przy jednostce `sec`.
Dla pustej serii: `{"value": null, "reps": null}`. Każde pole może być puste niezależnie.
Wartości są nieujemne i skończone; powtórzenia są całkowite. Nie akceptujemy tekstu
`"23,5"`, tekstu `"23.5"`, wartości logicznych ani brakujących kluczy serii.
Frontend zamienia przecinek na kropkę i wysyła liczbę JSON. Zero nie oznacza braku danych.
Dla ćwiczeń z masą ciała można umownie używać `0 kg` jako braku dodatkowego obciążenia.

`exercise_id` jest stałe. Zmiana nazwy zachowuje historię; zastąpienie ćwiczenia innym
wymaga nowego ID. Każdy trening przechowuje własne nazwy, jednostki i serie, stanowiące
kopię użytego planu. Zmiana pliku wybranego planu wpływa tylko na nowe treningi.
API nie przepisuje ani nie uzupełnia wcześniejszych dokumentów bieżącym planem.

## Kontrakt API

| Metoda i ścieżka | Działanie |
| --- | --- |
| `GET /api/plan?id=A|B|C` | Wybrany plan, jednostki i domyślna liczba serii |
| `GET /api/workouts?from=2026-09-01&to=2026-09-30` | Pełne dokumenty, rosnąco według daty |
| `GET /api/workouts/2026-09-22` | Jeden dokument z rewizją; `404`, jeśli nie istnieje |
| `PUT /api/workouts/2026-09-22` | Zapis całego dokumentu; `200` z wynikiem zapisu i Git |
| `DELETE /api/workouts/2026-09-22?expected_revision=...` | Usunięcie treningu z pliku danych i historii Git |
| `GET /api/progress?from=2026-08-24&to=2026-09-22` | Maksymalne wartości ćwiczeń w kolejnych treningach |

Parametry `from` i `to` są wymagane, obie granice włączne. Niepoprawny zakres daje `422`.
Daty muszą mieć format `YYYY-MM-DD`, bez godziny. Lista bez wyników to `[]`.

Żądanie `PUT` zawiera `schema_version: 1`, `date`, listę `exercises` oraz `expected_revision`.
Wysyłaj wszystkie ćwiczenia i serie, które mają pozostać w treningu — to pełne zastąpienie,
nie częściowe scalanie. Puste pola wysyłaj jako `null`. Nie ma osobnego etapu zatwierdzania
kompletności, więc można zapisać cały niewypełniony trening.

Przykład utworzenia całego pustego treningu na podstawie aktualnego planu (Python, standardowa biblioteka):

```python
import json
from datetime import datetime
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

base = "http://127.0.0.1:8000"
with urlopen(f"{base}/api/plan") as response:
    plan = json.load(response)

day = datetime.now(ZoneInfo("Europe/Warsaw")).date().isoformat()
payload = {
    "schema_version": 1,
    "date": day,
    "expected_revision": None,
    "exercises": [
        {**exercise, "sets": [{"value": None, "reps": None}
                             for _ in range(plan["default_sets"])]}
        for exercise in plan["exercises"]
    ],
}
request = Request(f"{base}/api/workouts/{day}", method="PUT",
                  data=json.dumps(payload).encode(),
                  headers={"Content-Type": "application/json"})
with urlopen(request) as response:
    result = json.load(response)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

Ten przykład rzeczywiście zapisuje trening i tworzy commit. Jeśli pod tą datą jest już
inny dokument, dostaniesz `409`; pobierz istniejący trening zamiast zastępować go pustym.

Odpowiedź synchronizacji ma postać:

```json
{
  "saved": true,
  "changed": true,
  "workout": {
    "schema_version": 1,
    "date": "2026-09-22",
    "exercises": [
      {
        "exercise_id": "plank",
        "name": "Plank",
        "unit": "sec",
        "sets": [{"value": 60, "reps": 1}]
      }
    ],
    "revision": "aebf5fb966334c9089c2f399961190af",
    "created_at": "2026-09-22T10:00:00Z",
    "updated_at": "2026-09-22T10:00:00Z"
  },
  "git": {
    "status": "committed",
    "commit": "przykladowy-identyfikator-commita",
    "error": null
  }
}
```

Lista ćwiczeń w przykładzie odpowiedzi została skrócona. W pliku zapisujemy dokładnie
obiekt `workout`, a nie otoczkę synchronizacji. Rewizja i znaczniki czasu są nadawane przez serwer.

### Edycja, ponawianie i błędy

1. Odczytaj dokument po jego oryginalnej dacie, również jeśli edytujesz go innego dnia.
2. Do nowego `PUT` skopiuj `schema_version`, `date`, `exercises`; przekaż odczytaną
   `revision` jako `expected_revision`. Nie wysyłaj `created_at`, `updated_at` ani `revision`.
3. Po odpowiedzi zapamiętaj zwrócony dokument i jego nową rewizję.

Nowy trening wymaga `expected_revision: null` (można też pominąć to pole).
Zmiana istniejącego wymaga jego bieżącej rewizji. Konflikt daje `409` z
`detail.code: "revision_conflict"` i `detail.current_revision`. Frontend powinien zachować
lokalne zmiany i pobrać aktualny dokument; nie nadpisywać automatycznie konfliktu.

**Identyczny dokument jest wyjątkiem:** ponowienie po utracie odpowiedzi jest bezpiecznym
brakiem zmian, nawet z poprzednią rewizją lub `null`. Nie zmienia czasu aktualizacji ani rewizji.
Nie tworzy commita, jeśli plik jest już wersjonowany. Jeśli poprzedni commit się nie udał,
ponowienie próbuje go utworzyć bez ponownego przepisywania JSON-a.

- `git.status = committed`: commit został utworzony.
- `git.status = unchanged`: dane były już zapisane i wersjonowane.
- `git.status = failed`: **JSON jest zapisany**, ale Git zawiódł. `saved` pozostaje `true`,
  HTTP pozostaje `200`; szczegóły są w `git.error`. Frontend powinien pokazać osobny status
  błędu wersjonowania, zachować zwróconą rewizję i pozwolić ponowić synchronizację.
- `422`: błędne dane; dokument nie został zapisany.
- `503`: problem z plikiem lub dyskiem. Nie zakładaj, że zapis nie dotarł do dysku;
  powtórz to samo żądanie. Uszkodzonych dokumentów serwer nie nadpisuje po cichu.

Data dokumentu nie zmienia się przy edycji. `created_at` jest czasem pierwszego zapisu
na serwerze, `updated_at` ostatniej zmiany treści; oba są w UTC. Dzień treningu może być
wcześniejszy od pierwszej synchronizacji. Frontend ustala domyślny dzień w `Europe/Warsaw`.

### Wykresy

Frontend wysyła przedział: dla 30 dni `from = to - 29 dni`, dla 90 dni `from = to - 89 dni`.
API zwraca listę obiektów `{exercise_id, name, unit, points: [{date, value}]}`.
Jeden punkt to maksimum wszystkich niepustych wartości ćwiczenia w danym treningu,
również gdy liczba powtórzeń pozostaje pusta. Zera zostają, `null` nie tworzy punktu.
Ćwiczenie bez żadnej wpisanej wartości w zakresie nie ma serii wynikowej.

Serie grupujemy po `(exercise_id, unit)`, więc kilogramy i sekundy nigdy się nie mieszają.
Punkty są uporządkowane chronologicznie; nazwa serii pochodzi z najnowszego punktu w zakresie.
Wykres planka pokazuje najdłuższy czas serii, bez przeliczania przez liczbę powtórzeń.

## Pliki i Git

```text
plan.json                # Plan A, śledzony przez Git
plan-b.json              # Plan B, śledzony przez Git
plan-c.json              # Plan C, śledzony przez Git
training_journal/        # Backend
tests/                   # Testy API i realnych operacji Git
deploy/                  # Przykładowa usługa systemd
.runtime/workouts.lock   # Blokada procesu; poza Gitem
```

`data/` oznacza podkatalog projektu, a nie systemowy `/data`. Repozytorium zostało już
zainicjalizowane na gałęzi `master`. Jeśli przenosisz projekt, klonuj repozytorium lub zachowaj
`.git`. Skopiowanie samych plików wymaga `git init -b master` i początkowego commita.
Nie dołączamy przykładowych treningów do rzeczywistych danych.

Automatyczne commity mają autora `Training Journal <training-journal@localhost>`,
nie wymagają globalnej konfiguracji użytkownika. Backend wyłącza podpisywanie i hooki
wyłącznie dla swoich poleceń Git. Nie zmienia globalnej konfiguracji i nie robi push.
`git commit --only -- <plik>` pomija pozostałe zmiany, także wcześniej dodane do indeksu.
Trwające merge, rebase lub cherry-pick blokują automatyczny commit, ale nie zapis JSON-a.

Backend serializuje odczyty i zapisy blokadą wątku oraz `flock`, a następnie zapisuje plik
tymczasowy, wykonuje `fsync` i atomową podmianę. Git działa pod tą samą blokadą.
Uruchamiaj jeden worker. Zatrzymaj usługę przed ręcznymi operacjami Git na serwerze
(np. pull/rebase) albo ręczną edycją danych — polecenia administratora nie używają blokady API.
Trzymaj dane na lokalnym systemie plików, nie na udziale sieciowym o innych zasadach blokad.

Zmienne środowiskowe:

| Zmienna | Wartość domyślna | Znaczenie |
| --- | --- | --- |
| `REPO_DIR` | Katalog projektu wykryty z położenia kodu | Główny katalog samodzielnego repozytorium Git |
| `DATA_DIR` | `data` | Ścieżka względna wobec repozytorium lub absolutna wewnątrz niego |
| `PLAN_FILE` | `plan.json` | Ścieżka względna wobec repozytorium lub absolutna |

`DATA_DIR` musi pozostawać pod `REPO_DIR`, aby automatyczne commity obejmowały treningi.
Można zamontować dysk/wolumen w tym podkatalogu; nie używaj dowiązania poza repozytorium.
Pliki treningowe nie mogą być dowiązaniami symbolicznymi.

## Raspberry Pi

1. Zainstaluj `python3`, `python3-venv` i `git`, następnie sprawdź `python3 --version` (minimum 3.11).
2. Umieść checkout np. w `/srv/training-journal`, z prawami zapisu dla konta uruchamiającego usługę.
3. Utwórz `.venv` i zainstaluj `requirements.lock` poleceniami z początku instrukcji.
4. Uruchom testy oraz Uvicorn. Do testów z komputera można użyć tunelu
   `ssh -L 8000:127.0.0.1:8000 TWOJ_UZYTKOWNIK@ADRES_RPI` i otworzyć lokalne `/docs`.
5. Skopiuj `deploy/training-journal.service` do `/etc/systemd/system/`, dostosuj użytkownika
   i ścieżki, następnie wykonaj:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now training-journal
sudo systemctl status training-journal
journalctl -u training-journal -f
```

Usługa nasłuchuje na `127.0.0.1:8000`, pod przyszłe reverse proxy z HTTPS dostępne przez VPN.
Jeśli chcesz testować backend bezpośrednio po VPN, zamiast loopback podaj konkretny adres
interfejsu VPN w `--host`. API nie ma mechanizmu logowania — ograniczenie dostępu zapewnia sieć.
Konfiguracja docelowego HTTPS i instalacja PWA na iPhonie pozostają etapem wdrożenia.

Remote `origin` wskazuje na `git@github.com:spacholski1225/gym-progress.git`.
Backend nadal tworzy tylko lokalne commity; po synchronizacji treningów wysyłaj je osobno
poleceniem `git push`. Kopię repozytorium wraz z `data/` przechowuj również poza kartą RPi.
