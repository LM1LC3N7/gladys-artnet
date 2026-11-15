# Art-Net

Pilote l’éclairage scénique DMX (gradateurs, projecteurs RGB, RGBW et blancs)
depuis Gladys par un **nœud Art-Net** : le boîtier qui convertit votre réseau
local en lignes DMX512. Tout reste sur le réseau local (port UDP 6454), sans
compte et sans cloud.

> Cette intégration n’a **jamais été testée avec un vrai nœud** : seulement avec
> un nœud simulé sur la même machine. Dites-nous comment elle se comporte avec
> le vôtre. Elle est sans lien avec Artistic Licence ni avec une marque
> d’éclairage.

Art-Net™ Designed by and Copyright Artistic Licence. Art-Net est un protocole
d’Artistic Licence Engineering Ltd.

## Ce qu’il faut

- Un nœud Art-Net (Art-Net 3 ou 4) sur votre réseau, avec une **adresse IP
  fixe** (réglée dans votre box ou dans le nœud).
- L’adresse DMX de chaque projecteur (réglée sur le projecteur : écran,
  interrupteurs DIP) et l’univers de la ligne DMX où il est branché (réglé dans
  le nœud).

## Configuration

1. **Adresse IP du nœud** : l’adresse du nœud, par exemple `192.168.1.60`. Le
   port est 6454, sauf si vous en ajoutez un autre (`192.168.1.60:6455`). Une
   adresse de diffusion (finissant par `.255`, `2.255.255.255`…) est refusée :
   Art-Net 4 envoie le DMX au nœud lui-même.
2. **Projecteurs** : une entrée par projecteur, séparées par `;` :
   `[univers/]adresse profil nom`. Exemple :
   `1 rgb Salon; 4 dimmer Bar; 2/10 cct Bureau`.
   - univers : 1 à 32767 (le Port-Address du nœud), 1 si omis ; 0 est
     accepté s’il est écrit (`0/4`) : Art-Net 4 le déprécie, mais beaucoup de
     nœuds l’utilisent encore ;
   - adresse : 1 à 512, le premier canal DMX du projecteur ;
   - profil : l’ordre de ses canaux :

     | Profil   | Canaux                              | Fonctions dans Gladys                      |
     | -------- | ----------------------------------- | ------------------------------------------ |
     | `dimmer` | intensité                           | allumage, luminosité                       |
     | `rgb`    | rouge, vert, bleu                   | allumage, luminosité, couleur              |
     | `rgbw`   | rouge, vert, bleu, blanc            | allumage, luminosité, couleur              |
     | `drgb`   | intensité, rouge, vert, bleu        | allumage, luminosité, couleur              |
     | `drgbw`  | intensité, rouge, vert, bleu, blanc | allumage, luminosité, couleur              |
     | `cct`    | blanc froid, blanc chaud            | allumage, luminosité, température du blanc |

   - nom : 40 caractères au plus (facultatif : `Projecteur 1/4` sinon).

   Une entrée illisible, qui dépasse le canal 512 ou qui chevauche un
   projecteur précédent est ignorée : le statut donne sa position et la raison.
   64 projecteurs au plus, sur 16 univers.

3. **Langue des noms par défaut** : celle des noms donnés aux projecteurs sans
   nom et aux fonctions.

Enregistrez : les projecteurs apparaissent dans la **Découverte** (une lumière
chacun). Ajoutez-les.

## État supposé

Art-Net envoie le DMX dans un seul sens : un projecteur **ne renvoie jamais son
état**. Gladys affiche la dernière commande envoyée, et le badge de chaque
projecteur indique que l’état est supposé. Si quelqu’un change un projecteur
avec une console ou ses propres boutons, Gladys ne le sait pas.

Après un redémarrage de l’intégration, chaque projecteur est supposé **éteint** :
rien n’est envoyé avant la première commande, et cette première commande envoie
tout l’univers, donc les autres projecteurs de l’univers passent à 0 (Gladys les
affiche éteints). Les canaux DMX d’un univers qui ne sont pas dans la liste des
projecteurs sont envoyés à 0.

## Envoi des trames

