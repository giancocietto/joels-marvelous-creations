# Joel's Marvelous Creations

Modulo per Foundry VTT v14 con sistema dnd5e 5.3+ (regole 2024).

## Installazione

In Foundry: **Moduli aggiuntivi → Installa modulo**, incolla il Manifest URL (vedi sotto) e attiva il modulo nel mondo (*Gestisci moduli*).

## Benedetto (Bless)

Status **Benedetto (Bless)** nell'HUD del token. Quando è attivo aggiunge `1d4` a:

- tutti i tiri salvezza;
- tutti i tiri per colpire (mischia e distanza, armi e incantesimi).

Il d4 compare direttamente nella formula del tiro.

### Legato alla concentrazione

1. Seleziona i bersagli con `T`.
2. Lancia **Benedizione** dalla scheda dell'incantatore (identifier `bless`, oppure nome "Bless" / "Benedizione").
3. Il modulo applica lo status Benedetto ai bersagli e lo lega alla concentrazione dell'incantatore.
4. Quando la concentrazione termina (TS fallito, nuovo incantesimo a concentrazione, rimozione manuale) lo status sparisce da tutti i bersagli.

Note:
- **Non** premere anche il pulsante "Applica effetto" della carta dell'incantesimo di dnd5e, altrimenti il bersaglio riceve il d4 due volte. In alternativa disattiva *Benedizione automatica* nelle impostazioni del modulo.
- Se i bersagli non sono di proprietà di chi lancia (es. un giocatore che benedice gli altri PG), l'applicazione e la rimozione passano dal GM: serve un GM connesso.
- Lo status messo a mano dall'HUD **non** è legato a nessuna concentrazione.

> All'avvio, nella console (F12), compare la riga `joels-marvelous-creations | Bless keys:` con le chiavi usate. Il modulo sceglie da solo tra `system.rolls.*` e `system.bonuses.*` in base alla versione di dnd5e.

## Immagine Speculare (regole 2024)

- **Attivazione**: lancia l'incantesimo dalla scheda (identifier `mirror-image`, oppure nome "Mirror Image" / "Immagine Speculare"), oppure attiva lo status dall'HUD. Parte con **3 duplicati**.
- **Quando qualcuno attacca** un token con lo status (il token va *targettato* prima di tirare):
  - se il tiro manca la CA non succede nulla;
  - se colpisce, il modulo tira 1d6 per ogni duplicato rimasto. Con almeno un 3+ un duplicato viene colpito e svanisce (il contatore scende), altrimenti il colpo va sul bersaglio vero;
  - un attaccante Accecato, oppure con Vista Cieca o Visione del Vero entro gittata, non viene ingannato.
- **Pulsanti in chat**: ogni messaggio di Immagine Speculare ha i pulsanti *Rimuovi duplicato* / *Aggiungi duplicato*, visibili solo al GM e al proprietario del personaggio.
- Il numero di duplicati resta sempre tra 0 e 3. A 0 l'effetto si rimuove.
- **Visivo**: attorno al token compaiono copie traslucide, una per duplicato. Si possono disattivare nelle impostazioni del modulo (impostazione per client).
- Se un giocatore attacca un PNG con Immagine Speculare, l'aggiornamento passa dal GM: serve un GM connesso.

## Macro

**Immagine Speculare: aggiungi / rimuovi duplicato** sui token selezionati (apre una finestra con il conteggio attuale e i due pulsanti):

```js
game.modules.get("joels-marvelous-creations").api.mirrorImageDialog();
```

**Benedetto on/off** sui token selezionati (senza legame alla concentrazione):

```js
for (const t of canvas.tokens.controlled) {
  await t.actor.toggleStatusEffect("jmc-blessed");
}
```

Per creare una macro: clic su uno slot vuoto della hotbar → tipo **Script** → incolla → salva.

## Limiti noti

- Quando un duplicato assorbe il colpo, il danno **non** viene bloccato in automatico: il messaggio in chat lo segnala e basta non applicarlo.
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
