/**
 * Joel's Marvelous Creations
 * Foundry VTT v14 + dnd5e 5.3 / 6.x (regole 2024)
 *
 *  - Blessed (Bless): +1d4 automatico a tiri per colpire e tiri salvezza,
 *    legato alla concentrazione di chi lancia l'incantesimo.
 *  - Immagine Speculare: da 0 a 3 duplicati; quando un attacco colpisce si tira
 *    1d6 per duplicato rimasto, con un 3+ il colpo va a un duplicato che svanisce.
 *    Pulsanti +/- in chat e finestra richiamabile da macro.
 */

const MODULE_ID = "joels-marvelous-creations";
const SOCKET = `module.${MODULE_ID}`;

const BLESSED_ID = "jmc-blessed";
const MIRROR_ID = "jmc-mirror-image";
const MIRROR_MAX = 3;        // duplicati massimi (e iniziali)
const MIRROR_THRESHOLD = 3;  // 2024: un d6 con 3+ devia il colpo
const FLAG_COUNT = "duplicates";
const FLAG_CONCENTRATION = "concentration";
const FLAG_MIRROR_REF = "mirrorRef";
const GHOSTS = Symbol("jmcGhosts");

const ATTACK_TYPES = ["mwak", "rwak", "msak", "rsak"];
const MIRROR_NAMES = /^(mirror image|immagin[ei] specular[ei])$/i;
const BLESS_NAMES = /^(bless|benedizione)$/i;

/* -------------------------------------------- */
/*  Init / Setup / Ready                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoMirrorImage", {
    name: "Immagine Speculare automatica",
    hint: "Quando un incantatore lancia Immagine Speculare dalla scheda, applica lo status con 3 duplicati.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoBless", {
    name: "Benedizione automatica",
    hint: "Quando un incantatore lancia Benedizione dalla scheda, applica lo status Blessed ai bersagli selezionati (T) e lo lega alla sua concentrazione.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showGhosts", {
    name: "Mostra i duplicati sul token",
    hint: "Disegna copie traslucide del token, una per ogni duplicato rimasto.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => canvas.tokens?.placeables.forEach(t => refreshGhosts(t, true))
  });
});

// In setup i data model di dnd5e sono già registrati: posso verificare quali
// chiavi esistono davvero prima di costruire le modifiche di Bless.
Hooks.once("setup", () => {
  addStatusEffect({
    id: BLESSED_ID,
    name: "Blessed",
    img: `modules/${MODULE_ID}/icons/blessed.svg`,
    description: "Aggiunge 1d4 ai tiri per colpire e ai tiri salvezza.",
    system: { changes: buildBlessChanges() }
  });

  addStatusEffect({
    id: MIRROR_ID,
    name: mirrorName(MIRROR_MAX),
    img: `modules/${MODULE_ID}/icons/mirror-image.svg`,
    description: "Duplicati illusori: quando un attacco ti colpisce, tira 1d6 per duplicato; con 3+ viene colpito un duplicato.",
    flags: { [MODULE_ID]: { [FLAG_COUNT]: MIRROR_MAX } }
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, onSocketMessage);
  if (game.users.activeGM?.isSelf) fixBlessedIcons().catch(err => console.error(`${MODULE_ID} |`, err));

  game.modules.get(MODULE_ID).api = {
    BLESSED_ID,
    MIRROR_ID,
    getDuplicates,
    setDuplicates: requestSetDuplicates,
    changeDuplicates,
    mirrorImageDialog
  };
});

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

function addStatusEffect(data) {
  const i = CONFIG.statusEffects.findIndex(s => s.id === data.id);
  if (i >= 0) CONFIG.statusEffects.splice(i, 1, data);
  else CONFIG.statusEffects.push(data);
}

function hasActorField(path) {
  try {
    return !!CONFIG.Actor.dataModels?.character?.schema?.getField(path);
  } catch {
    return false;
  }
}

/** Sceglie la chiave nuova (system.rolls.*) se esiste, altrimenti quella classica (system.bonuses.*). */
function pickKey(modern, legacy) {
  return hasActorField(modern) ? `system.${modern}` : `system.${legacy}`;
}

function buildBlessChanges() {
  const keys = [
    pickKey("rolls.ability.save.bonus", "bonuses.abilities.save"),
    ...ATTACK_TYPES.map(t => pickKey(`rolls.attack.${t}.bonus`, `bonuses.${t}.attack`))
  ];
  console.log(`${MODULE_ID} | Bless keys:`, keys);
  return keys.map(key => ({ key, type: "add", value: "1d4" }));
}

