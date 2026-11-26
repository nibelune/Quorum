# 0007 : parties en équipes avec un capitaine

- Statut : acceptée
- Date : 2026-11-26

## Contexte

Quorum vise aussi les soirées quiz en bar, où l'on joue par table. Les membres d'une équipe discutent avant de répondre, avec parfois un seul téléphone par table, parfois un par personne.

## Options envisagées

1. **Chaque membre répond, le score de l'équipe est la moyenne.** Juste quelle que soit la taille des équipes, mais un membre distrait ou déconnecté fait baisser la note, et la discussion à table perd son intérêt.
2. **La première réponse d'un membre engage l'équipe.** Simple, mais un clic trop rapide pénalise tout le monde.
3. **Un capitaine répond pour l'équipe**, et ses coéquipiers voient son choix en direct.

## Décision

Option 3. Le créateur de l'équipe est capitaine. Si le capitaine part, le membre le plus ancien prend sa place. Le score se calcule comme en solo, sur la réponse et le temps de réponse du capitaine.

## Conséquences

- Le moteur gère un mode (`solo` ou `teams`) choisi à la création de la partie. En mode équipes, les classements portent sur les équipes.
- Un nouveau type de destinataire apparaît pour la diffusion : l'équipe. `project` filtre `team_answer_locked` pour que seule l'équipe concernée voie le choix de son capitaine.
- Le parcours pour rejoindre une partie gagne une étape : `lookup` donne la liste des équipes avant le `join`.
- L'équipe d'un joueur est fixée au `join`, ce qui permet de l'inscrire dans son jeton de session.
- Une table avec un seul téléphone est simplement une équipe d'un membre : aucun cas particulier à gérer.
- La taille des équipes n'est pas limitée. Une équipe nombreuse a un avantage pour trouver la bonne réponse, comme dans un quiz de bar classique.
