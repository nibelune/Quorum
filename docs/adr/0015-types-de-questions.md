# 0015 : types de questions

- Statut : acceptée
- Date : 2026-11-27

## Contexte

La phase 3 ajoute trois types de questions au QCM : le sondage, la remise dans l'ordre et le nuage de mots. Ils changent ce que l'animateur saisit, ce que voient les écrans, la façon de répondre et le calcul des points.

## Décision

- **Une union discriminée sur `kind`**, toujours dans la colonne `jsonb` des quiz (ADR 0009) : `choice` (QCM, dont le vrai/faux), `poll`, puis `order` et `wordcloud` à leur arrivée. Le protocole, le moteur, les écrans et les statistiques traitent chaque type par un `switch` exhaustif.
- **Une migration SQL** marque `choice` les questions déjà enregistrées, dans les quiz comme dans les parties jouées.
- **Sondage** (`poll`) : des choix sans bonne réponse. Il ne rapporte aucun point ; la révélation montre la répartition des votes.
- **Remise dans l'ordre** (`order`) : 3 ou 4 éléments, présentés mélangés sur chaque téléphone. Le score est « tout ou rien », avec la même formule de temps que le QCM.
- **Nuage de mots** (`wordcloud`) : une réponse libre de 20 caractères au plus, normalisée (casse, espaces). Il ne rapporte aucun point ; l'animateur peut masquer un mot sur l'écran projeté.
- En mode équipes, seul le capitaine répond, quel que soit le type.

## Conséquences

- Les questions existantes deviennent des QCM sans perte. Un quiz exporté avant ce changement (sans `kind`) n'est plus accepté à l'import.
- Chaque type ajouté touche le protocole, le moteur, l'éditeur, les deux écrans de jeu et les statistiques ; les `switch` exhaustifs signalent chaque endroit oublié.
- Les points d'une partie ne viennent que des QCM et des remises dans l'ordre : les statistiques comptent les bonnes réponses sur ces questions seulement.
