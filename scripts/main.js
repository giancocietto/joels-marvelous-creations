/**
 * Joel's Marvelous Creations
 * Foundry VTT v14 + dnd5e 5.3+ (regole 2024)
 *
 *  - Benedetto (Bless): +1d4 automatico a tiri per colpire e tiri salvezza.
 *  - Immagine Speculare: 3 duplicati; quando un attacco colpisce si tira 1d6
 *    per duplicato rimasto, con un 3+ il colpo va a un duplicato che svanisce.
 */

const MODULE_ID = "joels-marvelous-creations";
const SOCKET = `module.${MODULE_ID}`;

const BLESSED_ID = "jmc-blessed";
const MIRROR_ID = "jmc-mirror-image";
const MIRROR_MAX = 3;        // duplicati iniziali
const MIRROR_THRESHOLD = 3;  // 2024: un d6 con 3+ devia il colpo
const FLAG_COUNT = "duplicates";
const GHOSTS = Symbol("jmcGhosts");

const ATTACK_TYPES = ["mwak", "rwak", "msak", "rsak"];

/* -------------------------------------------- */
/*  Init / Setup                                */
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

// In setup i data model di dnd5e sono già registrati, quindi posso verificare
// quali chiavi esistono davvero prima di costruire le modifiche di Bless.
Hooks.once("setup", () => {
  addStatusEffect({
    id: BLESSED_ID,
    name: "Benedetto (Bless)",
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

  game.modules.get(MODULE_ID).api = {
    BLESSED_ID,
    MIRROR_ID,
    getDuplicates,
    setDuplicates: requestSetDuplicates
  };
});

/* -------------------------------------------- */
/*  Status effect registration                  */
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

/* -------------------------------------------- */
/*  Mirror Image: counter                        */
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
  n = Math.clamp(Math.floor(n), 0, MIRROR_MAX);
  let effect = getMirrorEffect(actor);

  if (n <= 0) return effect?.delete();

  if (!effect) {
    await actor.toggleStatusEffect(MIRROR_ID, { active: true });
    effect = getMirrorEffect(actor);
  }
  if (!effect) return;

  return effect.update({
    name: mirrorName(n),
    [`flags.${MODULE_ID}.${FLAG_COUNT}`]: n
  });
}

/** Aggiorna direttamente se l'utente è owner, altrimenti chiede al GM via socket. */
async function requestSetDuplicates(actor, n) {
  if (!actor) return;
  if (actor.isOwner) return setDuplicates(actor, n);

  if (!game.users.activeGM) {
    ui.notifications.warn("Immagine Speculare: serve un GM connesso per aggiornare i duplicati.");
    return;
  }
  game.socket.emit(SOCKET, { action: "setDuplicates", actorUuid: actor.uuid, n });
}

async function onSocketMessage(data) {
  if (!game.users.activeGM?.isSelf) return;
  if (data?.action !== "setDuplicates") return;
  const actor = await fromUuid(data.actorUuid);
  if (actor) await setDuplicates(actor, data.n);
}

/* -------------------------------------------- */
/*  Mirror Image: auto-apply on cast            */
/* -------------------------------------------- */

const MIRROR_NAMES = /^(mirror image|immagin[ei] specular[ei])$/i;

Hooks.on("dnd5e.postUseActivity", (activity) => {
  if (!game.settings.get(MODULE_ID, "autoMirrorImage")) return;
  const item = activity?.item;
  if (item?.type !== "spell") return;
  const isMirror = item.system?.identifier === "mirror-image" || MIRROR_NAMES.test(item.name?.trim() ?? "");
  if (!isMirror) return;
  requestSetDuplicates(activity.actor, MIRROR_MAX);
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
        content: `<p><strong>Immagine Speculare</strong>: ${attacker.name} ${immunity}, quindi i duplicati non lo ingannano. Il colpo va su ${target.name}.</p>`
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
        + `Tiro ${count}d6 [${results.join(", ")}], serve ${MIRROR_THRESHOLD}+.<br>${verdict}`
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
/*  Mirror Image: ghost visuals on the token     */
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
