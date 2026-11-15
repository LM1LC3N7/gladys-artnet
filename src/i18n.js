// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, refusals of commands, badges,
// action results, feature and default device names), in English and French.
// An entry typed by the user is never shown back (only its position); the
// node address is not a secret, the node name comes from the node itself
// (printable ASCII, bounded).
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

const FEATURE_LABELS = {
  binary: { en: 'On / off', fr: 'Allumage' },
  brightness: { en: 'Brightness', fr: 'Luminosité' },
  color: { en: 'Colour', fr: 'Couleur' },
  temperature: { en: 'White temperature', fr: 'Température du blanc' },
};

export const featureLabel = (key, language = 'fr') =>
  FEATURE_LABELS[key]?.[language] ?? FEATURE_LABELS[key]?.en ?? key;
export const fixtureLabel = (language = 'fr') => (language === 'en' ? 'Fixture' : 'Projecteur');

/** Pairs joined by a space (undefined ones skipped), bounded. */
export function join(...pairs) {
  const list = pairs.filter(Boolean);
  const cut = (text) =>
    text.length > LIMITS.message ? `${text.slice(0, LIMITS.message - 1)}…` : text;
  return {
    en: cut(list.map((p) => p.en).join(' ')),
    fr: cut(list.map((p) => p.fr).join(' ')),
  };
}

/** A duration: "45 s", "3 min" (59.9 s is "1 min", never "60 s"). */
export function age(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}

const where = (node) => `${node.host}:${node.port}`;

const REASONS = {
  syntax: { en: 'unreadable', fr: 'illisible' },
  universe: { en: 'universe not in 0 to 32767', fr: 'univers hors de 0 à 32767' },
  address: { en: 'address not in 1 to 512', fr: 'adresse hors de 1 à 512' },
  profile: { en: 'unknown profile', fr: 'profil inconnu' },
  name: {
    en: 'name too long or with a control character',
    fr: 'nom trop long ou avec un caractère de contrôle',
  },
  overflow: { en: 'runs past channel 512', fr: 'dépasse le canal 512' },
  overlap: { en: 'overlaps an earlier fixture', fr: 'chevauche un projecteur précédent' },
  tooMany: { en: 'over 64 fixtures', fr: 'plus de 64 projecteurs' },
  universes: { en: 'over 16 universes', fr: 'plus de 16 univers' },
};

