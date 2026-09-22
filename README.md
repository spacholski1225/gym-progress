# Dziennik treningowy — backend

Prywatne API FastAPI do zapisu treningów. Dane są plikami JSON, jeden trening na dzień.
Każda zmiana zapisana przez API tworzy lokalny commit Git obejmujący tylko dany trening.
Bez kont, logowania, bazy SQL i automatycznego push. Dostęp docelowo wyłącznie przez VPN.

## Uruchomienie

Wymagania: Linux lub macOS, Python **3.11+**, Git. Na RPi zalecany 64-bitowy Raspberry Pi OS
z Pythonem 3.11 lub nowszym. Projekt uruchamiamy z checkoutu repozytorium.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m uvicorn training_journal.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Polecenia wykonuj w katalogu `training-journal`. W dostarczonym projekcie środowisko `.venv`
jest już przygotowane na obecnym komputerze; na RPi utwórz nowe, nie kopiuj `.venv` z macOS.

- Swagger UI: <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- OpenAPI: <http://127.0.0.1:8000/openapi.json>
- Plan: <http://127.0.0.1:8000/api/plan>

`requirements.lock` zawiera dokładne wersje użyte przy testach. `pyproject.toml` opisuje
pakiet i zakresy zależności. Testy uruchomisz przez `.venv/bin/python -m pytest -q`.
Nie uruchamiają one zapisów w prawdziwym `data/`: każdy test ma osobne tymczasowe repozytorium.

## Plan i model

`plan.json` zawiera sześć ćwiczeń w kolejności: wyciskanie leżąc, przysiady, podciągnięcia,
wykroki, pompki, plank. Domyślnie każde ma trzy serie. Jednostka planka to `sec`, innych `kg`.
W każdym treningu można zmienić liczbę serii (minimum jedna) i jednostkę ćwiczenia.

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
kopię użytego planu. Zmiana `plan.json` wpływa tylko na plan pobierany dla nowych treningów.
API nie przepisuje ani nie uzupełnia wcześniejszych dokumentów bieżącym planem.

## Kontrakt API

| Metoda i ścieżka | Działanie |
| --- | --- |
| `GET /api/plan` | Plan, jednostki i domyślna liczba serii |
| `GET /api/workouts?from=2026-09-01&to=2026-09-30` | Pełne dokumenty, rosnąco według daty |
| `GET /api/workouts/2026-09-22` | Jeden dokument z rewizją; `404`, jeśli nie istnieje |
| `PUT /api/workouts/2026-09-22` | Zapis całego dokumentu; `200` z wynikiem zapisu i Git |
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
plan.json                # Plan początkowy, śledzony przez Git
data/YYYY-MM-DD.json      # Treningi, śledzone przez Git
training_journal/        # Backend
tests/                   # Testy API i realnych operacji Git
deploy/                  # Przykładowa usługa systemd
.runtime/workouts.lock   # Blokada procesu; poza Gitem
```

`data/` oznacza podkatalog projektu, a nie systemowy `/data`. Repozytorium zostało już
zainicjalizowane na gałęzi `main`. Jeśli przenosisz projekt, klonuj repozytorium lub zachowaj
`.git`. Skopiowanie samych plików wymaga `git init -b main` i początkowego commita.
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
Konfiguracja HTTPS, frontend i instalacja PWA na iPhonie należą do następnego etapu.

Repozytorium nie ma skonfigurowanego zdalnego serwera. Lokalne commity dają historię,
ale kopię repozytorium wraz z `data/` trzeba przechowywać również poza kartą RPi.