/**
 * Riferimento serializzabile a un attore. Per i token non collegati serve
 * l'UUID del token, perché l'attore sintetico vive dentro il token.
 */
function actorRef(actor) {
  return actor?.isToken ? { token: actor.token.uuid } : { actor: actor?.uuid };
}

function resolveActor(ref) {
  if (!ref) return null;
  try {
    if (ref.token) return fromUuidSync(ref.token)?.actor ?? null;
    if (ref.actor) return fromUuidSync(ref.actor) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Attore non trovato`, ref, err);
  }
  return null;
}

function concentratingStatus() {
  return CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating";
}

function canActForAll(actors) {
  return actors.every(a => a?.isOwner);
}

/** Esegue l'azione in locale se possibile, altrimenti la chiede al GM via socket. */
async function runOrDelegate(payload, actors) {
  if (canActForAll(actors)) return handleAction(payload);
  if (!game.users.activeGM) {
    ui.notifications.warn("Joel's Marvelous Creations: serve un GM connesso per questa operazione.");
    return;
  }
  game.socket.emit(SOCKET, payload);
}

async function onSocketMessage(payload) {
  if (!game.users.activeGM?.isSelf) return;
  await handleAction(payload);
}

async function handleAction(payload) {
  switch (payload?.action) {
    case "setDuplicates": {
      const actor = resolveActor(payload.ref);
      if (actor) await setDuplicates(actor, payload.n);
      break;
    }
    case "applyBlessed":
      await applyBlessed(payload);
      break;
  }
}

/* -------------------------------------------- */
/*  Mirror Image: counter                       */
/* -------------------------------------------- */

function mirrorName(n) {
  return `Immagine Speculare (${n})`;
}

function getMirrorEffect(actor) {
  return actor?.effects?.find(e => e.statuses?.has(MIRROR_ID)) ?? null;
}

function getDuplicates(actor) {
  const effect = getMirrorEffect(actor);
  if (!effect || effect.disabled) return 0;
  return Number(effect.getFlag(MODULE_ID, FLAG_COUNT) ?? MIRROR_MAX);
}

async function setDuplicates(actor, n) {
  n = Math.clamp(Math.floor(Number(n) || 0), 0, MIRROR_MAX);
  let effect = getMirrorEffect(actor);

  if (n <= 0) return effect?.delete();

  if (!effect) {
    await actor.toggleStatusEffect(MIRROR_ID, { active: true });
    effect = getMirrorEffect(actor);
  }
  if (!effect) return;
  if (effect.getFlag(MODULE_ID, FLAG_COUNT) === n && effect.name === mirrorName(n)) return effect;

  return effect.update({
    name: mirrorName(n),
    [`flags.${MODULE_ID}.${FLAG_COUNT}`]: n
  });
}

async function requestSetDuplicates(actor, n) {
  if (!actor) return;
  return runOrDelegate({ action: "setDuplicates", ref: actorRef(actor), n }, [actor]);
}

/** Aggiunge (+1) o toglie (-1) duplicati, restando tra 0 e 3. A 0 l'effetto si rimuove. */
async function changeDuplicates(actor, delta) {
  if (!actor) return;
  const current = getDuplicates(actor);
  const next = Math.clamp(current + delta, 0, MIRROR_MAX);

  if (next === current) {
    const msg = delta > 0
      ? `${actor.name} ha già il massimo di ${MIRROR_MAX} duplicati.`
      : `${actor.name} non ha duplicati da rimuovere.`;
    ui.notifications.info(msg);
    return;
  }

  await requestSetDuplicates(actor, next);
  ui.notifications.info(next > 0
    ? `${actor.name}: duplicati ${current} → ${next}.`
    : `${actor.name}: ultimo duplicato rimosso, Immagine Speculare termina.`);
}

/** Finestra per aggiungere o togliere un duplicato ai token selezionati (usata dalla macro). */
async function mirrorImageDialog() {
  const tokens = canvas.tokens?.controlled ?? [];
  if (!tokens.length) {
    ui.notifications.warn("Seleziona almeno un token.");
    return;
  }

  const lines = tokens
    .map(t => `<li><strong>${t.name}</strong>: ${getDuplicates(t.actor)} / ${MIRROR_MAX}</li>`)
    .join("");

  const delta = await foundry.applications.api.DialogV2.wait({
    window: { title: "Immagine Speculare" },
    content: `<p>Duplicati attuali:</p><ul>${lines}</ul>`,
    buttons: [
      { action: "remove", label: "− Rimuovi un duplicato", icon: "fa-solid fa-minus", callback: () => -1 },
      { action: "add", label: "+ Aggiungi un duplicato", icon: "fa-solid fa-plus", callback: () => 1 }
    ],
    rejectClose: false
  });

  if (delta !== 1 && delta !== -1) return;
  for (const t of tokens) await changeDuplicates(t.actor, delta);
}

/* -------------------------------------------- */
/*  Mirror Image: chat cards and buttons        */
/* -------------------------------------------- */

function mirrorFlags(actor) {
  return { [MODULE_ID]: { [FLAG_MIRROR_REF]: actorRef(actor) } };
}

// Quando l'effetto viene creato (da incantesimo, HUD o pulsante) posto una carta con i pulsanti.
Hooks.on("createActiveEffect", (effect, options, userId) => {
  if (userId !== game.user.id || !effect.statuses?.has(MIRROR_ID)) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  const token = actor.token ?? actor.getActiveTokens()[0]?.document;
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token }),
    content: `<p><strong>Immagine Speculare</strong>: ${actor.name} è circondato da duplicati illusori.</p>`,
    flags: mirrorFlags(actor)
  });
});

// Aggiunge i pulsanti +/- ai messaggi di Immagine Speculare, visibili solo a GM e proprietario.
Hooks.on("renderChatMessageHTML", (message, html) => {
  const ref = message.getFlag(MODULE_ID, FLAG_MIRROR_REF);
  if (!ref) return;
  const actor = resolveActor(ref);
  if (!actor?.isOwner) return;

  const bar = document.createElement("div");
  bar.classList.add("jmc-mirror-controls");
  bar.style.cssText = "display:flex;gap:4px;margin-top:6px;";
  bar.innerHTML = `
    <button type="button" data-jmc-delta="-1" style="flex:1"><i class="fa-solid fa-minus"></i> Rimuovi duplicato</button>
    <button type="button" data-jmc-delta="1" style="flex:1"><i class="fa-solid fa-plus"></i> Aggiungi duplicato</button>`;

  bar.addEventListener("click", event => {
    const button = event.target.closest("button[data-jmc-delta]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const target = resolveActor(ref);
    if (target) changeDuplicates(target, Number(button.dataset.jmcDelta));
  });

  (html.querySelector(".message-content") ?? html).append(bar);
});

/* -------------------------------------------- */
/*  Spell casts: Mirror Image and Bless         */
/* -------------------------------------------- */

function spellMatches(item, identifier, namePattern) {
  if (item?.type !== "spell") return false;
  return item.system?.identifier === identifier || namePattern.test(item.name?.trim() ?? "");
}

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  const item = activity?.item;

  if (spellMatches(item, "mirror-image", MIRROR_NAMES) && game.settings.get(MODULE_ID, "autoMirrorImage")) {
    requestSetDuplicates(activity.actor, MIRROR_MAX);
  }

  if (spellMatches(item, "bless", BLESS_NAMES) && game.settings.get(MODULE_ID, "autoBless")) {
    handleBlessCast(activity, results).catch(err => console.error(`${MODULE_ID} |`, err));
  }
});

/* -------------------------------------------- */
/*  Bless: applicazione e concentrazione        */
/* -------------------------------------------- */

function findConcentration(caster, item, results) {
  const status = concentratingStatus();
  const isConc = e => e?.statuses?.has(status);

  const created = Array.isArray(results?.effects) ? results.effects.find(isConc) : null;
  if (created) return created;

  // dnd5e 6 ha spostato l'origine degli effetti nei dati di sistema: cerco
  // il riferimento all'incantesimo ovunque (origin, system, flag dnd5e).
  const mentionsItem = e => {
    try {
      const blob = JSON.stringify({
        origin: e.origin,
        system: e.system?.toObject?.() ?? e.system,
        flags: e.flags?.dnd5e
      });
      return blob.includes(item.uuid) || blob.includes(item.id);
    } catch {
      return false;
    }
  };

  const list = caster?.effects?.filter(isConc) ?? [];
  return list.find(mentionsItem) ?? list.at(-1) ?? null;
}

async function handleBlessCast(activity, results) {
  const caster = activity.actor;
  const item = activity.item;
  const targets = Array.from(game.user.targets).map(t => t.actor).filter(Boolean);

  if (!targets.length) {
    ui.notifications.warn("Benedizione: seleziona i bersagli (T) prima di lanciare l'incantesimo per applicare lo status Blessed.");
    return;
  }

  const concentration = findConcentration(caster, item, results);
  if (!concentration) {
    ui.notifications.warn("Benedizione: non trovo la concentrazione dell'incantatore, lo status verrà applicato senza legame.");
  }

  await runOrDelegate({
    action: "applyBlessed",
    targets: targets.map(actorRef),
    concentration: concentration?.uuid ?? null,
    origin: item.uuid,
    casterName: caster?.name ?? ""
  }, targets);
}

function blessedEffectData({ concentration, origin }) {
  const status = CONFIG.statusEffects.find(s => s.id === BLESSED_ID);
  const data = {
    name: status?.name ?? "Blessed",
    img: status?.img,
    description: status?.description ?? "",
    statuses: [BLESSED_ID],
    // v14: senza questo l'icona compare sul token solo per effetti con durata.
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
    system: foundry.utils.deepClone(status?.system ?? { changes: buildBlessChanges() }),
    flags: { [MODULE_ID]: { [FLAG_CONCENTRATION]: concentration ?? null } }
  };
  if (origin) data.origin = origin;
  return data;
}

async function applyBlessed(payload) {
  const names = [];
  for (const ref of payload.targets ?? []) {
    const actor = resolveActor(ref);
    if (!actor) continue;

    // Una sola Benedizione per bersaglio: sostituisco quella eventualmente presente.
    const old = actor.effects.filter(e => e.statuses?.has(BLESSED_ID)).map(e => e.id);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);

    await actor.createEmbeddedDocuments("ActiveEffect", [blessedEffectData(payload)]);
    names.push(actor.name);
  }

  if (names.length) {
    const linked = payload.concentration ? " (legato alla concentrazione)" : "";
    ui.notifications.info(`Benedizione${payload.casterName ? ` di ${payload.casterName}` : ""}: ${names.join(", ")}${linked}.`);
  }
}

/** Sistema gli effetti Blessed creati dalla v0.2.0, che non mostravano l'icona sul token. */
async function fixBlessedIcons() {
  const ALWAYS = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2;
  for (const actor of allWorldActors()) {
    const updates = actor.effects
      .filter(e => e.statuses?.has(BLESSED_ID) && e.showIcon !== ALWAYS)
      .map(e => ({ _id: e.id, showIcon: ALWAYS }));
    if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  }
}

/** Attori del mondo più quelli sintetici dei token non collegati. */
function allWorldActors() {
  const actors = new Set(game.actors);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.add(token.actor);
    }
  }
  return actors;
}

/** Rimuove tutti gli status Blessed legati a una concentrazione terminata. */
async function removeBlessedLinkedTo(concentrationUuid) {
  for (const actor of allWorldActors()) {
    if (!actor.isOwner) continue;
    const ids = actor.effects
      .filter(e => e.statuses?.has(BLESSED_ID) && e.getFlag(MODULE_ID, FLAG_CONCENTRATION) === concentrationUuid)
      .map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

Hooks.on("deleteActiveEffect", (effect, options, userId) => {
  if (!effect.statuses?.has(concentratingStatus())) return;
  // Pulisce il GM attivo; se nessun GM è connesso, ci pensa chi ha tolto la concentrazione.
  const gm = game.users.activeGM;
  const responsible = gm ? gm.isSelf : userId === game.user.id;
  if (!responsible) return;
  removeBlessedLinkedTo(effect.uuid).catch(err => console.error(`${MODULE_ID} |`, err));
});

/* -------------------------------------------- */
/*  Mirror Image: attack interception           */
/* -------------------------------------------- */

Hooks.on("dnd5e.rollAttack", (rolls, data) => {
  handleAttack(rolls, data).catch(err => console.error(`${MODULE_ID} |`, err));
});

async function handleAttack(rolls, { subject } = {}) {
  const roll = rolls?.[0];
  if (!roll) return;

  const attacker = subject?.actor ?? null;
  const attackerToken = attacker?.token?.object ?? attacker?.getActiveTokens?.()[0] ?? null;

  for (const target of game.user.targets) {
    const actor = target.actor;
    const count = getDuplicates(actor);
    if (!count || actor === attacker) continue;

    const ac = Number(actor.system?.attributes?.ac?.value ?? 10);
    const hit = roll.isCritical || (!roll.isFumble && roll.total >= ac);
    if (!hit) continue;

    const speaker = ChatMessage.getSpeaker({ token: target.document });
    const immunity = illusionImmunity(attacker, attackerToken, target);
    if (immunity) {
      await ChatMessage.create({
        speaker,
        content: `<p><strong>Immagine Speculare</strong>: ${attacker.name} ${immunity}, quindi i duplicati non lo ingannano. Il colpo va su ${target.name}.</p>`,
        flags: mirrorFlags(actor)
      });
      continue;
    }

    const dice = await new Roll(`${count}d6`).evaluate();
    const results = dice.dice[0].results.map(r => r.result);
    const struck = results.some(r => r >= MIRROR_THRESHOLD);
    const remaining = struck ? count - 1 : count;

    const verdict = struck
      ? `Un duplicato viene colpito e svanisce. <strong>Nessun danno a ${target.name}.</strong> Duplicati rimasti: ${remaining}.`
      : `Nessun duplicato viene colpito: l'attacco colpisce <strong>${target.name}</strong>.`;

    await dice.toMessage({
      speaker,
      flavor: `<strong>Immagine Speculare</strong>: ${attacker?.name ?? "L'attaccante"} colpisce (${roll.total} vs CA ${ac}). `
        + `Tiro ${count}d6 [${results.join(", ")}], serve ${MIRROR_THRESHOLD}+.<br>${verdict}`,
      flags: mirrorFlags(actor)
    });

    if (struck) await requestSetDuplicates(actor, remaining);
  }
}

