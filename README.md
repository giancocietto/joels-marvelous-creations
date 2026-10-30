# Joel's Marvelous Creations

Modulo per Foundry VTT v14 con sistema dnd5e 5.3+ (regole 2024).

## Installazione

1. Copia la cartella `joels-marvelous-creations` in `Data/modules/`.
2. Riavvia Foundry e attiva il modulo nel mondo (*Gestisci moduli*).

## Benedetto (Bless)

Nell'HUD del token trovi un nuovo status, **Benedetto (Bless)**. Quando è attivo aggiunge `1d4` a:

- tutti i tiri salvezza;
- tutti i tiri per colpire (mischia e distanza, armi e incantesimi).

Il d4 compare direttamente nella formula del tiro. Lo status non ha durata: va rimosso a mano oppure quando cade la concentrazione.

> All'avvio, nella console (F12), compare la riga `joels-marvelous-creations | Bless keys:` con le chiavi usate. Il modulo sceglie da solo tra `system.rolls.*` e `system.bonuses.*` in base alla versione di dnd5e.

## Immagine Speculare (regole 2024)

- **Attivazione**: lancia l'incantesimo dalla scheda (identifier `mirror-image`, oppure nome "Mirror Image" / "Immagine Speculare"), oppure attiva lo status dall'HUD. Parte con **3 duplicati**.
- **Quando qualcuno attacca** un token con lo status (il token va *targettato* prima di tirare):
  - se il tiro manca la CA non succede nulla;
  - se colpisce, il modulo tira 1d6 per ogni duplicato rimasto. Con almeno un 3+ un duplicato viene colpito e svanisce (il contatore scende), altrimenti il colpo va sul bersaglio vero;
  - un attaccante Accecato, oppure con Vista Cieca o Visione del Vero entro gittata, non viene ingannato.
- A 0 duplicati lo status si rimuove da solo.
- **Visivo**: attorno al token compaiono copie traslucide, una per duplicato. Si possono disattivare nelle impostazioni del modulo (impostazione per client).
- Se un giocatore attacca un PNG con Immagine Speculare, l'aggiornamento passa dal GM: serve un GM connesso.

## Macro utili

Attivare o disattivare Benedetto sui token selezionati:

```js
for (const t of canvas.tokens.controlled) {
  await t.actor.toggleStatusEffect("jmc-blessed");
}
```

Impostare a mano il numero di duplicati sul token selezionato:

```js
const api = game.modules.get("joels-marvelous-creations").api;
const actor = canvas.tokens.controlled[0]?.actor;
const n = Number(prompt("Duplicati (0-3)?", api.getDuplicates(actor)));
await api.setDuplicates(actor, n);
```

## Limiti noti

- Quando un duplicato assorbe il colpo, il danno **non** viene bloccato in automatico: il messaggio in chat lo segnala e basta non applicarlo.
- Lo status Benedetto non ha durata e non è legato alla concentrazione.
- Per gli attacchi conta il target dell'utente che tira (`T` sul token).

## Installazione da Manifest URL

In Foundry: **Moduli aggiuntivi → Installa modulo**, incolla questo URL nel campo *Manifest URL*:

```
https://github.com/giancocietto/joels-marvelous-creations/releases/latest/download/module.json
```

## Pubblicare una nuova versione

**Dal sito (senza terminale):** scheda **Actions** → *Release* → **Run workflow**, scrivi la versione (es. `0.2.0`) e conferma. L'Action crea il tag `v0.2.0`, aggiorna `module.json`, crea `module.zip` e pubblica la release.

**Da terminale:**

```bash
git tag v0.2.0
git push origin v0.2.0
```

In Foundry basta poi premere *Controlla aggiornamenti*.