export const T = {
  noAddress: {
    en: 'Type the IP address of the Art-Net node.',
    fr: 'Saisissez l’adresse IP du nœud Art-Net.',
  },
  invalidAddress: {
    en: 'The node address is not a valid IPv4 address (with an optional port).',
    fr: 'L’adresse du nœud n’est pas une adresse IPv4 valide (port facultatif).',
  },
  broadcastAddress: {
    en: 'The node address is a broadcast, multicast or network address: Art-Net sends DMX to the address of the node itself.',
    fr: 'L’adresse du nœud est une adresse de diffusion, de multidiffusion ou de réseau : Art-Net envoie le DMX à l’adresse du nœud lui-même.',
  },
  configUnread: (ms) => ({
    en:
      ms > 0 ? `Configuration not read: tried again in ${age(ms)}.` : 'Configuration not read yet.',
    fr:
      ms > 0
        ? `Configuration non lue : nouvel essai dans ${age(ms)}.`
        : 'Configuration pas encore lue.',
  }),
  noFixtures: {
    en: 'No fixture in the configuration.',
    fr: 'Aucun projecteur dans la configuration.',
  },
  tooLong: {
    en: 'The Fixtures field is over 4000 characters: no fixture read.',
    fr: 'Le champ Projecteurs dépasse 4000 caractères : aucun projecteur lu.',
  },
  fixtureErrors: (errors) => {
    const shown = errors.slice(0, 5);
    const more = errors.length - shown.length;
    return {
      en: `Entries skipped: ${shown.map((e) => `#${e.index} (${REASONS[e.reason]?.en ?? e.reason})`).join(', ')}${more > 0 ? ` and ${more} more` : ''}.`,
      fr: `Entrées ignorées : ${shown.map((e) => `n° ${e.index} (${REASONS[e.reason]?.fr ?? e.reason})`).join(', ')}${more > 0 ? ` et ${more} autres` : ''}.`,
    };
  },
  storeUnread: {
    en: 'Storage /data unreadable (read again every 10 s): before the configuration is read, "off" and Blackout cannot leave.',
    fr: 'Stockage /data illisible (relu toutes les 10 s) : avant la lecture de la configuration, « éteindre » et Blackout ne peuvent pas partir.',
  },
  storeUnwritable: {
    en: 'Storage /data not writable: after a restart, "off" waits for the configuration.',
    fr: 'Stockage /data non inscriptible : après un redémarrage, « éteindre » attendra la configuration.',
  },
  portFallback: (port) => ({
    en: `Port 6454 busy here: frames leave from port ${port} (a few nodes ignore them).`,
    fr: `Port 6454 occupé ici : les trames partent du port ${port} (quelques nœuds les ignorent).`,
  }),
  ready: (node, count) => ({
    en: `Ready: ${count} fixture(s), frames go to ${where(node)}.`,
    fr: `Prêt : ${count} projecteur(s), trames vers ${where(node)}.`,
  }),
  assumed: {
    en: 'Art-Net never reports a state: Gladys shows the last command sent (assumed state).',
    fr: 'Art-Net ne renvoie jamais d’état : Gladys affiche la dernière commande envoyée (état supposé).',
  },
  sendFailed: (node, code) => ({
    en: `Frames do not leave for ${where(node)} (${code}): tried again every second.`,
    fr: `Les trames ne partent pas vers ${where(node)} (${code}) : nouvel essai chaque seconde.`,
  }),
  badge: {
    en: 'Assumed state: Art-Net never reports the state of a fixture.',
    fr: 'État supposé : Art-Net ne renvoie jamais l’état d’un projecteur.',
  },
  testTooSoon: (ms) => ({
    en: `Test already run: try again in ${age(ms)}.`,
    fr: `Test déjà lancé : réessayez dans ${age(ms)}.`,
  }),
  testOk: (node, reply) => ({
    en: `The node ${where(node)} answers: ${reply.shortName || '(no name)'}${reply.longName ? ` - ${reply.longName}` : ''}.`,
    fr: `Le nœud ${where(node)} répond : ${reply.shortName || '(sans nom)'}${reply.longName ? ` - ${reply.longName}` : ''}.`,
  }),
  testNoReply: (node) => ({
    en: `No ArtPollReply from ${where(node)} within 3 s. Some nodes answer only to port 6454 or not at all: this does not stop the DMX frames.`,
    fr: `Aucune réponse ArtPollReply de ${where(node)} en 3 s. Certains nœuds ne répondent qu’au port 6454, ou jamais : cela n’empêche pas l’envoi des trames DMX.`,
  }),
  testSendFailed: (node, code) => ({
    en: `ArtPoll not sent to ${where(node)} (${code}).`,
    fr: `ArtPoll non envoyé à ${where(node)} (${code}).`,
  }),
  blackoutSent: (sent, total) => ({
    en: `Blackout sent: ${sent} universe(s) of ${total} at 0, kept at 0 until the next command.`,
    fr: `Blackout envoyé : ${sent} univers sur ${total} à 0, gardés à 0 jusqu’à la prochaine commande.`,
  }),
  blackoutPartial: (sent, total, code) => ({
    en: `Blackout: ${sent} universe(s) of ${total} sent, the others not (${code}): tried again every second.`,
    fr: `Blackout : ${sent} univers sur ${total} envoyé(s), les autres non (${code}) : nouvel essai chaque seconde.`,
  }),
  blackoutNothing: {
    en: 'Blackout: no fixture known yet (configuration not read, /data empty): nothing sent.',
    fr: 'Blackout : aucun projecteur connu pour l’instant (configuration non lue, /data vide) : rien envoyé.',
  },
  closed: {
    en: 'The integration is stopping: nothing sent.',
    fr: 'L’intégration s’arrête : rien envoyé.',
  },
  blackoutNoNode: {
    en: 'Blackout: no node address known: nothing sent.',
    fr: 'Blackout : aucune adresse de nœud connue : rien envoyé.',
  },
};

/** Command refusals (the SDK sends them to Gladys as plain text). */
export const ERRORS = {
  unknown: 'This device is not an Art-Net fixture of this integration',
  invalidValue: 'Invalid value for this feature (nothing sent)',
  notConfigured: 'Node address not configured (nothing sent)',
  configUnread: 'Configuration not read yet (nothing sent)',
  notListed: 'This fixture is not in the configuration (nothing sent)',
  notThisProfile: 'This feature does not exist on the profile of this fixture (nothing sent)',
  closed: 'The integration is stopping (nothing sent)',
  unsent: (code) => `The frame did not leave (${code}): nothing sent`,
  unconfirmed: 'Frame handed to the network, not confirmed in time',
  offUnsent: (code) => `Off not sent yet (${code}): tried again every second`,
  offUnconfirmed: 'Off handed to the network, not confirmed in time: sent again every second',
};