/** Accecato, Vista Cieca o Visione del Vero entro gittata: le immagini non funzionano. */
function illusionImmunity(attacker, attackerToken, targetToken) {
  if (!attacker) return null;
  if (attacker.statuses?.has("blinded")) return "è Accecato";

  const senses = attacker.system?.attributes?.senses ?? {};
  const range = key => Number(senses.ranges?.[key] ?? senses[key] ?? 0) || 0;

  let distance = Infinity;
  if (attackerToken && targetToken) {
    try {
      distance = canvas.grid.measurePath([attackerToken.center, targetToken.center]).distance;
    } catch { /* lasciamo Infinity */ }
  }

  for (const [key, label] of [["truesight", "Visione del Vero"], ["blindsight", "Vista Cieca"]]) {
    const r = range(key);
    if (r > 0 && distance <= r) return `ha ${label}`;
  }
  return null;
}

/* -------------------------------------------- */
/*  Mirror Image: ghost visuals on the token    */
/* -------------------------------------------- */

const GHOST_OFFSETS = [[-0.38, 0.06], [0.38, 0.06], [0, -0.32]];

function refreshGhosts(token, force = false) {
  if (!token || token.destroyed) return;
  const enabled = game.settings.get(MODULE_ID, "showGhosts");
  const count = enabled ? getDuplicates(token.actor) : 0;
  const existing = token[GHOSTS];

  if (existing && !existing.destroyed && existing._count === count && !force) return;
  if (existing && !existing.destroyed) existing.destroy({ children: true });
  token[GHOSTS] = null;

  const texture = token.texture ?? token.mesh?.texture;
  if (!count || !texture) return;

  const container = new PIXI.Container();
  container._count = count;
  container.eventMode = "none";

  for (let i = 0; i < Math.min(count, GHOST_OFFSETS.length); i++) {
    const [dx, dy] = GHOST_OFFSETS[i];
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = token.w * 0.9;
    sprite.height = token.h * 0.9;
    sprite.alpha = 0.35;
    sprite.tint = 0xb8dcff;
    sprite.position.set(token.w / 2 + dx * token.w, token.h / 2 + dy * token.h);
    container.addChild(sprite);
  }

  token.addChildAt(container, 0);
  token[GHOSTS] = container;
}

Hooks.on("refreshToken", token => refreshGhosts(token));

for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, effect => {
    if (!effect.statuses?.has(MIRROR_ID)) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    for (const token of actor.getActiveTokens()) refreshGhosts(token, true);
  });
}