- Un univers commence à être envoyé à la première commande, extinction ou
  Blackout qui le touche. Sa trame (tout l’univers, du canal 1 au dernier canal
  utilisé) part ensuite après chaque changement, au plus tôt 25 ms après la
  précédente (40 trames par seconde au plus, la limite du DMX512 est 44), et de
  nouveau toutes les 900 ms sans changement, comme Art-Net le demande, jusqu’à
  l’arrêt de l’intégration.
- Une trame part en unicast vers l’adresse du nœud, depuis le port 6454 s’il est
  libre (sinon depuis un autre port, dit dans le statut : quelques nœuds
  l’ignorent).
- Une commande reçoit sa réponse une fois sa trame sortie de la carte réseau.
  Si elle n’a pas pu partir (erreur réseau), allumage, luminosité, couleur et
  température sont annulés et la réponse dit que rien n’a été envoyé.

## Éteindre et Blackout

« Éteindre » (allumage à 0, ou luminosité 0) met tous les canaux du projecteur
à 0. **Blackout** (bouton de la configuration, et action de scène « Blackout
Art-Net ») met à 0 tous les projecteurs connus et tous les univers déjà envoyés.

Ils ne demandent aucune option ni configuration lue : l’adresse du nœud et les
projecteurs sont aussi gardés dans `/data`, lu dès le démarrage de l’intégration,
donc ils fonctionnent juste après un redémarrage, avant que Gladys donne la
configuration (avant sa lecture, ils attendent jusqu’à 1,5 s une lecture de
`/data` en cours). La limite de 32 univers par session ne les retient pas. Si une
trame ne peut pas partir, l’envoi de maintien toutes les 900 ms la réessaie
jusqu’à ce qu’elle parte ; quand elle part enfin, Gladys apprend que le
projecteur est éteint. Leurs seuls refus :

- aucune adresse de nœud connue (aucune configurée, rien dans `/data`) ;
- « éteindre » seulement : un projecteur absent de la configuration ; avant sa
  lecture, un projecteur absent de `/data`, ou `/data` illisible, ou `/data`
  toujours pas lu après 1,5 s ;
- Blackout seulement : aucun projecteur ni univers connu (mêmes cas) ;
- l’intégration est en train de s’arrêter.

Si l’adresse du nœud devient invalide dans la configuration, « éteindre » et
Blackout partent vers la dernière adresse valide.

## Boutons

- **Tester le nœud** : envoie un ArtPoll et affiche le nom que le nœud donne
  dans son ArtPollReply (3 s au plus, une fois toutes les 10 s). Certains nœuds
  ne répondent qu’au port 6454, ou jamais : cela n’empêche pas l’envoi des
  trames DMX.
- **Blackout (tous les projecteurs à 0)** : voir plus haut.

## Statut

- _Prêt : N projecteur(s), trames vers adresse:port_ : la configuration est
  valide.
- _Les trames ne partent pas vers … (code)_ : le réseau refuse les datagrammes
  (câble, adresse) ; nouvel essai chaque seconde.
- _Configuration non lue_ : Gladys ne l’a pas donnée, nouvel essai après 5 s,
  puis jusqu’à toutes les 5 min.
- _Entrées ignorées_ : la position et la raison de chaque entrée en erreur.
- _Stockage /data illisible / non inscriptible_ : relu toutes les 10 s ;
  jusque-là, « éteindre » et Blackout ont besoin de la configuration.

## Limites

- 32 univers au plus démarrés dans une session (après plusieurs changements de
  configuration) : au-delà, allumage, luminosité, couleur et température sont
  refusés jusqu’au redémarrage de l’intégration ; « éteindre » et Blackout non.
- Un seul nœud. Plusieurs nœuds, la découverte ArtPoll, ArtSync et RDM ne sont
  pas faits.
- Canaux 8 bits seulement (pas de canaux « fins » 16 bits), pas de lyres, pas
  d’effets.
- Rien n’est relu : l’état est la dernière commande envoyée.

## Vie privée

Rien ne quitte votre réseau local. `/data` garde l’adresse du nœud et l’univers,
l’adresse et le profil de chaque projecteur (pas leurs noms).
